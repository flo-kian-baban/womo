/**
 * Unit tests — analysis-run context (womo_0006).
 * The AsyncLocalStorage context is the mechanism that carries the run id to
 * every scrape_event/llm_invocation writer without parameter threading; these
 * tests pin down the propagation guarantees it relies on.
 */

import { describe, it, expect } from "vitest";
import { newRunId, withAnalysisRun, currentRunId } from "./_core/runContext";

describe("analysis run context (womo_0006)", () => {
  it("is null outside a run", () => {
    expect(currentRunId()).toBeNull();
  });

  it("provides the run id inside the run and restores null after", async () => {
    const runId = newRunId();
    await withAnalysisRun(runId, async () => {
      expect(currentRunId()).toBe(runId);
    });
    expect(currentRunId()).toBeNull();
  });

  it("survives await boundaries and timer callbacks", async () => {
    const runId = newRunId();
    await withAnalysisRun(runId, async () => {
      await new Promise(resolve => setTimeout(resolve, 5));
      expect(currentRunId()).toBe(runId);
      // fire-and-forget style (how llm.ts / httpClient.ts log provenance)
      const seen = await new Promise<string | null>(resolve =>
        setTimeout(() => resolve(currentRunId()), 5),
      );
      expect(seen).toBe(runId);
    });
  });

  it("isolates concurrent runs from each other", async () => {
    const a = newRunId();
    const b = newRunId();
    const results = await Promise.all([
      withAnalysisRun(a, async () => {
        await new Promise(r => setTimeout(r, 10));
        return currentRunId();
      }),
      withAnalysisRun(b, async () => {
        await new Promise(r => setTimeout(r, 5));
        return currentRunId();
      }),
    ]);
    expect(results).toEqual([a, b]);
  });

  it("generates unique UUIDs", () => {
    const ids = new Set(Array.from({ length: 100 }, () => newRunId()));
    expect(ids.size).toBe(100);
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    }
  });
});
