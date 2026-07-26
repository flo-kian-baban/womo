/**
 * Phase scheduler — phased architecture S3a, Parts 2 and 3.
 *
 * ─── The division of labour ─────────────────────────────────────────────────
 * THE PHASE CLASSIFIES; THE SCHEDULER DECIDES. A phase reports an outcome and a
 * failure class and nothing else — it has no opinion about whether it will run
 * again, when, or how often. Retry policy is DATA this module reads
 * (`DEFAULT_BACKOFF` / `BLOCKED_PARK_MS` below, narrowed by the phase's own
 * declared `retry`), not logic embedded in the phases. That separation is what
 * lets the policy be tuned from telemetry without reopening a single scraper.
 *
 * The runner (phaseRunner.ts) keeps what it already owns: execution ORDER and
 * the stop conditions. This module plugs into its `execute` seam and adds the
 * two things it deliberately does not do — admission and retry.
 *
 * ─── Admission, and the invariant it protects ───────────────────────────────
 * Every phase runs inside `withResourceSlot(classForPhase(phase.name), …)`, so
 * the permit is held BEFORE `phase.run()` is entered and released AFTER it
 * settles. Since every `getContext()` lives inside a tool inside `phase.run()`,
 * a job waiting for admission holds no browser context — see resourceSlots.ts
 * for why that is the difference between this and the TTL reaper race.
 *
 * The corollary is enforced here: A PERMIT IS NEVER HELD ACROSS A BACKOFF
 * SLEEP. `withResourceSlot` returns (releasing the permit) and only then does
 * the retry loop sleep. Sleeping inside the slot would park a browser permit for
 * minutes and starve every other campaign.
 *
 * ─── Deadline awareness ─────────────────────────────────────────────────────
 * S3a keeps the endpoint synchronous: the caller is holding an open request with
 * a race deadline (ENV.analysisTimeoutMs, 300s by default). A 5-15 minute park
 * inside that request would guarantee a client timeout and pin the connection
 * for nothing. So a delay that would cross the campaign's deadline is DOWNGRADED
 * from "retry" to "park": the intent is still recorded as `next_earliest_at` in
 * the ledger — real data for S3b's poller — and the campaign stops exactly as a
 * stopped campaign stops today. Nothing about the client-visible behaviour of a
 * failing run changes.
 */
import {
  type AnalysisPhase,
  type PhaseFailureClass,
  type PhaseOutcome,
  type PhaseResult,
  type PhaseRetryPolicy,
  type PhaseRunContext,
} from "../_core/analysisPhase";
import { classForPhase, withResourceSlot } from "../_core/resourceSlots";

// ─── Policy, as data ─────────────────────────────────────────────────────────

/**
 * Default backoff before the Nth requeue, per failure class. A phase's own
 * declared `retry.backoffMs` OVERRIDES this where present — the S1 contract
 * says policy is "declared per phase, applied by the scheduler", and the
 * per-phase numbers encode real judgement (transcribe waits 60s because a retry
 * costs two minutes of scraping; derive retries fast because it costs a token).
 *
 *   transient     — plumbing died; a fresh attempt plausibly succeeds.
 *   structural    — the target shape changed. Retrying is futile; a human looks.
 *   genuine_empty — a confirmed fact about the subject. Never a retry.
 */
export const DEFAULT_BACKOFF: Record<PhaseFailureClass, readonly number[]> = {
  transient: [30_000, 120_000, 300_000],
  structural: [],
  genuine_empty: [],
};

/**
 * Parks for an external gate (429 / quota / bot wall). Longer than a transient
 * retry on purpose: hammering a rate limiter is how a soft block becomes a hard
 * one. Not our bug and not the subject's fault — wait it out.
 */
export const BLOCKED_PARK_MS: readonly number[] = [300_000, 900_000];

/** Initial attempt + 3 retries, when a phase declares no `maxAttempts`. */
export const DEFAULT_MAX_ATTEMPTS = 4;

export type RetryAction =
  /** Outcome is usable (or terminal-good); move on. */
  | "done"
  /** Run this phase again after `delayMs`. */
  | "retry"
  /** Stop trying in this process; record `nextEarliestAt` for later attention. */
  | "park"
  /** Stop the campaign now — nothing more can be gathered. */
  | "terminate";

export interface RetryDecision {
  action: RetryAction;
  /** Set for "retry" (how long to sleep) and "park" (how far ahead the gate is). */
  delayMs?: number;
  /** Human-readable why, for the log line and the session report. */
  reason: string;
}

/**
 * The whole retry policy, as one pure function. No clock, no I/O, no sleeping —
 * `now` and `deadlineAt` are injected so this is exhaustively testable.
 *
 * @param attempt 1-based number of the attempt that JUST RAN.
 */
export function decideRetry(args: {
  outcome: PhaseOutcome;
  failureClass?: PhaseFailureClass;
  attempt: number;
  /** The phase's declared policy; overrides the defaults where present. */
  policy?: PhaseRetryPolicy;
  now: number;
  /** Campaign race deadline (epoch ms). Omitted = no deadline pressure. */
  deadlineAt?: number;
}): RetryDecision {
  const { outcome, failureClass, attempt, policy, now, deadlineAt } = args;

  // 1. A confirmed fact about the subject. Terminal, fast, and never retried —
  //    the campaign stops and the honest message is produced downstream.
  if (outcome === "genuine_empty" || failureClass === "genuine_empty") {
    return { action: "terminate", reason: "genuine_empty — a confirmed fact about the subject, not a failure" };
  }

  // 2. Usable output. `partial` counts: a budget-bailed transcribe still feeds
  //    the phases after it, and re-running it would re-scrape for no gain.
  if (outcome === "complete" || outcome === "partial") {
    return { action: "done", reason: `outcome ${outcome} is usable` };
  }

  // 3. The path is gone or its shape changed. Retrying a dead path burns
  //    minutes and teaches us nothing — park it where an analyst will see it.
  if (failureClass === "structural") {
    return { action: "park", reason: "structural — retrying a changed/removed path is futile; parked for attention" };
  }

  const maxAttempts = policy?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

  // 4. An external gate. Park for minutes, not seconds.
  //    Always the global ladder: `blocked` is an OUTCOME, not a failure class,
  //    so a phase's `backoffMs` (keyed by class) can never express a block park.
  if (outcome === "blocked") {
    const delayMs = BLOCKED_PARK_MS[attempt - 1] ?? BLOCKED_PARK_MS[BLOCKED_PARK_MS.length - 1]!;
    if (attempt >= maxAttempts) {
      return { action: "park", delayMs, reason: `blocked and out of attempts (${attempt}/${maxAttempts}) — parked` };
    }
    return withDeadline({ action: "park", delayMs, reason: `blocked — parked ${Math.round(delayMs / 1000)}s for the gate to clear` }, now, deadlineAt);
  }

  // 5. Transient failure (or an unclassified one — treated as transient, since
  //    the cost of one extra attempt is far below the cost of discarding a run
  //    that would have succeeded).
  //    A DECLARED policy is authoritative in full: the contract states "absent
  //    class = no requeue", so a phase that declares `retry` without a transient
  //    ladder means "do not retry transients", NOT "fall through to the table".
  //    Only a phase with no declared policy at all gets the defaults.
  const backoffs = policy ? (policy.backoffMs?.transient ?? []) : DEFAULT_BACKOFF.transient;
  const delayMs = backoffs[attempt - 1];

  if (attempt >= maxAttempts || delayMs === undefined) {
    return {
      action: "park",
      reason: `transient failure, attempts exhausted (${attempt}/${maxAttempts}) — parked`,
    };
  }

  return withDeadline(
    { action: "retry", delayMs, reason: `transient failure — retry ${attempt + 1}/${maxAttempts} in ${Math.round(delayMs / 1000)}s` },
    now,
    deadlineAt,
  );
}

/**
 * A wait that would outlive the campaign's deadline becomes a park. The gate is
 * still recorded so S3b's poller can pick the phase up; what changes is that we
 * do not hold an open request asleep past the moment its answer stops mattering.
 */
function withDeadline(decision: RetryDecision, now: number, deadlineAt?: number): RetryDecision {
  if (decision.action !== "retry") return decision;
  if (deadlineAt === undefined) return decision;
  if (now + (decision.delayMs ?? 0) < deadlineAt) return decision;
  return {
    action: "park",
    delayMs: decision.delayMs,
    reason: `${decision.reason} — but that lands past the campaign deadline; parked instead`,
  };
}

/** When a parked phase becomes eligible again, or null when it never does. */
export function nextEarliestAtFor(decision: RetryDecision, now: number): Date | null {
  if (decision.delayMs === undefined) return null;
  if (decision.action !== "park" && decision.action !== "retry") return null;
  return new Date(now + decision.delayMs);
}

// ─── The execute seam ────────────────────────────────────────────────────────

/** What the runner calls instead of `phase.run` when a scheduler is supplied. */
export type ExecuteFn = (
  phase: AnalysisPhase<never, unknown>,
  input: never,
  ctx: PhaseRunContext,
) => Promise<ScheduledPhaseResult>;

export interface ScheduledPhaseResult extends PhaseResult<unknown> {
  /** How many attempts this phase consumed (1 when it succeeded first try). */
  attemptCount: number;
  /** Backoff gate the scheduler recorded, if it parked or requeued. */
  nextEarliestAt: Date | null;
}

export interface SchedulerOptions {
  /** Campaign race deadline (epoch ms) — see the module header. */
  deadlineAt?: number;
  /** Injected for tests; production uses the real clock and a real sleep. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /**
   * Called twice per attempt so the ledger distinguishes WAITING from WORKING:
   * `pending` when the attempt is queued for admission, `running` once a permit
   * is held and the tool is actually executing. Reporting a queued phase as
   * "running" would make the ledger lie about exactly the state this session
   * introduced — and `pending` is in READY_STATUSES, so a phase abandoned while
   * queued is rescannable rather than invisible.
   */
  onAttemptStart?: (
    phase: AnalysisPhase<never, unknown>,
    attempt: number,
    status: "pending" | "running",
  ) => void;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Build the runner's `execute`: admission + attempts + backoff around one phase.
 *
 * The loop is deliberately small. Everything hard is elsewhere and already
 * proven — the bound in `withResourceSlot`, the policy in `decideRetry`, the
 * ordering and stop conditions in `runPhases`.
 */
export function makeSchedulerExecute(opts: SchedulerOptions = {}): ExecuteFn {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? realSleep;

  return async function execute(phase, input, ctx): Promise<ScheduledPhaseResult> {
    const cls = classForPhase(phase.name);
    let attempt = 1;

    for (;;) {
      // Queued: waiting for a permit, holding nothing.
      opts.onAttemptStart?.(phase, attempt, "pending");

      // Admission: the permit is taken HERE, before any tool runs, and dropped
      // when `phase.run` settles — after its contexts are retired.
      const result = await withResourceSlot(cls, () => {
        // Admitted: a permit is held and the tool is about to touch the network.
        opts.onAttemptStart?.(phase, attempt, "running");
        return phase.run(input, { ...ctx, attempt });
      });

      const decision = decideRetry({
        outcome: result.outcome,
        failureClass: result.failureClass,
        attempt,
        policy: phase.retry,
        now: now(),
        deadlineAt: opts.deadlineAt,
      });

      if (decision.action !== "retry") {
        if (decision.action !== "done") {
          console.warn(`[scheduler] ${phase.name} (${phase.tool}) → ${decision.action}: ${decision.reason}`);
        }
        return { ...result, attemptCount: attempt, nextEarliestAt: nextEarliestAtFor(decision, now()) };
      }

      // The permit is already released — `withResourceSlot` returned above.
      // Sleeping here holds nothing.
      console.warn(`[scheduler] ${phase.name} (${phase.tool}): ${decision.reason}`);
      await sleep(decision.delayMs!);
      attempt++;
    }
  };
}
