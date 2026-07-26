/**
 * Phase runner — phased architecture S2.
 *
 * Executes phases in sequence. Each phase declares its inputs by reading the
 * BANKED output of prior phases from the campaign state; the runner banks each
 * phase's output as it completes, so the state a phase reads is the state that
 * was durably written, not a value threaded through a caller's locals.
 *
 * SEQUENTIAL AND SYNCHRONOUS by design this session. There is no scheduler, no
 * queue, no backoff timer here — a phase's declared retry policy is data the
 * S3 scheduler will act on, and the runner deliberately does not interpret it.
 * What the runner does provide is the execution order and the stop conditions,
 * which is what makes S3 a matter of adding a scheduler rather than rewriting
 * this.
 *
 * Stop conditions, in priority order:
 *   1. genuine_empty  — a confirmed fact about the subject. Terminal, and the
 *                       campaign stops immediately: there is nothing to gather.
 *   2. NOT_READY      — an upstream phase did not bank what this one needs.
 *                       Stops the run; it is a scheduling condition, not an
 *                       error, and the ledger shows exactly how far it got.
 *   3. unusable       — outcome is neither complete nor partial (failed /
 *                       blocked). Stops the run so the ledger records the true
 *                       terminal phase instead of cascading nulls downstream.
 * A `partial` outcome does NOT stop the run: a budget-bailed transcribe or a
 * degraded augment still feeds the phases after it.
 */
import {
  isUsableOutcome,
  NOT_READY,
  type AnalysisPhase,
  type CampaignState,
  type PhaseName,
  type PhaseResult,
  type PhaseStateEntry,
  type PlatformName,
} from "../_core/analysisPhase";

/** How the runner persists a phase's outcome. Injected so the runner is
 *  testable without a database, and so the caller owns the ledger write. */
export type BankFn = (entry: {
  phase: PhaseName;
  tool: string;
  status: PhaseStateEntry["status"];
  failureClass?: PhaseResult<unknown>["failureClass"];
  output: unknown;
  attempts: PhaseResult<unknown>["attempts"];
}) => Promise<void> | void;

export interface PhaseRunSummary {
  /** Phases that ran, in order, with the outcome each produced. */
  executed: Array<{ phase: PhaseName; outcome: PhaseResult<unknown>["outcome"] }>;
  /** Set when the run stopped before completing every phase. */
  stoppedAt?: { phase: PhaseName; reason: "genuine_empty" | "not_ready" | "unusable" };
  /** Final campaign state — every banked output, keyed by phase. */
  state: CampaignState;
}

/**
 * Run the given phases in order against a campaign.
 *
 * `state` is the live campaign state: the runner writes each phase's banked
 * output into it, and the NEXT phase's `inputs()` reads from it. That
 * indirection is the whole point — swap the in-memory state for one loaded
 * from the ledger and the same phases resume a cold campaign unchanged.
 */
export async function runPhases(args: {
  runId: string;
  handle: string;
  platform: PlatformName;
  phases: Array<AnalysisPhase<never, unknown>>;
  bank: BankFn;
  /** Pre-banked phases (a resumed campaign); defaults to empty. */
  initialPhases?: CampaignState["phases"];
}): Promise<PhaseRunSummary> {
  const state: CampaignState = {
    runId: args.runId,
    handle: args.handle,
    platform: args.platform,
    phases: { ...(args.initialPhases ?? {}) },
  };
  const executed: PhaseRunSummary["executed"] = [];

  for (const phase of args.phases) {
    // A phase already banked as usable (a resumed campaign) is not re-run:
    // re-running a completed phase would re-scrape and, worse, could bank a
    // DIFFERENT pool than the one later phases already consumed.
    const existing = state.phases[phase.name];
    if (existing && isUsableOutcome(existing.status as never)) {
      executed.push({ phase: phase.name, outcome: existing.status as never });
      continue;
    }

    const input = phase.inputs(state);
    if (input === NOT_READY) {
      return { executed, stoppedAt: { phase: phase.name, reason: "not_ready" }, state };
    }

    const result = await phase.run(input as never, {
      runId: args.runId, handle: args.handle, platform: args.platform, attempt: 1,
    });

    // Bank BEFORE deciding whether to continue: a failed phase's attempt record
    // is exactly what the analyst (and S3's scheduler) needs to see.
    await args.bank({
      phase: phase.name,
      tool: phase.tool,
      status: result.outcome as PhaseStateEntry["status"],
      failureClass: result.failureClass,
      output: result.output,
      attempts: result.attempts,
    });

    state.phases[phase.name] = {
      phase: phase.name,
      tool: phase.tool,
      status: result.outcome as PhaseStateEntry["status"],
      attemptCount: 1,
      failureClass: result.failureClass ?? null,
      nextEarliestAt: null,
      output: result.output,
    };
    executed.push({ phase: phase.name, outcome: result.outcome });

    if (result.outcome === "genuine_empty") {
      return { executed, stoppedAt: { phase: phase.name, reason: "genuine_empty" }, state };
    }
    if (!isUsableOutcome(result.outcome)) {
      return { executed, stoppedAt: { phase: phase.name, reason: "unusable" }, state };
    }
  }

  return { executed, state };
}

/** Typed read of a phase's banked output from a completed run. */
export function bankedOutput<T>(summary: PhaseRunSummary, phase: PhaseName): T | null {
  return (summary.state.phases[phase]?.output as T | undefined) ?? null;
}
