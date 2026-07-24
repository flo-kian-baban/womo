import { z } from "zod";
import { createHmac } from "crypto";
import { ENV } from "./_core/env";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { analysisRateLimitedProcedure, fitRateLimitedProcedure, bulkRateLimitedProcedure, loginRateLimitedProcedure } from "./_core/rateLimit";
import { TRPCError } from "@trpc/server";
import {
  // Transaction plumbing (atomic identity core)
  withTransaction,
  // V2 write functions
  upsertSubject, upsertPlatformHandle, insertObservation, insertCreatorObservation,
  insertSignalValues, insertDecodedSignals, insertContentItems,
  updateContentItemTranscript, updateObservationTranscriptCount,
  updateCreatorObservationAvgDuration, updateObservationPersistenceStatus,
  insertEvidenceSnapshots, insertLongitudinalSampleSnapshot, findExistingCreatorByHandle,
  insertBrandObservation, insertAudienceMentions,
  insertMatchScore, insertMatchNarrative, insertMatchWarnings, insertMatchOverlaps, insertMatchContentDirections,
  insertScrapeEvent, insertLlmInvocation, getLlmTokenUsageByTimeWindow, getLlmTokenUsageBySubject,
  getLlmTokenUsageByRunId, getLatestObservationRun,
  setObservationReviewStatus, getRunDiagnostics, getEvidenceSnapshotByObservation,
  getLatestObservationId,
  // V2 read functions
  getCreatorProfileById, listCreatorProfiles, deleteCreatorProfile, listArchivedCreatorRuns,
  getContentItemsBySubject, getProvenance,
  getBrandProfileById, listBrandProfiles, deleteBrandProfile,
  listMatchRecords, deleteMatchRecord, getMatchWithProfiles,
  getComparablePartnerships,
} from "./db";
import { extractCreatorProfile, extractBrandProfile, generateFITNarrative, buildCreatorExtractionPrompts } from "./aiExtraction";
import { runFullFITCalculation, getBrandWeights, BRAND_WEIGHT_TABLE, ARCHETYPES } from "./fitEngine";
import { calculateAllSignals } from "./performanceSignals";
import { invokeLLM } from "./_core/llm";
import { researchCreator, researchBrand } from "./webResearch";
import { TRANSCRIPT_SOURCE } from "@shared/transcriptSource";
import { analyzeBrandTikTokChannel, formatBrandTikTokEvidenceBlock, type BrandTikTokMetadata, type MentionVideo } from "./brandTikTokAnalysis";
import { analyzeBrandInstagramChannel, formatBrandInstagramEvidenceBlock, type BrandInstagramMetadata } from "./brandInstagramAnalysis";
import { createBulkCreatorJob, createBulkBrandJob, getJob, markJobProcessing, markJobCompleted, recordJobError, updateJobResult, updateJobProgress } from "./bulkAnalysisJobs";
import { newRunId, withAnalysisRun } from "./_core/runContext";
import { canonicalizeHandle } from "./_core/handles";
import type { DecodedSymbols } from "./symbolDecoder";
import pLimit from "p-limit";

// ─── Concurrency limiter ─────────────────────────────────────────────────────
// Limits simultaneous full creator/brand analyses to 2.
// Each analysis holds Playwright browser contexts + LLM API slots.
// Without this, 3+ concurrent requests can exhaust the browser pool (max 5 contexts)
// and cause context eviction mid-analysis.
const analysisConcurrencyLimit = pLimit(2);

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

function recordOutcome(
  map: PersistenceStatusMap,
  component: string,
  status: EnrichmentOutcomeStatus,
  reason: string | null = null,
): void {
  map[component] = { status, reason, at: new Date().toISOString() };
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
 */
async function runEnrichment(
  map: PersistenceStatusMap,
  component: string,
  action: EnrichmentSkip | (() => Promise<void>),
): Promise<void> {
  if (typeof action !== "function") {
    recordOutcome(map, component, action.skip, action.reason);
    return;
  }
  try {
    await action();
    recordOutcome(map, component, "success");
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

function buildCreatorEvidenceSnapshotPayload(
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

      // 2. upsertPlatformHandle
      await upsertPlatformHandle(subjectId, platform, handle, profileUrl, tx);

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
    recordOutcome(persistence, "identity_core", "success");

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
    type PoolVideo = { id: string; url: string; caption: string; createTime: number; views: number; likes: number; comments: number; saves: number; shares: number; musicOriginal: boolean; musicTitle?: string; musicArtist?: string; durationSec: number; videoUrl?: string; transcriptText?: string; transcriptWordCount?: number; transcriptSource?: string };
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
      status: v.transcriptText ? "sampled" : "discovered",
    }));
    await runEnrichment(persistence, "content_items",
      contentRows.length === 0
        ? { skip: "skipped_no_data", reason: "no videos in discovered pool" }
        : async () => {
            await insertContentItems(subjectId, observationId, contentRows);
            console.log(`[persist] insertContentItems: ${contentRows.length} rows written for subject ${subjectId}`);
          });

    // I2: Compute avgVideoDuration from actual content_items data
    const videosWithDuration = contentRows.filter(v => v.videoDuration && v.videoDuration > 0);
    await runEnrichment(persistence, "avg_video_duration",
      videosWithDuration.length === 0
        ? { skip: "skipped_no_data", reason: "no videos with duration data" }
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
                  subjectId, t.videoId, platform,
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
            await insertContentItems(subjectId, observationId, contentRows);
            console.log(`[persist] Brand channel videos: ${contentRows.length} rows written`);
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
            await insertContentItems(subjectId, observationId, mentionContentRows);
            console.log(`[persist] Audience mention videos: ${mentionContentRows.length} rows written`);
          });

    // 9. Instagram platform handle
    await runEnrichment(persistence, "instagram_handle",
      instagramGate ?? (!instagramMetadata?.channelHandle
        ? { skip: "skipped_no_data", reason: "Instagram analysis returned no channel handle" }
        : async () => {
            await upsertPlatformHandle(
              subjectId,
              "instagram",
              instagramMetadata.channelHandle,
              `https://www.instagram.com/${instagramMetadata.channelHandle}/`,
            );
            console.log(`[persist] Instagram handle @${instagramMetadata.channelHandle} saved`);
          }));

    // 10. Instagram post content items
    await runEnrichment(persistence, "instagram_content_items",
      instagramGate ?? (!instagramMetadata?.postCaptions?.length
        ? { skip: "skipped_no_data", reason: "Instagram analysis returned no post captions" }
        : async () => {
            const igContentRows = instagramMetadata.postCaptions!.map((caption, i) => ({
              platform: "instagram" as const,
              platformVideoId: `ig-post-${instagramMetadata.channelHandle}-${i}`,
              caption,
              status: "sampled",
            }));
            await insertContentItems(subjectId, observationId, igContentRows);
            console.log(`[persist] Instagram post captions: ${igContentRows.length} rows written`);
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
    try {
      await updateObservationPersistenceStatus(observationId, persistence);
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

// ─── Auth Cookie Helpers ────────────────────────────────────────────────────

/**
 * Returns an HMAC-SHA256 signature of "womo_pilot_auth" using JWT_SECRET.
 * The cookie is set to this value on login and compared against it on every
 * authenticated request. Anyone who does not know JWT_SECRET cannot forge it.
 */
function signedCookieValue(secret: string): string {
  return createHmac("sha256", secret)
    .update("womo_pilot_auth")
    .digest("hex");
}

export const appRouter = router({
  system: systemRouter,
  auth: router({
    login: loginRateLimitedProcedure
      .input(z.object({ pin: z.string().min(1) }))
      .mutation(({ input, ctx }) => {
        if (input.pin === ENV.pinCode) {
          // Set an HMAC-signed cookie value — cannot be forged without JWT_SECRET.
          // sameSite: "none" + secure: true is required for cross-origin deployments
          // (Vercel frontend → Railway backend on different domains).
          ctx.res.cookie("womo_pilot_auth", signedCookieValue(ENV.cookieSecret), {
            httpOnly: true,
            path: "/",
            sameSite: "none",
            secure: true,
            maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
          });
          return { success: true as const };
        }
        return { success: false as const, error: "Invalid PIN" };
      }),
    logout: publicProcedure.mutation(({ ctx }) => {
      // Must pass same sameSite/secure options when clearing, otherwise browsers
      // with strict security won't treat it as the same cookie.
      ctx.res.clearCookie("womo_pilot_auth", {
        path: "/",
        sameSite: "none",
        secure: true,
      });
      return { success: true } as const;
    }),
    check: publicProcedure.query(({ ctx }) => {
      return { authenticated: ctx.authenticated };
    }),
  }),

  // ─── Creator Routes ─────────────────────────────────────────────────────────
  creator: router({
    // Duplicate pre-flight (Session 7): read-only check the client calls BEFORE
    // starting an analysis. Returns the existing profile summary when the
    // canonicalized handle already exists as a creator subject.
    preflight: protectedProcedure
      .input(z.object({
        handleOrUrl: z.string().min(1),
        platform: z.enum(["TikTok", "Instagram"]),
      }))
      .query(async ({ input }) => {
        const existing = await findExistingCreatorByHandle(input.handleOrUrl, input.platform);
        return { existing };
      }),

    analyze: analysisRateLimitedProcedure
      .input(z.object({
        handleOrUrl: z.string().min(1),
        platform: z.enum(["TikTok", "Instagram"]),
        /** Session 7: required to proceed when the handle already exists as a subject */
        confirmDuplicate: z.boolean().optional(),
      }))
      .mutation(async ({ input }) => {
        // Duplicate gate (Session 7): enforced server-side even if a client
        // skips the pre-flight, and re-checked at submit time to cover the
        // pre-flight → submit race. Runs BEFORE any scraping starts.
        if (!input.confirmDuplicate) {
          const existing = await findExistingCreatorByHandle(input.handleOrUrl, input.platform);
          if (existing) {
            const last = existing.lastAnalyzedAt
              ? new Date(existing.lastAnalyzedAt).toISOString().slice(0, 10)
              : "unknown date";
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: `A profile for @${existing.handle ?? canonicalizeHandle(input.handleOrUrl)} already exists (last analyzed ${last}, status: ${existing.reviewStatus ?? "unknown"}). Re-submit with confirmation to run a new analysis.`,
            });
          }
        }

        // womo_0006: one correlation id per analysis run — every scrape_event
        // and llm_invocation below inherits it via AsyncLocalStorage (see
        // _core/runContext.ts), and the observation is stamped with it.
        const runId = newRunId();
        return withAnalysisRun(runId, async () => {
        const pipelineStart = Date.now();
        const stepTimings: Array<{ step: string; durationMs: number }> = [];

        // ── FIX 1.1: Global analysis timeout ──
        // Wrap research + extraction in Promise.race with a 3-minute timeout
        // to prevent hung Playwright pages from blocking the server thread.
        const ANALYSIS_TIMEOUT_MS = 5 * 60 * 1000;

        const analysisPromise = (async () => {
          // Step 1: Research
          const t1 = Date.now();
          const research = await researchCreator(input.handleOrUrl, input.platform);
          stepTimings.push({ step: "Web Research & Scraping", durationMs: Date.now() - t1 });

          // Session 8: never extract on empty evidence. A researchCreator failure
          // already rejects this promise before extraction runs; this guard also
          // closes the theoretical "succeeded but empty evidence" case so the
          // "use your own knowledge" prompt branch can never fabricate a profile.
          if (!research.evidenceSummary) {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: `No usable evidence was collected for @${input.handleOrUrl}. Analysis was not saved.`,
            });
          }

          // Step 2: AI Extraction (with retry)
          const t2 = Date.now();
          let extracted;
          try {
            extracted = await extractCreatorProfile(input.handleOrUrl, input.platform, research.evidenceSummary);
          } catch (firstErr) {
            console.warn("[creator.analyze] First extraction attempt failed, retrying:", firstErr);
            await new Promise(r => setTimeout(r, 1000));
            try {
              extracted = await extractCreatorProfile(input.handleOrUrl, input.platform, research.evidenceSummary);
            } catch (secondErr) {
              throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: "Creator extraction failed after retry. Please try again.",
              });
            }
          }
          stepTimings.push({ step: "AI Profile Extraction", durationMs: Date.now() - t2 });

          return { research, extracted };
        })();

        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(
            new TRPCError({
              code: "TIMEOUT",
              message: "Analysis timed out after 5 minutes. The creator's page may be slow or unavailable. Please try again.",
            })
          ), ANALYSIS_TIMEOUT_MS)
        );

        const { research, extracted } = await analysisConcurrencyLimit(() =>
          Promise.race([analysisPromise, timeoutPromise])
        );

        // Step 1: Gather real evidence from the platform before AI analysis
        let evidenceSummary: string | undefined;
        let researchedProfileUrl: string | undefined;
        let researchData: {
          followerCount?: number; followingCount?: number; totalLikes?: number; videoCount?: number;
          totalViews?: number; avgViews?: number; engagementRate?: number;
          location?: string; bio?: string; rawKeywords?: string[]; contentThemeLabels?: string[];
          topHashtags?: string[]; recentVideoTitles?: string[];
          transcriptCount?: number; transcriptExcerpts?: string;
          decodedSymbols?: Record<string, unknown>;
          culturalVelocity?: string;
          dataConfidenceLevel?: string;
          sociologicalFieldsComputed?: boolean;
          longitudinalSampleJson?: Record<string, unknown>;
          discoveredVideoPoolJson?: Array<{ id: string; url: string; caption: string; createTime: number; views: number; likes: number; comments: number; saves: number; shares: number; musicOriginal: boolean; musicTitle?: string; musicArtist?: string; durationSec: number }>;
          transcripts?: Array<{ videoId: string; transcript: string; wordCount: number; transcriptSource?: string }>;
        } | undefined;

        evidenceSummary = research.evidenceSummary;
        researchedProfileUrl = research.profileUrl;
        researchData = {
          followerCount: research.followerCount || undefined,
          // I1: Thread followingCount from scraper data
          followingCount: research.followingCount || undefined,
          totalLikes: research.totalLikes || undefined,
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
          longitudinalSampleJson: research.longitudinalSample as unknown as Record<string, unknown> ?? undefined,
          discoveredVideoPoolJson: research.discoveredVideoPool?.length ? research.discoveredVideoPool : undefined,
          transcripts: research.transcripts?.length ? research.transcripts : undefined,
        };

        // ── Step 3: DB Persistence ──
        const t3 = Date.now();
        const persistResult = await persistCreatorToV2({
          handle: extracted.handle,
          platform: extracted.platform,
          profileUrl: researchedProfileUrl ?? (input.handleOrUrl.startsWith("http") ? input.handleOrUrl : undefined),
          displayName: extracted.displayName,
          pronouns: extracted.pronouns,
          extracted,
          researchData: researchData ?? {},
          // womo_0007: same (handleOrUrl, platform, evidenceSummary) triple the
          // extraction call above received → byte-identical prompt snapshot
          evidenceSnapshot: buildCreatorEvidenceSnapshotPayload(
            input.handleOrUrl, input.platform, research.evidenceSummary, research,
          ),
        });
        stepTimings.push({ step: "Database Persistence", durationMs: Date.now() - t3 });

        // ── Collect token metrics — exact per-run lookup via run_id (womo_0006),
        // replacing the old time-window inference.
        const tokenMetrics = await getLlmTokenUsageByRunId(runId)
          .catch(() => ({ inputTokens: 0, outputTokens: 0, totalTokens: 0, llmCalls: 0, model: "unknown" }));

        const totalDurationMs = Date.now() - pipelineStart;

        // Honest persistence outcome — never report plain success when
        // persistence partially or wholly failed.
        const persistence = summarizePersistence(persistResult);
        if (persistence.saved !== "full") {
          console.warn(`[V2 Pipeline] ⚠️ Creator persistence outcome: ${persistence.saved}`, persistence.error ?? persistence.failedComponents);
        }
        const actualSubjectId = "subjectId" in persistResult ? persistResult.subjectId : null;

        // Return saved profile + persistence outcome + pipeline metrics
        const saved = actualSubjectId ? await getCreatorProfileById(actualSubjectId) : null;
        return {
          profile: saved,
          persistence,
          extracted,
          runId,
          pipelineMetrics: {
            totalDurationMs,
            steps: stepTimings,
            tokens: tokenMetrics,
            transcriptCount: researchData?.transcriptCount ?? 0,
            videosScraped: researchData?.discoveredVideoPoolJson?.length ?? 0,
          },
        };
        });
      }),

    list: protectedProcedure
      .input(z.object({
        search: z.string().optional(),
        /** true = accepted only — for matching/creator-selection surfaces (womo_0006) */
        matchableOnly: z.boolean().optional(),
      }))
      .query(async ({ input }) => {
        return listCreatorProfiles(undefined, input.search, { matchableOnly: input.matchableOnly });
      }),

    // Archived (declined) runs — retained, never deleted; browsable for
    // scraper-failure analysis (womo_0006).
    listArchived: protectedProcedure
      .query(async () => {
        return listArchivedCreatorRuns();
      }),

    get: protectedProcedure
      .input(z.object({ id: z.string() }))
      .query(async ({ input }) => {
        const profile = await getCreatorProfileById(input.id);
        if (!profile) throw new Error("Creator profile not found");
        return profile;
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ input }) => {
        await deleteCreatorProfile(input.id);
        return { success: true };
      }),

    getContentItems: protectedProcedure
      .input(z.object({ subjectId: z.string() }))
      .query(async ({ input }) => {
        return getContentItemsBySubject(input.subjectId);
      }),

    // ─── Review gate (womo_0006) ────────────────────────────────────────────
    // Accept: the run enters the corpus and becomes the authoritative
    // observation (is_latest transfers to it).
    // Decline: status change ONLY — the run is archived with full provenance,
    // never deleted.
    // Plain protectedProcedure (like list/get/delete): review actions are
    // cheap DB updates; rate limits here guard expensive analysis/LLM paths.
    acceptObservation: protectedProcedure
      .input(z.object({
        observationId: z.string().uuid(),
        reviewedBy: z.string().min(1).max(64),
      }))
      .mutation(async ({ input }) => {
        return setObservationReviewStatus(input.observationId, "accepted", input.reviewedBy);
      }),

    declineObservation: protectedProcedure
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
    getDiagnostics: protectedProcedure
      .input(z.object({ observationId: z.string().uuid() }))
      .query(async ({ input }) => {
        const diagnostics = await getRunDiagnostics(input.observationId);
        if (!diagnostics) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Observation not found" });
        }
        return diagnostics;
      }),

    // Session 9 (A7): let the analyst read exactly what the model received.
    getEvidenceSnapshot: protectedProcedure
      .input(z.object({ observationId: z.string() }))
      .query(async ({ input }) => {
        return getEvidenceSnapshotByObservation(input.observationId);
      }),

    getProvenance: protectedProcedure
      .input(z.object({ observationId: z.string() }))
      .query(async ({ input }) => {
        return getProvenance(input.observationId);
      }),

    getPipelineMetrics: protectedProcedure
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

    reanalyze: protectedProcedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ input }) => {
        // womo_0006: reanalyze is its own analysis run
        const runId = newRunId();
        return withAnalysisRun(runId, async () => {
        const existing = await getCreatorProfileById(input.id);
        if (!existing) throw new Error("Creator profile not found");

        let evidenceSummary = "";
        let researchedProfileUrl: string | undefined;
        let researchData: any = {};

        try {
          const research = await researchCreator(existing.profileUrl || existing.handle, existing.platform as any);
          evidenceSummary = research.evidenceSummary;
          researchedProfileUrl = research.profileUrl;
          researchData = {
            followerCount: research.followerCount || undefined,
            totalLikes: research.totalLikes || undefined,
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
            longitudinalSampleJson: research.longitudinalSample as unknown as Record<string, unknown> ?? undefined,
            discoveredVideoPoolJson: research.discoveredVideoPool?.length ? research.discoveredVideoPool : undefined,
            transcripts: research.transcripts?.length ? research.transcripts : undefined,
          };
        } catch (err) {
          // Session 8: FAIL CLEANLY on research failure. This previously swallowed
          // the error and fell through to extractCreatorProfile with an empty
          // evidenceSummary, which triggers the "use your own knowledge of this
          // creator" prompt branch (aiExtraction.ts:107-109) and fabricates a
          // profile with no confidence penalty. We throw here — before the persist
          // call below — so NO observation is created and nothing is persisted.
          if (err instanceof TRPCError) throw err;
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Re-analysis could not collect fresh evidence for @${existing.handle ?? input.id}. Nothing was saved. (${(err as Error).message})`,
          });
        }

        // Defensive: a successful research always yields a non-empty evidence
        // summary. If that ever changes, still refuse to extract on empty evidence
        // rather than hallucinate a profile from the model's own knowledge.
        if (!evidenceSummary) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `Re-analysis produced no usable evidence for @${existing.handle ?? input.id}. Nothing was saved.`,
          });
        }

        const extracted = await extractCreatorProfile(existing.profileUrl || existing.handle, existing.platform as any, evidenceSummary);

        // V2: reanalyze creates a new observation (append-only)
        const reanalyzePersistResult = await persistCreatorToV2({
          handle: existing.handle,
          platform: existing.platform as string,
          profileUrl: researchedProfileUrl ?? existing.profileUrl ?? undefined,
          displayName: extracted.displayName,
          pronouns: extracted.pronouns,
          extracted,
          researchData,
          // womo_0007: mirror the exact extraction inputs used above
          evidenceSnapshot: buildCreatorEvidenceSnapshotPayload(
            existing.profileUrl || existing.handle, existing.platform as string, evidenceSummary, researchData,
          ),
        });
        const persistence = summarizePersistence(reanalyzePersistResult);
        if (persistence.saved !== "full") {
          console.warn(`[V2 Pipeline] ⚠️ Creator reanalyze persistence outcome: ${persistence.saved}`, persistence.error ?? persistence.failedComponents);
        }

        // NOTE: on saved === "none" this returns the PREVIOUS profile — the
        // persistence field is what tells the caller the rerun was not saved.
        const updated = await getCreatorProfileById(input.id);
        return { profile: updated, persistence, extracted, runId };
        });
      }),

    // ─── Supplemental Video Ingestion ─────────────────────────────────────────
    // Fetches transcript for a single TikTok video URL and appends it to the
    // creator profile's transcript pool, then updates the profile's data.
    ingestSupplementalVideo: protectedProcedure
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


    bulkAnalyze: bulkRateLimitedProcedure
      .input(z.object({
        handles: z.array(z.string().min(1)).max(10, "Bulk analysis is limited to 10 handles per request"),
        platform: z.enum(["TikTok", "Instagram"]),
      }))
      .mutation(async ({ input }) => {
        // Create a bulk job
        const job = createBulkCreatorJob(input.handles, input.platform);
        
        // Start processing in background (non-blocking)
        // In production, this would be queued to a job processor
        (async () => {
          markJobProcessing(job.jobId);
          
          for (let i = 0; i < input.handles.length; i++) {
            try {
              const handle = input.handles[i];
              // womo_0006: each bulk handle is its own analysis run
              await withAnalysisRun(newRunId(), async () => {
              // Call the regular analyze endpoint
              const research = await researchCreator(handle, input.platform);
              // Session 8: never extract on empty evidence (fabrication guard).
              // A researchCreator throw is already caught by the per-handle
              // try/catch below and recorded as a job error; this also closes the
              // theoretical empty-success case for the same fabrication path.
              if (!research.evidenceSummary) {
                throw new TRPCError({
                  code: "PRECONDITION_FAILED",
                  message: `No usable evidence was collected for @${handle}.`,
                });
              }
              const extracted = await extractCreatorProfile(handle, input.platform, research.evidenceSummary);

              const bulkPersistResult = await persistCreatorToV2({
                handle,
                platform: input.platform,
                profileUrl: research.profileUrl ?? "",
                displayName: extracted.displayName,
                pronouns: extracted.pronouns,
                extracted,
                // womo_0007: mirror the exact extraction inputs used above
                evidenceSnapshot: buildCreatorEvidenceSnapshotPayload(
                  handle, input.platform, research.evidenceSummary, research,
                ),
                researchData: {
                  followerCount: research.followerCount ?? undefined,
                  totalLikes: research.totalLikes ?? undefined,
                  videoCount: research.videoCount ?? undefined,
                  totalViews: research.totalViews ?? undefined,
                  avgViews: research.avgViews ?? undefined,
                  engagementRate: research.engagementRate ?? undefined,
                  location: research.location ?? undefined,
                  bio: research.bio ?? undefined,
                  rawKeywords: research.rawKeywords ?? undefined,
                  contentThemeLabels: research.contentThemeLabels ?? undefined,
                  topHashtags: research.topHashtags ?? undefined,
                  recentVideoTitles: research.recentVideoTitles ?? undefined,
                  transcriptCount: research.transcriptCount ?? 0,
                  transcriptExcerpts: research.transcriptExcerpts ?? undefined,
                  decodedSymbols: research.decodedSymbols ?? undefined,
                  culturalVelocity: research.culturalVelocity ?? undefined,
                  dataConfidenceLevel: research.dataConfidenceLevel ?? undefined,
                  sociologicalFieldsComputed: research.sociologicalFieldsComputed,
                  longitudinalSampleJson: research.longitudinalSample as unknown as Record<string, unknown> ?? undefined,
                  discoveredVideoPoolJson: research.discoveredVideoPool?.length ? research.discoveredVideoPool : undefined,
                  transcripts: research.transcripts?.length ? research.transcripts : undefined,
                },
              });
              
              const bulkSubjectId = "subjectId" in bulkPersistResult ? bulkPersistResult.subjectId : "unknown";
              updateJobResult(job.jobId, i, { creatorId: bulkSubjectId });
              // Use loop index i + 1 as completed count — job.progress is a stale
              // snapshot from job creation time and does not reflect live progress.
              updateJobProgress(job.jobId, { completed: i + 1 });
              });
            } catch (err) {
              recordJobError(job.jobId, i, input.handles[i], String(err));
            }
          }
          
          markJobCompleted(job.jobId);
        })().catch(err => console.error("Bulk creator analysis failed:", err));
        
        return { jobId: job.jobId };
      }),

    // ─── Brand Routes ───────────────────────────────────────────────────────────
  brand: router({
    analyze: analysisRateLimitedProcedure
      .input(z.object({
        brandNameOrUrl: z.string().min(1),
        tiktokChannelUrl: z.string().optional().or(z.literal("")),
        instagramHandle: z.string().optional().or(z.literal("")),
        googleMapsUrl: z.string().optional().or(z.literal("")),
      }))
      .mutation(async ({ input }) => {
        // Step 1: Gather real evidence from the brand's website/web presence + review data + TikTok
        let brandEvidenceSummary: string | undefined;
        let tiktokMetadata: BrandTikTokMetadata | null = null;
        let brandDataConfidenceLevel: string | undefined;
        let brandSemanticWordCount: number | undefined;
        let brandCrawledPagesCount: number | undefined;
        let reviewFields: {
          yelpRating?: number | null;
          yelpReviewCount?: number | null;
          yelpReviewExcerpts?: string;
          googleRating?: number | null;
          googleReviewCount?: number | null;
          googleReviewExcerpts?: string;
          combinedReviewText?: string;
          overallRating?: number | null;
          totalReviews?: number;
        } = {};
        let symbolFields: {
          brandRawKeywords?: string[];
          brandThemeLabels?: string[];
          brandSymbolicVocabulary?: string[];
          brandDecodedSymbols?: Record<string, unknown>;
        } = {};
        let mentionFields: {
          mentionDecodedSymbols?: Record<string, unknown>;
          mentionRawKeywords?: string[];
          mentionHashtagCloud?: string[];
          mentionSentiment?: string;
          mentionSentimentConfidence?: string;
          mentionMusicSignals?: string[];
          mentionMusicArtists?: string[];
          mentionTotalCount?: number;
          mentionUniqueAuthors?: number;
          mentionAudienceSummary?: string;
        } = {};
        try {
          const brandResearch = await researchBrand(input.brandNameOrUrl, input.googleMapsUrl || undefined);
          brandEvidenceSummary = brandResearch.evidenceSummary;
          reviewFields = {
            yelpRating: brandResearch.yelpRating,
            yelpReviewCount: brandResearch.yelpReviewCount,
            yelpReviewExcerpts: brandResearch.yelpReviewExcerpts || undefined,
            googleRating: brandResearch.googleRating,
            googleReviewCount: brandResearch.googleReviewCount,
            googleReviewExcerpts: brandResearch.googleReviewExcerpts || undefined,
            combinedReviewText: brandResearch.combinedReviewText || undefined,
            overallRating: brandResearch.overallRating,
            totalReviews: brandResearch.totalReviews,
          };
          // Brand Symbol Decoder fields
          if (brandResearch.brandDecodedSymbols) {
            symbolFields = {
              brandRawKeywords: brandResearch.brandRawKeywords,
              brandThemeLabels: brandResearch.brandThemeLabels,
              brandSymbolicVocabulary: brandResearch.brandSymbolicVocabulary,
              brandDecodedSymbols: brandResearch.brandDecodedSymbols as unknown as Record<string, unknown>,
            };
          }
          // Phase 6: Audience Mention Intelligence fields
          if (brandResearch.audienceMentionData) {
            const m = brandResearch.audienceMentionData;
            mentionFields = {
              mentionDecodedSymbols: m as unknown as Record<string, unknown>,
              mentionRawKeywords: m.audienceIdentityClaims,
              mentionHashtagCloud: m.topHashtags,
              mentionSentiment: m.sentimentSignal,
              mentionSentimentConfidence: m.sentimentConfidence,
              mentionMusicSignals: m.mentionMusicTitles,
              mentionMusicArtists: m.mentionMusicArtists,
              mentionTotalCount: m.totalMentions,
              mentionUniqueAuthors: m.uniqueAuthors,
              mentionAudienceSummary: m.audienceLanguageSummary,
            };
          }
          // Capture data confidence level from brand research
          brandDataConfidenceLevel = brandResearch.dataConfidenceLevel;
          // P2-2: Capture crawl metadata for audit trail
          brandSemanticWordCount = brandResearch.semanticWordCount;
          brandCrawledPagesCount = brandResearch.crawledPages?.length;
        } catch (err) {
          console.warn("[brand.analyze] Web research failed, proceeding without evidence:", err);
        }

        // Step 1b: Analyze TikTok channel if provided
        if (input.tiktokChannelUrl && input.tiktokChannelUrl.trim() !== "") {
          try {
            tiktokMetadata = await analyzeBrandTikTokChannel(input.tiktokChannelUrl);
            if (tiktokMetadata) {
              const tiktokEvidenceBlock = formatBrandTikTokEvidenceBlock(tiktokMetadata);
              brandEvidenceSummary = (brandEvidenceSummary || "") + "\n\n" + tiktokEvidenceBlock;
            }
          } catch (err) {
            console.warn("[brand.analyze] TikTok analysis failed, proceeding without TikTok data:", err);
          }
        }

        // Step 1b2: Analyze Instagram channel if provided
        let instagramMetadata: BrandInstagramMetadata | null = null;
        if (input.instagramHandle?.trim()) {
          try {
            instagramMetadata = await analyzeBrandInstagramChannel(input.instagramHandle);
            if (instagramMetadata) {
              const igBlock = formatBrandInstagramEvidenceBlock(instagramMetadata);
              brandEvidenceSummary = (brandEvidenceSummary ?? "") + "\n\n" + igBlock;
              console.log("[brand.analyze] Instagram evidence block added");
            }
          } catch (err) {
            console.warn("[brand.analyze] Instagram analysis failed, proceeding without Instagram data:", err);
          }
        }

        // Step 1c: Minimum data threshold — prevent hallucinated profiles
        const evidenceLength = (brandEvidenceSummary || "").length;
        const hasReviewData = (reviewFields.totalReviews ?? 0) > 0;
        const hasMentionData = (mentionFields.mentionTotalCount ?? 0) > 0;
        const hasTikTokChannel = tiktokMetadata !== null;
        const hasInstagramChannel = instagramMetadata !== null;
        if (evidenceLength < 200 && !hasReviewData && !hasMentionData && !hasTikTokChannel && !hasInstagramChannel) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Insufficient data to analyze this brand. No website content, reviews, or social mentions were found. Please verify the brand URL and try again.",
          });
        }

        // Step 2: AI extraction grounded in real evidence
        // P0-3: Wrap extraction in try-catch with single retry for malformed LLM JSON
        let extracted: Awaited<ReturnType<typeof extractBrandProfile>>;
        try {
          extracted = await extractBrandProfile(input.brandNameOrUrl, brandEvidenceSummary);
        } catch (firstErr) {
          const errMsg = firstErr instanceof Error ? firstErr.message : String(firstErr);
          if (errMsg.includes("JSON") || errMsg.includes("parse") || errMsg.includes("Unexpected token")) {
            console.warn(`[brand.analyze] LLM JSON parse failed on first attempt: ${errMsg.slice(0, 500)}`);
            console.warn(`[brand.analyze] Retrying extraction after 1s delay...`);
            await new Promise(r => setTimeout(r, 1000));
            try {
              extracted = await extractBrandProfile(input.brandNameOrUrl, brandEvidenceSummary);
            } catch (retryErr) {
              throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: "Brand extraction failed after retry — please try again",
              });
            }
          } else {
            throw firstErr; // Non-JSON error, rethrow immediately
          }
        }

        // P1-2: Validate brandType against BRAND_WEIGHT_TABLE keys
        const validBrandTypes = Object.keys(BRAND_WEIGHT_TABLE);
        if (!validBrandTypes.includes(extracted.brandType)) {
          const invalidValue = extracted.brandType;
          // Find closest match by checking substring containment
          const closestMatch = validBrandTypes.find(vbt =>
            vbt.toLowerCase().includes(invalidValue.toLowerCase()) ||
            invalidValue.toLowerCase().includes(vbt.toLowerCase())
          );
          // Fallback: "Retail — E-Commerce / DTC Product" has α=0.5/β=0.3/γ=0.2 weights,
          // which are closest to the table-wide average (α≈0.50, β≈0.29, γ≈0.20) across
          // all 107 entries (Euclidean distance 0.011). It is also the most semantically
          // generic consumer brand key — applicable to any DTC product regardless of category.
          const fallback = closestMatch || "Retail — E-Commerce / DTC Product";
          console.warn(`[brandType] Invalid value "${invalidValue}" received from LLM — defaulting to "${fallback}"`);
          (extracted as unknown as Record<string, unknown>).brandType = fallback;
        }

        // Apply campaign modifier (Rule 5) when campaignType is Long-Term Ambassador or Product Launch
        const weights = getBrandWeights(extracted.brandType, extracted.campaignType);

        // Step 3: Persist to V2 schema
        const brandPersistResult = await persistBrandToV2({
          brandName: extracted.brandName,
          brandUrl: input.brandNameOrUrl.startsWith("http") ? input.brandNameOrUrl : undefined,
          category: extracted.category,
          extracted,
          weights,
          reviewFields,
          tiktokMetadata,
          instagramMetadata,
          mentionFields,
          symbolFields,
          dataConfidenceLevel: brandDataConfidenceLevel,
          semanticWordCount: brandSemanticWordCount,
          crawledPagesCount: brandCrawledPagesCount,
          tiktokRequested: Boolean(input.tiktokChannelUrl?.trim()),
          instagramRequested: Boolean(input.instagramHandle?.trim()),
        });

        // Honest persistence outcome — never report plain success when
        // persistence partially or wholly failed.
        const persistence = summarizePersistence(brandPersistResult);
        if (persistence.saved !== "full") {
          console.warn(`[V2 Pipeline] ⚠️ Brand persistence outcome: ${persistence.saved}`, persistence.error ?? persistence.failedComponents);
        }
        const brandSubjectId = "subjectId" in brandPersistResult ? brandPersistResult.subjectId : null;
        const saved = brandSubjectId ? await getBrandProfileById(brandSubjectId) : null;
        return { profile: saved, persistence, extracted, weights };
      }),

    list: protectedProcedure
      .input(z.object({ search: z.string().optional() }))
      .query(async ({ input }) => {
        return listBrandProfiles(undefined, input.search);
      }),

    get: protectedProcedure
      .input(z.object({ id: z.string() }))
      .query(async ({ input }) => {
        const profile = await getBrandProfileById(input.id);
        if (!profile) throw new Error("Brand profile not found");
        return profile;
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ input }) => {
        await deleteBrandProfile(input.id);
        return { success: true };
      }),

    reanalyze: protectedProcedure
      .input(z.object({ id: z.string(), instagramHandle: z.string().optional().or(z.literal("")), googleMapsUrl: z.string().optional().or(z.literal("")) }))
      .mutation(async ({ input }) => {
        const existing = await getBrandProfileById(input.id);
        if (!existing) throw new Error("Brand profile not found");

        let brandEvidenceSummary = "";
        let reviewFields: any = {};
        let symbolFields: any = {};
        let mentionFieldsReanalyze: any = {};
        let tiktokMetadata: BrandTikTokMetadata | null = null;
        let brandDataConfidenceLevel: string | undefined;
        let brandSemanticWordCountReanalyze: number | undefined;
        let brandCrawledPagesCountReanalyze: number | undefined;

        try {
          const brandResearch = await researchBrand(existing.brandUrl || existing.brandName, input.googleMapsUrl || undefined);
          brandEvidenceSummary = brandResearch.evidenceSummary;
          reviewFields = {
            yelpRating: brandResearch.yelpRating,
            yelpReviewCount: brandResearch.yelpReviewCount,
            yelpReviewExcerpts: brandResearch.yelpReviewExcerpts || undefined,
            googleRating: brandResearch.googleRating,
            googleReviewCount: brandResearch.googleReviewCount,
            googleReviewExcerpts: brandResearch.googleReviewExcerpts || undefined,
            combinedReviewText: brandResearch.combinedReviewText || undefined,
            overallRating: brandResearch.overallRating,
            totalReviews: brandResearch.totalReviews,
          };
          if (brandResearch.brandDecodedSymbols) {
            symbolFields = {
              brandRawKeywords: brandResearch.brandRawKeywords,
              brandThemeLabels: brandResearch.brandThemeLabels,
              brandSymbolicVocabulary: brandResearch.brandSymbolicVocabulary,
              brandDecodedSymbols: brandResearch.brandDecodedSymbols as unknown as Record<string, unknown>,
            };
          }
          // Phase 6: Audience Mention Intelligence
          if (brandResearch.audienceMentionData) {
            const m = brandResearch.audienceMentionData;
            mentionFieldsReanalyze = {
              mentionDecodedSymbols: m as unknown as Record<string, unknown>,
              mentionRawKeywords: m.audienceIdentityClaims,
              mentionHashtagCloud: m.topHashtags,
              mentionSentiment: m.sentimentSignal,
              mentionSentimentConfidence: m.sentimentConfidence,
              mentionMusicSignals: m.mentionMusicTitles,
              mentionMusicArtists: m.mentionMusicArtists,
              mentionTotalCount: m.totalMentions,
              mentionUniqueAuthors: m.uniqueAuthors,
              mentionAudienceSummary: m.audienceLanguageSummary,
            };
          }
          // Capture data confidence level from brand research
          brandDataConfidenceLevel = brandResearch.dataConfidenceLevel;
          brandSemanticWordCountReanalyze = brandResearch.semanticWordCount;
          brandCrawledPagesCountReanalyze = brandResearch.crawledPages?.length;
        } catch (err) {
          console.warn("[brand.reanalyze] Web research failed, proceeding without evidence:", err);
        }

        // Re-run TikTok analysis if the brand has a stored TikTok handle
        if (existing.tiktokChannelUrl) {
          try {
            tiktokMetadata = await analyzeBrandTikTokChannel(existing.tiktokChannelUrl);
            if (tiktokMetadata) {
              const tiktokEvidenceBlock = formatBrandTikTokEvidenceBlock(tiktokMetadata);
              if (tiktokEvidenceBlock) {
                brandEvidenceSummary = brandEvidenceSummary + "\n\n" + tiktokEvidenceBlock;
              }
            }
          } catch (err) {
            console.warn("[brand.reanalyze] TikTok analysis failed, proceeding without TikTok data:", err);
          }
        }

        // Re-run Instagram analysis if handle is provided or stored
        let instagramMetadataReanalyze: BrandInstagramMetadata | null = null;
        const igHandleToUse = input.instagramHandle?.trim() || (existing as any).instagramHandle;
        if (igHandleToUse) {
          try {
            instagramMetadataReanalyze = await analyzeBrandInstagramChannel(igHandleToUse);
            if (instagramMetadataReanalyze) {
              const igBlock = formatBrandInstagramEvidenceBlock(instagramMetadataReanalyze);
              if (igBlock) {
                brandEvidenceSummary = brandEvidenceSummary + "\n\n" + igBlock;
              }
              console.log("[brand.reanalyze] Instagram evidence block added");
            }
          } catch (err) {
            console.warn("[brand.reanalyze] Instagram analysis failed, proceeding without Instagram data:", err);
          }
        }

        // P0-3: Wrap extraction with retry for malformed JSON
        let extracted: Awaited<ReturnType<typeof extractBrandProfile>>;
        try {
          extracted = await extractBrandProfile(existing.brandUrl || existing.brandName, brandEvidenceSummary);
        } catch (firstErr) {
          const errMsg = firstErr instanceof Error ? firstErr.message : String(firstErr);
          if (errMsg.includes("JSON") || errMsg.includes("parse") || errMsg.includes("Unexpected token")) {
            console.warn(`[brand.reanalyze] LLM JSON parse failed, retrying after 1s...`);
            await new Promise(r => setTimeout(r, 1000));
            try {
              extracted = await extractBrandProfile(existing.brandUrl || existing.brandName, brandEvidenceSummary);
            } catch {
              throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: "Brand extraction failed after retry — please try again",
              });
            }
          } else {
            throw firstErr;
          }
        }

        // P1-2: Validate brandType
        const validBrandTypesReanalyze = Object.keys(BRAND_WEIGHT_TABLE);
        if (!validBrandTypesReanalyze.includes(extracted.brandType)) {
          const invalidValue = extracted.brandType;
          const closestMatch = validBrandTypesReanalyze.find(vbt =>
            vbt.toLowerCase().includes(invalidValue.toLowerCase()) ||
            invalidValue.toLowerCase().includes(vbt.toLowerCase())
          );
          // Same rationale as analyze path — closest to table-wide average α/β/γ weights
          const fallback = closestMatch || "Retail — E-Commerce / DTC Product";
          console.warn(`[brandType] Invalid value "${invalidValue}" received from LLM — defaulting to "${fallback}"`);
          (extracted as unknown as Record<string, unknown>).brandType = fallback;
        }

        const weights = getBrandWeights(extracted.brandType, extracted.campaignType);

        // V2: reanalyze creates a new observation (append-only)
        const brandReanalyzePersistResult = await persistBrandToV2({
          brandName: existing.brandName,
          brandUrl: existing.brandUrl ?? undefined,
          category: extracted.category,
          extracted,
          weights,
          reviewFields,
          tiktokMetadata,
          instagramMetadata: instagramMetadataReanalyze,
          mentionFields: mentionFieldsReanalyze,
          symbolFields,
          dataConfidenceLevel: brandDataConfidenceLevel,
          semanticWordCount: brandSemanticWordCountReanalyze,
          crawledPagesCount: brandCrawledPagesCountReanalyze,
          tiktokRequested: Boolean(existing.tiktokChannelUrl),
          instagramRequested: Boolean(igHandleToUse),
        });
        const persistence = summarizePersistence(brandReanalyzePersistResult);
        if (persistence.saved !== "full") {
          console.warn(`[V2 Pipeline] ⚠️ Brand reanalyze persistence outcome: ${persistence.saved}`, persistence.error ?? persistence.failedComponents);
        }

        // NOTE: on saved === "none" this returns the PREVIOUS profile — the
        // persistence field is what tells the caller the rerun was not saved.
        const updated = await getBrandProfileById(input.id);
        return { profile: updated, persistence, extracted, weights };
      }),

    weightTable: protectedProcedure.query(() => {
      return Object.entries(BRAND_WEIGHT_TABLE).map(([type, weights]) => ({
        type,
        ...weights,
      }));
    }),
  }),

    // ─── Cultural Match Score Routes ─────────────────────────────────────────────────────────────────────────────
  fit: router({
    calculate: fitRateLimitedProcedure
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

        // FIX 5: Inject radar warning when myth/tribe LLM failed
        if (mythLlmFailed) {
          (result.radarWarnings as string[]).push(
            "Myth/tribe alignment could not be computed \u2014 score may be unreliable"
          );
        }

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
        } catch (err) {
          console.warn("[routers] Cultural borrowing summary generation failed (non-fatal):", err);
        }

        // Save match record — V2 pipeline
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
          });

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

          // Insert overlaps
          if (result.sharedKeywords.length > 0 || result.sharedThemes.length > 0) {
            const overlaps: Array<{ domain: string; value: string }> = [];
            result.sharedKeywords.forEach((k: string) => overlaps.push({ domain: "keyword", value: k }));
            result.sharedThemes.forEach((t: string) => overlaps.push({ domain: "theme", value: t }));
            await insertMatchOverlaps(matchId, overlaps);
          }

          // Insert content directions
          if (contentDirections.length > 0) {
            await insertMatchContentDirections(matchId, contentDirections);
          }
        } catch (err) {
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
          scoreDegradation: {
            degraded: mythAlignmentScore === null || tribMatchScore === null,
            reasons: scoreDegradationReasons,
          },
        };
      }),

    getJobProgress: protectedProcedure
      .input(z.object({ jobId: z.string() }))
      .query(({ input }) => {
        const job = getJob(input.jobId);
        if (!job) {
          throw new Error("Job not found");
        }
        return {
          jobId: job.jobId,
          type: job.type,
          progress: job.progress,
          results: job.results,
        };
      }),

    get: protectedProcedure
      .input(z.object({ id: z.string() }))
      .query(async ({ input }) => {
        return getMatchWithProfiles(input.id);
      }),

    list: protectedProcedure.query(async () => {
      return listMatchRecords();
    }),

    delete: protectedProcedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ input }) => {
        await deleteMatchRecord(input.id);
        return { success: true };
      }),

    comparable: protectedProcedure
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
