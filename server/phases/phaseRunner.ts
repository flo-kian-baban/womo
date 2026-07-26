/**
 * Phase runner — phased architecture S2.
 *
 * Executes phases in sequence. Each phase declares its inputs by reading the
 * BANKED output of prior phases from the campaign state; the runner banks each
 * phase's output as it completes, so the state a phase reads is the state that
 * was durably written, not a value threaded through a caller's locals.
 *
 * SEQUENTIAL by design. The runner owns the execution ORDER and the stop
 * conditions and nothing else — it still does not interpret a phase's retry
 * policy, admit work, or sleep. S3a added a scheduler by supplying `execute`
 * (phaseScheduler.ts) rather than by rewriting anything here, which is what the
 * original split was for.
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
  type PhaseRunContext,
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
  /** How many attempts the scheduler consumed; 1 without a scheduler. */
  attemptCount: number;
  /** Backoff gate the scheduler recorded, if it parked or requeued. */
  nextEarliestAt: Date | null;
}) => Promise<void> | void;

/**
 * How one phase is executed. Defaults to calling the phase directly — that is
 * the whole S2 behaviour, preserved. S3a's scheduler supplies an implementation
 * that adds admission and retry around the same call, so this file needs to
 * know nothing about either.
 */
export type ExecutePhaseFn = (
  phase: AnalysisPhase<never, unknown>,
  input: never,
  ctx: PhaseRunContext,
) => Promise<PhaseResult<unknown> & { attemptCount?: number; nextEarliestAt?: Date | null }>;

const runDirectly: ExecutePhaseFn = (phase, input, ctx) => phase.run(input, ctx);

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
  /** How each phase is executed. Omit for the direct call (S2 behaviour). */
  execute?: ExecutePhaseFn;
}): Promise<PhaseRunSummary> {
  const execute = args.execute ?? runDirectly;
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

    const result = await execute(phase, input as never, {
      runId: args.runId, handle: args.handle, platform: args.platform, attempt: 1,
    });
    const attemptCount = result.attemptCount ?? 1;
    const nextEarliestAt = result.nextEarliestAt ?? null;

    // Bank BEFORE deciding whether to continue: a failed phase's attempt record
    // is exactly what the analyst (and the scheduler's rescan) needs to see.
    await args.bank({
      phase: phase.name,
      tool: phase.tool,
      status: result.outcome as PhaseStateEntry["status"],
      failureClass: result.failureClass,
      output: result.output,
      attempts: result.attempts,
      attemptCount,
      nextEarliestAt,
    });

    state.phases[phase.name] = {
      phase: phase.name,
      tool: phase.tool,
      status: result.outcome as PhaseStateEntry["status"],
      attemptCount,
      failureClass: result.failureClass ?? null,
      nextEarliestAt,
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
