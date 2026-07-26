/**
 * Scraper-reliability Part 4 — the analyze-unchanged proof (approved
 * amendment 3).
 *
 * runInstrumentedAnalysis is analyze's run machinery extracted verbatim. These
 * tests pin the three-exit contract that machinery has carried since Session 11
 * Commit 7 (the fix for the lost-work class), so the extraction is PROVABLY
 * behavior-preserving:
 *
 *   success  → one terminal recordRunOutcome with the work's status/detail +
 *              memory summary, value returned;
 *   failure  → one terminal recordRunOutcome with classifyRunFailure(err) +
 *              sliced message + memory, error rethrown;
 *   timeout  → caller gets TIMEOUT immediately, a PROVISIONAL "timeout" row is
 *              written, the work KEEPS RUNNING and its own terminal write
 *              supersedes the provisional one (in-race persistence / salvage);
 *              a late rejection never surfaces as an unhandled rejection.
 *
 * S3a removed the `pLimit(2)` this file used to call "the shared 2-slot
 * concurrency pool". It never bounded anything (see the module header), and the
 * case that pinned its behaviour was pinning the bug. Real admission is proven
 * in resourceSlots.test.ts; what remains here is the proof that this wrapper
 * does not gate a run behind an unrelated one.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({
  recordRunOutcome: vi.fn(async () => {}),
}));

import { recordRunOutcome } from "./db";
import { classifyRunFailure, runInstrumentedAnalysis } from "./_core/instrumentedRun";
import { TRPCError } from "@trpc/server";

const recorded = vi.mocked(recordRunOutcome);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

beforeEach(() => {
  recorded.mockClear();
});

describe("classifyRunFailure (moved verbatim)", () => {
  it("classifies exactly as before", () => {
    expect(classifyRunFailure(new TRPCError({ code: "TIMEOUT", message: "t" }))).toBe("timeout");
    expect(classifyRunFailure(new TRPCError({ code: "PRECONDITION_FAILED", message: "m" }))).toBe("min_data_rejection");
    expect(classifyRunFailure(new Error("boom"))).toBe("error");
  });
});

describe("runInstrumentedAnalysis — the three exits", () => {
  it("SUCCESS: returns the value; one terminal write with status, merged detail, memory, captureEvidence", async () => {
    const result = await runInstrumentedAnalysis({
      runId: "run-success",
      runType: "creator_analysis",
      timeoutMs: 5_000,
      timeoutMessage: "timed out",
      work: async () => ({
        value: 42,
        status: "success" as const,
        detail: { a: 1 },
        captureEvidence: { transcripts: 5, titles: 9 },
      }),
    });

    expect(result).toBe(42);
    expect(recorded).toHaveBeenCalledTimes(1);
    const [runId, status, opts] = recorded.mock.calls[0]!;
    expect(runId).toBe("run-success");
    expect(status).toBe("success");
    expect(opts?.runType).toBe("creator_analysis");
    expect(opts?.startedAt).toBeInstanceOf(Date);
    expect(opts?.detail).toMatchObject({ a: 1 });
    expect(opts?.detail?.memory).toBeTruthy(); // memTracker.stop() summary
    expect(opts?.captureEvidence).toEqual({ transcripts: 5, titles: 9 });
  });

  it("FAILURE: classifies (min_data_rejection), records message + memory, rethrows", async () => {
    await expect(
      runInstrumentedAnalysis({
        runId: "run-mindata",
        runType: "creator_analysis",
        timeoutMs: 5_000,
        timeoutMessage: "timed out",
        work: async () => {
          throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Insufficient data for @x" });
        },
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

    expect(recorded).toHaveBeenCalledTimes(1);
    const [, status, opts] = recorded.mock.calls[0]!;
    expect(status).toBe("min_data_rejection");
    expect(opts?.detail?.message).toBe("Insufficient data for @x");
    expect(opts?.detail?.memory).toBeTruthy();
  });

  it("TIMEOUT + SALVAGE: caller gets TIMEOUT, provisional row first, then the finished work's own terminal write supersedes it", async () => {
    const promise = runInstrumentedAnalysis({
      runId: "run-salvage",
      runType: "creator_analysis",
      timeoutMs: 60,
      timeoutMessage: "Analysis timed out after 1 minute(s).",
      work: async () => {
        await sleep(180); // outlives the race deadline — keeps running after TIMEOUT
        return { value: "late-but-saved", status: "success" as const };
      },
    });

    await expect(promise).rejects.toMatchObject({ code: "TIMEOUT", message: "Analysis timed out after 1 minute(s)." });

    // Provisional timeout row was written when the race fired.
    expect(recorded.mock.calls[0]![1]).toBe("timeout");
    expect(String(recorded.mock.calls[0]![2]?.detail?.note)).toContain("race timeout at 60ms");

    // The work keeps running; its terminal write lands afterwards (salvage).
    await sleep(220);
    expect(recorded).toHaveBeenCalledTimes(2);
    expect(recorded.mock.calls[1]![0]).toBe("run-salvage");
    expect(recorded.mock.calls[1]![1]).toBe("success");
  });

  it("TIMEOUT + late failure: late rejection records its class and never surfaces unhandled", async () => {
    await expect(
      runInstrumentedAnalysis({
        runId: "run-late-fail",
        runType: "creator_reanalysis",
        timeoutMs: 60,
        timeoutMessage: "timed out",
        work: async () => {
          await sleep(180);
          throw new Error("late boom");
        },
      }),
    ).rejects.toMatchObject({ code: "TIMEOUT" });

    await sleep(220);
    expect(recorded).toHaveBeenCalledTimes(2);
    expect(recorded.mock.calls[0]![1]).toBe("timeout");
    expect(recorded.mock.calls[1]![1]).toBe("error");
    expect(recorded.mock.calls[1]![2]?.runType).toBe("creator_reanalysis");
    // Reaching here without vitest flagging an unhandled rejection IS the assertion.
  });

  // ─── S3a: this wrapper no longer pretends to bound anything ───────────────
  //
  // The old case here asserted the pLimit(2) contract as it actually behaved:
  // work started EAGERLY and the pool merely gated when a run's race settled.
  // That was the bug, pinned as a feature. Admission moved to where the
  // contention is — per resource class, per phase, taken before any tool runs
  // (resourceSlots.ts / phaseScheduler.ts), and it is proven in
  // resourceSlots.test.ts by assertions about when a body is CALLED.
  //
  // What is pinned here now is the inverse: a run's wrapper must not hold a
  // finished run back waiting on some unrelated run.

  it("NO RUN-LEVEL GATE: a run settles on its own work, never behind another run", async () => {
    const order: string[] = [];

    // Two long runs that would have occupied both old pool slots.
    const hog = (id: string) =>
      runInstrumentedAnalysis({
        runId: id,
        runType: "creator_analysis",
        timeoutMs: 600,
        timeoutMessage: "timed out",
        work: async () => {
          await sleep(2_000);
          return { value: id, status: "success" as const };
        },
      }).catch(() => order.push(`hog-settled-${id}`));

    const a = hog("run-hog-a");
    const b = hog("run-hog-b");
    await sleep(20);

    const c = runInstrumentedAnalysis({
      runId: "run-re-c",
      runType: "creator_reanalysis",
      timeoutMs: 10_000,
      timeoutMessage: "timed out",
      work: async () => {
        order.push("c-work-started");
        return { value: "c", status: "success" as const };
      },
    }).then((v) => { order.push("c-resolved"); return v; });

    expect(await c).toBe("c");

    // c finished while both hogs are still running: its result is not held
    // hostage to their races. Under the old pool, c-resolved could only appear
    // after a hog freed a slot.
    expect(order).toEqual(["c-work-started", "c-resolved"]);

    await Promise.all([a, b]);
    await sleep(1_600); // let the hogs' detached works finish before the file ends
  });

  it("does not import a global limiter any more", async () => {
    const mod = await import("./_core/instrumentedRun");
    expect("analysisConcurrencyLimit" in mod).toBe(false);
  });
});
