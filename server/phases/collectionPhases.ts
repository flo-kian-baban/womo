/**
 * Phase units for capture / augment / transcribe — phased architecture S2,
 * Part 2. These implement the S1 `AnalysisPhase` contract against the platform
 * tool seam, so the phase logic is platform-agnostic and the platform logic is
 * phase-agnostic.
 *
 * WHAT IS AND IS NOT NEW HERE: none of the collection work is reimplemented.
 * Each phase delegates to a tool, and every tool calls the hardened internals
 * verbatim — the profile chain with its empty-capture retry and assessment, the
 * search chain with its transient retry, the fail-closed author guard, and the
 * frozen 6-3-3 sampler. What is new is the CONTRACT around them: declared
 * inputs read from banked output, durable output, and an outcome + failure
 * class per the S1 taxonomy.
 *
 * Guarded by the collection identity harness (collectionIdentity.test.ts),
 * which replays recorded raw platform payloads and asserts the pool order and
 * the exact (id, bucket) sample are unchanged.
 */
import type {
  AnalysisPhase,
  CampaignState,
  PhaseFailureClass,
  PhaseResult,
  PhaseRunContext,
  PlatformName,
} from "../_core/analysisPhase";
import { NOT_READY } from "../_core/analysisPhase";
import { isBrowserDeadError } from "../scraping/browserClient";
import type {
  CreatorResearchResult, EngagementSignals, LongitudinalSample,
  PoolVideoItem, TranscriptEntry,
} from "../webResearch";
import { snapshotPool } from "../webResearch";
import {
  toolsetFor,
  type CaptureToolResult,
  type ToolPoolState,
} from "./platformTools";

// ─── Shared helpers ──────────────────────────────────────────────────────────

/**
 * Map a thrown error to the contract's failure class. Reuses the same
 * discriminators the reliability session established rather than inventing a
 * second taxonomy: browser death and quota/rate limits are transient (a fresh
 * attempt plausibly succeeds); everything else is structural until proven
 * otherwise, so a dead path parks for a human instead of looping.
 */
export function classifyPhaseError(err: unknown): PhaseFailureClass {
  if (isBrowserDeadError(err)) return "transient";
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  if (
    msg.includes("quota") || msg.includes("rate limit") ||
    msg.includes("too many requests") || msg.includes("usage exhausted") ||
    msg.includes("timeout") || msg.includes("econnreset") || msg.includes("socket hang up")
  ) {
    return "transient";
  }
  return "structural";
}

/** A fresh pool accumulator with the shape the collection tools expect. */
export function freshPoolState(): ToolPoolState {
  return {
    videoItems: [], seen: new Set<string>(), viewCounts: [], videoTitles: [],
    hashtags: [], musicTitles: [], foreignVideosRejected: 0,
    searchQuotaExhausted: false, apiVideoCount: 0,
  };
}

/** Rehydrate a pool accumulator from a phase's banked output. */
export function poolStateFromBanked(banked: {
  videoItems: PoolVideoItem[]; viewCounts: number[]; videoTitles: string[];
  hashtags: string[]; musicTitles: string[]; foreignVideosRejected: number;
}): ToolPoolState {
  return {
    videoItems: [...banked.videoItems],
    seen: new Set(banked.videoItems.map(v => v.id)),
    viewCounts: [...banked.viewCounts],
    videoTitles: [...banked.videoTitles],
    hashtags: [...banked.hashtags],
    musicTitles: [...banked.musicTitles],
    foreignVideosRejected: banked.foreignVideosRejected,
    searchQuotaExhausted: false,
    apiVideoCount: 0,
  };
}

// ─── P1: capture ─────────────────────────────────────────────────────────────

export interface CapturePhaseOutput {
  stats: CaptureToolResult["stats"];
  profileTitles: string[];
  profileViewCounts: number[];
  assessment: unknown;
  pool: ReturnType<typeof snapshotPool>;
}

/**
 * Capture has no upstream phase, so its declared input is just the subject.
 * Genuine-empty is TERMINAL here and must never be retried: it is a confirmed
 * fact about the creator (their own stats report zero posts), not a failure.
 */
export function makeCapturePhase(platform: PlatformName): AnalysisPhase<{ handle: string }, CapturePhaseOutput> {
  const tools = toolsetFor(platform);
  return {
    name: "capture",
    tool: tools.capture.name,
    retry: { maxAttempts: 3, backoffMs: { transient: [30_000, 120_000] } },
    inputs: (state: CampaignState) => ({ handle: state.handle }),
    async run(input, ctx: PhaseRunContext): Promise<PhaseResult<CapturePhaseOutput>> {
      const started = Date.now();
      try {
        const captured = await tools.capture.capture(input.handle);
        const pool = freshPoolState();
        await tools.capture.seedPool(input.handle, captured, pool);

        const assessment = captured.assessment as { genuineEmpty?: boolean } | undefined;
        const genuineEmpty = Boolean(assessment?.genuineEmpty);
        const outcome = genuineEmpty
          ? "genuine_empty" as const
          : pool.videoItems.length > 0 ? "complete" as const : "partial" as const;

        return {
          outcome,
          failureClass: genuineEmpty ? "genuine_empty" : undefined,
          output: {
            stats: captured.stats,
            profileTitles: captured.profileTitles,
            profileViewCounts: captured.profileViewCounts,
            assessment: captured.assessment ?? null,
            pool: snapshotPool(pool),
          },
          attempts: [{
            tool: tools.capture.name, outcome, durationMs: Date.now() - started,
            failureClass: genuineEmpty ? "genuine_empty" : undefined,
          }],
        };
      } catch (err) {
        const failureClass = classifyPhaseError(err);
        return {
          outcome: "failed", failureClass, output: null,
          attempts: [{
            tool: tools.capture.name, outcome: "failed", failureClass,
            durationMs: Date.now() - started,
            detail: (err as Error).message?.slice(0, 300),
          }],
        };
      }
    },
  };
}

// ─── P2: augment ─────────────────────────────────────────────────────────────

export interface AugmentPhaseOutput {
  pool: ReturnType<typeof snapshotPool>;
  quotaExhausted: boolean;
}

/**
 * Augment declares capture's banked pool as its input — it EXTENDS that pool
 * rather than rebuilding one, which is why the merge order is preserved.
 * Optional by design: a platform with no augmentation (YouTube) registers a
 * null tool and the phase completes as a no-op; a failure degrades rather than
 * blocking, because 16 of 27 historical runs got nothing here and still
 * produced good analyses.
 */
export function makeAugmentPhase(platform: PlatformName): AnalysisPhase<
  { handle: string; capture: CapturePhaseOutput }, AugmentPhaseOutput
> {
  const tools = toolsetFor(platform);
  return {
    name: "augment",
    tool: tools.augment?.name ?? `${platform.toLowerCase()}:none`,
    retry: { maxAttempts: 2, backoffMs: { transient: [30_000] } },
    inputs: (state: CampaignState) => {
      const capture = state.phases.capture;
      if (!capture?.output) return NOT_READY;
      return { handle: state.handle, capture: capture.output as CapturePhaseOutput };
    },
    async run(input, ctx: PhaseRunContext): Promise<PhaseResult<AugmentPhaseOutput>> {
      const started = Date.now();
      const pool = poolStateFromBanked(input.capture.pool);

      if (!tools.augment) {
        // No augmentation on this platform — a fact, not a failure.
        return {
          outcome: "complete",
          output: { pool: snapshotPool(pool), quotaExhausted: false },
          attempts: [{ tool: this.tool, outcome: "complete", durationMs: 0, detail: "platform has no augment step" }],
        };
      }

      try {
        await tools.augment.augment(input.handle, pool);
        const outcome = pool.searchQuotaExhausted ? "blocked" as const : "complete" as const;
        return {
          outcome,
          failureClass: pool.searchQuotaExhausted ? "transient" : undefined,
          output: { pool: snapshotPool(pool), quotaExhausted: pool.searchQuotaExhausted },
          attempts: [{ tool: tools.augment.name, outcome, durationMs: Date.now() - started }],
        };
      } catch (err) {
        // Degrade, never block: the capture pool is still usable downstream.
        const failureClass = classifyPhaseError(err);
        return {
          outcome: "partial", failureClass,
          output: { pool: snapshotPool(pool), quotaExhausted: pool.searchQuotaExhausted },
          attempts: [{
            tool: tools.augment.name, outcome: "partial", failureClass,
            durationMs: Date.now() - started, detail: (err as Error).message?.slice(0, 300),
          }],
        };
      }
    },
  };
}

// ─── P3: transcribe (selection half) ─────────────────────────────────────────

export interface SamplePhaseInput {
  handle: string;
  augment: AugmentPhaseOutput;
  nowSec: number;
}

/**
 * The sample selection the transcribe phase performs before fetching. Split out
 * as its own exported unit because it is the step the collection harness pins
 * exactly — same pool in, same twelve videos out — and because a platform can
 * swap its sampling strategy here without touching the phase.
 */
export function selectSampleForPlatform(
  platform: PlatformName,
  handle: string,
  pool: PoolVideoItem[],
  nowSec: number,
): Array<{ item: PoolVideoItem; bucket: "recent" | "mid" | "anchor" }> {
  return toolsetFor(platform).transcribe.selectSample(handle, pool, nowSec);
}

/** P3's durable output — the corpus everything downstream reads. */
export interface TranscribePhaseOutput {
  transcripts: TranscriptEntry[];
  musicTitles: string[];
  engagementSignals: EngagementSignals;
  longitudinalSample: LongitudinalSample;
  discoveredVideoPool: NonNullable<CreatorResearchResult["discoveredVideoPool"]>;
  foreignVideosRejected: number;
  transcriptViewCounts: number[];
  /** How many videos the sampler selected (>= transcripts.length). */
  sampledCount: number;
}

export interface TranscribePhaseInput {
  handle: string;
  augment: AugmentPhaseOutput;
  /** Injected so a replayed or resumed campaign resolves the same temporal
   *  buckets the original run did. */
  nowSec: number;
}

/**
 * P3: transcribe — select, fetch, assemble. Now complete (it was
 * selection-only): the phase owns the whole step through the TranscribeTool
 * seam, so per-video fetching and the engagement/longitudinal/pool assembly
 * live behind the same contract as everything else.
 *
 * Declares augment's banked pool as its input — the AUGMENTED pool, so
 * search-discovered videos are sampled too.
 *
 * Outcome semantics: an empty transcript set is PARTIAL, not failed. A creator
 * whose videos genuinely have no subtitles still produces a usable analysis
 * from titles and metadata, and the min-data gate downstream is what decides
 * whether that is enough — this phase does not pre-empt that frozen decision.
 */
export function makeTranscribePhase(platform: PlatformName): AnalysisPhase<
  TranscribePhaseInput, TranscribePhaseOutput
> {
  const tools = toolsetFor(platform);
  return {
    name: "transcribe",
    tool: tools.transcribe.name,
    retry: { maxAttempts: 2, backoffMs: { transient: [60_000] } },
    inputs: (state: CampaignState) => {
      const augment = state.phases.augment?.output as AugmentPhaseOutput | undefined;
      if (!augment) return NOT_READY;
      return { handle: state.handle, augment, nowSec: Math.floor(Date.now() / 1000) };
    },
    async run(input, ctx: PhaseRunContext): Promise<PhaseResult<TranscribePhaseOutput>> {
      const started = Date.now();
      try {
        const pool = input.augment.pool.videoItems;
        const sampled = tools.transcribe.selectSample(input.handle, pool, input.nowSec);
        const transcripts = await tools.transcribe.transcribe(input.handle, sampled);
        const assembled = tools.transcribe.assemble(input.handle, pool, transcripts, sampled);

        // The collection stage's view counts, taken VERBATIM from the banked
        // pool rather than re-derived: the monolith returns exactly this array
        // and merges it into the profile's list downstream, in order, with
        // dedup. Re-deriving it from videoItems would be equivalent today but
        // would silently diverge the moment either loop changed.
        const transcriptViewCounts = input.augment.pool.viewCounts;

        const outcome = transcripts.length > 0 ? "complete" as const : "partial" as const;
        return {
          outcome,
          output: {
            transcripts,
            musicTitles: input.augment.pool.musicTitles,
            engagementSignals: assembled.engagementSignals,
            longitudinalSample: assembled.longitudinalSample,
            discoveredVideoPool: assembled.discoveredVideoPool,
            foreignVideosRejected: input.augment.pool.foreignVideosRejected,
            transcriptViewCounts,
            sampledCount: sampled.length,
          },
          attempts: [{ tool: tools.transcribe.name, outcome, durationMs: Date.now() - started }],
        };
      } catch (err) {
        const failureClass = classifyPhaseError(err);
        return {
          outcome: "failed", failureClass, output: null,
          attempts: [{
            tool: tools.transcribe.name, outcome: "failed", failureClass,
            durationMs: Date.now() - started, detail: (err as Error).message?.slice(0, 300),
          }],
        };
      }
    },
  };
}
