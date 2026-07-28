import { z } from "zod";
import { ENV } from "./_core/env";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import {
  // Transaction plumbing (atomic identity core)
  withTransaction,
  // V2 write functions
  upsertSubject, upsertPlatformHandle, type PlatformHandleWrite, insertObservation, insertCreatorObservation,
  insertSignalValues, insertDecodedSignals, insertContentItems,
  updateContentItemTranscript, updateObservationTranscriptCount,
  updateCreatorObservationAvgDuration, updateObservationPersistenceStatus,
  insertEvidenceSnapshots, insertLongitudinalSampleSnapshot, findExistingCreatorByHandle,
  insertBrandObservation, insertAudienceMentions,
  insertMatchScore, insertMatchNarrative, insertMatchWarnings, insertMatchOverlaps, insertMatchContentDirections,
  linkLlmInvocationsToMatch, getMatchLlmInvocations,
  insertScrapeEvent, insertLlmInvocation, getLlmTokenUsageByTimeWindow, getLlmTokenUsageBySubject,
  getLlmTokenUsageByRunId, getLatestObservationRun,
  setObservationReviewStatus, getRunDiagnostics, getStrategyOutcomesForRun, getEvidenceSnapshotByObservation,
  getLatestObservationId,
  recordPhaseObservation, getPhaseState,
  // V2 read functions
  getCreatorProfileById, listCreatorProfiles, deleteCreatorProfile, listArchivedCreatorRuns,
  getContentItemsBySubject, getProvenance,
  getBrandProfileById, listBrandProfiles, deleteBrandProfile,
  listMatchRecords, deleteMatchRecord, getMatchWithProfiles,
  getComparablePartnerships,
  type ContentItemsWriteResult,
} from "./db";
import { extractCreatorProfile, extractBrandProfile, generateFITNarrative, buildCreatorExtractionPrompts } from "./aiExtraction";
import { runFullFITCalculation, getBrandWeights, BRAND_WEIGHT_TABLE, ARCHETYPES } from "./fitEngine";
import { calculateAllSignals } from "./performanceSignals";
import { invokeLLM } from "./_core/llm";
import { runInstrumentedAnalysis } from "./_core/instrumentedRun";
import { withResourceSlot } from "./_core/resourceSlots";
import { runCreatorCampaign, type CreatorCampaignDeps } from "./phases/creatorCampaign";
import type { BrandCampaignDeps } from "./phases/brandCampaign";
import { submitCampaigns, getCampaignStatus, listCampaigns, requeueCampaignNow, isRunnableSubject, type SubmitRequest } from "./queue/analysisQueue";
import type { CreatorResearchResult } from "./webResearch";
import type { PhaseStateWrite } from "./db";
import type { RunOutcomeStatus } from "./db";
import { TRANSCRIPT_SOURCE } from "@shared/transcriptSource";
import { analyzeBrandTikTokChannel, formatBrandTikTokEvidenceBlock, type BrandTikTokMetadata, type MentionVideo } from "./brandTikTokAnalysis";
import { analyzeBrandInstagramChannel, formatBrandInstagramEvidenceBlock, type BrandInstagramMetadata } from "./brandInstagramAnalysis";
import { newRunId, withAnalysisRun, currentDeadlineAt } from "./_core/runContext";
import { decodeSubject } from "./_core/subjectIdentity";
import { assembleBrandEvidence, maybeDumpBrandBaseline, type BrandBaseEvidenceInputs, type BrandDecoderInputs, type BrandEvidenceParts } from "./phases/brandEvidence";
import { canonicalizeHandle } from "./_core/handles";
import type { DecodedSymbols } from "./symbolDecoder";
// Run machinery (concurrency limiter, failure classification, timeout race,
// terminal telemetry) moved to ./_core/instrumentedRun (scraper-reliability
// Part 4) — shared by analyze and reanalyze, pinned by instrumentedRun.test.ts.

// ─── V2 Pipeline Helpers ─────────────────────────────────────────────────────

// ─── Persistence-outcome tracking (womo_0005 hybrid model) ───────────────────
// The identity core (subject → observation → subtype row) commits atomically.
// Every enrichment write runs independently, records its own outcome into the
// map below, and never aborts sibling enrichments. The map is stored on
// observations.persistence_status and returned to the API caller.

export type EnrichmentOutcomeStatus =
  | "success"                // the component's write completed
  | "failed"                 // write attempted and errored (reason = error)
  | "skipped_no_data"        // subject genuinely has no such data (fact about subject)
  | "skipped_not_attempted"; // never attempted — config/feature gap or upstream failure

export type PersistenceStatusMap = Record<string, {
  status: EnrichmentOutcomeStatus;
  reason: string | null;
  at: string; // ISO-8601 UTC
}>;

type EnrichmentSkip = { skip: "skipped_no_data" | "skipped_not_attempted"; reason: string };

/**
 * What an enrichment action may report about its OWN outcome when the write
 * did not throw but also did not achieve what it claimed.
 *
 * The content_items attribution bug is the reason this exists: the upsert
 * succeeded, Postgres raised nothing, and the component recorded `success`
 * while every row it wrote stayed attached to an earlier observation. A
 * component that can tell it failed must be able to say so without inventing
 * an exception.
 */
type EnrichmentReport = { status: EnrichmentOutcomeStatus; reason: string };

function recordOutcome(
  map: PersistenceStatusMap,
  component: string,
  status: EnrichmentOutcomeStatus,
  reason: string | null = null,
): void {
  map[component] = { status, reason, at: new Date().toISOString() };
}

// ─── Creator campaign dependencies (S3b) ─────────────────────────────────────
//
// extract_commit runs inside the phase runner now, but the three things it needs
// — the LLM extraction, the evidence-snapshot builder, and persistCreatorToV2 —
// live here. Injecting them keeps `phases/` free of the routers↔webResearch
// cycle and lets a campaign run in tests without a database or an LLM.
//
// The fabrication guard, the extraction retry and the researchData mapping all
// moved into these deps VERBATIM. The `withResourceSlot("llm", …)` wrap that
// used to sit around the extraction is GONE — not moved: the scheduler already
// admits extract_commit against the llm bound (classForPhase), and wrapping it
// again would trip the nesting guard.

/** Extraction with the one-retry policy analyze has always applied. */
async function extractCreatorWithRetry(
  handleOrUrl: string, platform: string, evidenceSummary: string,
): Promise<Record<string, unknown>> {
  // Session 8: never extract on empty evidence. A collection failure already
  // rejects before this runs; this guard also closes the theoretical "succeeded
  // but empty evidence" case so the "use your own knowledge" prompt branch can
  // never fabricate a profile.
  if (!evidenceSummary) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `No usable evidence was collected for @${handleOrUrl}. Analysis was not saved.`,
    });
  }
  try {
    return await extractCreatorProfile(handleOrUrl, platform as never, evidenceSummary) as unknown as Record<string, unknown>;
  } catch (firstErr) {
    console.warn("[campaign] First extraction attempt failed, retrying:", firstErr);
    await new Promise(r => setTimeout(r, 1000));
    try {
      return await extractCreatorProfile(handleOrUrl, platform as never, evidenceSummary) as unknown as Record<string, unknown>;
    } catch {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Creator extraction failed after retry. Please try again.",
      });
    }
  }
}

/** The CreatorResearchResult → researchData mapping, moved verbatim from analyze. */
export function researchDataFromResult(research: CreatorResearchResult): Record<string, unknown> {
  return {
    followerCount: research.followerCount || undefined,
    // I1: thread followingCount from scraper data.
    followingCount: research.followingCount || undefined,
    totalLikes: research.totalLikes || undefined,
    // `||` (not `??`) is load-bearing: an Instagram capture that never saw a
    // posts count banks 0 with `videoCountUnavailableReason` beside it in the
    // capture output — 0 means UNKNOWN there, never "zero posts" (a genuinely
    // empty channel is refused by the gate before persistence). Dropping it to
    // undefined persists NULL, which is the honest DB value for unknown.
    videoCount: research.videoCount || undefined,
    totalViews: research.totalViews || undefined,
    avgViews: research.avgViews || undefined,
    engagementRate: research.engagementRate || undefined,
    location: research.location || undefined,
    bio: research.bio || undefined,
    rawKeywords: research.rawKeywords?.length ? research.rawKeywords : undefined,
    contentThemeLabels: research.contentThemeLabels?.length ? research.contentThemeLabels : undefined,
    topHashtags: research.topHashtags?.length ? research.topHashtags : undefined,
    recentVideoTitles: research.recentVideoTitles?.length ? research.recentVideoTitles : undefined,
    transcriptCount: research.transcriptCount ?? 0,
    transcriptExcerpts: research.transcriptExcerpts || undefined,
    decodedSymbols: research.decodedSymbols ?? undefined,
    culturalVelocity: research.culturalVelocity ?? undefined,
    dataConfidenceLevel: research.dataConfidenceLevel ?? undefined,
    sociologicalFieldsComputed: research.sociologicalFieldsComputed,
    foreignVideosRejected: research.foreignVideosRejected,
    longitudinalSampleJson: research.longitudinalSample as unknown as Record<string, unknown> ?? undefined,
    discoveredVideoPoolJson: research.discoveredVideoPool?.length ? research.discoveredVideoPool : undefined,
    transcripts: research.transcripts?.length ? research.transcripts : undefined,
  };
}

/** The dependency set every creator campaign runs with. */
export const creatorCampaignDeps: CreatorCampaignDeps = {
  extract: extractCreatorWithRetry,
  buildSnapshot: (handleOrUrl, platform, evidenceSummary, structured) =>
    buildCreatorEvidenceSnapshotPayload(handleOrUrl, platform, evidenceSummary, structured),
  persist: async (params) => {
    const research = params.research as CreatorResearchResult;
    const extracted = params.extracted as Record<string, unknown>;
    return persistCreatorToV2({
      handle: extracted.handle as string,
      platform: extracted.platform as string,
      profileUrl: (params.profileUrl as string | undefined) ?? undefined,
      displayName: extracted.displayName as string,
      pronouns: extracted.pronouns as string | undefined,
      extracted,
      researchData: researchDataFromResult(research),
      evidenceSnapshot: params.evidenceSnapshot as CreatorEvidenceSnapshotPayload,
    }) as unknown as Record<string, unknown>;
  },
  summarize: (result) => summarizePersistence(result as PersistResult),
  bank: (entry) => recordPhaseObservation({
    runId: entry.runId,
    subjectHint: entry.subjectHint,
    phase: entry.phase as PhaseStateWrite["phase"],
    tool: entry.tool,
    status: entry.status as PhaseStateWrite["status"],
    failureClass: entry.failureClass as PhaseStateWrite["failureClass"],
    attemptCount: entry.attemptCount,
    nextEarliestAt: entry.nextEarliestAt,
    output: entry.output,
  }),
  mark: (entry) => {
    void recordPhaseObservation({
      runId: entry.runId,
      subjectHint: entry.subjectHint,
      phase: entry.phase as PhaseStateWrite["phase"],
      tool: entry.tool,
      status: entry.status,
      attemptCount: entry.attempt,
    });
  },
};

/**
 * Brand extraction WITH the one-retry policy the endpoint has always applied.
 *
 * VERBATIM from `brand.analyze`: retry ONLY on a JSON/parse failure, after 1s,
 * once; any other error rethrows immediately, and a failed retry becomes the
 * frozen INTERNAL_SERVER_ERROR message. A transient LLM hiccup should not kill
 * an otherwise-good run, and a semantic failure should not be papered over by
 * asking twice.
 */
async function extractBrandWithRetry(
  brandNameOrUrl: string,
  _platform: string,
  evidenceSummary: string,
): Promise<Record<string, unknown>> {
  try {
    return await extractBrandProfile(brandNameOrUrl, evidenceSummary) as unknown as Record<string, unknown>;
  } catch (firstErr) {
    const errMsg = firstErr instanceof Error ? firstErr.message : String(firstErr);
    if (errMsg.includes("JSON") || errMsg.includes("parse") || errMsg.includes("Unexpected token")) {
      console.warn(`[brand.analyze] LLM JSON parse failed on first attempt: ${errMsg.slice(0, 500)}`);
      console.warn(`[brand.analyze] Retrying extraction after 1s delay...`);
      await new Promise(r => setTimeout(r, 1000));
      try {
        return await extractBrandProfile(brandNameOrUrl, evidenceSummary) as unknown as Record<string, unknown>;
      } catch {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Brand extraction failed after retry — please try again",
        });
      }
    }
    throw firstErr; // Non-JSON error, rethrow immediately
  }
}

/**
 * Validate the LLM's brandType, then weight it. VERBATIM from `brand.analyze`.
 *
 * P1-2: an LLM value outside BRAND_WEIGHT_TABLE is mapped to the closest key by
 * substring containment, or to "Retail — E-Commerce / DTC Product" — the entry
 * whose α/β/γ sit nearest the table-wide average across all 107 rows, and the
 * most semantically generic consumer key.
 *
 * MUTATES `extracted.brandType`, exactly as the endpoint does: the corrected
 * value is what gets persisted, not just what gets weighted.
 */
export function validateAndWeighBrandType(extracted: Record<string, unknown>) {
  const validBrandTypes = Object.keys(BRAND_WEIGHT_TABLE);
  const brandType = extracted.brandType as string;
  if (!validBrandTypes.includes(brandType)) {
    const invalidValue = brandType;
    const closestMatch = validBrandTypes.find(vbt =>
      vbt.toLowerCase().includes(invalidValue?.toLowerCase() ?? "") ||
      (invalidValue?.toLowerCase() ?? "").includes(vbt.toLowerCase())
    );
    const fallback = closestMatch || "Retail — E-Commerce / DTC Product";
    console.warn(`[brandType] Invalid value "${invalidValue}" received from LLM — defaulting to "${fallback}"`);
    extracted.brandType = fallback;
  }
  return getBrandWeights(extracted.brandType as string, extracted.campaignType as string | undefined);
}

/**
 * A brand's queue submission, built in ONE place.
 *
 * Both `brand.submit` and `brand.reanalyze` go through this rather than each
 * assembling its own descriptor. That is not tidiness: two hand-written copies
 * of the same submission is the exact drift that left `bulkAnalyze` without a
 * timeout, without terminal telemetry and without `followingCount` for months,
 * and the brand router carried two near-identical copies of the whole
 * orchestration until this session.
 *
 * Empty strings are dropped rather than passed through, so a brand submitted
 * with blank optional fields encodes to the SAME `subject_hint` as one
 * submitted without them — see _core/subjectIdentity for why that invariant is
 * load-bearing.
 */
export function brandSubmitRequest(input: {
  brandNameOrUrl: string;
  googleMapsUrl?: string;
  tiktokChannelUrl?: string;
  instagramHandle?: string;
}): SubmitRequest {
  return {
    handle: input.brandNameOrUrl,
    platform: "Brand",
    extras: {
      ...(input.googleMapsUrl?.trim() ? { googleMapsUrl: input.googleMapsUrl.trim() } : {}),
      ...(input.tiktokChannelUrl?.trim() ? { tiktokChannelUrl: input.tiktokChannelUrl.trim() } : {}),
      ...(input.instagramHandle?.trim() ? { instagramHandle: input.instagramHandle.trim() } : {}),
    },
  };
}

/** The dependency set every brand campaign runs with. */
export const brandCampaignDeps: BrandCampaignDeps = {
  ...creatorCampaignDeps,
  extract: extractBrandWithRetry,
  // Brand records no womo_0007 snapshot — persistBrandToV2 has no parameter for
  // one, and the endpoint never built one.
  buildSnapshot: () => null,
  persist: async (params) => persistBrandToV2(params as never) as unknown as Record<string, unknown>,
  weightsFor: validateAndWeighBrandType,
};

/**
 * Turn a platform-handle write into an honest outcome for persistence_status.
 *
 * ─── Why `failed` and not a skip ────────────────────────────────────────────
 * The two skip kinds both mean "no write was owed": `skipped_no_data` is a fact
 * about the subject (it has no such handle) and `skipped_not_attempted` means we
 * never tried. Neither is true here. We had a handle, we attempted the write,
 * and the subject ends up WITHOUT the row it should own — the write did not
 * achieve what it claimed. That is the definition of `failed`, and it is the
 * same call `reportContentItemsWrite` makes for the identical situation one
 * table over.
 *
 * The reason names the owning subject id, because the first question anyone asks
 * is "then who has it?" and the answer decides whether this is a duplicate
 * subject to merge or a genuine collision between two different real accounts.
 *
 * Shared by the creator core and the brand enrichment so the two cannot drift
 * into reporting the same event differently.
 */
export function platformHandleCollisionReport(
  write: PlatformHandleWrite,
  label: string,
): EnrichmentReport {
  const reason =
    `${label} is already owned by subject ${write.ownerSubjectId} — ` +
    `handles are globally unique per platform (handles_lookup_idx), so no row was written for this subject`;
  console.warn(`[persist] platform handle collision: ${reason}`);
  return { status: "failed", reason };
}

/** The same verdict, recorded directly — for callers outside `runEnrichment`. */
function recordPlatformHandleOutcome(
  map: PersistenceStatusMap,
  component: string,
  write: PlatformHandleWrite | null,
  label: string,
): void {
  if (!write) {
    // Unreachable while the transaction assigns it, but a silent `success` here
    // would be the very failure mode this component exists to end.
    recordOutcome(map, component, "failed", `${label}: handle write did not run`);
    return;
  }
  if (write.outcome === "claimed_by_other") {
    const report = platformHandleCollisionReport(write, label);
    recordOutcome(map, component, report.status, report.reason);
    return;
  }
  recordOutcome(map, component, "success");
}

/**
 * Turn a content_items write into an honest outcome for persistence_status.
 *
 * "We wrote rows" and "this observation owns evidence" are different claims,
 * and until the unique key includes observation_id they can diverge silently on
 * any re-analysis. Shared by the creator path and all three brand paths, which
 * call the same insertContentItems and therefore have the same failure mode.
 */
export function reportContentItemsWrite(
  result: ContentItemsWriteResult,
  requested: number,
  label: string,
): EnrichmentReport | void {
  if (requested > 0 && result.attributed === 0) {
    return {
      status: "failed",
      reason:
        `${requested} ${label} written but ZERO attributed to this observation — ` +
        `all ${result.collided} collided with rows owned by an earlier observation ` +
        `(content_items' unique key omits observation_id). This observation has no content evidence of its own.`,
    };
  }
  if (result.collided > 0) {
    return {
      status: "success",
      reason:
        `${result.attributed} of ${requested} ${label} attributed to this observation; ` +
        `${result.collided} stayed attached to an earlier observation.`,
    };
  }
}

/**
 * Extract the root-cause message for provenance. Drizzle wraps driver errors
 * ("Failed query: insert into ... params: ...") with the real Postgres error
 * on `cause` — the cause is the signal, the wrapper is mostly noise.
 */
function describeError(err: unknown): string {
  if (err instanceof Error) {
    const cause = (err as { cause?: unknown }).cause;
    const causeMsg = cause instanceof Error ? cause.message : cause ? String(cause) : "";
    return (causeMsg || err.message).slice(0, 500);
  }
  return String(err).slice(0, 500);
}

/**
 * Run one enrichment write. A thrown error is recorded as `failed` and does NOT
 * propagate — a broken enrichment must never prevent the others from saving.
 *
 * An action may also RETURN an `EnrichmentReport` to record a non-success
 * outcome without throwing, for the case where the write completed but did not
 * accomplish its purpose (see EnrichmentReport).
 */
async function runEnrichment(
  map: PersistenceStatusMap,
  component: string,
  action: EnrichmentSkip | (() => Promise<void | EnrichmentReport>),
): Promise<void> {
  if (typeof action !== "function") {
    recordOutcome(map, component, action.skip, action.reason);
    return;
  }
  try {
    const report = await action();
    if (report) {
      if (report.status !== "success") {
        console.warn(`[persist] Enrichment '${component}' → ${report.status}: ${report.reason}`);
      }
      recordOutcome(map, component, report.status, report.reason);
    } else {
      recordOutcome(map, component, "success");
    }
  } catch (err) {
    console.error(`[persist] Enrichment '${component}' failed (continuing with others):`, err);
    recordOutcome(map, component, "failed", describeError(err));
  }
}

/**
 * Evidence snapshot payload (womo_0007): built by the analyze/reanalyze/bulk
 * handlers with the SAME (handleOrUrl, platform, evidenceSummary) triple that
 * extractCreatorProfile received, so the persisted prompt is byte-identical to
 * what the LLM saw. Capture only — nothing about the pipeline's LLM input
 * changes.
 */
export type CreatorEvidenceSnapshotPayload = {
  inputsJson: string;
  promptText: string;
  promptMeta: Record<string, unknown>;
};

/** Exported for the identity harness (evidenceIdentity.test.ts): the womo_0007
 *  snapshot is the byte-comparison surface for the phased-architecture program. */
export function buildCreatorEvidenceSnapshotPayload(
  handleOrUrl: string,
  platform: string,
  evidenceSummary: string | undefined,
  structuredInputs: unknown,
): CreatorEvidenceSnapshotPayload {
  const prompts = buildCreatorExtractionPrompts(handleOrUrl, platform, evidenceSummary);
  return {
    inputsJson: JSON.stringify({
      schemaVersion: 1,
      handleOrUrl,
      platform,
      evidenceSummary: evidenceSummary ?? null,
      structuredInputs,
    }),
    promptText: prompts.userPrompt,
    promptMeta: {
      systemPrompt: prompts.systemPrompt,
      model: prompts.model,
      purpose: prompts.purpose,
      temperature: prompts.temperature,
    },
  };
}

/**
 * Persist a full creator analysis result to the V2 schema.
 * Identity core is atomic; enrichments are independent and status-tracked.
 */
type PersistSuccess = { subjectId: string; observationId: string; persistence: PersistenceStatusMap };
type PersistFailure = { error: string };
type PersistResult = PersistSuccess | PersistFailure;

/**
 * API-facing persistence outcome. The analyze/reanalyze endpoints must never
 * report plain success when persistence partially or wholly failed:
 *  - saved "full"    — identity core + every attempted enrichment succeeded
 *                      (skips are legitimate absences, not failures)
 *  - saved "partial" — identity core saved, but ≥1 enrichment failed
 *  - saved "none"    — identity core rolled back; nothing persisted
 */
export type PersistenceSummary = {
  saved: "full" | "partial" | "none";
  failedComponents: string[];
  error: string | null;
  components: PersistenceStatusMap | null;
};

function summarizePersistence(result: PersistResult): PersistenceSummary {
  if ("error" in result) {
    return { saved: "none", failedComponents: [], error: result.error, components: null };
  }
  const failedComponents = Object.entries(result.persistence)
    .filter(([, o]) => o.status === "failed")
    .map(([component]) => component);
  return {
    saved: failedComponents.length === 0 ? "full" : "partial",
    failedComponents,
    error: null,
    components: result.persistence,
  };
}

// Exported for the Docker Postgres integration suite (server/integration/) —
// not part of the public API surface.
export async function persistCreatorToV2(params: {
  handle: string;
  platform: string;
  profileUrl?: string;
  displayName: string;
  pronouns?: string;
  extracted: Record<string, any>;
  researchData: Record<string, any>;
  /** womo_0007: evidence snapshot to persist alongside the observation */
  evidenceSnapshot?: CreatorEvidenceSnapshotPayload;
}): Promise<PersistResult> {
  try {
    const { platform, profileUrl, displayName, pronouns, extracted, researchData } = params;
    // Session 7: the persisted subject key is the CANONICAL handle (extracted
    // from URL/@-prefix, lowercased) — not the LLM's raw echo. This makes
    // storage and duplicate-pre-flight lookup share one key across analyze,
    // reanalyze, and bulk.
    const handle = canonicalizeHandle(params.handle) || params.handle;

    // ── ATOMIC IDENTITY CORE ──
    // subject → platform handle → observation → creator_observation commit as
    // ONE transaction: either the whole identity chain persists or none of it
    // does (no orphaned observations / handles). The platform handle is part of
    // the core because it FK-references the subject created in the same
    // transaction. Enrichments (signals, content items, transcripts) are
    // written independently below.
    /**
     * The handle write's outcome, carried OUT of the transaction.
     *
     * A collision must not abort the core: a subject without its handle row is a
     * DEGRADED result, not a dead one, and throwing here would roll back the
     * subject, the observation and the creator_observation over a row that
     * already exists under another owner. So the outcome is captured and
     * reported afterwards, alongside every other component.
     */
    let handleWrite: PlatformHandleWrite | null = null;

    const { subjectId, observationId } = await withTransaction(async (tx) => {
      // 1. upsertSubject
      const subjectId = await upsertSubject({
        subjectType: "creator",
        primaryHandle: handle,
        primaryPlatform: platform,
        displayName,
        profileUrl,
        pronouns,
        latestArchetype: extracted.archetype,
        engagementTier: computeEngagementTierLocal(researchData.followerCount),
      }, tx);

      // 2. upsertPlatformHandle — never throws on a collision; see handleWrite.
      handleWrite = await upsertPlatformHandle(subjectId, platform, handle, profileUrl, tx);

      // 3. insertObservation — review gate (womo_0006): creator runs persist as
      // 'pending' and await analyst acceptance before entering the corpus.
      const observationId = await insertObservation(subjectId, {
        followerCount: researchData.followerCount ?? null,
        followingCount: researchData.followingCount ?? null,
        engagementRate: researchData.engagementRate ?? null,
        bio: researchData.bio ?? null,
        dataConfidenceLevel: researchData.dataConfidenceLevel ?? null,
        transcriptCount: researchData.transcriptCount ?? 0,
        reviewStatus: "pending",
      }, tx);

      // 4. insertCreatorObservation
      await insertCreatorObservation(observationId, {
        totalLikes: researchData.totalLikes ?? null,
        videoCount: researchData.videoCount ?? null,
        totalViews: researchData.totalViews ?? null,
        avgViews: researchData.avgViews ?? null,
        avgVideoDuration: null, // I2: computed after contentItems insertion below
        primaryRegion: researchData.location ?? null,
        archetype: extracted.archetype,
        toneRegister: extracted.toneRegister,
        parasocialBondStrength: extracted.parasocialBondStrength,
        audienceRelationshipType: extracted.audienceRelationshipType,
        barthesMyth: extracted.barthesMyth,
        culturalCapital: extracted.culturalCapital,
        goffmanStageConsistency: extracted.goffmanStageConsistency,
        driftSignal: extracted.driftSignal,
        stuartHallDecoding: extracted.stuartHallDecoding,
        nicheTopicNode: extracted.nicheTopicNode,
        undergroundDensity: extracted.undergroundDensity,
        mainstreamBleed: extracted.mainstreamBleed,
        remixRate: extracted.remixRate,
        brandSaturation: extracted.brandSaturation,
        rogersAdopterStage: extracted.rogersAdopterStage,
        creatorNichePosition: extracted.creatorNichePosition,
        lifecyclePhase: extracted.lifecyclePhase,
        barthesNicheMeaning: extracted.barthesNicheMeaning,
        turnerLiminalPhase: extracted.turnerLiminalPhase,
        culturalVelocity: researchData.culturalVelocity ?? null,
        symbolicSummary: (researchData.decodedSymbols as any)?.symbolicSummary ?? null,
        aiSummary: extracted.aiSummary,
      }, tx);

      return { subjectId, observationId };
    });

    // ── INDEPENDENT ENRICHMENTS — each records its own outcome, none aborts the others ──
    const persistence: PersistenceStatusMap = {};
    /**
     * `identity_core` stays SUCCESS in a handle collision, and that is not a
     * softened verdict — it is the accurate one.
     *
     * The core's claim is atomicity: subject, handle, observation and
     * creator_observation commit together or not at all, so that no orphaned
     * observation or handle can exist. In a collision the handle row DOES exist
     * (owned by another subject), nothing is orphaned, and every row the
     * transaction is responsible for was written. Reporting `failed` here would
     * say the identity chain did not persist, which is false and would send
     * anyone triaging it to the wrong table.
     *
     * The ownership loss is a different fact and gets its own component below,
     * so both are legible at once instead of one masking the other.
     */
    recordOutcome(persistence, "identity_core", "success");
    recordPlatformHandleOutcome(persistence, "platform_handle", handleWrite, `@${handle} on ${platform}`);

    // 5. insertSignalValues
    const signals: Array<{ domain: string; signalKey: string; rank?: number; source?: string }> = [];
    (researchData.rawKeywords as string[] ?? []).forEach((k: string, i: number) =>
      signals.push({ domain: "keyword", signalKey: k, rank: i + 1, source: "creator" }));
    (researchData.contentThemeLabels as string[] ?? []).forEach((t: string, i: number) =>
      signals.push({ domain: "content_theme", signalKey: t, rank: i + 1, source: "creator" }));
    (researchData.topHashtags as string[] ?? []).forEach((h: string, i: number) =>
      signals.push({ domain: "hashtag", signalKey: h, rank: i + 1, source: "creator" }));
    (extracted.recurringThemes as string[] ?? []).forEach((t: string, i: number) =>
      signals.push({ domain: "theme", signalKey: t, rank: i + 1, source: "creator" }));
    await runEnrichment(persistence, "signal_values",
      signals.length === 0
        ? { skip: "skipped_no_data", reason: "no keywords/themes/hashtags extracted for this creator" }
        : () => insertSignalValues(subjectId, observationId, signals));

    // 6. insertDecodedSignals
    const ds = researchData.decodedSymbols as DecodedSymbols | null;
    const decodedRows: Array<{ category: string; phrase: string; meaning: string; informsFields?: string[]; source?: string }> = [];
    if (ds) {
      (ds.identityClaims ?? []).forEach(s => decodedRows.push({ category: "identity_claim", phrase: s.phrase, meaning: s.meaning, informsFields: s.informs, source: "creator" }));
      (ds.statusSignals ?? []).forEach(s => decodedRows.push({ category: "status_signal", phrase: s.phrase, meaning: s.meaning, informsFields: s.informs, source: "creator" }));
      (ds.communityReferences ?? []).forEach(s => decodedRows.push({ category: "community_reference", phrase: s.phrase, meaning: s.meaning, informsFields: s.informs, source: "creator" }));
      (ds.aspirationDrivers ?? []).forEach(s => decodedRows.push({ category: "aspiration_driver", phrase: s.phrase, meaning: s.meaning, informsFields: s.informs, source: "creator" }));
    }
    await runEnrichment(persistence, "decoded_signals",
      decodedRows.length === 0
        ? { skip: "skipped_no_data", reason: "symbol decoder produced no signals for this creator" }
        : () => insertDecodedSignals(subjectId, observationId, decodedRows));

    // 7. insertContentItems (discoveredVideoPool with engagement stats)
    type PoolVideo = { id: string; url: string; caption: string; createTime: number; views: number; likes: number; comments: number; saves: number; shares: number; musicOriginal: boolean; musicTitle?: string; musicArtist?: string; durationSec: number; videoUrl?: string; transcriptText?: string; transcriptWordCount?: number; transcriptSource?: string; temporalBucket?: string };
    const rawPool = researchData.discoveredVideoPoolJson as PoolVideo[] ?? [];
    console.log(`[persist] discoveredVideoPool received: ${rawPool.length} videos`);
    const contentRows = rawPool.map(v => ({
      platform,
      platformVideoId: v.id,
      videoUrl: v.videoUrl || v.url,
      caption: v.caption,
      createTime: v.createTime,
      viewCount: v.views,
      likeCount: v.likes,
      commentCount: v.comments,
      shareCount: v.shares,
      saveCount: v.saves,
      isOriginalAudio: v.musicOriginal,
      musicTitle: v.musicTitle,
      musicArtist: v.musicArtist,
      videoDuration: v.durationSec,
      transcriptText: v.transcriptText,
      transcriptSource: v.transcriptSource,
      transcriptWordCount: v.transcriptWordCount,
      // C3: 6-3-3 sample membership persists at INSERT time for all sampled
      // videos — previously the bucket only landed via a successful transcript
      // (updateContentItemTranscript), so subtitle-less creators lost their
      // longitudinal structure. status semantics unchanged (transcript-derived).
      temporalBucket: v.temporalBucket,
      status: v.transcriptText ? "sampled" : "discovered",
    }));
    await runEnrichment(persistence, "content_items",
      contentRows.length === 0
        ? { skip: "skipped_no_data", reason: "no videos in discovered pool" }
        : async () => {
            const written = await insertContentItems(subjectId, observationId, contentRows);
            console.log(`[persist] insertContentItems: ${contentRows.length} rows written for subject ${subjectId} (${written.attributed} attributed to this observation, ${written.collided} collided)`);
            return reportContentItemsWrite(written, contentRows.length, "videos");
          });

    // I2: Compute avgVideoDuration from actual content_items data
    const videosWithDuration = contentRows.filter(v => v.videoDuration && v.videoDuration > 0);
    await runEnrichment(persistence, "avg_video_duration",
      videosWithDuration.length === 0
        // Session 10: distinguish a SCRAPE capture gap from a genuine data absence.
        // If we captured videos but none carried a duration, that's our scrape not
        // capturing video.duration (skipped_not_attempted), NOT the subject lacking
        // data (skipped_no_data — reserved for a creator with no videos at all).
        ? (contentRows.length > 0
            ? { skip: "skipped_not_attempted" as const, reason: "video duration not present in the scraped payloads (capture gap, not a subject-data absence)" }
            : { skip: "skipped_no_data" as const, reason: "no videos captured for this creator" })
        : () => {
            const totalDuration = videosWithDuration.reduce((sum, v) => sum + (v.videoDuration ?? 0), 0);
            const avgDuration = Math.round((totalDuration / videosWithDuration.length) * 10) / 10;
            return updateCreatorObservationAvgDuration(observationId, avgDuration);
          });

    // 8. Wire transcripts into content_items rows
    const transcriptArray = researchData.transcripts as Array<{ videoId: string; transcript: string; wordCount: number; transcriptSource?: string; bucket?: string }> ?? [];
    let transcriptSuccessCount = 0;
    await runEnrichment(persistence, "transcripts",
      transcriptArray.length === 0
        ? { skip: "skipped_no_data", reason: "no transcripts fetched for this creator" }
        : async () => {
            for (const t of transcriptArray) {
              if (t.videoId && t.transcript) {
                const updated = await updateContentItemTranscript(
                  // womo_0011: scoped to THIS observation. Unscoped, a success
                  // here could be another observation's row — which is how a
                  // content-less observation still reported transcript_count 8
                  // and confidence "high".
                  subjectId, observationId, t.videoId, platform,
                  t.transcript, t.transcriptSource ?? TRANSCRIPT_SOURCE.subtitle, t.wordCount,
                  // Session 8: carry the 6-3-3 bucket onto content_items.temporal_bucket
                  t.bucket ?? null,
                );
                if (updated) transcriptSuccessCount++;
              }
            }
          });

    // FIX 8.2: Always update observation with actual transcript count and derived confidence.
    // This is the single source of truth — overrides any preliminary value from webResearch.ts.
    const confidence: "high" | "medium" | "low" =
      transcriptSuccessCount >= 6 ? "high" :
      transcriptSuccessCount >= 3 ? "medium" : "low";
    await runEnrichment(persistence, "transcript_count",
      () => updateObservationTranscriptCount(observationId, transcriptSuccessCount, confidence));

    // Evidence snapshot (womo_0007): structured inputs + exact extraction
    // prompt, keyed by the ambient run id. Capture-only.
    await runEnrichment(persistence, "evidence_snapshot",
      !params.evidenceSnapshot
        ? { skip: "skipped_not_attempted", reason: "caller provided no evidence snapshot payload" }
        : () => insertEvidenceSnapshots({
            subjectId,
            observationId,
            kindPrefix: "creator",
            inputsJson: params.evidenceSnapshot!.inputsJson,
            promptText: params.evidenceSnapshot!.promptText,
            promptMeta: params.evidenceSnapshot!.promptMeta,
          }));

    // Session 8: persist the VERBATIM 6-3-3 longitudinal sample (womo_0007
    // snapshot mechanism, document_type 'creator_longitudinal_sample'). The
    // per-video temporal_bucket written above makes the sample functional in the
    // read model + diagnostics NOW; this preserves the exact sampler output
    // (fill-forward decisions, ordering, completeness, culturalVelocity) that a
    // content_items reconstruction cannot fully recover. Only the TikTok path
    // produces a longitudinal sample.
    const longitudinalSampleJson = researchData.longitudinalSampleJson as Record<string, unknown> | undefined;
    await runEnrichment(persistence, "longitudinal_sample",
      !longitudinalSampleJson
        ? { skip: "skipped_no_data", reason: "no longitudinal sample produced (non-TikTok path or no dated videos)" }
        : () => insertLongitudinalSampleSnapshot({
            subjectId,
            observationId,
            sampleJson: JSON.stringify(longitudinalSampleJson),
          }));

    // Record the outcome map on the observation row. Best-effort: a failure to
    // record status must not turn an otherwise-successful persist into an error.
    // Session 8: attach a reserved, non-component `_meta` key marking whether the
    // sociological fields (parasocialBondStrength / audienceRelationshipType /
    // culturalCapital / remixRate) were data-computed (TikTok engagement signals)
    // or LLM-estimated (Instagram / YouTube). The VALUES are unchanged — only
    // their provenance is recorded. getRunDiagnostics skips reserved keys in its
    // component loop and surfaces this as sociologicalFieldsProvenance. The clean
    // component map is still what is returned to the API caller below.
    const persistenceWithMeta = {
      ...persistence,
      _meta: {
        sociologicalFieldsProvenance: researchData.sociologicalFieldsComputed ? "computed" : "estimated",
        // Session 10: videos rejected by the author guard (foreign / author-less),
        // so an analyst can see "N videos excluded — author mismatch".
        pool: { authorRejected: Number(researchData.foreignVideosRejected ?? 0) },
      },
    };
    try {
      await updateObservationPersistenceStatus(observationId, persistenceWithMeta);
    } catch (err) {
      console.error("[persist] Failed to write persistence_status (creator):", err);
    }

    return { subjectId, observationId, persistence };
  } catch (err) {
    console.error("[V2 Pipeline] Creator persist failed:", err);
    return { error: describeError(err) };
  }
}

/**
 * Persist a full brand analysis result to the V2 schema.
 */
// Exported for the Docker Postgres integration suite (server/integration/) —
// not part of the public API surface.
export async function persistBrandToV2(params: {
  brandName: string;
  brandUrl?: string;
  category?: string;
  extracted: Record<string, any>;
  weights: { alpha: number; beta: number; gamma: number; priority: string };
  reviewFields: Record<string, any>;
  tiktokMetadata: BrandTikTokMetadata | null;
  instagramMetadata?: BrandInstagramMetadata | null;
  mentionFields: Record<string, any>;
  symbolFields: Record<string, any>;
  dataConfidenceLevel?: string;
  semanticWordCount?: number;
  crawledPagesCount?: number;
  /** Whether a TikTok channel URL was supplied — distinguishes skipped_not_attempted from skipped_no_data */
  tiktokRequested?: boolean;
  /** Whether an Instagram handle was supplied — distinguishes skipped_not_attempted from skipped_no_data */
  instagramRequested?: boolean;
  /**
   * Review recency/trajectory (S5). RECORDED, NOT READ — it lands in the
   * reserved `_meta` key and reaches neither the evidence string nor scoring.
   * Jason's question 20 decides whether it ever should.
   */
  reviewTrajectory?: unknown;
}): Promise<PersistResult> {
  try {
    const { brandName, brandUrl, category, extracted, weights, reviewFields, tiktokMetadata, instagramMetadata, mentionFields, symbolFields } = params;

    // ── ATOMIC IDENTITY CORE ──
    // subject → observation → brand_observation commit as ONE transaction:
    // either the whole identity chain persists or none of it does. Enrichments
    // (signals, mentions, content items, IG handle) are written independently
    // below.
    const tiktokHandle = tiktokMetadata?.channelHandle ?? null;
    // Use the higher follower count between TikTok and Instagram
    const bestFollowerCount = Math.max(
      tiktokMetadata?.followerCount ?? 0,
      instagramMetadata?.followerCount ?? 0,
    ) || null;

    const { subjectId, observationId } = await withTransaction(async (tx) => {
      // 1. upsertSubject
      const subjectId = await upsertSubject({
        subjectType: "brand",
        displayName: brandName,
        websiteUrl: brandUrl,
        brandCategory: category ?? extracted.category,
        latestArchetype: extracted.archetype,
        latestBrandArchetype: extracted.brandArchetypeClassification,
        brandType: extracted.brandType,
        campaignType: extracted.campaignType,
      }, tx);

      // 2. insertObservation
      const observationId = await insertObservation(subjectId, {
        followerCount: bestFollowerCount,
        engagementRate: tiktokMetadata?.engagementRate ?? instagramMetadata?.engagementRate ?? null,
        dataConfidenceLevel: params.dataConfidenceLevel ?? null,
      }, tx);

      // 3. insertBrandObservation
      await insertBrandObservation(observationId, {
        brandArchetypeClassification: extracted.brandArchetypeClassification,
        archetype: extracted.archetype,
        emotionalPromise: extracted.emotionalPromise,
        audienceTribe: extracted.audienceTribe,
        culturalTension: extracted.culturalTension,
        brandTone: extracted.brandTone,
        barthesMyth: extracted.barthesMyth,
        brandCulturalCapital: extracted.brandCulturalCapital,
        brandGoffmanConsistency: extracted.brandGoffmanStageConsistency,
        brandDriftSignal: extracted.brandDriftSignal,
        brandHallDecoding: extracted.brandStuartHallDecoding,
        brandRogersStage: extracted.brandRogersAdopterStage,
        brandLiminalPhase: extracted.brandTurnerLiminalPhase,
        brandLifecyclePhase: extracted.brandLifecyclePhase,
        brandBarthesNicheMeaning: extracted.brandBarthesNicheMeaning,
        brandAudienceDecodingSplit: extracted.brandAudienceDecodingSplit,
        weightAlpha: weights.alpha,
        weightBeta: weights.beta,
        weightGamma: weights.gamma,
        weightPriority: weights.priority,
        googleRating: reviewFields.googleRating ?? null,
        googleReviewCount: reviewFields.googleReviewCount ?? null,
        googleReviewExcerpts: reviewFields.googleReviewExcerpts ?? null,
        yelpRating: reviewFields.yelpRating ?? null,
        yelpReviewCount: reviewFields.yelpReviewCount ?? null,
        overallRating: reviewFields.overallRating ?? null,
        totalReviews: reviewFields.totalReviews ?? null,
        tiktokHandle,
        tiktokFollowerCount: tiktokMetadata?.followerCount ?? null,
        tiktokEngagementRate: tiktokMetadata?.engagementRate ?? null,
        mentionTotalCount: mentionFields.mentionTotalCount ?? null,
        mentionUniqueAuthors: mentionFields.mentionUniqueAuthors ?? null,
        mentionSentiment: mentionFields.mentionSentiment ?? null,
        mentionSentimentConfidence: mentionFields.mentionSentimentConfidence ?? null,
        mentionAudienceSummary: mentionFields.mentionAudienceSummary ?? null,
        symbolicSummary: symbolFields.brandDecodedSymbols?.symbolicSummary ?? null,
        aiSummary: extracted.aiSummary,
        yelpReviewExcerpts: reviewFields.yelpReviewExcerpts ?? null,
        semanticWordCount: params.semanticWordCount ?? null,
        crawledPagesCount: params.crawledPagesCount ?? null,
      }, tx);

      return { subjectId, observationId };
    });

    // ── INDEPENDENT ENRICHMENTS — each records its own outcome, none aborts the others ──
    // Review data (google/yelp ratings + excerpts) is persisted as columns on
    // the brand_observations row, i.e. inside the atomic identity core above —
    // it has no separate component entry here.
    const persistence: PersistenceStatusMap = {};
    recordOutcome(persistence, "identity_core", "success");

    const tiktokRequested = params.tiktokRequested ?? tiktokMetadata !== null;
    const instagramRequested = params.instagramRequested ?? instagramMetadata != null;

    // Shared gate for TikTok-channel-derived components
    const tiktokGate: EnrichmentSkip | null =
      !tiktokRequested
        ? { skip: "skipped_not_attempted", reason: "no TikTok channel URL provided" }
        : tiktokMetadata === null
          ? { skip: "skipped_not_attempted", reason: "TikTok channel analysis failed upstream — no data reached persistence" }
          : null;
    // Shared gate for Instagram-derived components
    const instagramGate: EnrichmentSkip | null =
      !instagramRequested
        ? { skip: "skipped_not_attempted", reason: "no Instagram handle provided" }
        : instagramMetadata == null
          ? { skip: "skipped_not_attempted", reason: "Instagram channel analysis failed upstream — no data reached persistence" }
          : null;

    // 4. insertSignalValues (brand keywords, themes, visual language, symbolic vocab, mention signals)
    const signals: Array<{ domain: string; signalKey: string; rank?: number; source?: string }> = [];
    const bk = symbolFields.brandRawKeywords ?? tiktokMetadata?.rawKeywords ?? [];
    (bk as string[]).forEach((k: string, i: number) => signals.push({ domain: "keyword", signalKey: k, rank: i + 1, source: "brand" }));
    const bt = symbolFields.brandThemeLabels ?? tiktokMetadata?.themeLabels ?? [];
    (bt as string[]).forEach((t: string, i: number) => signals.push({ domain: "content_theme", signalKey: t, rank: i + 1, source: "brand" }));
    (extracted.visualLanguage as string[] ?? []).forEach((v: string, i: number) => signals.push({ domain: "visual_language", signalKey: v, rank: i + 1, source: "brand" }));
    const sv = symbolFields.brandSymbolicVocabulary ?? tiktokMetadata?.symbolicVocabulary ?? [];
    (sv as string[]).forEach((s: string, i: number) => signals.push({ domain: "symbolic_vocabulary", signalKey: s, rank: i + 1, source: "brand" }));
    // Mention signals
    (mentionFields.mentionHashtagCloud as string[] ?? []).forEach((h: string, i: number) => signals.push({ domain: "hashtag", signalKey: h, rank: i + 1, source: "audience" }));
    (mentionFields.mentionRawKeywords as string[] ?? []).forEach((k: string, i: number) => signals.push({ domain: "identity_claim", signalKey: k, rank: i + 1, source: "audience" }));
    (mentionFields.mentionMusicSignals as string[] ?? []).forEach((m: string, i: number) => signals.push({ domain: "music_title", signalKey: m, rank: i + 1, source: "audience" }));
    (mentionFields.mentionMusicArtists as string[] ?? []).forEach((a: string, i: number) => signals.push({ domain: "music_artist", signalKey: a, rank: i + 1, source: "audience" }));
    await runEnrichment(persistence, "signal_values",
      signals.length === 0
        ? { skip: "skipped_no_data", reason: "no brand/mention signals extracted" }
        : () => insertSignalValues(subjectId, observationId, signals));

    // 5. insertDecodedSignals (brand decoded symbols — mirror creator pattern)
    const bds = symbolFields.brandDecodedSymbols as import("./brandSymbolDecoder").BrandDecodedSymbols | null;
    const tiktokDss = tiktokMetadata?.decodedSymbols as Array<{ phrase: string; meaning: string; category: string; source?: string }> | undefined;
    const decodedRows: Array<{ category: string; phrase: string; meaning: string; informsFields?: string[]; source?: string }> = [];
    if (bds) {
      // BrandDecodedSymbols is an object with nested arrays — destructure like creator pipeline
      (bds.identityClaims ?? []).forEach(s => decodedRows.push({ category: "identity_claim", phrase: s.phrase, meaning: s.meaning, informsFields: s.informs, source: "brand" }));
      (bds.statusSignals ?? []).forEach(s => decodedRows.push({ category: "status_signal", phrase: s.phrase, meaning: s.meaning, informsFields: s.informs, source: "brand" }));
      (bds.communityReferences ?? []).forEach(s => decodedRows.push({ category: "community_reference", phrase: s.phrase, meaning: s.meaning, informsFields: s.informs, source: "brand" }));
      (bds.aspirationDrivers ?? []).forEach(s => decodedRows.push({ category: "aspiration_driver", phrase: s.phrase, meaning: s.meaning, informsFields: s.informs, source: "brand" }));
      (bds.audienceLanguage ?? []).forEach(s => decodedRows.push({ category: "audience_language", phrase: s.phrase, meaning: s.meaning, informsFields: s.informs, source: "audience" }));
    } else if (tiktokDss && Array.isArray(tiktokDss)) {
      // Fallback: TikTok channel decoded symbols (flat array from Track A LLM)
      tiktokDss.forEach(s => decodedRows.push({
        category: s.category, phrase: s.phrase, meaning: s.meaning, source: s.source ?? "brand",
      }));
    }
    await runEnrichment(persistence, "decoded_signals",
      decodedRows.length === 0
        ? { skip: "skipped_no_data", reason: "symbol decoder produced no signals for this brand" }
        : () => insertDecodedSignals(subjectId, observationId, decodedRows));

    // 6. insertAudienceMentions (raw mention videos)
    const rawMentions = (mentionFields.mentionDecodedSymbols as any)?.rawMentionVideos as MentionVideo[] ?? [];
    await runEnrichment(persistence, "audience_mentions",
      rawMentions.length === 0
        ? { skip: "skipped_no_data", reason: "no audience mention videos found" }
        : () => insertAudienceMentions(subjectId, observationId, rawMentions.map((m: MentionVideo) => ({
            platform: "TikTok",
            mentionVideoId: m.videoId,
            authorHandle: m.authorHandle,
            caption: m.caption,
            viewCount: m.plays,
            likeCount: m.likes,
            commentCount: m.comments,
            shareCount: m.shares,
            saveCount: m.saves,
            musicTitle: m.musicTitle,
            musicArtist: m.musicArtist,
          }))));

    // 7. insertContentItems (brand TikTok channel videos)
    const brandVideos = tiktokMetadata?.videoTranscripts ?? [];
    await runEnrichment(persistence, "channel_content_items",
      tiktokGate ?? (brandVideos.length === 0
        ? { skip: "skipped_no_data", reason: "TikTok channel has no analyzable videos" }
        : async () => {
            const contentRows = brandVideos.map((v, i) => ({
              platform: "TikTok" as const,
              platformVideoId: v.videoId || `brand-video-${i}`,
              caption: v.caption,
              transcriptText: v.transcriptText ?? undefined,
              transcriptWordCount: v.transcriptWordCount ?? undefined,
              transcriptSource: v.transcriptSource ?? undefined,
              createTime: v.postedDate ? Math.floor(new Date(v.postedDate).getTime() / 1000) : undefined,
              status: v.transcriptText ? "sampled" : "discovered",
            }));
            const written = await insertContentItems(subjectId, observationId, contentRows);
            console.log(`[persist] Brand channel videos: ${contentRows.length} rows written (${written.attributed} attributed, ${written.collided} collided)`);
            return reportContentItemsWrite(written, contentRows.length, "channel videos");
          }));

    // 8. insertContentItems (audience mention videos as 'mention' status)
    await runEnrichment(persistence, "mention_content_items",
      rawMentions.length === 0
        ? { skip: "skipped_no_data", reason: "no audience mention videos found" }
        : async () => {
            const mentionContentRows = rawMentions.slice(0, 50).map(m => ({
              platform: "TikTok" as const,
              platformVideoId: m.videoId,
              caption: m.caption,
              viewCount: m.plays,
              likeCount: m.likes,
              commentCount: m.comments,
              shareCount: m.shares,
              saveCount: m.saves,
              musicTitle: m.musicTitle,
              musicArtist: m.musicArtist,
              createTime: m.createdAt || undefined,
              status: "mention",
            }));
            const written = await insertContentItems(subjectId, observationId, mentionContentRows);
            console.log(`[persist] Audience mention videos: ${mentionContentRows.length} rows written (${written.attributed} attributed, ${written.collided} collided)`);
            return reportContentItemsWrite(written, mentionContentRows.length, "mention videos");
          });

    // 9. Instagram platform handle
    await runEnrichment(persistence, "instagram_handle",
      instagramGate ?? (!instagramMetadata?.channelHandle
        ? { skip: "skipped_no_data", reason: "Instagram analysis returned no channel handle" }
        : async () => {
            const write = await upsertPlatformHandle(
              subjectId,
              "instagram",
              instagramMetadata.channelHandle,
              `https://www.instagram.com/${instagramMetadata.channelHandle}/`,
            );
            // A collision must be REPORTED, not logged as "saved" — this
            // component said success while writing nothing for the live
            // Glossier run. `runEnrichment` records whatever this returns.
            if (write.outcome === "claimed_by_other") {
              return platformHandleCollisionReport(
                write, `@${instagramMetadata.channelHandle} on instagram`,
              );
            }
            console.log(`[persist] Instagram handle @${instagramMetadata.channelHandle} saved`);
          }));

    // 10. Instagram post content items
    await runEnrichment(persistence, "instagram_content_items",
      instagramGate ?? (!instagramMetadata?.postCaptions?.length
        ? { skip: "skipped_no_data", reason: "Instagram analysis returned no post captions" }
        : async () => {
            /**
             * STABLE IDS, NOT POSITIONS.
             *
             * This used to key each post by `ig-post-${handle}-${i}`. Position
             * is not identity: a re-analysis whose feed moved by one writes
             * post #3's caption over a DIFFERENT post #3. womo_0011's
             * observation-scoped index contains the damage to a single
             * observation, but the ids were still unsound.
             *
             * The identity was never missing — `analyzeBrandInstagramChannel`
             * was discarding it when it mapped posts down to bare captions.
             * `postRefs` carries it; `postCaptions` stays exactly as it was
             * because it is fed verbatim to the model.
             *
             * Falls back to the positional form only for metadata recorded
             * before postRefs existed, so an old in-flight result still writes.
             */
            const igContentRows = (instagramMetadata.postRefs?.length
              ? instagramMetadata.postRefs.map(ref => ({
                  platform: "instagram" as const,
                  platformVideoId: ref.id,
                  caption: ref.caption,
                  status: "sampled",
                }))
              : instagramMetadata.postCaptions!.map((caption, i) => ({
                  platform: "instagram" as const,
                  platformVideoId: `ig-post-${instagramMetadata.channelHandle}-${i}`,
                  caption,
                  status: "sampled",
                })));
            const written = await insertContentItems(subjectId, observationId, igContentRows);
            console.log(`[persist] Instagram post captions: ${igContentRows.length} rows written (${written.attributed} attributed, ${written.collided} collided)`);
            return reportContentItemsWrite(written, igContentRows.length, "Instagram posts");
          }));

    // 11. Instagram signal values (keywords, themes, vocab from LLM analysis)
    const igSignals: Array<{ domain: string; signalKey: string; rank?: number; source?: string }> = [];
    if (instagramMetadata) {
      (instagramMetadata.rawKeywords ?? []).forEach((k, i) => igSignals.push({ domain: "keyword", signalKey: k, rank: i + 1, source: "instagram" }));
      (instagramMetadata.themeLabels ?? []).forEach((t, i) => igSignals.push({ domain: "content_theme", signalKey: t, rank: i + 1, source: "instagram" }));
      (instagramMetadata.symbolicVocabulary ?? []).forEach((s, i) => igSignals.push({ domain: "symbolic_vocabulary", signalKey: s, rank: i + 1, source: "instagram" }));
    }
    await runEnrichment(persistence, "instagram_signal_values",
      instagramGate ?? (igSignals.length === 0
        ? { skip: "skipped_no_data", reason: "Instagram analysis produced no signals" }
        : async () => {
            await insertSignalValues(subjectId, observationId, igSignals);
            console.log(`[persist] Instagram signal values: ${igSignals.length} rows written`);
          }));

    // 12. Instagram decoded signals
    await runEnrichment(persistence, "instagram_decoded_signals",
      instagramGate ?? (!instagramMetadata?.decodedSymbols?.length
        ? { skip: "skipped_no_data", reason: "Instagram analysis produced no decoded symbols" }
        : async () => {
            const igDecodedRows = instagramMetadata.decodedSymbols!.map(s => ({
              category: s.category,
              phrase: s.phrase,
              meaning: s.meaning,
              source: "instagram",
            }));
            await insertDecodedSignals(subjectId, observationId, igDecodedRows);
            console.log(`[persist] Instagram decoded signals: ${igDecodedRows.length} rows written`);
          }));

    // Record the outcome map on the observation row. Best-effort: a failure to
    // record status must not turn an otherwise-successful persist into an error.
    //
    // `_meta` is the reserved, non-component key (getRunDiagnostics skips it in
    // its component loop). The review trajectory rides there because it is a
    // FACT ABOUT THE EVIDENCE, not an enrichment outcome — and because putting
    // it anywhere the model reads would be a ruling nobody has made.
    const brandPersistenceWithMeta = params.reviewTrajectory
      ? { ...persistence, _meta: { reviewTrajectory: params.reviewTrajectory } }
      : persistence;
    try {
      await updateObservationPersistenceStatus(observationId, brandPersistenceWithMeta);
    } catch (err) {
      console.error("[persist] Failed to write persistence_status (brand):", err);
    }

    return { subjectId, observationId, persistence };
  } catch (err) {
    console.error("[V2 Pipeline] Brand persist failed (non-fatal):", err);
    return { error: describeError(err) };
  }
}

function computeEngagementTierLocal(followers: number | undefined | null): string | undefined {
  if (!followers) return undefined;
  if (followers < 10_000) return "nano";
  if (followers < 100_000) return "micro";
  if (followers < 500_000) return "mid";
  if (followers < 1_000_000) return "macro";
  return "mega";
}

export const appRouter = router({
  system: systemRouter,

  // ─── Creator Routes ─────────────────────────────────────────────────────────
  creator: router({
    // Duplicate pre-flight (Session 7): read-only check the client calls BEFORE
    // starting an analysis. Returns the existing profile summary when the
    // canonicalized handle already exists as a creator subject.
    preflight: publicProcedure
      .input(z.object({
        handleOrUrl: z.string().min(1),
        platform: z.enum(["TikTok", "Instagram"]),
      }))
      .query(async ({ input }) => {
        const existing = await findExistingCreatorByHandle(input.handleOrUrl, input.platform);
        return { existing };
      }),

    /**
     * SUBMIT — the single entry point for all creator analysis (S3b).
     *
     * New analysis, re-analysis, one handle or twenty: same call, same code
     * path. The array length is the only difference. There is no synchronous
     * variant and no "run now" bypass; a single creator is a queue of one.
     *
     * Returns as soon as the campaigns are DURABLY enqueued. Poll
     * `creator.queue.status` for progress — it reports real ledger state, never
     * an estimate.
     */
    submit: publicProcedure
      .input(z.object({
        handles: z.array(z.string().min(1)).min(1).max(50),
        // A platform is queueable only while it has a REGISTERED toolset.
        // YouTube is disabled (see YOUTUBE_TOOLSET in phases/platformTools.ts),
        // so it is rejected here at the edge — zod answers BAD_REQUEST before a
        // campaign row exists, rather than letting it fail deep in the runner.
        platform: z.enum(["TikTok", "Instagram"]),
        /** Session 7: required to proceed when a handle already exists. */
        confirmDuplicate: z.boolean().optional(),
      }))
      .mutation(async ({ input }) => {
        // Duplicate gate (Session 7) — still BEFORE enqueue, so the analyst
        // confirms before anything is queued rather than after it has run.
        if (!input.confirmDuplicate) {
          const duplicates: string[] = [];
          for (const handle of input.handles) {
            const existing = await findExistingCreatorByHandle(handle, input.platform);
            if (existing) {
              const last = existing.lastAnalyzedAt
                ? new Date(existing.lastAnalyzedAt).toISOString().slice(0, 10)
                : "unknown date";
              duplicates.push(`@${existing.handle ?? canonicalizeHandle(handle)} (last analyzed ${last}, status: ${existing.reviewStatus ?? "unknown"})`);
            }
          }
          if (duplicates.length > 0) {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: `A profile already exists for ${duplicates.join("; ")}. Re-submit with confirmation to queue a new analysis.`,
            });
          }
        }

        const campaigns = await submitCampaigns(
          input.handles.map(handle => ({ handle, platform: input.platform })),
        );
        return { campaigns };
      }),

    /**
     * Queue view: one campaign, or a list. Real ledger state, READ ONLY.
     *
     * `includeTerminal` switches the underlying question from "what is still in
     * flight?" to "what has this system done?". Without it the view is
     * structurally incapable of showing a completed or failed campaign — the
     * in-flight query excludes both by design — which measured as 0 of 40
     * campaigns visible.
     */
    queueStatus: publicProcedure
      .input(z.object({
        runId: z.string().uuid().optional(),
        includeTerminal: z.boolean().optional(),
        limit: z.number().int().min(1).max(200).optional(),
      }))
      .query(async ({ input }) => {
        if (input.runId) {
          const one = await getCampaignStatus(input.runId);
          return { campaigns: one ? [one] : [] };
        }
        return {
          campaigns: await listCampaigns(input.limit ?? 50, {
            includeTerminal: input.includeTerminal,
          }),
        };
      }),

    /**
     * Per-strategy attempt outcomes for one campaign. READ ONLY.
     *
     * A phase reports a single outcome, so a strategy chain whose middle
     * strategy contributes nothing is indistinguishable from one that works —
     * which is how `subtitle_browser` reached 227 attempts and 0 successes
     * unnoticed. The events were always recorded; nothing read them back.
     */
    strategyBreakdown: publicProcedure
      .input(z.object({ runId: z.string().uuid() }))
      .query(async ({ input }) => {
        return { rows: await getStrategyOutcomesForRun(input.runId) };
      }),

    list: publicProcedure
      .input(z.object({
        search: z.string().optional(),
        /** true = accepted only — for matching/creator-selection surfaces (womo_0006) */
        matchableOnly: z.boolean().optional(),
      }))
      .query(async ({ input }) => {
        return listCreatorProfiles(input.search, { matchableOnly: input.matchableOnly });
      }),

    // Archived (declined) runs — retained, never deleted; browsable for
    // scraper-failure analysis (womo_0006).
    listArchived: publicProcedure
      .query(async () => {
        return listArchivedCreatorRuns();
      }),

    get: publicProcedure
      .input(z.object({ id: z.string() }))
      .query(async ({ input }) => {
        const profile = await getCreatorProfileById(input.id);
        if (!profile) throw new Error("Creator profile not found");
        return profile;
      }),

    delete: publicProcedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ input }) => {
        await deleteCreatorProfile(input.id);
        return { success: true };
      }),

    getContentItems: publicProcedure
      .input(z.object({ subjectId: z.string() }))
      .query(async ({ input }) => {
        return getContentItemsBySubject(input.subjectId);
      }),

    // ─── Review gate (womo_0006) ────────────────────────────────────────────
    // Accept: the run enters the corpus and becomes the authoritative
    // observation (is_latest transfers to it).
    // Decline: status change ONLY — the run is archived with full provenance,
    // never deleted.
    acceptObservation: publicProcedure
      .input(z.object({
        observationId: z.string().uuid(),
        reviewedBy: z.string().min(1).max(64),
      }))
      .mutation(async ({ input }) => {
        return setObservationReviewStatus(input.observationId, "accepted", input.reviewedBy);
      }),

    declineObservation: publicProcedure
      .input(z.object({
        observationId: z.string().uuid(),
        reviewedBy: z.string().min(1).max(64),
      }))
      .mutation(async ({ input }) => {
        return setObservationReviewStatus(input.observationId, "declined", input.reviewedBy);
      }),

    // Factual diagnostic breakdown for an observation/run (womo_0006) — the
    // data an analyst reviews before accepting or declining. Facts and counts
    // only; no derived quality metrics.
    getDiagnostics: publicProcedure
      .input(z.object({ observationId: z.string().uuid() }))
      .query(async ({ input }) => {
        const diagnostics = await getRunDiagnostics(input.observationId);
        if (!diagnostics) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Observation not found" });
        }
        return diagnostics;
      }),

    // Session 9 (A7): let the analyst read exactly what the model received.
    getEvidenceSnapshot: publicProcedure
      .input(z.object({ observationId: z.string() }))
      .query(async ({ input }) => {
        return getEvidenceSnapshotByObservation(input.observationId);
      }),

    getProvenance: publicProcedure
      .input(z.object({ observationId: z.string() }))
      .query(async ({ input }) => {
        return getProvenance(input.observationId);
      }),

    getPipelineMetrics: publicProcedure
      .input(z.object({ subjectId: z.string(), observedAt: z.string().optional() }))
      .query(async ({ input }) => {
        // Exact per-run lookup when the observation carries a run_id (womo_0006);
        // the by-subject / time-window paths remain only for pre-run_id rows.
        const latestRun = await getLatestObservationRun(input.subjectId).catch(() => null);
        if (latestRun?.runId) {
          const exact = await getLlmTokenUsageByRunId(latestRun.runId).catch(() => null);
          if (exact) return exact;
        }

        // Try by subjectId first, fall back to time window around observedAt
        let metrics = await getLlmTokenUsageBySubject(input.subjectId).catch(() => null);
        if (metrics && metrics.llmCalls > 0) return metrics;

        // Subject wasn't set on invocations — query by time window around observation
        if (input.observedAt) {
          const obsDate = new Date(input.observedAt);
          const windowStart = new Date(obsDate.getTime() - 5 * 60_000); // 5 min before
          const windowEnd = new Date(obsDate.getTime() + 60_000); // 1 min after (LLM logs can trail slightly)
          metrics = await getLlmTokenUsageByTimeWindow(windowStart, windowEnd).catch(() => null);
          if (metrics && metrics.llmCalls > 0) return metrics;
        }

        return { inputTokens: 0, outputTokens: 0, totalTokens: 0, llmCalls: 0, model: "unknown" };
      }),

    /**
     * RE-ANALYSIS — a queue submission like any other (S3b).
     *
     * It differs from a first analysis in exactly one way: the subject already
     * exists, so the duplicate gate is implicitly confirmed. Mechanism, code
     * path and result shape are identical. It used to be a second full copy of
     * the orchestration, which is how it drifted (it dropped followingCount for
     * months).
     */
    reanalyze: publicProcedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ input }) => {
        const existing = await getCreatorProfileById(input.id);
        if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Creator profile not found" });
        const lower = String(existing.platform).toLowerCase();
        // YouTube is intentionally absent: legacy YouTube profiles are still
        // readable, but they cannot be re-analysed while the platform has no
        // registered toolset.
        const platform = lower === "instagram" ? "Instagram" as const
          : lower === "tiktok" ? "TikTok" as const
          : null;
        if (!platform) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `Re-analysis supports TikTok and Instagram (this profile is ${existing.platform}).`,
          });
        }
        const campaigns = await submitCampaigns([{ handle: existing.handle ?? input.id, platform }]);
        return { campaigns };
      }),

    // ─── M3 resume, superseded (S3b) ──────────────────────────────────────────
    // The dead-key class — capture/augment/transcribe succeeded, then derive or
    // extract_commit failed and minutes of scraping were discarded — is now
    // handled AUTOMATICALLY: the queue's boot loop resumes every incomplete
    // campaign, and the runner skips phases already banked as usable, so only
    // the failed phase re-runs. This endpoint remains as the manual nudge for a
    // campaign parked on backoff that an analyst does not want to wait for.
    resumeRun: publicProcedure
      .input(z.object({ runId: z.string().uuid() }))
      .mutation(async ({ input }) => {
        const rows = await getPhaseState(input.runId);
        if (rows.length === 0) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `Run ${input.runId} is not in the ledger — there is nothing to resume.`,
          });
        }
        /**
         * The guard here said "TikTok campaigns only … Instagram/YouTube land in
         * S4". Instagram landed in S4 and brand in S5, so it had been refusing
         * work the worker could run for two sessions — and it was a SECOND copy
         * of a rule that belongs to the queue. It now asks the queue.
         *
         * The check is kept rather than dropped because requeueing a subject the
         * worker will skip would report `requeued: true` for a campaign that can
         * never advance.
         */
        const { platform } = decodeSubject(rows[0]!.subjectHint);
        if (!isRunnableSubject(platform)) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `Run ${input.runId} is a ${platform} campaign, which has no registered phase toolset — resuming it would never advance.`,
          });
        }
        // Clear the backoff gate so the next drain picks it up immediately.
        await requeueCampaignNow(input.runId);
        return { runId: input.runId, requeued: true };
      }),

    ingestSupplementalVideo: publicProcedure
      .input(z.object({
        creatorProfileId: z.string(),
        videoUrl: z.string().url(),
        videoId: z.string(),
        caption: z.string().default(""),
      }))
      .mutation(async ({ input }) => {
        const { fetchSingleTikTokTranscript } = await import("./webResearch");
        const profile = await getCreatorProfileById(input.creatorProfileId);
        if (!profile) throw new Error("Creator profile not found");

        // Fetch transcript for this specific video
        const transcript = await fetchSingleTikTokTranscript(input.videoUrl, input.videoId, input.caption);

        // Always remove this video from the pool (whether or not we got a transcript)
        const currentPool = (profile.discoveredVideoPoolJson as Array<{ id: string; url: string; caption: string; createTime: number }> | null) ?? [];
        const updatedPool = currentPool.filter(v => v.id !== input.videoId);

        if (!transcript) {
          // No captions available — remove from pool so user doesn't retry indefinitely
          // V2: supplemental video results are not stored via updateCreatorProfile anymore.
          // The pool is tracked in content_items. No incremental update needed.
          return {
            success: false,
            noCaptions: true,
            videoId: input.videoId,
            transcriptWordCount: 0,
            newTranscriptCount: profile.transcriptCount ?? 0,
            newDataConfidence: (profile.dataConfidenceLevel ?? "low") as "high" | "medium" | "low",
            transcriptExcerpt: "",
          };
        }

        // Append to existing transcript excerpts
        const existingExcerpts = profile.transcriptExcerpts ?? "";
        const newExcerpt = `[${input.caption.slice(0, 40) || "video"}]: ${transcript.transcript.slice(0, 200)}`;
        const updatedExcerpts = existingExcerpts
          ? `${existingExcerpts}\n\n${newExcerpt}`
          : newExcerpt;

        // Update transcript count and excerpts
        const newCount = (profile.transcriptCount ?? 0) + 1;
        const newConfidence: "high" | "medium" | "low" =
          newCount >= 6 ? "high" : newCount >= 3 ? "medium" : "low";

        // V2: Store the transcript as a content_item linked to the latest observation
        try {
          const latestObsId = await getLatestObservationId(input.creatorProfileId);
          if (!latestObsId) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "No observation found for this creator",
            });
          }
          await insertContentItems(input.creatorProfileId, latestObsId, [{
            platform: profile.platform as string,
            platformVideoId: input.videoId,
            videoUrl: input.videoUrl,
            caption: input.caption,
            transcriptText: transcript.transcript,
            transcriptWordCount: transcript.wordCount,
            // Session 9: use the transcript's actual source (fetchSingleTikTokTranscript
            // returns a WEBVTT subtitle or a post-caption fallback) instead of the
            // hardcoded "whisper" that never reflected reality.
            transcriptSource: transcript.transcriptSource ?? TRANSCRIPT_SOURCE.subtitle,
            status: "transcribed",
          }]);
        } catch (err) {
          console.error("[ingestSupplementalVideo] Failed to store content item:", err);
        }

        return {
          success: true,
          noCaptions: false,
          videoId: input.videoId,
          transcriptWordCount: transcript.wordCount,
          newTranscriptCount: newCount,
          newDataConfidence: newConfidence,
          transcriptExcerpt: transcript.transcript.slice(0, 300),
        };
      }),
  }),


    // bulkAnalyze REMOVED (S3b). Bulk is no longer a concept: `creator.submit`
    // takes n handles and one handle through the identical path. The old
    // endpoint was a third copy of the orchestration and had drifted badly — no
    // timeout, no memory tracker, no terminal pipeline_runs telemetry, no
    // extraction retry, and it dropped followingCount. It also had no client
    // surface at all. One entry point cannot drift from itself.


    // ─── Brand Routes ───────────────────────────────────────────────────────────
  brand: router({
    /**
     * SUBMIT — the queue entry point for brand analysis (S5).
     *
     * The brand mirror of `creator.submit`: durably enqueued, then run by the
     * same worker on the same ledger with the same retry, park and resume. Poll
     * `creator.queue.status` for progress — the queue view is subject-agnostic
     * and reads real ledger state.
     *
     * ─── The locators travel as EXTRAS ──────────────────────────────────────
     * A brand is not one handle. Its Maps URL, TikTok channel and Instagram
     * handle are carried in the structured subject descriptor, so the campaign
     * banks under exactly the `subject_hint` the queue enqueued it as, and phases
     * 2, 3 and 4 receive what they need on a RESUMED run without the submitting
     * request still being alive. Empty strings are dropped by `encodeSubject`, so
     * a brand with no channels encodes identically to one submitted without the
     * fields at all.
     *
     * There is now ONE way in. `brand.analyze` — the synchronous endpoint that
     * ran the whole orchestration inline — is gone (S5), and `brand.reanalyze`
     * enqueues through the same builder as this. A single brand is a queue of
     * one, exactly as a single creator is.
     */
    submit: publicProcedure
      .input(z.object({
        brandNameOrUrl: z.string().min(1),
        tiktokChannelUrl: z.string().optional().or(z.literal("")),
        instagramHandle: z.string().optional().or(z.literal("")),
        googleMapsUrl: z.string().optional().or(z.literal("")),
      }))
      .mutation(async ({ input }) => {
        const campaigns = await submitCampaigns([brandSubmitRequest(input)]);
        return { campaigns };
      }),

    list: publicProcedure
      .input(z.object({ search: z.string().optional() }))
      .query(async ({ input }) => {
        return listBrandProfiles(input.search);
      }),

    get: publicProcedure
      .input(z.object({ id: z.string() }))
      .query(async ({ input }) => {
        const profile = await getBrandProfileById(input.id);
        if (!profile) throw new Error("Brand profile not found");
        return profile;
      }),

    delete: publicProcedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ input }) => {
        await deleteBrandProfile(input.id);
        return { success: true };
      }),

    /**
     * RE-ANALYSE — the stored profile, back through the queue.
     *
     * Resolves the saved brand into the SAME submit request `brand.submit`
     * builds, then enqueues it. Both endpoints go through `brandSubmitRequest`
     * rather than each assembling its own: two hand-written copies of a subject
     * descriptor is precisely the drift that cost the creator side
     * `followingCount` for months, and brand had two near-identical copies of
     * the whole orchestration.
     *
     * The stored locators are the defaults; the caller may override the
     * Instagram handle and Maps URL, which is what the old endpoint allowed and
     * what an analyst uses when the first run had the wrong listing.
     */
    reanalyze: publicProcedure
      .input(z.object({
        id: z.string(),
        instagramHandle: z.string().optional().or(z.literal("")),
        googleMapsUrl: z.string().optional().or(z.literal("")),
      }))
      .mutation(async ({ input }) => {
        const existing = await getBrandProfileById(input.id);
        if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Brand profile not found" });

        const campaigns = await submitCampaigns([brandSubmitRequest({
          // The URL when we have one — a name-only brand has nothing to crawl,
          // and capture's `isUrl` test is what decides that.
          brandNameOrUrl: existing.brandUrl || existing.brandName,
          googleMapsUrl: input.googleMapsUrl,
          tiktokChannelUrl: existing.tiktokChannelUrl ?? undefined,
          instagramHandle: input.instagramHandle?.trim() || existing.instagramHandle || undefined,
        })]);
        return { campaigns };
      }),
  }),

    // ─── Cultural Match Score Routes ─────────────────────────────────────────────────────────────────────────────
  fit: router({
    calculate: publicProcedure
      .input(z.object({
        creatorProfileId: z.string(),
        brandProfileId: z.string(),
      }))
      .mutation(async ({ input }) => {
        const creator = await getCreatorProfileById(input.creatorProfileId);
        const brand = await getBrandProfileById(input.brandProfileId);
        if (!creator) throw new Error("Creator profile not found");
        if (!brand) throw new Error("Brand profile not found");

        // Review-gate eligibility (womo_0006): only ACCEPTED creator profiles
        // are matchable. Eligibility filter ONLY — the scoring engine is not
        // touched. Brands are not gated this session (Session 7).
        if (creator.reviewStatus !== "accepted") {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `Creator profile is ${creator.reviewStatus} — only accepted profiles can be matched. Review the analysis run first.`,
          });
        }

        // ── Derive myth alignment score from Barthes myth sentence overlap ──
        // Both profiles carry a barthesMyth field extracted by the AI.
        // We compute a heuristic score (0–10) by asking the LLM to compare them.
        // Fallback: 5 (neutral) if either field is missing.
        let mythAlignmentScore: number | null = null;
        let tribMatchScore: number | null = null;
        let mythLlmFailed = false;
        // Degradation markers (Session 5): scoring behavior is FROZEN — these
        // only record when a result rests on fallbacks instead of real
        // computation, so a degraded score is distinguishable from a real one.
        const scoreDegradationReasons: string[] = [];
        // M1 item 6: invocation ids of this calculation's LLM calls, linked to
        // the match row AFTER persist (the FK forbids writing them earlier).
        // Failed calls throw before their result object exists, so only
        // successful calls are linkable — a failed call is named in the
        // degradation record instead.
        const matchLlmInvocationIds: Array<Promise<string | null>> = [];

        if (creator.barthesMyth && brand.barthesMyth) {
          try {
            // Extract semantic overlap data for richer tribe matching
            const creatorKeywords = (creator.rawKeywords as string[] | null) ?? [];
            const creatorVocab = (creator.decodedSymbols as Record<string, unknown> | null)?.symbolicVocabulary as string[] ?? [];
            const brandKeywords = (brand.brandRawKeywords as string[] | null) ?? [];
            const brandVocab = (brand.brandDecodedSymbols as Record<string, unknown> | null)?.symbolicVocabulary as string[] ?? [];
            
            // Extract mention keywords if available
            let brandMentionKeywords: string[] = [];
            if (brand.tiktokMetadata) {
              try {
                const metadata = typeof brand.tiktokMetadata === 'string' 
                  ? JSON.parse(brand.tiktokMetadata) 
                  : brand.tiktokMetadata;
                if (metadata.mentionHashtags) {
                  brandMentionKeywords = metadata.mentionHashtags.slice(0, 10);
                }
              } catch (err) {
                // Previously an empty catch — the LLM then scored on reduced
                // context with no trace. Keep the fallback (FROZEN) but record it.
                console.warn("[fit.calculate] brand tiktokMetadata unparseable — mention keywords omitted from myth-scoring context:", err);
                scoreDegradationReasons.push("brand mention metadata unparseable — myth/tribe scoring ran on reduced context");
              }
            }
            
            // Build semantic context for the LLM
            const semanticContext = `
ADDITIONAL SEMANTIC SIGNALS:
Creator Keywords: ${creatorKeywords.slice(0, 10).join(", ") || "none"}
Creator Vocabulary: ${creatorVocab.slice(0, 10).join(", ") || "none"}
Brand Keywords: ${brandKeywords.slice(0, 10).join(", ") || "none"}
Brand Vocabulary: ${brandVocab.slice(0, 10).join(", ") || "none"}
Brand Audience Mentions (TikTok): ${brandMentionKeywords.join(", ") || "none"}`;
            
            const mythResponse = await invokeLLM({
              purpose: "myth_tension_analysis",
              messages: [
                {
                  role: "system",
                  content: `You are a cultural semiotics analyst scoring the mythological alignment between a creator and a brand for an influencer marketing platform.

Creator Barthes Myth: "${creator.barthesMyth}"
Creator Tone Register: "${creator.toneRegister ?? "not specified"}"
Creator Audience Relationship: "${creator.audienceRelationshipType ?? ""}"
Creator Cultural Capital: "${creator.culturalCapital ?? ""}"
Creator Stuart Hall Decoding: "${creator.stuartHallDecoding ?? "Dominant"}"

Brand Barthes Myth: "${brand.barthesMyth}"
Brand Tone Register: "${(brand as Record<string, unknown>).brandTone ?? "not specified"}"
Brand Audience Tribe: "${brand.audienceTribe ?? ""}"
Brand Cultural Tension: "${brand.culturalTension ?? ""}"
Brand Archetype Classification: "${brand.brandArchetypeClassification ?? ""}"

${semanticContext}

SCORING RULES:
- If creator tone is anti-establishment, rebellious, or oppositional AND brand is institutional, corporate, or formal: mythAlignmentScore should be 1-3 (severe mismatch)
- If creator and brand share the same symbolic territory (both community-driven, both aspirational, both playful): mythAlignmentScore should be 7-10
- If creator's Stuart Hall Decoding is Oppositional: apply a -2 penalty to mythAlignmentScore
- tribMatchScore measures whether the creator's actual audience would authentically receive this brand — not just whether the brand wants that audience
- Use semantic keyword overlap as an additional signal: shared keywords between creator and brand vocabulary suggest stronger tribe match
- Consider brand audience mentions (TikTok): if audiences are talking about the brand in positive terms, boost tribMatchScore

Score 1: mythAlignmentScore (0–10) — How closely do the creator's and brand's mythological narratives and tones align? Same symbolic territory = 10, completely opposed = 1.
Score 2: tribMatchScore (0–10) — How well does the creator's audience relationship type match the brand's target tribe? Perfect match = 10, mismatch = 1.

Return ONLY valid JSON: {"mythAlignmentScore": <number>, "tribMatchScore": <number>}`,
                },
                { role: "user", content: "Score the alignment." },
              ],
              response_format: {
                type: "json_schema",
                json_schema: {
                  name: "myth_trib_scores",
                  strict: true,
                  schema: {
                    type: "object",
                    properties: {
                      mythAlignmentScore: { type: "number" },
                      tribMatchScore: { type: "number" },
                    },
                    required: ["mythAlignmentScore", "tribMatchScore"],
                    additionalProperties: false,
                  },
                },
              },
            });
            const parsed = JSON.parse(mythResponse.choices[0]?.message?.content as string);
            if (mythResponse.invocationIdPromise) matchLlmInvocationIds.push(mythResponse.invocationIdPromise);
            mythAlignmentScore = Math.min(10, Math.max(0, Number(parsed.mythAlignmentScore) || 3));
            tribMatchScore = Math.min(10, Math.max(0, Number(parsed.tribMatchScore) || 3));
          } catch (err) {
            // FIX 5: Log clearly and use cautious fallback (3.0) instead of false-neutral (5.0)
            console.error("[fit.calculate] myth/tribe LLM failed — scores will be defaulted:", err);
            mythAlignmentScore = null;
            tribMatchScore = null;
            mythLlmFailed = true;
            scoreDegradationReasons.push("myth/tribe LLM failed — mythAlignmentScore and tribMatchScore are fallback defaults (3.0), not computed");
          }
        } else {
          scoreDegradationReasons.push("barthesMyth missing on creator and/or brand — mythAlignmentScore and tribMatchScore are fallback defaults (3.0), not computed");
        }

        // Extract symbolic vocabulary arrays for overlap calculation
        const creatorDecodedSymbols = creator.decodedSymbols as Record<string, unknown> | null;
        const brandDecodedSymbols = brand.brandDecodedSymbols as Record<string, unknown> | null;
        const creatorKeywords = (creator.rawKeywords as string[] | null) ?? [];
        const creatorThemes = (creator.contentThemeLabels as string[] | null) ?? [];
        const brandKeywords = (brand.brandRawKeywords as string[] | null) ?? [];
        const brandThemes = (brand.brandThemeLabels as string[] | null) ?? [];

        // Phase 6: Extract music signals from creator transcripts and brand mention data
        const creatorTranscripts = ((creator as unknown as Record<string, unknown>).transcripts as Array<Record<string, unknown>> | null) ?? [];
        const creatorMusicTitles: string[] = creatorTranscripts
          .map(t => (t.musicMetadata as Record<string, unknown> | undefined)?.soundName as string | undefined)
          .filter((s): s is string => Boolean(s));
        const creatorMusicArtists: string[] = []; // TikTok API doesn't return artist separately for creators
        const brandMentionMusicTitles = (brand.mentionMusicSignals as string[] | null) ?? [];
        const brandMentionMusicArtists = (brand.mentionMusicArtists as string[] | null) ?? [];

        // Also pull from decodedSymbols if rawKeywords are sparse
        if (creatorDecodedSymbols) {
          const dsKeywords = creatorDecodedSymbols.rawKeywords as string[] | undefined;
          if (dsKeywords?.length) creatorKeywords.push(...dsKeywords);
        }
        if (brandDecodedSymbols) {
          const dsKeywords = brandDecodedSymbols.rawKeywords as string[] | undefined;
          if (dsKeywords?.length) brandKeywords.push(...dsKeywords);
        }

        // Run the F.I.T. engine
        const result = runFullFITCalculation({
          creatorArchetype: creator.archetype ?? "The Everyman",
          goffmanStageConsistency: creator.goffmanStageConsistency ?? "Consistent",
          driftSignal: creator.driftSignal ?? "Zero Change",
          stuartHallDecoding: creator.stuartHallDecoding ?? "Dominant",
          rogersAdopterStage: creator.rogersAdopterStage ?? "Early Majority",
          turnerLiminalPhase: creator.turnerLiminalPhase ?? "Pre-Liminal",
          creatorNichePosition: creator.creatorNichePosition ?? "Consistent",
          brandArchetype: brand.archetype ?? "The Everyman",
          brandType: brand.brandType ?? "Retail — Local Boutique",
          mythAlignmentScore: mythAlignmentScore ?? 3.0,
          tribMatchScore: tribMatchScore ?? 3.0,
          creatorKeywords,
          creatorThemes,
          brandKeywords,
          brandThemes,
          culturalVelocity: (creator.culturalVelocity as string | null) ?? "Insufficient Data",
          dataConfidenceLevel: (creator.dataConfidenceLevel as string | null) ?? "low",
          // TikTok metrics for brands
          brandTiktokEngagementRate: brand.tiktokEngagementRate ?? undefined,
          brandTiktokFollowerCount: brand.tiktokAudienceSize ?? undefined,
          brandTiktokPostFrequency: brand.tiktokMetadata ? (brand.tiktokMetadata as any).postFrequency : undefined,
          // Phase 4: Brand-side sociological framework fields (bilateral scoring)
          brandGoffmanStageConsistency: (brand as any).brandGoffmanStageConsistency ?? undefined,
          brandDriftSignal: (brand as any).brandDriftSignal ?? undefined,
          brandStuartHallDecoding: (brand as any).brandStuartHallDecoding ?? undefined,
          brandRogersAdopterStage: (brand as any).brandRogersAdopterStage ?? undefined,
          brandTurnerLiminalPhase: (brand as any).brandTurnerLiminalPhase ?? undefined,
          brandLifecyclePhase: (brand as any).brandLifecyclePhase ?? undefined,
          brandCulturalCapital: (brand as any).brandCulturalCapital ?? undefined,
          brandAudienceDecodingSplit: (brand as any).brandAudienceDecodingSplit ?? undefined,
          // Phase 6: Audience Mention Intelligence
          brandMentionSentiment: (brand as any).mentionSentiment ?? undefined,
          brandMentionSentimentConfidence: (brand as any).mentionSentimentConfidence ?? undefined,
          brandMentionHashtags: (brand.mentionHashtagCloud as string[] | null) ?? undefined,
          brandMentionKeywords: (brand.mentionRawKeywords as string[] | null) ?? undefined,
          brandMentionMusicTitles,
          brandMentionMusicArtists,
          brandMentionTotalCount: (brand as any).mentionTotalCount ?? undefined,
          brandMentionUniqueAuthors: (brand as any).mentionUniqueAuthors ?? undefined,
          // Creator music signals
          creatorMusicTitles,
          creatorMusicArtists,
        });

        /*
          ─── M1 item 1: the myth-LLM-failure marker is NOT a radar warning ──
          FIX 5 pushed "Myth/tribe alignment could not be computed" into
          radarWarnings here. That string is not in the warning enum, and the
          persist layer coerced any unknown string to "Low Alignment" — so a
          computation failure was STORED AND RENDERED as a substantive claim
          that alignment fell below 6.0. A warning says something about the
          MATCH; a degradation says something about the CALCULATION. The
          failure already lands in scoreDegradationReasons above, which is
          persisted (womo_0012) and rendered on both surfaces. mythLlmFailed
          stays read below for the degraded flag.
        */

        // Calculate performance signals using actual brand + creator data
        const performanceSignals = calculateAllSignals(
          creator,
          brand,
          result.parrScore,
          result.qovScore,
          result.alignmentScoreRaw,
          result.pulseScoreRaw,
          result.stabilityScoreRaw,
          result.dataConfidenceLevel,
        );

        // Generate Synergy Narrative + Content Directions
        let synergyNarrative = "";
        let contentDirections: Array<{ title: string; rationale: string; exampleAngle: string }> = [];
        try {
          const synergyResponse = await invokeLLM({
            purpose: "cultural_synergy_analysis",
            messages: [
              {
                role: "system",
                content: `You are a plain-talking creator marketing strategist writing a partnership brief for a business owner or junior marketer.
Your job is to explain — in simple, direct language — whether this creator and brand are a good match, and why.

IMPORTANT WRITING RULES:
- Write like you are explaining this to a smart business owner who has never heard of semiotics or Jungian archetypes.
- NO academic jargon. Do NOT use words like: semiotics, archetype, Barthes myth, symbolic capital, liminality, Bourdieu, Goffman, Stuart Hall, parasocial, decoding, signifier, or any other academic term.
- Instead of "archetype", say "personality type" or "the kind of person they come across as".
- Instead of "symbolic vocabulary", say "the words and ideas they both use".
- Instead of "cultural territory", say "the world they both live in" or "what they both stand for".
- Write in short, confident sentences. No fluff. No filler phrases like "it is worth noting" or "it is important to consider".
- The tone should feel like advice from a trusted colleague, not a consultant's report.

CREATOR PROFILE:
- Handle: @${creator.handle}
- Personality type: ${creator.archetype ?? "Unknown"}
- What they stand for: ${creator.barthesMyth ?? "Not available"}
- How they relate to their audience: ${creator.audienceRelationshipType ?? "Unknown"}
- Their cultural standing: ${creator.culturalCapital ?? "Unknown"}
- Content themes: ${creatorThemes.join(", ") || "Not available"}
- Top keywords from their content: ${creatorKeywords.slice(0, 15).join(", ") || "Not available"}
- What their content signals: ${creatorDecodedSymbols ? JSON.stringify(creatorDecodedSymbols).slice(0, 400) : "Not available"}

BRAND PROFILE:
- Brand: ${brand.brandName}
- Personality type: ${brand.archetype ?? "Unknown"}
- What they stand for: ${brand.barthesMyth ?? "Not available"}
- Their target customer: ${brand.audienceTribe ?? "Unknown"}
- The tension they play into: ${brand.culturalTension ?? "Not available"}
- Brand category: ${brand.brandType ?? "Unknown"}
- Brand themes: ${brandThemes.join(", ") || "Not available"}
- Top keywords from their content: ${brandKeywords.slice(0, 15).join(", ") || "Not available"}
- What their brand signals: ${brandDecodedSymbols ? JSON.stringify(brandDecodedSymbols).slice(0, 400) : "Not available"}

SHARED SIGNALS:
- Words and ideas they both use: ${result.sharedKeywords.join(", ") || "None detected"}
- Themes they share: ${result.sharedThemes.join(", ") || "None detected"}
- How much they overlap: ${result.symbolicOverlapScore}/10

SCORES:
- Cultural Match Score: ${result.caiScore}/10 (${result.caiStatus})
- Audience Acceptance Score: ${result.parrScore}/100 (${result.parrLabel})
- Alignment: ${result.alignmentScoreRaw.toFixed(1)}/10 | Momentum: ${result.pulseScoreRaw.toFixed(1)}/10 | Consistency: ${result.stabilityScoreRaw.toFixed(1)}/10

Write the following in JSON format:
1. synergyNarrative (string, 120–200 words): A clear, plain-language explanation of whether this partnership makes sense. Answer three questions in plain English: (a) Do these two belong in the same world — and why? (b) What do they have in common that their shared audience will immediately recognize? (c) What will the audience think and feel when they see this collaboration? Be specific and direct. Use real details from the data above.
2. contentDirections (array of 3 objects): Three specific content ideas grounded in what this creator and brand actually share. Each must have: title (short, punchy — max 6 words), rationale (1 plain sentence explaining why this idea will work with this audience), exampleAngle (1 concrete, specific example of a post or video — describe it like you are pitching it in a meeting).`,
              },
              { role: "user", content: "Generate the synergy brief and content directions." },
            ],
            response_format: {
              type: "json_schema",
              json_schema: {
                name: "synergy_brief",
                strict: true,
                schema: {
                  type: "object",
                  properties: {
                    synergyNarrative: { type: "string" },
                    contentDirections: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          title: { type: "string" },
                          rationale: { type: "string" },
                          exampleAngle: { type: "string" },
                        },
                        required: ["title", "rationale", "exampleAngle"],
                        additionalProperties: false,
                      },
                    },
                  },
                  required: ["synergyNarrative", "contentDirections"],
                  additionalProperties: false,
                },
              },
            },
          });
          const synergyParsed = JSON.parse(synergyResponse.choices[0]?.message?.content as string);
          if (synergyResponse.invocationIdPromise) matchLlmInvocationIds.push(synergyResponse.invocationIdPromise);
          synergyNarrative = synergyParsed.synergyNarrative ?? "";
          contentDirections = synergyParsed.contentDirections ?? [];
        } catch (err) {
          console.warn("[routers] Synergy narrative generation failed (non-fatal):", err);
        }

        // Generate narrative
        const narrative = await generateFITNarrative({
          creatorHandle: creator.handle,
          brandName: brand.brandName,
          caiScore: result.caiScore,
          caiStatus: result.caiStatus,
          alignmentRaw: result.alignmentScoreRaw,
          pulseRaw: result.pulseScoreRaw,
          stabilityRaw: result.stabilityScoreRaw,
          radarWarnings: result.radarWarnings,
          creatorArchetype: creator.archetype ?? "",
          brandArchetype: brand.archetype ?? "",
          creatorBarthesMyth: creator.barthesMyth ?? "",
          brandBarthesMyth: brand.barthesMyth ?? "",
          creatorAudienceRelationship: creator.audienceRelationshipType ?? "",
          brandAudienceTribe: brand.audienceTribe ?? "",
          weightPriority: result.weightPriority,
          creatorPronouns: creator.pronouns ?? "not specified",
        });

        if (narrative.invocationIdPromise) matchLlmInvocationIds.push(narrative.invocationIdPromise);

        // Generate Cultural Borrowing Summary — what the brand gains from this creator
        let culturalBorrowingSummary: string | null = null;
        try {
          const borrowingResponse = await invokeLLM({
            purpose: "cultural_borrowing_analysis",
            messages: [
              {
                role: "system",
                content: `You are a plain-talking cultural strategist writing a single paragraph for a brand considering partnering with a creator.

Your job: explain in 2-3 direct sentences what the brand is BORROWING from this creator. Not what the brand gains in reach — what they gain CULTURALLY. What trust, identity, community, or perception does the creator carry that the brand cannot generate on its own?

Write in plain language. No jargon. Be specific. Use the creator's actual archetype, audience relationship, and tone.

CREATOR:
- Handle: @${creator.handle}
- Archetype: ${creator.archetype ?? "Unknown"}
- Tone: ${creator.toneRegister ?? "Unknown"}
- Audience relationship: ${creator.audienceRelationshipType ?? "Unknown"}
- Parasocial bond: ${creator.parasocialBondStrength ?? "Unknown"}/5
- What they stand for: ${creator.barthesMyth ?? "Not available"}
- Cultural capital type: ${creator.culturalCapital ?? "Unknown"}
- Followers: ${creator.followerCount?.toLocaleString() ?? "Unknown"}

BRAND:
- Name: ${brand.brandName}
- Archetype: ${brand.archetype ?? "Unknown"}
- Audience tribe: ${brand.audienceTribe ?? "Unknown"}
- What they stand for: ${brand.barthesMyth ?? "Not available"}
- Audience sentiment: ${brand.mentionSentiment ?? "Unknown"}

SHARED SIGNALS:
- Shared keywords: ${result.sharedKeywords.join(", ") || "None"}
- Music overlap: ${result.musicOverlap.overlapStrength}

Write ONLY the 2-3 sentence paragraph. No headers. No lists. No quotes.`,
              },
              { role: "user", content: "Write the cultural borrowing summary." },
            ],
          });
          culturalBorrowingSummary = borrowingResponse.choices[0]?.message?.content as string ?? null;
          if (borrowingResponse.invocationIdPromise) matchLlmInvocationIds.push(borrowingResponse.invocationIdPromise);
        } catch (err) {
          console.warn("[routers] Cultural borrowing summary generation failed (non-fatal):", err);
        }

        // Session 5 marker, computed ONCE and used three ways: persisted on the
        // match row (womo_0012), returned to the client, and — nowhere — as a
        // radar warning (M1 item 1).
        const scoreDegradation = {
          degraded: mythAlignmentScore === null || tribMatchScore === null,
          reasons: scoreDegradationReasons,
        };

        // Save match record — V2 pipeline.
        // M1 items 4+5: the persisted id and any failure are RETURNED, not
        // swallowed — the client links to the report only when a record
        // exists, and says so plainly when it does not.
        let persistedMatchId: string | null = null;
        let persistFailure: string | null = null;
        let matchLlm: Awaited<ReturnType<typeof getMatchLlmInvocations>> | null = null;
        try {
          const matchId = await insertMatchScore({
            creatorSubjectId: input.creatorProfileId,
            brandSubjectId: input.brandProfileId,
            fitScore: result.caiScore,
            fitStatus: result.caiStatus,
            alignmentScoreRaw: result.alignmentScoreRaw,
            pulseScoreRaw: result.pulseScoreRaw,
            stabilityScoreRaw: result.stabilityScoreRaw,
            parrScore: result.parrScore,
            parrLabel: result.parrLabel,
            qovScore: result.qovScore,
            symbolicOverlapScore: result.symbolicOverlapScore,
            archetypeMatchScore: result.archetypeMatchScore,
            mythAlignmentScore: result.mythAlignmentScore,
            tribMatchScore: result.tribMatchScore,
            decodingModifier: result.decodingModifier,
            rogersBaseScore: result.rogersBaseScore,
            liminalAdjustment: result.liminalAdjustment,
            goffmanScore: result.goffmanScore,
            driftScore: result.driftScore,
            weightAlpha: result.weightAlpha,
            weightBeta: result.weightBeta,
            weightGamma: result.weightGamma,
            culturalVelocity: result.culturalVelocity || undefined,
            dataConfidenceLevel: result.dataConfidenceLevel || undefined,
            // Performance signals
            creativeIntegritySignal: performanceSignals.creativeIntegrity.score,
            creativeIntegrityConfidence: performanceSignals.creativeIntegrity.confidence,
            performanceConsistencySignal: performanceSignals.performanceConsistency.score,
            performanceConsistencyConfidence: performanceSignals.performanceConsistency.confidence,
            communityQualitySignal: performanceSignals.communityQuality.score,
            communityQualityConfidence: performanceSignals.communityQuality.confidence,
            audienceReceptivitySignal: performanceSignals.audienceReceptivity.score,
            audienceReceptivityConfidence: performanceSignals.audienceReceptivity.confidence,
            brandTrustSignal: performanceSignals.brandTrust.score,
            brandTrustConfidence: performanceSignals.brandTrust.confidence,
            // C5: Wire PARR sub-scores into match persist
            parrTribeOverlap: result.parrSignalBreakdown.tribeOverlap,
            parrDecodingAcceptance: result.parrSignalBreakdown.decodingAcceptance,
            parrArchetypeResonance: result.parrSignalBreakdown.archetypeResonance,
            parrSymbolicOverlap: result.parrSignalBreakdown.symbolicVocabularyOverlap,
            parrPersonaConsistency: result.parrSignalBreakdown.personaConsistency,
            // C5: Wire music overlap + mention modifiers
            musicOverlapStrength: result.musicOverlap.overlapStrength,
            mentionSentimentPenalty: result.mentionSentimentPenalty,
            mentionVocabBoost: result.mentionVocabBoost,
            // C5: Wire observation IDs for provenance
            creatorObservationId: (creator as Record<string, unknown>).observationId as string | undefined,
            brandObservationId: (brand as Record<string, unknown>).observationId as string | undefined,
            // womo_0012 (M1 item 3): the fallback-vs-computed marker, stored.
            scoreDegraded: scoreDegradation.degraded,
            degradationReasons: scoreDegradation.reasons,
          });
          persistedMatchId = matchId;

          // Insert narratives (single row with all narrative fields)
          await insertMatchNarrative(matchId, {
            narrativeSummary: narrative.narrativeSummary,
            synergyNarrative: synergyNarrative || undefined,
            alignmentNarrative: result.alignmentNarrative || undefined,
            culturalBorrowingSummary: culturalBorrowingSummary || undefined,
            // C6: Wire narrative detail fields from generateFITNarrative
            archetypeAnalysis: narrative.alignmentNotes?.archetypeAnalysis || undefined,
            mythAlignment: narrative.alignmentNotes?.mythAlignment || undefined,
            audienceOverlap: narrative.alignmentNotes?.audienceOverlap || undefined,
            culturalMomentum: narrative.alignmentNotes?.culturalMomentum || undefined,
            identityStability: narrative.alignmentNotes?.identityStability || undefined,
            recommendation: narrative.alignmentNotes?.recommendation || undefined,
          });

          // Insert warnings
          if (result.radarWarnings.length > 0) {
            await insertMatchWarnings(matchId, result.radarWarnings);
          }

          // Insert overlaps.
          // M1 item 7c: music titles/artists were computed, returned, and then
          // LOST — never written, while the read path reconstructed musicOverlap
          // from exactly these domains and always found nothing. The engine's
          // music result persists now. (sharedArtists is structurally empty
          // today — the creator side has no artist source — so music_artist
          // rows appear only when that changes; the write path is ready.)
          const overlaps: Array<{ domain: string; value: string }> = [];
          result.sharedKeywords.forEach((k: string) => overlaps.push({ domain: "keyword", value: k }));
          result.sharedThemes.forEach((t: string) => overlaps.push({ domain: "theme", value: t }));
          result.musicOverlap.sharedTitles.forEach((t: string) => overlaps.push({ domain: "music_title", value: t }));
          result.musicOverlap.sharedArtists.forEach((a: string) => overlaps.push({ domain: "music_artist", value: a }));
          if (overlaps.length > 0) {
            await insertMatchOverlaps(matchId, overlaps);
          }

          // Insert content directions
          if (contentDirections.length > 0) {
            await insertMatchContentDirections(matchId, contentDirections);
          }

          // M1 item 6: tie this calculation's LLM calls to the match row now
          // that it exists. The inserts were fired long ago (fire-and-forget);
          // awaiting their ids here costs nothing measurable.
          const invocationIds = (await Promise.all(matchLlmInvocationIds))
            .filter((id): id is string => Boolean(id));
          if (invocationIds.length > 0) {
            await linkLlmInvocationsToMatch(matchId, invocationIds);
          }
          // M3 §5: read the account straight back through the SAME reader
          // fit.get uses, so the calculation view and the record view cannot
          // disagree about cost by construction.
          matchLlm = await getMatchLlmInvocations(matchId);
        } catch (err) {
          // M1 item 5: still non-fatal — the COMPUTATION succeeded and the
          // analyst should see it — but the failure is returned, not swallowed.
          persistFailure = err instanceof Error ? err.message : String(err);
          console.error("[fit.calculate] Match record persist failed (non-fatal):", err);
        }

        return {
          creator,
          brand,
          result,
          narrative,
          performanceSignals,
          // Session 5: marks results that rest on fallback values instead of a
          // real computation. Score VALUES are unchanged (scoring is frozen) —
          // this only stops a degraded result from masquerading as a real one.
          scoreDegradation,
          // M1 item 4: the persisted record's id — "View Full Report" linked
          // to /report/undefined for as long as this endpoint existed, because
          // the id was never returned. Null when persist failed.
          matchId: persistedMatchId,
          // M1 item 5: persist outcome, stated. A computed-but-unsaved result
          // must not render identically to a saved one.
          persist: persistedMatchId
            ? { ok: true as const }
            : { ok: false as const, error: persistFailure ?? "persist did not run" },
          // M1 item 7b: these were generated, persisted, and rendered on the
          // full report — but the calculate page read them from the mutation
          // result, which never included them. Two dead blocks come alive.
          synergyNarrative: synergyNarrative || null,
          contentDirections,
          // M3: the borrowing summary was generated and persisted but never
          // returned — the calculation view rendered its auto-assembled
          // fallback for a match that HAD a model-written one.
          culturalBorrowingSummary,
          // M3 §5: null = not persisted, so no linked account exists yet.
          llm: matchLlm,
        };
      }),

    // getJobProgress REMOVED (S3b) along with the in-memory bulkAnalysisJobs
    // store it read. Queue progress is `creator.queueStatus`, which reads the
    // ledger — durable across restarts, which an in-memory Map never was.

    get: publicProcedure
      .input(z.object({ id: z.string() }))
      .query(async ({ input }) => {
        return getMatchWithProfiles(input.id);
      }),

    list: publicProcedure.query(async () => {
      return listMatchRecords();
    }),

    delete: publicProcedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ input }) => {
        await deleteMatchRecord(input.id);
        return { success: true };
      }),

    comparable: publicProcedure
      .input(z.object({
        matchId: z.string(),
        brandType: z.string().optional(),
        brandArchetypeClassification: z.string().optional(),
        creatorArchetype: z.string().optional(),
        creatorNicheTopicNode: z.string().optional(),
      }))
      .query(async ({ input }) => {
        return getComparablePartnerships({
          excludeMatchId: input.matchId,
          brandType: input.brandType,
          brandArchetypeClassification: input.brandArchetypeClassification,
          creatorArchetype: input.creatorArchetype,
          creatorNicheTopicNode: input.creatorNicheTopicNode,
        });
      }),
  }),

  // ─── Meta / Reference Data ──────────────────────────────────────────────────
  meta: router({
    archetypes: publicProcedure.query(() => ARCHETYPES),
    brandTypes: publicProcedure.query(() => Object.keys(BRAND_WEIGHT_TABLE)),
  }),
});

export type AppRouter = typeof appRouter;
