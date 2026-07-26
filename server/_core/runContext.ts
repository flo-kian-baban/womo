/**
 * Analysis-run context (womo_0006).
 *
 * An analysis run (creator.analyze / creator.reanalyze / one bulk handle) gets
 * a correlation UUID that must reach EVERY scrape_event and llm_invocation the
 * run produces — including ones written deep inside modules that cannot take a
 * runId parameter (frozen engine files, module-level telemetry in
 * scraping/httpClient.ts). AsyncLocalStorage threads it implicitly: wrap the
 * run in withAnalysisRun() and db.ts stamps currentRunId() on provenance
 * writes automatically. No pipeline code changes hands the id around.
 */

import { AsyncLocalStorage } from "async_hooks";
import { randomUUID } from "crypto";

type AnalysisRunContext = {
  runId: string;
  /**
   * When this run's race deadline expires (epoch ms), when it has one. Carried
   * here for the same reason as runId: the S3a scheduler needs it deep inside
   * the phase runner, which has no parameter to take it through and no business
   * knowing about the endpoint's timeout. A backoff that would land past this
   * point is parked instead of slept (phaseScheduler.ts).
   */
  deadlineAt?: number;
};

const storage = new AsyncLocalStorage<AnalysisRunContext>();

/** Generate a fresh analysis-run correlation id. */
export function newRunId(): string {
  return randomUUID();
}

/** Run `fn` with the given runId as the ambient analysis-run context. */
export function withAnalysisRun<T>(
  runId: string,
  fn: () => Promise<T>,
  opts?: { deadlineAt?: number },
): Promise<T> {
  return storage.run({ runId, deadlineAt: opts?.deadlineAt }, fn);
}

/** The ambient run id, or null when not inside an analysis run. */
export function currentRunId(): string | null {
  return storage.getStore()?.runId ?? null;
}

/** The ambient race deadline (epoch ms), or undefined when there is none. */
export function currentDeadlineAt(): number | undefined {
  return storage.getStore()?.deadlineAt;
}
