/**
 * Browser memory instrumentation (isolated stability session, Part 1).
 *
 * Measurement scaffolding for the --single-process decision: per analysis run we
 * record peak Node RSS/heap, peak Chromium process count + process-tree RSS, peak
 * context-pool occupancy, and crash/relaunch counters. The analyze mutation
 * attaches the summary to the run's terminal pipeline_runs row
 * (error_log.memory via recordRunOutcome), so after the flag flips we can SEE the
 * memory impact on real production runs instead of guessing.
 *
 * Strictly passive — no scraping behavior changes:
 *   - a 5s unref'd sampling interval per run (1-2 concurrent runs max);
 *   - Chromium processes found by /proc scan on Linux (prod: node:20-slim) with a
 *     one-shot `ps` fallback on darwin (dev); every probe is try/catch → null.
 */
import { readdirSync, readFileSync, existsSync } from "fs";
import { execFileSync } from "child_process";
import { getPoolSnapshot, getPoolStats, BROWSER_LAUNCH_ARGS } from "./browserClient";

// ─── Snapshot ─────────────────────────────────────────────────────────────────

export interface MemorySnapshot {
  nodeRssMb: number;
  nodeHeapMb: number;
  /** null when the process tree could not be probed on this platform */
  chromiumProcs: number | null;
  chromiumRssMb: number | null;
  contexts: number;
  busyContexts: number;
}

const MB = 1024 * 1024;
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Does this command line look like our headless Playwright Chromium? */
function isChromiumCmd(cmd: string): boolean {
  const c = cmd.toLowerCase();
  return (c.includes("chrom") || c.includes("ms-playwright")) && (c.includes("--headless") || c.includes("--type="));
}

/** Linux: scan /proc for Chromium processes; count + sum resident set. */
function sampleChromiumViaProc(): { procs: number; rssMb: number } | null {
  try {
    const pageSize = 4096;
    let procs = 0;
    let rssBytes = 0;
    for (const entry of readdirSync("/proc")) {
      if (!/^\d+$/.test(entry)) continue;
      try {
        const cmd = readFileSync(`/proc/${entry}/cmdline`, "utf8").replace(/\0/g, " ");
        if (!isChromiumCmd(cmd)) continue;
        // /proc/N/statm: "size resident shared ..." in pages
        const resident = Number(readFileSync(`/proc/${entry}/statm`, "utf8").split(/\s+/)[1] ?? 0);
        procs++;
        rssBytes += resident * pageSize;
      } catch { /* process vanished mid-scan — skip */ }
    }
    return { procs, rssMb: round1(rssBytes / MB) };
  } catch {
    return null;
  }
}

/** Parse `ps -axo pid=,rss=,command=` output (rss in KB). Exported for tests. */
export function parsePsChromium(psOutput: string): { procs: number; rssMb: number } {
  let procs = 0;
  let rssKb = 0;
  for (const line of psOutput.split("\n")) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
    if (!m) continue;
    if (!isChromiumCmd(m[3])) continue;
    procs++;
    rssKb += Number(m[2]);
  }
  return { procs, rssMb: round1(rssKb / 1024) };
}

/** darwin/dev fallback: one `ps` exec per sample (5s cadence — negligible). */
function sampleChromiumViaPs(): { procs: number; rssMb: number } | null {
  try {
    const out = execFileSync("ps", ["-axo", "pid=,rss=,command="], { timeout: 1500, encoding: "utf8" });
    return parsePsChromium(out);
  } catch {
    return null;
  }
}

/** One passive snapshot of Node + Chromium + context-pool memory state. */
export function snapshotMemory(): MemorySnapshot {
  const mu = process.memoryUsage();
  const chromium = existsSync("/proc/self") ? sampleChromiumViaProc() : sampleChromiumViaPs();
  const pool = getPoolSnapshot();
  return {
    nodeRssMb: round1(mu.rss / MB),
    nodeHeapMb: round1(mu.heapUsed / MB),
    chromiumProcs: chromium?.procs ?? null,
    chromiumRssMb: chromium?.rssMb ?? null,
    contexts: pool.contexts,
    busyContexts: pool.busyContexts,
  };
}

// ─── Per-run tracker ──────────────────────────────────────────────────────────

export interface RunMemorySummary {
  /** Which flag configuration produced this row — lets us compare eras in SQL. */
  singleProcess: boolean;
  samples: number;
  peakNodeRssMb: number;
  peakNodeHeapMb: number;
  peakChromiumProcs: number | null;
  peakChromiumRssMb: number | null;
  peakContexts: number;
  /** Deltas over this run (from browserClient counters). */
  browserRelaunches: number;
  relaunchTotalMs: number;
  crashRecoveries: number;
}

export interface RunMemoryTracker {
  /** Take an extra sample immediately (also used by tests). */
  sampleNow: () => void;
  /** Non-terminal summary — used by the timeout handler while work continues. */
  summarySoFar: () => RunMemorySummary;
  /** Stop sampling and return the final summary. Idempotent. */
  stop: () => RunMemorySummary;
}

export function startRunMemoryTracker(opts?: {
  intervalMs?: number;
  snapshotFn?: () => MemorySnapshot;
}): RunMemoryTracker {
  const snapshotFn = opts?.snapshotFn ?? snapshotMemory;
  const startStats = getPoolStats();
  let samples = 0;
  let peakNodeRssMb = 0;
  let peakNodeHeapMb = 0;
  let peakChromiumProcs: number | null = null;
  let peakChromiumRssMb: number | null = null;
  let peakContexts = 0;
  let stopped = false;
  let finalSummary: RunMemorySummary | null = null;

  const sampleNow = () => {
    if (stopped) return;
    try {
      const s = snapshotFn();
      samples++;
      peakNodeRssMb = Math.max(peakNodeRssMb, s.nodeRssMb);
      peakNodeHeapMb = Math.max(peakNodeHeapMb, s.nodeHeapMb);
      if (s.chromiumProcs !== null) peakChromiumProcs = Math.max(peakChromiumProcs ?? 0, s.chromiumProcs);
      if (s.chromiumRssMb !== null) peakChromiumRssMb = Math.max(peakChromiumRssMb ?? 0, s.chromiumRssMb);
      peakContexts = Math.max(peakContexts, s.contexts);
    } catch { /* sampling must never break a run */ }
  };

  sampleNow();
  const timer = setInterval(sampleNow, opts?.intervalMs ?? 5000);
  if (typeof timer === "object" && "unref" in timer) (timer as NodeJS.Timeout).unref();

  const build = (): RunMemorySummary => {
    const end = getPoolStats();
    return {
      singleProcess: (BROWSER_LAUNCH_ARGS as readonly string[]).includes("--single-process"),
      samples,
      peakNodeRssMb,
      peakNodeHeapMb,
      peakChromiumProcs,
      peakChromiumRssMb,
      peakContexts,
      browserRelaunches: end.browserLaunches - startStats.browserLaunches,
      relaunchTotalMs: end.launchTotalMs - startStats.launchTotalMs,
      crashRecoveries: end.crashRecoveries - startStats.crashRecoveries,
    };
  };

  return {
    sampleNow,
    summarySoFar: build,
    stop: () => {
      if (!stopped) {
        sampleNow();
        stopped = true;
        clearInterval(timer);
        finalSummary = build();
        console.log(`[memoryTelemetry] run peak: node ${finalSummary.peakNodeRssMb}MB rss / chromium ${finalSummary.peakChromiumRssMb ?? "?"}MB across ${finalSummary.peakChromiumProcs ?? "?"} proc(s), ${finalSummary.crashRecoveries} crash recover(ies), ${finalSummary.browserRelaunches} launch(es)`);
      }
      return finalSummary ?? build();
    },
  };
}
