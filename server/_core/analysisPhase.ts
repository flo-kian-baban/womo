/**
 * Analysis Phase Contract — phased-architecture program, S1 (definition only).
 *
 * DEFINITION ONLY. Nothing in the running pipeline implements or executes this
 * yet: the monolith (webResearch.ts → routers.ts) still runs end to end exactly
 * as before. This is the contract later sessions build against, in the same
 * shape as transcriptStrategies.ts: named, individually instrumented,
 * individually budgeted units behind ONE interface.
 *
 * ─── The five phases ────────────────────────────────────────────────────────
 * Derived from where failure semantics, retry policy, blocking behavior, and
 * cost genuinely differ in the current pipeline (S0 design investigation):
 *
 *   capture         — surface stats + the author-guarded post pool. One
 *                     navigation yields both on TikTok/Instagram, so they are
 *                     ONE phase, not two. Genuine-empty here is terminal.
 *   augment         — optional discovery enrichment (TikTok search, IG oEmbed
 *                     supplement; YouTube has none). Failure degrades, never
 *                     blocks: 16 of 27 historical runs got nothing here and
 *                     still completed.
 *   transcribe      — per-post transcription over the 6-3-3 sample. Already the
 *                     best-factored unit in the codebase (transcriptStrategies
 *                     with budgets + early-bail); an "empty" is a fact about a
 *                     video, not a phase failure.
 *   derive          — the two independent LLM calls (theme translation, symbol
 *                     decoding) that run from banked evidence. Cheap to retry,
 *                     and the entire credential/quota failure class lives here.
 *   extract_commit  — profile extraction + evidence snapshot + observation
 *                     commit. FUSED deliberately: the snapshot must capture the
 *                     exact extraction inputs, and an extraction without its
 *                     commit is orphaned work (the in-race persistence/salvage
 *                     logic in instrumentedRun.ts exists to keep them welded).
 *
 * ─── Declared inputs, never in-memory threading ─────────────────────────────
 * A phase declares what it needs from PRIOR phases' banked outputs and reads
 * them from the ledger. It never receives values threaded through a caller's
 * locals. That is what makes a campaign resumable across process restarts: any
 * phase can run on a cold process given only its run id.
 *
 * ─── Idempotency ────────────────────────────────────────────────────────────
 * Re-running a completed phase must not duplicate or corrupt. Phase output is
 * upserted on (run_id, phase) — a re-run replaces its OWN output atomically and
 * touches nothing else. extract_commit inherits idempotency from the existing
 * model: observations are append-only per run, snapshots are keyed by run id,
 * and recordRunOutcome upserts on the run row.
 *
 * ─── What this contract must never do ───────────────────────────────────────
 * Change WHAT is gathered. Phases change only HOW gathering is sequenced and
 * banked. The evidence handed to extraction stays byte-identical — proven by
 * the identity harness (evidenceIdentity.test.ts), which is the acceptance
 * criterion for the whole program.
 */

// ─── Names ───────────────────────────────────────────────────────────────────

export const PHASE_NAMES = [
  "capture",
  "augment",
  "transcribe",
  "derive",
  "extract_commit",
] as const;

export type PhaseName = (typeof PHASE_NAMES)[number];

/** Platform tools plug into the SAME phase; a fourth platform is an
 *  implementation, not an architecture change. */
export type PlatformName = "TikTok" | "Instagram" | "YouTube";

/**
 * Which slice of a creator's history a sampled video came from.
 *
 * S4: `unbucketed` exists because not every platform samples temporally.
 * TikTok's 6-3-3 sampler deliberately spreads across recent / mid / anchor to
 * measure drift over time. Instagram takes the most recent reels in feed order —
 * there is no temporal stratification to report, and stamping those "recent"
 * would put a claim in the ledger and in `content_items.temporal_bucket` that
 * the sampler never made. An honest absence beats a plausible fabrication.
 *
 * Declared here, in the contract, because both the platform tools and the
 * collection internals need it and neither may import the other.
 */
export type SampleBucket = "recent" | "mid" | "anchor" | "unbucketed";

// ─── Outcomes and failure classification ─────────────────────────────────────

/**
 * complete      — the phase's completion criteria were met.
 * partial       — usable output, but less than the phase wanted (e.g. the
 *                 transcript budget bailed early). Downstream may proceed.
 * blocked       — an external gate stopped us (429 / quota / bot wall). Not our
 *                 bug, not the subject's fault: park and requeue later.
 * genuine_empty — a CONFIRMED fact about the subject (e.g. the profile's own
 *                 stats report 0 posts). Terminal, and fast — never retried.
 * failed        — anything else; retry policy decides whether it requeues.
 */
export type PhaseOutcome =
  | "complete"
  | "partial"
  | "blocked"
  | "genuine_empty"
  | "failed";

/**
 * transient     — plumbing died (context/page death, nav abort, socket reset).
 *                 A fresh attempt plausibly succeeds.
 * structural    — the target shape changed or the path is gone. Retrying is
 *                 futile; a human must look (cf. the search HTML-parse leg,
 *                 0/38 lifetime, removed with evidence).
 * genuine_empty — see above; carried as a failure class so the ledger can hold
 *                 the reason without pretending it was an error.
 */
export type PhaseFailureClass = "transient" | "structural" | "genuine_empty";

/** One attempt by one tool. Mirrors what scrape_events / llm_invocations
 *  already record per attempt — the phase runner emits those, exactly as the
 *  strategy chains do today. */
export interface PhaseAttemptRecord {
  tool: string;
  outcome: PhaseOutcome;
  durationMs: number;
  failureClass?: PhaseFailureClass;
  detail?: string;
}

export interface PhaseResult<Out> {
  outcome: PhaseOutcome;
  /** Durable, JSON-serializable phase output. Null when nothing was produced. */
  output: Out | null;
  failureClass?: PhaseFailureClass;
  attempts: PhaseAttemptRecord[];
}

// ─── Retry policy ────────────────────────────────────────────────────────────

/**
 * Declared per phase, applied by the scheduler (S3). Backoff is per failure
 * class because the classes mean different things: a transient failure retries
 * in seconds, a block parks for minutes, a structural failure never requeues.
 */
export interface PhaseRetryPolicy {
  maxAttempts: number;
  /** Backoff before the Nth requeue, per class. Absent class = no requeue. */
  backoffMs: Partial<Record<PhaseFailureClass, readonly number[]>>;
}

/** Phases are pure-ish units; the runner owns telemetry and the ledger write. */
export interface PhaseRunContext {
  runId: string;
  handle: string;
  platform: PlatformName;
  /** Attempt number for THIS phase in THIS campaign, 1-based. */
  attempt: number;
}

// ─── Banked state (what a phase reads) ───────────────────────────────────────

export type PhaseStatus =
  | "pending"
  | "running"
  | "complete"
  | "partial"
  | "blocked"
  | "genuine_empty"
  | "failed";

/** One ledger row, as the scheduler and phases see it. */
export interface PhaseStateEntry<Out = unknown> {
  phase: PhaseName;
  tool: string | null;
  status: PhaseStatus;
  attemptCount: number;
  failureClass: PhaseFailureClass | null;
  nextEarliestAt: Date | null;
  output: Out | null;
}

/** The campaign's banked state: every phase's durable output so far. A phase
 *  reads ONLY from here (plus its own tool calls) — never from caller locals. */
export interface CampaignState {
  runId: string;
  handle: string;
  platform: PlatformName;
  phases: Partial<Record<PhaseName, PhaseStateEntry>>;
}

/** Returned by `inputs()` when required upstream output is not banked yet. The
 *  scheduler treats it as "not schedulable", not as a failure. */
export const NOT_READY = "not_ready" as const;
export type NotReady = typeof NOT_READY;

// ─── The interface ───────────────────────────────────────────────────────────

export interface AnalysisPhase<In, Out> {
  name: PhaseName;
  /** Which platform tool implements this phase for this campaign. */
  tool: string;
  retry: PhaseRetryPolicy;
  /**
   * Declare this phase's inputs by reading PRIOR phases' banked outputs.
   * Returns NOT_READY when an upstream phase has not banked what we need.
   */
  inputs(state: CampaignState): In | NotReady;
  run(input: In, ctx: PhaseRunContext): Promise<PhaseResult<Out>>;
}

/** Convenience: is this phase's output usable by downstream phases? */
export function isUsableOutcome(outcome: PhaseOutcome): boolean {
  return outcome === "complete" || outcome === "partial";
}

/** Convenience: should the scheduler ever try this phase again? */
export function isRequeueable(
  outcome: PhaseOutcome,
  failureClass: PhaseFailureClass | undefined,
): boolean {
  if (outcome === "complete" || outcome === "genuine_empty") return false;
  if (failureClass === "structural" || failureClass === "genuine_empty") return false;
  return true;
}
