/**
 * Phase units for derive and extract_commit — phased architecture S2, Part 3.
 *
 * ─── Why extract_commit is FUSED ────────────────────────────────────────────
 * Extraction, the womo_0007 evidence snapshot, and the observation commit are
 * ONE phase deliberately. The snapshot must capture the exact inputs that
 * produced the extraction, and an extraction without its commit is orphaned
 * work — the in-race persistence/salvage logic in instrumentedRun.ts exists
 * precisely to keep them welded (a timed-out run whose extraction finishes must
 * still persist). Splitting them would reintroduce the lost-work class.
 *
 * ─── Dependency injection, and why ──────────────────────────────────────────
 * extract_commit needs extractCreatorProfile / persistCreatorToV2 /
 * buildCreatorEvidenceSnapshotPayload, which live in routers.ts — and routers
 * imports webResearch, which these phases also use. Injecting them keeps this
 * module free of that cycle and makes the phase unit testable without a
 * database or an LLM.
 */
import type {
  AnalysisPhase,
  CampaignState,
  PhaseResult,
  PhaseRunContext,
  PlatformName,
} from "../_core/analysisPhase";
import { NOT_READY } from "../_core/analysisPhase";
import {
  assembleCreatorResearchResult,
  computeDeriveInputs,
  computeLocalPrepared,
  reconstructMergedInputs,
  type BankedCreatorEvidence,
  type CreatorResearchResult,
  type ResumableBankedPhases,
} from "../webResearch";
import { classifyPhaseError } from "./collectionPhases";
import { toolsetFor } from "./platformTools";
import type { CapturePhaseOutput, AugmentPhaseOutput, TranscribePhaseOutput } from "./collectionPhases";
export type { TranscribePhaseOutput };

// ─── P4: derive ──────────────────────────────────────────────────────────────

export interface DerivePhaseInput {
  handle: string;
  capture: CapturePhaseOutput;
  augment: AugmentPhaseOutput;
  transcribe: TranscribePhaseOutput;
}

export interface DerivePhaseOutput {
  contentThemeLabels: string[];
  decodedSymbols: BankedCreatorEvidence["derived"]["decodedSymbols"];
}

/** Shape the banked phases into the struct the shared reconstruction expects. */
export function bankedPhasesFor(input: DerivePhaseInput): ResumableBankedPhases {
  return {
    capture: {
      stats: input.capture.stats,
      profileTitles: input.capture.profileTitles,
      profileViewCounts: input.capture.profileViewCounts,
    },
    // The merged pool's titles carry both API and search contributions in
    // order; hashtags likewise. Both come from the augment phase's banked pool.
    augment: {
      searchTitles: input.augment.pool.videoTitles,
      searchHashtags: input.augment.pool.hashtags,
    },
    transcribe: input.transcribe,
  };
}

/**
 * Derive: the two independent LLM calls, launched together with the local work
 * running while they are in flight (the monolith's deliberate concurrency).
 * The entire credential/quota failure class lives here, which is why it is its
 * own phase — it is cheap to retry from banked evidence and it is what the
 * dead-key incident destroyed three runs on.
 */
export function makeDerivePhase(platform: PlatformName, deps: {
  translateKeywordsToThemes: (
    keywords: string[], hashtags: string[], titles: string[], bio: string, transcriptText: string,
  ) => Promise<string[]>;
  decodeCreatorSymbols: (input: {
    handle: string; bio: string; videoTitles: string[]; hashtags: string[]; transcriptExcerpts: string[];
  }) => Promise<BankedCreatorEvidence["derived"]["decodedSymbols"]>;
}): AnalysisPhase<DerivePhaseInput, DerivePhaseOutput> {
  return {
    name: "derive",
    tool: "llm:themes+symbols",
    // Generous retries: this phase is cheap (no scraping) and its dominant
    // failure is a transient credential/quota problem.
    retry: { maxAttempts: 4, backoffMs: { transient: [30_000, 120_000, 300_000] } },
    inputs: (state: CampaignState) => {
      const capture = state.phases.capture?.output as CapturePhaseOutput | undefined;
      const augment = state.phases.augment?.output as AugmentPhaseOutput | undefined;
      const transcribe = state.phases.transcribe?.output as TranscribePhaseOutput | undefined;
      if (!capture || !augment || !transcribe) return NOT_READY;
      return { handle: state.handle, capture, augment, transcribe };
    },
    async run(input, ctx: PhaseRunContext): Promise<PhaseResult<DerivePhaseOutput>> {
      const started = Date.now();
      try {
        const banked = bankedPhasesFor(input);
        const { allTitles, viewCounts } = reconstructMergedInputs(banked);
        const { topHashtags, rawKeywords, combinedTranscriptText } = computeDeriveInputs({
          searchHashtags: banked.augment.searchHashtags,
          allTitles,
          bio: input.capture.stats.bio,
          transcripts: input.transcribe.transcripts,
          viewCounts,
          followerCount: input.capture.stats.followerCount,
          engagementSignals: input.transcribe.engagementSignals,
          platform,
          pool: input.augment.pool.videoItems,
        });

        const themesPromise = deps.translateKeywordsToThemes(
          rawKeywords, topHashtags, allTitles, input.capture.stats.bio, combinedTranscriptText,
        );
        const symbolsPromise = deps.decodeCreatorSymbols({
          handle: input.handle,
          bio: input.capture.stats.bio,
          videoTitles: allTitles,
          hashtags: topHashtags,
          transcriptExcerpts: input.transcribe.transcripts.map(t => t.transcript),
        });
        const [contentThemeLabels, decodedSymbols] = await Promise.all([themesPromise, symbolsPromise]);

        // Both helpers catch internally, so an empty result means degraded, not
        // thrown — reported as partial so the campaign can proceed but the
        // ledger records that the derivation was thin.
        const outcome = contentThemeLabels.length > 0 && decodedSymbols ? "complete" as const : "partial" as const;
        return {
          outcome,
          output: { contentThemeLabels, decodedSymbols },
          attempts: [{ tool: "llm:themes+symbols", outcome, durationMs: Date.now() - started }],
        };
      } catch (err) {
        const failureClass = classifyPhaseError(err);
        return {
          outcome: "failed", failureClass, output: null,
          attempts: [{
            tool: "llm:themes+symbols", outcome: "failed", failureClass,
            durationMs: Date.now() - started, detail: (err as Error).message?.slice(0, 300),
          }],
        };
      }
    },
  };
}

// ─── Assembly bridge: banked phases → the evidence the model reads ───────────

/**
 * Build the assembled research result from banked phase outputs. PURE, and the
 * single path both the phased runner and resume use — which is what keeps a
 * phased run byte-identical to a monolith run.
 */
export function assembleFromPhases(
  handle: string,
  platform: PlatformName,
  input: DerivePhaseInput,
  derived: DerivePhaseOutput,
): CreatorResearchResult {
  const banked = bankedPhasesFor(input);
  const { allTitles, viewCounts } = reconstructMergedInputs(banked);
  const { totalViews, avgViews, engagementRate, topHashtags, rawKeywords, combinedTranscriptText } =
    computeDeriveInputs({
      searchHashtags: banked.augment.searchHashtags,
      allTitles,
      bio: input.capture.stats.bio,
      transcripts: input.transcribe.transcripts,
      viewCounts,
      followerCount: input.capture.stats.followerCount,
      engagementSignals: input.transcribe.engagementSignals,
      platform,
      pool: input.augment.pool.videoItems,
    });
  const localPrepared = computeLocalPrepared({
    allTitles, topHashtags, bio: input.capture.stats.bio,
    location: input.capture.stats.location, combinedTranscriptText,
    transcripts: input.transcribe.transcripts,
  });

  const bankedEvidence: BankedCreatorEvidence = {
    schemaVersion: 1,
    handle,
    platform,
    capture: {
      displayName: input.capture.stats.displayName,
      bio: input.capture.stats.bio,
      followerCount: input.capture.stats.followerCount,
      followingCount: input.capture.stats.followingCount,
      videoCount: input.capture.stats.videoCount,
      totalLikes: input.capture.stats.totalLikes,
      location: localPrepared.location,
      profileUrl: toolsetFor(platform).profileUrl(handle),
    },
    collection: {
      transcripts: input.transcribe.transcripts,
      musicTitles: input.transcribe.musicTitles,
      engagementSignals: input.transcribe.engagementSignals,
      longitudinalSample: input.transcribe.longitudinalSample,
      discoveredVideoPool: input.transcribe.discoveredVideoPool,
      foreignVideosRejected: input.transcribe.foreignVideosRejected,
    },
    prepared: {
      allTitles, topHashtags, rawKeywords,
      contentThemes: localPrepared.contentThemes,
      transcriptExcerpts: localPrepared.transcriptExcerpts,
      totalViews, avgViews, engagementRate,
    },
    derived: { contentThemeLabels: derived.contentThemeLabels, decodedSymbols: derived.decodedSymbols },
  };

  // S4: the platform appends its own evidence, verbatim. TikTok returns "",
  // which the evidence harness proves keeps the assembly byte-identical.
  return assembleCreatorResearchResult(
    bankedEvidence,
    toolsetFor(platform).evidenceExtras({ handle, capture: input.capture }),
  );
}

// ─── P5: extract_commit (FUSED — see module header) ──────────────────────────

export interface ExtractCommitOutput {
  subjectId: string | null;
  observationId: string | null;
  persistence: unknown;
  evidenceSummaryBytes: number;
}

/**
 * WHAT VARIES BY SUBJECT, injected. Everything else in this phase — the
 * extract → snapshot → persist → summarize sequence, the saved-to-outcome
 * mapping and the error classification — is identical for every subject, and
 * that is precisely the part worth keeping in ONE place. A second copy of the
 * outcome mapping is how a brand campaign starts reporting `partial` where a
 * creator reports `complete`.
 */
export interface ExtractCommitSpec<TIn extends { handle: string }, TResearch> {
  /** Read this subject's banked phases, or NOT_READY. */
  readInputs: (state: CampaignState) => TIn | typeof NOT_READY;
  /** Turn them into the research object the model and the persister receive. */
  assemble: (input: TIn) => TResearch & { evidenceSummary?: string; profileUrl?: string };
  /** Names the tool in the ledger — creator and brand extract different things. */
  tool: string;
}

export function makeExtractCommitPhase<TIn extends { handle: string }, TResearch>(
  platform: PlatformName,
  deps: {
    extract: (handleOrUrl: string, platform: string, evidenceSummary: string) => Promise<Record<string, unknown>>;
    buildSnapshot: (handleOrUrl: string, platform: string, evidenceSummary: string | undefined, structured: unknown) => unknown;
    persist: (params: Record<string, unknown>) => Promise<Record<string, unknown>>;
    summarize: (result: unknown) => { saved: string };
  },
  spec: ExtractCommitSpec<TIn, TResearch>,
): AnalysisPhase<TIn, ExtractCommitOutput> {
  return {
    name: "extract_commit",
    tool: spec.tool,
    retry: { maxAttempts: 3, backoffMs: { transient: [30_000, 120_000] } },
    inputs: spec.readInputs,
    async run(input, ctx: PhaseRunContext): Promise<PhaseResult<ExtractCommitOutput>> {
      const started = Date.now();
      try {
        // FUSED: assemble → extract → snapshot → persist, in one unit.
        const research = spec.assemble(input);
        const extracted = await deps.extract(input.handle, platform, research.evidenceSummary ?? "");
        const persistResult = await deps.persist({
          handle: input.handle,
          platform,
          profileUrl: research.profileUrl,
          displayName: extracted.displayName,
          pronouns: extracted.pronouns,
          extracted,
          research,
          evidenceSnapshot: deps.buildSnapshot(input.handle, platform, research.evidenceSummary, research),
        });
        const persistence = deps.summarize(persistResult);
        const outcome = persistence.saved === "full" ? "complete" as const
          : persistence.saved === "partial" ? "partial" as const : "failed" as const;

        return {
          outcome,
          output: {
            subjectId: (persistResult as { subjectId?: string }).subjectId ?? null,
            observationId: (persistResult as { observationId?: string }).observationId ?? null,
            persistence,
            evidenceSummaryBytes: research.evidenceSummary?.length ?? 0,
          },
          attempts: [{ tool: spec.tool, outcome, durationMs: Date.now() - started }],
        };
      } catch (err) {
        const failureClass = classifyPhaseError(err);
        return {
          outcome: "failed", failureClass, output: null,
          attempts: [{
            tool: spec.tool, outcome: "failed", failureClass,
            durationMs: Date.now() - started, detail: (err as Error).message?.slice(0, 300),
          }],
        };
      }
    },
  };
}
