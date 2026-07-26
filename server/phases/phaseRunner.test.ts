/**
 * Phase runner — isolation tests (S2).
 *
 * The runner decides execution order and stop conditions, and it is what the S3
 * scheduler will be bolted onto. These pin the behaviours that would be
 * expensive to discover later: that a phase reads BANKED output rather than
 * whatever the previous phase happened to return, that a failure stops the run
 * instead of cascading nulls, and that a completed phase is never re-run.
 */
import { describe, expect, it, vi } from "vitest";
import { runPhases, bankedOutput, type BankFn } from "./phaseRunner";
import { NOT_READY, type AnalysisPhase, type PhaseName } from "../_core/analysisPhase";

/** Minimal phase factory: records what input it was handed. */
function stubPhase(
  name: PhaseName,
  opts: {
    outcome?: "complete" | "partial" | "failed" | "blocked" | "genuine_empty";
    output?: unknown;
    ready?: boolean;
    onRun?: (input: unknown) => void;
    failureClass?: "transient" | "structural" | "genuine_empty";
  } = {},
): AnalysisPhase<never, unknown> {
  return {
    name,
    tool: `stub:${name}`,
    retry: { maxAttempts: 1, backoffMs: {} },
    inputs: (state) => (opts.ready === false ? NOT_READY : ({ state } as never)),
    async run(input) {
      opts.onRun?.(input);
      return {
        outcome: opts.outcome ?? "complete",
        failureClass: opts.failureClass,
        output: opts.output ?? { phase: name },
        attempts: [{ tool: `stub:${name}`, outcome: opts.outcome ?? "complete", durationMs: 1 }],
      };
    },
  } as AnalysisPhase<never, unknown>;
}

const noBank: BankFn = () => {};
const base = { runId: "run-1", handle: "someone", platform: "TikTok" as const };

describe("execution order", () => {
  it("runs phases in the order given", async () => {
    const order: string[] = [];
    const mk = (n: PhaseName) => stubPhase(n, { onRun: () => order.push(n) });
    const summary = await runPhases({
      ...base, bank: noBank,
      phases: [mk("capture"), mk("augment"), mk("transcribe"), mk("derive"), mk("extract_commit")],
    });
    expect(order).toEqual(["capture", "augment", "transcribe", "derive", "extract_commit"]);
    expect(summary.stoppedAt).toBeUndefined();
    expect(summary.executed.map(e => e.phase)).toEqual(order);
  });
});

describe("phases read BANKED state, not the previous return value", () => {
  it("hands each phase a state containing prior phases' banked output", async () => {
    let seenByAugment: unknown = null;
    const capture = stubPhase("capture", { output: { pool: ["a", "b"] } });
    const augment: AnalysisPhase<never, unknown> = {
      name: "augment", tool: "stub", retry: { maxAttempts: 1, backoffMs: {} },
      inputs: (state) => {
        seenByAugment = state.phases.capture?.output;
        return { ok: true } as never;
      },
      run: async () => ({ outcome: "complete", output: {}, attempts: [] }),
    } as AnalysisPhase<never, unknown>;

    await runPhases({ ...base, bank: noBank, phases: [capture, augment] });
    // augment saw capture's BANKED output through the campaign state.
    expect(seenByAugment).toEqual({ pool: ["a", "b"] });
  });

  it("banks every phase's output through the injected sink, in order", async () => {
    const banked: string[] = [];
    const bank: BankFn = (e) => { banked.push(`${e.phase}:${e.status}`); };
    await runPhases({
      ...base, bank,
      phases: [stubPhase("capture"), stubPhase("augment", { outcome: "partial" })],
    });
    expect(banked).toEqual(["capture:complete", "augment:partial"]);
  });
});

describe("stop conditions", () => {
  it("NOT_READY stops the run and reports which phase blocked", async () => {
    const later = vi.fn();
    const summary = await runPhases({
      ...base, bank: noBank,
      phases: [
        stubPhase("capture"),
        stubPhase("augment", { ready: false }),
        stubPhase("transcribe", { onRun: later }),
      ],
    });
    expect(summary.stoppedAt).toEqual({ phase: "augment", reason: "not_ready" });
    expect(later).not.toHaveBeenCalled();
  });

  it("a FAILED phase stops the run rather than cascading nulls downstream", async () => {
    const later = vi.fn();
    const summary = await runPhases({
      ...base, bank: noBank,
      phases: [
        stubPhase("capture"),
        stubPhase("augment", { outcome: "failed", failureClass: "structural", output: null }),
        stubPhase("transcribe", { onRun: later }),
      ],
    });
    expect(summary.stoppedAt).toEqual({ phase: "augment", reason: "unusable" });
    expect(later).not.toHaveBeenCalled();
  });

  it("GENUINE_EMPTY stops immediately — the subject has nothing to gather", async () => {
    const later = vi.fn();
    const summary = await runPhases({
      ...base, bank: noBank,
      phases: [
        stubPhase("capture", { outcome: "genuine_empty", failureClass: "genuine_empty" }),
        stubPhase("augment", { onRun: later }),
      ],
    });
    expect(summary.stoppedAt).toEqual({ phase: "capture", reason: "genuine_empty" });
    expect(later).not.toHaveBeenCalled();
  });

  it("a PARTIAL outcome does NOT stop the run", async () => {
    // A budget-bailed transcribe or degraded augment still feeds what follows.
    const later = vi.fn();
    const summary = await runPhases({
      ...base, bank: noBank,
      phases: [
        stubPhase("capture"),
        stubPhase("augment", { outcome: "partial" }),
        stubPhase("transcribe", { onRun: later }),
      ],
    });
    expect(later).toHaveBeenCalledOnce();
    expect(summary.stoppedAt).toBeUndefined();
  });

  it("banks the failing phase BEFORE stopping, so the ledger shows the true terminal phase", async () => {
    const banked: string[] = [];
    await runPhases({
      ...base, bank: (e) => { banked.push(`${e.phase}:${e.status}`); },
      phases: [stubPhase("capture"), stubPhase("augment", { outcome: "failed", output: null })],
    });
    expect(banked).toContain("augment:failed");
  });
});

describe("idempotent re-run of a completed phase", () => {
  it("skips a phase already banked as usable and does not re-execute it", async () => {
    // Re-running a completed capture would re-scrape and could bank a DIFFERENT
    // pool than the phases after it already consumed.
    const rerun = vi.fn();
    const summary = await runPhases({
      ...base, bank: noBank,
      phases: [stubPhase("capture", { onRun: rerun }), stubPhase("augment")],
      initialPhases: {
        capture: {
          phase: "capture", tool: "prior", status: "complete", attemptCount: 1,
          failureClass: null, nextEarliestAt: null, output: { pool: ["prior"] },
        },
      },
    });
    expect(rerun).not.toHaveBeenCalled();
    // …and the prior banked output is what downstream sees.
    expect(bankedOutput<{ pool: string[] }>(summary, "capture")?.pool).toEqual(["prior"]);
    expect(summary.executed.map(e => e.phase)).toEqual(["capture", "augment"]);
  });

  it("DOES re-run a phase whose prior outcome was not usable", async () => {
    const rerun = vi.fn();
    await runPhases({
      ...base, bank: noBank,
      phases: [stubPhase("capture", { onRun: rerun })],
      initialPhases: {
        capture: {
          phase: "capture", tool: "prior", status: "failed", attemptCount: 1,
          failureClass: "transient", nextEarliestAt: null, output: null,
        },
      },
    });
    expect(rerun).toHaveBeenCalledOnce();
  });
});

// ─── S3a: the execute seam ───────────────────────────────────────────────────
// The runner keeps owning order and stop conditions; a scheduler is supplied
// through `execute` rather than bolted into this file.

describe("execute seam", () => {
  it("calls the phase directly when no execute is supplied (unchanged S2 behaviour)", async () => {
    const ran = vi.fn();
    const summary = await runPhases({
      ...base, bank: noBank, phases: [stubPhase("capture", { onRun: ran })],
    });
    expect(ran).toHaveBeenCalledOnce();
    expect(summary.executed).toEqual([{ phase: "capture", outcome: "complete" }]);
  });

  it("routes every phase through the supplied execute, with the runner's context", async () => {
    const seen: string[] = [];
    await runPhases({
      ...base, bank: noBank,
      phases: [stubPhase("capture"), stubPhase("augment")],
      execute: (phase, input, ctx) => {
        seen.push(`${phase.name}@${ctx.runId}`);
        return phase.run(input, ctx);
      },
    });
    expect(seen).toEqual(["capture@run-1", "augment@run-1"]);
  });

  it("banks the attemptCount and nextEarliestAt the scheduler reports", async () => {
    const gate = new Date("2026-07-26T12:00:00Z");
    const banked: Array<{ attemptCount: number; nextEarliestAt: Date | null }> = [];
    const summary = await runPhases({
      ...base,
      bank: (e) => { banked.push({ attemptCount: e.attemptCount, nextEarliestAt: e.nextEarliestAt }); },
      phases: [stubPhase("capture")],
      execute: async (phase, input, ctx) => ({
        ...(await phase.run(input, ctx)), attemptCount: 3, nextEarliestAt: gate,
      }),
    });
    expect(banked).toEqual([{ attemptCount: 3, nextEarliestAt: gate }]);
    expect(summary.state.phases.capture).toMatchObject({ attemptCount: 3, nextEarliestAt: gate });
  });

  it("defaults attemptCount to 1 and the gate to null when execute omits them", async () => {
    const banked: Array<{ attemptCount: number; nextEarliestAt: Date | null }> = [];
    await runPhases({
      ...base,
      bank: (e) => { banked.push({ attemptCount: e.attemptCount, nextEarliestAt: e.nextEarliestAt }); },
      phases: [stubPhase("capture")],
    });
    expect(banked).toEqual([{ attemptCount: 1, nextEarliestAt: null }]);
  });

  it("stop conditions still belong to the runner, not to execute", async () => {
    const summary = await runPhases({
      ...base, bank: noBank,
      phases: [stubPhase("capture", { outcome: "genuine_empty" }), stubPhase("augment")],
      execute: (phase, input, ctx) => phase.run(input, ctx),
    });
    expect(summary.stoppedAt).toEqual({ phase: "capture", reason: "genuine_empty" });
    expect(summary.executed.map(e => e.phase)).toEqual(["capture"]);
  });
});
