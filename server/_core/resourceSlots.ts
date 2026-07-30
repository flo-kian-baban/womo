/**
 * Per-resource-class admission control — phased architecture S3a, Part 1.
 *
 * ─── The bug this replaces ──────────────────────────────────────────────────
 * instrumentedRun.ts used to hold ONE global `pLimit(2)` and hand it a promise
 * that had ALREADY STARTED (`workPromise` is an IIFE: `args.work(...)` is
 * invoked synchronously at construction). A limiter can only defer the callback
 * it is given, so deferring `Promise.race([workPromise, timeoutPromise])`
 * deferred nothing but the OBSERVATION of two already-running promises. Three
 * concurrent analyses therefore all scraped at once, exhausted the 5-context
 * browser pool, and evicted each other's contexts mid-run.
 *
 * p-limit was never the problem — passing it started work was. This module
 * keeps p-limit and fixes the contract: `fn` is not called until a permit is
 * held.
 *
 * ─── Why per resource class, not one global limit ───────────────────────────
 * A campaign's phases contend for DIFFERENT scarce things. Browser-bound phases
 * (capture / augment / transcribe) contend for Playwright contexts, capped at
 * MAX_CONCURRENT_CONTEXTS = 5 and measured in hundreds of MB of Chromium RSS.
 * LLM-bound phases (derive / extract_commit) contend for API quota and cost
 * nothing locally. One number cannot serve both: set it low enough for
 * Chromium and the cheap LLM work queues behind scraping for no reason.
 *
 * ─── The invariant that keeps the TTL reaper race dead ──────────────────────
 * PERMIT ⊃ CONTEXT, ALWAYS. Admission happens BEFORE `fn` runs; every
 * `getContext()` happens inside `fn`; the permit is released in `finally` after
 * `fn` settles — i.e. after the context has been retired or its page closed. A
 * job that is WAITING therefore holds no browser context.
 *
 * This is not a style preference. `reapStaleContexts` (stability FIX 1, f04329b)
 * closes contexts past CONTEXT_TTL_MS unless they are `busy` or have open pages.
 * If a queued job held a context while it waited, either (a) the context stays
 * `busy`, pool occupancy climbs past the cap, and `acquireContextPage` starts
 * creating contexts OVER the soft cap (browserClient.ts:417-423) — the memory
 * blowup; or (b) the wait outlives the TTL after `busy` clears and the reaper
 * closes the context out from under the resumed job — "Target page, context or
 * browser has been closed", the exact cascade Session 11 Commit 6 killed.
 *
 * Two rules protect the invariant, and the second is enforced structurally:
 *   1. A permit is never held across a retry backoff sleep (the scheduler
 *      releases, sleeps, re-acquires).
 *   2. ONE permit per phase, NEVER NESTED — `withResourceSlot` throws on
 *      re-entrant acquisition. Nesting is how hold-and-wait (and deadlock)
 *      would sneak back in, e.g. "just grab an LLM slot inside transcribe".
 */
import { AsyncLocalStorage } from "async_hooks";
import pLimit, { type LimitFunction } from "p-limit";
import type { PhaseName } from "./analysisPhase";

// ─── Classes ─────────────────────────────────────────────────────────────────

/**
 * browser — contends for Playwright contexts and Chromium RSS (the scarce one).
 * llm     — contends for API quota; cheap locally, rate-limited remotely.
 * compute — pure in-process work; nothing to bound.
 */
export type ResourceClass = "browser" | "llm" | "compute";

/** Which scarce resource each phase actually contends for. */
export function classForPhase(phase: PhaseName): ResourceClass {
  switch (phase) {
    case "capture":
    case "augment":
    case "transcribe":
    // Brand's Instagram channel: a profile scrape and a post fetch before its
    // LLM call, so it is admitted against the BROWSER bound like the other
    // scraping phases — not the llm one, which would let it hold a browser
    // context outside the bound that exists to cap them.
    case "channel_instagram":
      return "browser";
    case "derive":
    case "extract_commit":
      return "llm";
    // Match phases (S6). Neither opens a browser nor calls a model: `prepare`
    // reads two committed observations, `persist` writes match_scores and its
    // satellites. Bounding them against `browser` or `llm` would hold a permit
    // that exists to cap a scarcity they do not consume. A match's ONE model
    // phase is `derive`, already classified `llm` above.
    case "prepare":
    case "persist":
      return "compute";
  }
}

// ─── Bounds (configuration, not constants) ───────────────────────────────────
//
// Deliberately env-tunable: these are starting values to be moved against the
// memory telemetry (pipeline_runs.error_log.memory), not truths.
//
//   browser = 2 — MAX_CONCURRENT_CONTEXTS is 5 and a browser-bound phase peaks
//     at 1-2 contexts (capture's profile chain: 1; augment's shared search
//     context: 1; transcribe's shared batch context: 1). Two concurrent browser
//     phases stay under the cap with headroom for the health-check path. THREE
//     can reach or exceed 5, at which point the pool creates contexts over the
//     cap rather than blocking — precisely the memory path this exists to close.
//
//   llm = 4 — derive fires two Gemini calls concurrently, so 4 concurrent
//     LLM-bound phases means up to 8 in-flight requests. invokeLLM's 429 retry
//     with backoff is the real backstop; this is the conservative end of the
//     approved 4-6 range and can be raised once telemetry says the quota holds.
//
//   compute = unbounded (0) — no scarce resource to protect.

/** 0 or negative = unbounded. */
export type ResourceBounds = Record<ResourceClass, number>;

function envInt(name: string, fallback: number): number {
  const raw = parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(raw) && raw >= 0 ? raw : fallback;
}

export const DEFAULT_BOUNDS: ResourceBounds = {
  browser: 2,
  llm: 4,
  compute: 0,
};

let _bounds: ResourceBounds = {
  browser: envInt("PHASE_BROWSER_CONCURRENCY", DEFAULT_BOUNDS.browser),
  llm: envInt("PHASE_LLM_CONCURRENCY", DEFAULT_BOUNDS.llm),
  compute: envInt("PHASE_COMPUTE_CONCURRENCY", DEFAULT_BOUNDS.compute),
};

/** The bounds actually in force (for diagnostics and the session report). */
export function currentBounds(): ResourceBounds {
  return { ..._bounds };
}

// ─── Limiters + peak accounting ──────────────────────────────────────────────

const _limiters = new Map<ResourceClass, LimitFunction>();
const _peakInFlight: Record<ResourceClass, number> = { browser: 0, llm: 0, compute: 0 };

function limiterFor(cls: ResourceClass): LimitFunction | null {
  const bound = _bounds[cls];
  if (bound <= 0) return null; // unbounded
  let limit = _limiters.get(cls);
  if (!limit) {
    limit = pLimit(bound);
    _limiters.set(cls, limit);
  }
  return limit;
}

export interface SlotStats {
  bound: number;
  /** Permits held right now. */
  inFlight: number;
  /** Jobs waiting for a permit right now. */
  queued: number;
  /** High-water mark of `inFlight` since process start (or the last reset). */
  peakInFlight: number;
}

/**
 * Live admission state per class. `peakInFlight` is the number the concurrency
 * acceptance test reports: browser must never exceed its bound.
 */
export function slotSnapshot(): Record<ResourceClass, SlotStats> {
  const out = {} as Record<ResourceClass, SlotStats>;
  for (const cls of ["browser", "llm", "compute"] as const) {
    const limit = _limiters.get(cls);
    out[cls] = {
      bound: _bounds[cls],
      inFlight: limit?.activeCount ?? 0,
      queued: limit?.pendingCount ?? 0,
      peakInFlight: _peakInFlight[cls],
    };
  }
  return out;
}

// ─── The nesting guard ───────────────────────────────────────────────────────

const _held = new AsyncLocalStorage<ResourceClass>();

/** The class whose permit this async context currently holds, if any. */
export function currentlyHeldClass(): ResourceClass | null {
  return _held.getStore() ?? null;
}

export class NestedResourceSlotError extends Error {
  constructor(held: ResourceClass, requested: ResourceClass) {
    super(
      `Nested resource slot: already holding a "${held}" permit while requesting "${requested}". ` +
      `One permit per phase, never nested — nesting reintroduces hold-and-wait (a job queued ` +
      `while holding a browser context is how the TTL reaper race comes back) and can deadlock. ` +
      `Release the outer permit first, or run this work as its own phase.`,
    );
    this.name = "NestedResourceSlotError";
  }
}

// ─── Admission ───────────────────────────────────────────────────────────────

/**
 * Run `fn` holding a permit for `cls`.
 *
 * THE CONTRACT: `fn` is NOT CALLED until a permit is held. That is the whole
 * fix — the old path started work and then queued the observation of it.
 *
 * The permit is released in `finally`, so it survives `fn` throwing, and it is
 * released only after `fn` has fully settled (which is after any browser
 * context it acquired has been retired or its page closed).
 */
export async function withResourceSlot<T>(cls: ResourceClass, fn: () => Promise<T>): Promise<T> {
  const held = _held.getStore();
  if (held) throw new NestedResourceSlotError(held, cls);

  const limit = limiterFor(cls);
  if (!limit) {
    // Unbounded class: no permit to hold, but still mark the context so a
    // nested acquisition below is caught rather than silently allowed.
    return _held.run(cls, fn);
  }

  return limit(async () => {
    // Reached only once a permit is held.
    _peakInFlight[cls] = Math.max(_peakInFlight[cls], limit.activeCount);
    return _held.run(cls, fn);
  });
}

// ─── Test seam ───────────────────────────────────────────────────────────────

/**
 * TEST-ONLY: retune bounds and reset accounting. p-limit v5 instances have a
 * fixed concurrency, so changing a bound rebuilds its limiter — which is safe
 * only when nothing is in flight. Throws in production, like browserClient's
 * `__testPool`.
 */
export const __testSlots = {
  setBounds(next: Partial<ResourceBounds>): void {
    if (process.env.NODE_ENV === "production") throw new Error("__testSlots is test-only");
    _bounds = { ..._bounds, ...next };
    _limiters.clear();
  },
  reset(): void {
    if (process.env.NODE_ENV === "production") throw new Error("__testSlots is test-only");
    _bounds = { ...DEFAULT_BOUNDS };
    _limiters.clear();
    _peakInFlight.browser = 0;
    _peakInFlight.llm = 0;
    _peakInFlight.compute = 0;
  },
};
