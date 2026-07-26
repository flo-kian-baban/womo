/**
 * Unit tests — analysis-run context (womo_0006).
 * The AsyncLocalStorage context is the mechanism that carries the run id to
 * every scrape_event/llm_invocation writer without parameter threading; these
 * tests pin down the propagation guarantees it relies on.
 */

import { describe, it, expect } from "vitest";
import { newRunId, withAnalysisRun, currentRunId, currentDeadlineAt } from "./_core/runContext";

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

  // S3a: the race deadline rides the same context as the run id, for the same
  // reason — the scheduler needs it deep inside the phase runner, which has no
  // parameter to take it through and no business knowing about the endpoint.
  it("carries the race deadline, and reports undefined when there is none", async () => {
    expect(currentDeadlineAt()).toBeUndefined();
    await withAnalysisRun(newRunId(), async () => {
      expect(currentDeadlineAt()).toBeUndefined();
    });
    const deadline = Date.now() + 300_000;
    await withAnalysisRun(newRunId(), async () => {
      await new Promise(r => setTimeout(r, 5));
      expect(currentDeadlineAt()).toBe(deadline);
    }, { deadlineAt: deadline });
    expect(currentDeadlineAt()).toBeUndefined();
  });

  it("keeps concurrent runs' deadlines separate", async () => {
    const [a, b] = await Promise.all([
      withAnalysisRun(newRunId(), async () => {
        await new Promise(r => setTimeout(r, 10));
        return currentDeadlineAt();
      }, { deadlineAt: 1_000 }),
      withAnalysisRun(newRunId(), async () => currentDeadlineAt(), { deadlineAt: 2_000 }),
    ]);
    expect([a, b]).toEqual([1_000, 2_000]);
  });

  it("generates unique UUIDs", () => {
    const ids = new Set(Array.from({ length: 100 }, () => newRunId()));
    expect(ids.size).toBe(100);
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    }
  });
});
