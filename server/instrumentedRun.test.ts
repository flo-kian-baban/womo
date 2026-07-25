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
 *              a late rejection never surfaces as an unhandled rejection;
 *   plus the shared 2-slot concurrency pool.
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

  it("CONCURRENCY: the shared 2-slot pool gates race observation (the original contract, preserved)", async () => {
    // Faithful to the ORIGINAL analyze shape: workPromise is created EAGERLY,
    // so the pool never delayed work START — it gates when a run's race is
    // observed/settled. (Latent gap in the original, deliberately preserved by
    // the extraction per the analyze-unchanged mandate; flagged in the session
    // report, not silently fixed.) Order-based assertions: memTracker's initial
    // synchronous sample costs tens of ms when many Chromium processes exist,
    // so wall-clock bounds are brittle here.
    const order: string[] = [];

    // Two runs whose work hangs far past their own 600ms race deadline — they
    // hold both pool slots until their races reject.
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
      }).catch(() => order.push(`slot-free-${id}`));

    const a = hog("run-hog-a");
    const b = hog("run-hog-b");
    await sleep(20); // both slots taken

    // Third run: its work runs eagerly (original behavior), but its wrapper
    // cannot settle until one of the hogs' races rejects and frees a slot.
    const c = runInstrumentedAnalysis({
      runId: "run-re-c",
      runType: "creator_reanalysis",
      timeoutMs: 10_000,
      timeoutMessage: "timed out",
      work: async () => {
        order.push("c-work-started");
        return { value: "c", status: "success" as const };
      },
    }).then(() => order.push("c-resolved"));

    await Promise.all([a, b, c]);
    // Eager work start: c's work ran while both slots were still held…
    expect(order.indexOf("c-work-started")).toBeLessThan(order.indexOf("slot-free-run-hog-a"));
    expect(order.indexOf("c-work-started")).toBeLessThan(order.indexOf("slot-free-run-hog-b"));
    // …but its wrapper only settled after a slot freed (the pool contract).
    expect(order.indexOf("c-resolved")).toBeGreaterThan(
      Math.min(order.indexOf("slot-free-run-hog-a"), order.indexOf("slot-free-run-hog-b")),
    );
    await sleep(1_600); // let the hogs' detached works finish before the file ends
  });
});
