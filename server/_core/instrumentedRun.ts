/**
 * Instrumented analysis-run wrapper (scraper-reliability Part 4).
 *
 * This is analyze's run machinery — extracted VERBATIM from creator.analyze so
 * reanalyze can share it (parity), with the three-exit contract pinned by unit
 * tests (instrumentedRun.test.ts):
 *
 *   1. SUCCESS  — work resolves → ONE recordRunOutcome with the work's own
 *                 status/detail, memory summary attached, then the value is
 *                 returned to the caller.
 *   2. FAILURE  — work throws → ONE recordRunOutcome(classifyRunFailure(err))
 *                 with the error message + memory summary, then rethrow.
 *   3. TIMEOUT  — the race deadline fires first → the caller gets the TIMEOUT
 *                 TRPCError immediately and a PROVISIONAL "timeout" outcome is
 *                 recorded; the work keeps running and, if it finishes, its own
 *                 terminal write UPSERTS over the provisional row (Session 11
 *                 Commit 7: a timed-out run is no longer lost work). Its later
 *                 rejection is swallowed (no unhandled rejection).
 *
 * All runs — analyze AND reanalyze — share ONE concurrency pool
 * (analysisConcurrencyLimit, 2 slots): each run holds Playwright contexts and
 * LLM slots; 3+ concurrent runs exhaust the browser pool (max 5 contexts) and
 * cause context eviction mid-analysis.
 */
import { TRPCError } from "@trpc/server";
import pLimit from "p-limit";
import { recordRunOutcome, type RunOutcomeStatus } from "../db";
import { withAnalysisRun } from "./runContext";
import { startRunMemoryTracker } from "../scraping/memoryTelemetry";
import { isBrowserDeadError } from "../scraping/browserClient";

// ─── Concurrency limiter (moved verbatim from routers.ts) ────────────────────
// Limits simultaneous full creator/brand analyses to 2.
export const analysisConcurrencyLimit = pLimit(2);

// Session 11 (Commit 7): map a run failure to a terminal-outcome status for
// pipeline_runs telemetry. TIMEOUT is owned by the outer racer; here we classify
// the work's own failure — a min-data rejection (PRECONDITION_FAILED), a browser
// crash surfacing to the mutation, or an otherwise-unclassified error.
export function classifyRunFailure(err: unknown): "timeout" | "min_data_rejection" | "crash" | "error" {
  if (err instanceof TRPCError) {
    if (err.code === "TIMEOUT") return "timeout";
    if (err.code === "PRECONDITION_FAILED") return "min_data_rejection";
  }
  if (isBrowserDeadError(err)) return "crash";
  return "error";
}

export interface InstrumentedRunContext {
  pipelineStart: number;
  stepTimings: Array<{ step: string; durationMs: number }>;
}

export interface InstrumentedOutcome<T> {
  /** Returned to the tRPC caller. */
  value: T;
  /** Terminal pipeline_runs status for the successful work path. */
  status: RunOutcomeStatus;
  /** Merged into error_log ahead of the memory summary. */
  detail?: Record<string, unknown>;
  /** Evidence counts for the capture-health "thin" tier (Part 3, reporting only). */
  captureEvidence?: { transcripts: number; titles: number };
}

export async function runInstrumentedAnalysis<T>(args: {
  runId: string;
  /** pipeline_runs.run_type — "creator_analysis" | "creator_reanalysis" | … */
  runType: string;
  /** Race deadline (ENV.analysisTimeoutMs in production callers; injectable for tests). */
  timeoutMs: number;
  /** Client-facing TIMEOUT message (caller-specific wording preserved). */
  timeoutMessage: string;
  work: (ctx: InstrumentedRunContext) => Promise<InstrumentedOutcome<T>>;
}): Promise<T> {
  return withAnalysisRun(args.runId, async () => {
    const pipelineStart = Date.now();
    const stepTimings: Array<{ step: string; durationMs: number }> = [];
    // Part 1 (stability session): passive memory sampling for the whole run —
    // summary lands in pipeline_runs.error_log.memory on every terminal write.
    const memTracker = startRunMemoryTracker();

    const workPromise = (async () => {
      try {
        const out = await args.work({ pipelineStart, stepTimings });

        // Terminal telemetry — the authoritative outcome for this run.
        await recordRunOutcome(args.runId, out.status, {
          runType: args.runType,
          startedAt: new Date(pipelineStart),
          detail: {
            ...(out.detail ?? {}),
            memory: memTracker.stop(),
          },
          captureEvidence: out.captureEvidence,
        });

        return out.value;
      } catch (err) {
        // The work itself failed (research / extraction / persist). Record the
        // true terminal cause so a persist-time bail leaves telemetry instead of
        // the old nothing (Part 0.3, run a8c1833e). TIMEOUT is not raised here —
        // it belongs to the outer racer below.
        await recordRunOutcome(args.runId, classifyRunFailure(err), {
          runType: args.runType,
          startedAt: new Date(pipelineStart),
          detail: {
            message: err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300),
            memory: memTracker.stop(),
          },
        });
        throw err;
      }
    })();

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(
        new TRPCError({ code: "TIMEOUT", message: args.timeoutMessage })
      ), args.timeoutMs)
    );

    try {
      return await analysisConcurrencyLimit(() =>
        Promise.race([workPromise, timeoutPromise])
      );
    } catch (err) {
      if (err instanceof TRPCError && err.code === "TIMEOUT") {
        // Provisional: the client sees a timeout, but workPromise keeps running
        // and — if the extraction finishes — persists and upserts the real
        // outcome, superseding this. A timed-out run is no longer lost work.
        await recordRunOutcome(args.runId, "timeout", {
          runType: args.runType,
          startedAt: new Date(pipelineStart),
          detail: {
            note: `race timeout at ${args.timeoutMs}ms; extraction may still complete and persist out-of-band`,
            // Non-terminal snapshot: workPromise is still running and owns the
            // tracker's final stop() on its own success/failure path.
            memory: memTracker.summarySoFar(),
          },
        });
      }
      // If the timeout won, don't let workPromise's later settlement surface as
      // an unhandled rejection.
      void workPromise.catch(() => {});
      throw err;
    }
  });
}
