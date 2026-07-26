/**
 * Retry/backoff policy and the execute seam — phased architecture S3a, Parts 2-3.
 *
 * The point of these tests is that the POLICY IS DATA: `decideRetry` is pure and
 * exhaustively exercisable without a phase, a clock, a database or a browser. A
 * phase's only job is to say what happened; every "will we try again, and when"
 * decision is made here and is provable here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BLOCKED_PARK_MS,
  DEFAULT_BACKOFF,
  DEFAULT_MAX_ATTEMPTS,
  decideRetry,
  makeSchedulerExecute,
  nextEarliestAtFor,
} from "./phaseScheduler";
import { __testSlots, currentlyHeldClass, slotSnapshot } from "../_core/resourceSlots";
import type { AnalysisPhase, PhaseResult, PhaseRunContext } from "../_core/analysisPhase";

const NOW = 1_800_000_000_000;
const ctx: PhaseRunContext = { runId: "r1", handle: "creator", platform: "TikTok", attempt: 1 };

beforeEach(() => { __testSlots.reset(); });
afterEach(() => { __testSlots.reset(); });

/** A phase whose outcomes are scripted per attempt. */
function scriptedPhase(
  name: AnalysisPhase<never, unknown>["name"],
  script: Array<Partial<PhaseResult<unknown>>>,
  extra: Partial<AnalysisPhase<never, unknown>> = {},
): AnalysisPhase<never, unknown> & { seenAttempts: number[] } {
  const seenAttempts: number[] = [];
  return {
    name,
    tool: `${name}:test`,
    retry: { maxAttempts: 4, backoffMs: { transient: [1_000, 2_000, 3_000] } },
    inputs: () => ({}) as never,
    async run(_input, c) {
      seenAttempts.push(c.attempt);
      const step = script[c.attempt - 1] ?? script[script.length - 1]!;
      return { outcome: "complete", output: null, attempts: [], ...step } as PhaseResult<unknown>;
    },
    seenAttempts,
    ...extra,
  } as AnalysisPhase<never, unknown> & { seenAttempts: number[] };
}

describe("policy is data — the approved failure-class table", () => {
  it("transient backs off 30s, 2m, 5m", () => {
    expect(DEFAULT_BACKOFF.transient).toEqual([30_000, 120_000, 300_000]);
  });
  it("blocked parks 5m then 15m", () => {
    expect(BLOCKED_PARK_MS).toEqual([300_000, 900_000]);
  });
  it("structural and genuine_empty declare no backoff at all — they never requeue", () => {
    expect(DEFAULT_BACKOFF.structural).toEqual([]);
    expect(DEFAULT_BACKOFF.genuine_empty).toEqual([]);
  });
});

describe("decideRetry — by failure class", () => {
  it("GENUINE_EMPTY terminates the campaign immediately, on either signal", () => {
    expect(decideRetry({ outcome: "genuine_empty", attempt: 1, now: NOW }))
      .toMatchObject({ action: "terminate" });
    expect(decideRetry({ outcome: "failed", failureClass: "genuine_empty", attempt: 1, now: NOW }))
      .toMatchObject({ action: "terminate" });
  });

  it("GENUINE_EMPTY is never retried, no matter how early the attempt", () => {
    for (let attempt = 1; attempt <= 5; attempt++) {
      expect(decideRetry({ outcome: "genuine_empty", attempt, now: NOW }).action).toBe("terminate");
    }
  });

  it("complete and partial are done — a budget-bailed transcribe is not re-scraped", () => {
    expect(decideRetry({ outcome: "complete", attempt: 1, now: NOW }).action).toBe("done");
    expect(decideRetry({ outcome: "partial", attempt: 1, now: NOW }).action).toBe("done");
  });

  it("STRUCTURAL parks for attention and never requeues", () => {
    const d = decideRetry({ outcome: "failed", failureClass: "structural", attempt: 1, now: NOW });
    expect(d.action).toBe("park");
    expect(d.delayMs).toBeUndefined();
    expect(nextEarliestAtFor(d, NOW)).toBeNull(); // no gate — it will not come back on its own
  });

  it("TRANSIENT walks the 30s / 2m / 5m ladder, then parks", () => {
    const at = (attempt: number) =>
      decideRetry({ outcome: "failed", failureClass: "transient", attempt, now: NOW });
    expect(at(1)).toMatchObject({ action: "retry", delayMs: 30_000 });
    expect(at(2)).toMatchObject({ action: "retry", delayMs: 120_000 });
    expect(at(3)).toMatchObject({ action: "retry", delayMs: 300_000 });
    expect(at(4)).toMatchObject({ action: "park" }); // DEFAULT_MAX_ATTEMPTS reached
    expect(DEFAULT_MAX_ATTEMPTS).toBe(4);
  });

  it("BLOCKED parks 5m then 15m rather than hammering the gate", () => {
    const at = (attempt: number) => decideRetry({ outcome: "blocked", attempt, now: NOW });
    expect(at(1)).toMatchObject({ action: "park", delayMs: 300_000 });
    expect(at(2)).toMatchObject({ action: "park", delayMs: 900_000 });
    expect(nextEarliestAtFor(at(1), NOW)).toEqual(new Date(NOW + 300_000));
  });

  it("an unclassified failure is treated as transient — one more try beats discarding a good run", () => {
    expect(decideRetry({ outcome: "failed", attempt: 1, now: NOW }))
      .toMatchObject({ action: "retry", delayMs: 30_000 });
  });
});

describe("decideRetry — the phase's declared policy overrides the table", () => {
  it("uses the phase's own backoff ladder and attempt cap (capture: 3 / [30s, 2m])", () => {
    const policy = { maxAttempts: 3, backoffMs: { transient: [30_000, 120_000] } };
    const at = (attempt: number) =>
      decideRetry({ outcome: "failed", failureClass: "transient", attempt, policy, now: NOW });
    expect(at(1)).toMatchObject({ action: "retry", delayMs: 30_000 });
    expect(at(2)).toMatchObject({ action: "retry", delayMs: 120_000 });
    // The table would have offered a third 5m retry; the phase says stop at 3.
    expect(at(3)).toMatchObject({ action: "park" });
  });

  it("a phase declaring no transient backoff parks on the first failure", () => {
    const policy = { maxAttempts: 4, backoffMs: {} };
    expect(decideRetry({ outcome: "failed", failureClass: "transient", attempt: 1, policy, now: NOW }))
      .toMatchObject({ action: "park" });
  });

  it("transcribe's expensive single retry (2 / [60s]) is respected", () => {
    const policy = { maxAttempts: 2, backoffMs: { transient: [60_000] } };
    expect(decideRetry({ outcome: "failed", failureClass: "transient", attempt: 1, policy, now: NOW }))
      .toMatchObject({ action: "retry", delayMs: 60_000 });
    expect(decideRetry({ outcome: "failed", failureClass: "transient", attempt: 2, policy, now: NOW }))
      .toMatchObject({ action: "park" });
  });
});

describe("decideRetry — deadline awareness", () => {
  it("a retry that fits inside the deadline still retries", () => {
    expect(decideRetry({
      outcome: "failed", failureClass: "transient", attempt: 1, now: NOW,
      deadlineAt: NOW + 120_000, // 30s backoff fits
    })).toMatchObject({ action: "retry", delayMs: 30_000 });
  });

  it("a retry that would land past the deadline is DOWNGRADED to a park, gate still recorded", () => {
    const d = decideRetry({
      outcome: "failed", failureClass: "transient", attempt: 2, now: NOW,
      deadlineAt: NOW + 60_000, // the 2m backoff overshoots
    });
    expect(d.action).toBe("park");
    expect(d.delayMs).toBe(120_000);
    // The intent survives as ledger data for S3b's poller.
    expect(nextEarliestAtFor(d, NOW)).toEqual(new Date(NOW + 120_000));
    expect(d.reason).toContain("past the campaign deadline");
  });

  it("with no deadline supplied, nothing is downgraded", () => {
    expect(decideRetry({ outcome: "failed", failureClass: "transient", attempt: 3, now: NOW }))
      .toMatchObject({ action: "retry", delayMs: 300_000 });
  });

  it("terminate and structural park are unaffected by the deadline", () => {
    expect(decideRetry({ outcome: "genuine_empty", attempt: 1, now: NOW, deadlineAt: NOW - 1 }).action)
      .toBe("terminate");
    expect(decideRetry({ outcome: "failed", failureClass: "structural", attempt: 1, now: NOW, deadlineAt: NOW - 1 }).action)
      .toBe("park");
  });
});

describe("makeSchedulerExecute — attempts, admission and sleeps", () => {
  it("retries a transient failure and reports the real attempt number to the phase", async () => {
    const slept: number[] = [];
    const phase = scriptedPhase("capture", [
      { outcome: "failed", failureClass: "transient" },
      { outcome: "failed", failureClass: "transient" },
      { outcome: "complete", output: { ok: true } },
    ]);

    const execute = makeSchedulerExecute({
      now: () => NOW,
      sleep: async (ms) => { slept.push(ms); },
    });
    const result = await execute(phase, {} as never, ctx);

    expect(phase.seenAttempts).toEqual([1, 2, 3]);
    expect(slept).toEqual([1_000, 2_000]); // the phase's own declared ladder
    expect(result.outcome).toBe("complete");
    expect(result.attemptCount).toBe(3);
    expect(result.nextEarliestAt).toBeNull();
  });

  it("HOLDS NO PERMIT WHILE SLEEPING — the backoff must not park a browser slot", async () => {
    __testSlots.setBounds({ browser: 1 });
    const heldDuringSleep: Array<string | null> = [];
    const inFlightDuringSleep: number[] = [];

    const phase = scriptedPhase("capture", [
      { outcome: "failed", failureClass: "transient" },
      { outcome: "complete" },
    ]);

    const execute = makeSchedulerExecute({
      now: () => NOW,
      sleep: async () => {
        heldDuringSleep.push(currentlyHeldClass());
        inFlightDuringSleep.push(slotSnapshot().browser.inFlight);
      },
    });
    await execute(phase, {} as never, ctx);

    expect(heldDuringSleep).toEqual([null]); // outside any slot
    expect(inFlightDuringSleep).toEqual([0]); // the browser slot is free for others
  });

  it("runs the phase inside its resource class's bound", async () => {
    __testSlots.setBounds({ browser: 1 });
    const execute = makeSchedulerExecute({ now: () => NOW });

    let inFlightInside = 0;
    const phase = scriptedPhase("transcribe", [{ outcome: "complete" }]);
    const original = phase.run.bind(phase);
    phase.run = async (i, c) => {
      inFlightInside = slotSnapshot().browser.inFlight;
      expect(currentlyHeldClass()).toBe("browser");
      return original(i, c);
    };

    await execute(phase, {} as never, ctx);
    expect(inFlightInside).toBe(1);
    expect(slotSnapshot().browser.inFlight).toBe(0); // released on the way out
  });

  it("takes an LLM permit for derive, not a browser one", async () => {
    const execute = makeSchedulerExecute({ now: () => NOW });
    const phase = scriptedPhase("derive", [{ outcome: "complete" }]);
    const original = phase.run.bind(phase);
    let seen: string | null = null;
    phase.run = async (i, c) => { seen = currentlyHeldClass(); return original(i, c); };

    await execute(phase, {} as never, ctx);
    expect(seen).toBe("llm");
  });

  it("NEVER retries a genuine_empty — one attempt, campaign over", async () => {
    const sleep = vi.fn(async () => {});
    const phase = scriptedPhase("capture", [{ outcome: "genuine_empty", failureClass: "genuine_empty" }]);

    const result = await makeSchedulerExecute({ now: () => NOW, sleep })(phase, {} as never, ctx);

    expect(phase.seenAttempts).toEqual([1]);
    expect(sleep).not.toHaveBeenCalled();
    expect(result.outcome).toBe("genuine_empty");
    expect(result.attemptCount).toBe(1);
  });

  it("stops at the phase's attempt cap and returns the parked gate", async () => {
    const slept: number[] = [];
    const phase = scriptedPhase("augment", [{ outcome: "failed", failureClass: "transient" }], {
      retry: { maxAttempts: 2, backoffMs: { transient: [5_000] } },
    });

    const result = await makeSchedulerExecute({
      now: () => NOW, sleep: async (ms) => { slept.push(ms); },
    })(phase, {} as never, ctx);

    expect(phase.seenAttempts).toEqual([1, 2]);
    expect(slept).toEqual([5_000]);
    expect(result.outcome).toBe("failed");
    expect(result.attemptCount).toBe(2);
    expect(result.nextEarliestAt).toBeNull(); // attempts exhausted: no gate
  });

  it("a blocked phase parks with a future gate instead of retrying in-process", async () => {
    const sleep = vi.fn(async () => {});
    const phase = scriptedPhase("augment", [{ outcome: "blocked", failureClass: "transient" }]);

    const result = await makeSchedulerExecute({ now: () => NOW, sleep })(phase, {} as never, ctx);

    expect(phase.seenAttempts).toEqual([1]);
    expect(sleep).not.toHaveBeenCalled();
    expect(result.nextEarliestAt).toEqual(new Date(NOW + 300_000));
  });

  it("under deadline pressure it does not sleep at all — it parks and returns", async () => {
    const sleep = vi.fn(async () => {});
    const phase = scriptedPhase("capture", [{ outcome: "failed", failureClass: "transient" }]);

    const result = await makeSchedulerExecute({
      now: () => NOW, sleep, deadlineAt: NOW + 500, // 1s backoff overshoots
    })(phase, {} as never, ctx);

    expect(phase.seenAttempts).toEqual([1]);
    expect(sleep).not.toHaveBeenCalled();
    expect(result.attemptCount).toBe(1);
    expect(result.nextEarliestAt).toEqual(new Date(NOW + 1_000));
  });

  it("announces each attempt twice — pending while queued, running once admitted", async () => {
    const starts: Array<string> = [];
    const phase = scriptedPhase("capture", [
      { outcome: "failed", failureClass: "transient" },
      { outcome: "complete" },
    ]);

    await makeSchedulerExecute({
      now: () => NOW,
      sleep: async () => {},
      onAttemptStart: (p, attempt, status) => starts.push(`${p.name}#${attempt}:${status}`),
    })(phase, {} as never, ctx);

    expect(starts).toEqual([
      "capture#1:pending", "capture#1:running",
      "capture#2:pending", "capture#2:running",
    ]);
  });

  it("reports `running` only while a permit is actually held — a QUEUED phase reads pending", async () => {
    // The ledger must not call a phase "running" while it is waiting for
    // admission. Bound 1: the second campaign's capture queues behind the first.
    __testSlots.setBounds({ browser: 1 });
    const seen: Array<{ status: string; held: string | null }> = [];
    const record = (_p: unknown, _a: number, status: "pending" | "running") =>
      seen.push({ status, held: currentlyHeldClass() });

    const blocker = gateOpen();
    const slow = scriptedPhase("capture", [{ outcome: "complete" }]);
    const slowRun = slow.run.bind(slow);
    slow.run = async (i, c) => { await blocker.opened; return slowRun(i, c); };

    const queued = scriptedPhase("capture", [{ outcome: "complete" }]);

    const execute = makeSchedulerExecute({ now: () => NOW, onAttemptStart: record });
    const first = execute(slow, {} as never, ctx);
    const second = execute(queued, {} as never, ctx);

    await new Promise<void>((r) => setTimeout(r, 20));
    // Both phases announced themselves as pending (admission is always deferred
    // by at least a microtask), but only ONE has been admitted — the other is
    // sitting in the queue and must not be reported as running.
    expect(seen.filter(s => s.status === "pending")).toHaveLength(2);
    expect(seen.filter(s => s.status === "running")).toHaveLength(1);
    // …and every `running` came from INSIDE a permit, every `pending` from outside.
    expect(seen.filter(s => s.status === "running").every(s => s.held === "browser")).toBe(true);
    expect(seen.filter(s => s.status === "pending").every(s => s.held === null)).toBe(true);

    blocker.release();
    await Promise.all([first, second]);
    // The queued phase is only now reported running — after the first released.
    expect(seen.filter(s => s.status === "running")).toHaveLength(2);
    expect(seen[seen.length - 1]).toEqual({ status: "running", held: "browser" });
  });
});

/** A latch the test opens by hand. */
function gateOpen() {
  let release!: () => void;
  const opened = new Promise<void>((r) => { release = r; });
  return { opened, release };
}
