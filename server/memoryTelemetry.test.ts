/**
 * Stability session (Part 1) — memory instrumentation.
 * Measurement scaffolding only: these tests pin the tracker's peak logic,
 * stop-idempotence, the non-terminal summarySoFar path (used by the timeout
 * handler while the raced work keeps running), and the ps-fallback parser.
 */
import { describe, it, expect } from "vitest";
import {
  startRunMemoryTracker,
  snapshotMemory,
  parsePsChromium,
  type MemorySnapshot,
} from "./scraping/memoryTelemetry";

function snap(overrides: Partial<MemorySnapshot>): MemorySnapshot {
  return {
    nodeRssMb: 100, nodeHeapMb: 50, chromiumProcs: null, chromiumRssMb: null,
    contexts: 0, busyContexts: 0, ...overrides,
  };
}

describe("startRunMemoryTracker", () => {
  it("tracks peaks across samples, not last values", () => {
    const series = [
      snap({ nodeRssMb: 100, chromiumProcs: 2, chromiumRssMb: 300, contexts: 1 }),
      snap({ nodeRssMb: 250, nodeHeapMb: 120, chromiumProcs: 6, chromiumRssMb: 900, contexts: 4 }),
      snap({ nodeRssMb: 150, chromiumProcs: 3, chromiumRssMb: 400, contexts: 2 }),
    ];
    let i = 0;
    const tracker = startRunMemoryTracker({ intervalMs: 60_000, snapshotFn: () => series[Math.min(i++, series.length - 1)] });
    tracker.sampleNow(); // series[1]
    tracker.sampleNow(); // series[2]
    const s = tracker.stop();
    expect(s.peakNodeRssMb).toBe(250);
    expect(s.peakNodeHeapMb).toBe(120);
    expect(s.peakChromiumProcs).toBe(6);
    expect(s.peakChromiumRssMb).toBe(900);
    expect(s.peakContexts).toBe(4);
    expect(s.samples).toBeGreaterThanOrEqual(3);
    expect(typeof s.singleProcess).toBe("boolean");
  });

  it("stop is idempotent and stops sampling", () => {
    let calls = 0;
    const tracker = startRunMemoryTracker({ intervalMs: 60_000, snapshotFn: () => { calls++; return snap({ nodeRssMb: calls * 100 }); } });
    const first = tracker.stop();
    const callsAtStop = calls;
    tracker.sampleNow(); // must be a no-op after stop
    const second = tracker.stop();
    expect(second).toEqual(first);
    expect(calls).toBe(callsAtStop);
  });

  it("summarySoFar does not stop sampling (timeout-handler path)", () => {
    const tracker = startRunMemoryTracker({ intervalMs: 60_000, snapshotFn: () => snap({ nodeRssMb: 100 }) });
    const provisional = tracker.summarySoFar();
    expect(provisional.peakNodeRssMb).toBe(100);
    tracker.sampleNow(); // still live
    const final = tracker.stop();
    expect(final.samples).toBeGreaterThan(provisional.samples);
  });

  it("keeps chromium peaks null when the platform probe never returns data", () => {
    const tracker = startRunMemoryTracker({ intervalMs: 60_000, snapshotFn: () => snap({}) });
    const s = tracker.stop();
    expect(s.peakChromiumProcs).toBeNull();
    expect(s.peakChromiumRssMb).toBeNull();
  });
});

describe("parsePsChromium", () => {
  it("counts only headless-chromium processes and sums their RSS", () => {
    const ps = [
      "  123  204800 /ms-playwright/chromium-1105/chrome-linux/chrome --headless --no-sandbox",
      "  124  102400 /ms-playwright/chromium-1105/chrome-linux/chrome --type=renderer --headless",
      "  200   51200 node dist/index.js",
      "  201    1024 grep chrome",
    ].join("\n");
    const r = parsePsChromium(ps);
    expect(r.procs).toBe(2);              // node + grep excluded
    expect(r.rssMb).toBe(300);            // (204800+102400) KB = 300 MB
  });

  it("returns zeros on empty output", () => {
    expect(parsePsChromium("")).toEqual({ procs: 0, rssMb: 0 });
  });
});

describe("snapshotMemory", () => {
  it("returns live Node numbers and a well-formed shape on any platform", () => {
    const s = snapshotMemory();
    expect(s.nodeRssMb).toBeGreaterThan(0);
    expect(s.nodeHeapMb).toBeGreaterThan(0);
    expect(s.contexts).toBeGreaterThanOrEqual(0);
    expect(s.busyContexts).toBeGreaterThanOrEqual(0);
    // chromiumProcs/RssMb are number-or-null depending on platform probe
    expect(s.chromiumProcs === null || typeof s.chromiumProcs === "number").toBe(true);
    expect(s.chromiumRssMb === null || typeof s.chromiumRssMb === "number").toBe(true);
  });
});
