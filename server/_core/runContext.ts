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

type AnalysisRunContext = { runId: string };

const storage = new AsyncLocalStorage<AnalysisRunContext>();

/** Generate a fresh analysis-run correlation id. */
export function newRunId(): string {
  return randomUUID();
}

/** Run `fn` with the given runId as the ambient analysis-run context. */
export function withAnalysisRun<T>(runId: string, fn: () => Promise<T>): Promise<T> {
  return storage.run({ runId }, fn);
}

/** The ambient run id, or null when not inside an analysis run. */
export function currentRunId(): string | null {
  return storage.getStore()?.runId ?? null;
}
