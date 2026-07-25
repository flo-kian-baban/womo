/**
 * Playwright Browser Pool Manager — Phase 2
 *
 * Single browser instance, multiple contexts (max 3 concurrent).
 * Supports stealth via puppeteer-extra-plugin-stealth through playwright-extra.
 *
 * Features:
 *   - Context pool with warm/cold state tracking
 *   - Named presets: mobile-ios, mobile-android, desktop-chrome
 *   - Auto-restart crashed browser instances
 *   - Context rotation: retire after 5 navigations
 *   - Session warming: visit homepage first with 2–4s random pause
 *   - XHR interception helper for API response capture
 */

import { chromium } from "playwright-extra";
import type { Browser, BrowserContext, Page, Route } from "playwright";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { existsSync } from "fs";

// Apply stealth plugin at module level
chromium.use(StealthPlugin());

// ─── Context Presets ──────────────────────────────────────────────────────────

export type ContextPreset = "mobile-ios" | "mobile-android" | "desktop-chrome";

interface PresetConfig {
  viewport: { width: number; height: number };
  userAgent: string;
  isMobile: boolean;
  hasTouch: boolean;
  deviceScaleFactor: number;
  locale: string;
}

const PRESETS: Record<ContextPreset, PresetConfig> = {
  "mobile-ios": {
    viewport: { width: 375, height: 812 },
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3,
    locale: "en-US",
  },
  "mobile-android": {
    viewport: { width: 412, height: 915 },
    userAgent:
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36",
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2.625,
    locale: "en-US",
  },
  "desktop-chrome": {
    viewport: { width: 1920, height: 1080 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    isMobile: false,
    hasTouch: false,
    deviceScaleFactor: 1,
    locale: "en-US",
  },
};

// ─── Pool State ───────────────────────────────────────────────────────────────

interface ManagedContext {
  context: BrowserContext;
  preset: ContextPreset;
  useCount: number;
  maxUses: number;
  createdAt: number;
  // Session 11 (Commit 6): true while a caller holds a page checked out from this
  // context. A busy context is never reused by another concurrent caller and never
  // evicted — that is what closed contexts out from under in-flight work (the
  // retire race). Cleared when the handed-out page closes.
  busy: boolean;
}

// FIX 3.1: Increased from 3 to 5 to accommodate multi-path Instagram analysis
// (mobile profile + desktop fallback + transcript download + buffer).
// FIX 4.1's cleanup timer ensures stale contexts don't accumulate.
const MAX_CONCURRENT_CONTEXTS = 5;
const DEFAULT_MAX_USES = 5;
const CONTEXT_TTL_MS = 5 * 60 * 1000; // 5 minutes max lifetime
const CLEANUP_INTERVAL_MS = 60 * 1000; // Check every 60 seconds
// Stability FIX 1: never hand OUT a warm context that is within this margin of
// its TTL — a checkout seconds before the reaper's boundary is how in-flight work
// used to get its context closed from under it. Near-TTL idle contexts are left
// for the reaper; the caller gets a fresh one.
const REUSE_TTL_SAFETY_MS = 60 * 1000;

/**
 * May this pooled context be handed out for reuse right now? Exported for tests.
 * Requires: matching preset, uses remaining, not checked out (busy), and not
 * within REUSE_TTL_SAFETY_MS of its TTL expiry.
 */
export function isWarmContextReusable(
  mc: { preset: ContextPreset; useCount: number; maxUses: number; busy: boolean; createdAt: number },
  preset: ContextPreset,
  nowMs: number = Date.now(),
): boolean {
  return (
    mc.preset === preset &&
    mc.useCount < mc.maxUses &&
    !mc.busy &&
    (nowMs - mc.createdAt) < (CONTEXT_TTL_MS - REUSE_TTL_SAFETY_MS)
  );
}

let _browser: Browser | null = null;
let _browserLaunching = false;
const _contexts: ManagedContext[] = [];
let _cleanupTimer: ReturnType<typeof setInterval> | null = null;

// ─── Memory instrumentation (isolated stability session, Part 1) ─────────────
// Passive counters read by scraping/memoryTelemetry.ts — measurement only.

// ─── Environment-profiled launch args (local-first session, C1) ──────────────
//
// The container flags — above all --single-process — exist for headless Docker
// on Railway ("GPU initialization crashes", 1bb2d2d). --single-process is also
// the MEASURED crash root cause (a renderer crash kills the whole browser;
// ~1-2 recoveries/run, storms of 7-8). On a normal macOS laptop none of that
// medicine is needed, so the local profile drops every container-only flag and
// keeps only the stealth flags. memoryTelemetry's `singleProcess` marker reads
// the active args, so telemetry rows self-label their era automatically.

export type BrowserProfile = "container" | "local";

/** Stealth flags — both profiles. */
const STEALTH_ARGS = [
  "--disable-blink-features=AutomationControlled",
  "--disable-infobars",
] as const;

/** Container-only medicine (headless Docker on Railway). */
const CONTAINER_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  // Required in headless Docker to prevent GPU initialization crashes
  "--disable-gpu",
  "--disable-software-rasterizer",
  "--single-process",
] as const;

/** The launch args for a given profile. Pure — exported for tests. */
export function launchArgsForProfile(profile: BrowserProfile): readonly string[] {
  return profile === "container" ? [...CONTAINER_ARGS, ...STEALTH_ARGS] : [...STEALTH_ARGS];
}

/**
 * Resolve the active profile. Pure (deps injectable) — exported for tests.
 * Precedence:
 *   1. BROWSER_PROFILE env ("container" | "local") — explicit override, both ways;
 *   2. container markers already present in the deployed image with ZERO Railway
 *      changes: /.dockerenv (standard Docker) or PLAYWRIGHT_BROWSERS_PATH (set in
 *      our Dockerfile);
 *   3. default: local (an analyst laptop needs no configuration at all).
 */
export function resolveBrowserProfile(
  env: Record<string, string | undefined> = process.env,
  fileExists: (p: string) => boolean = existsSync,
): BrowserProfile {
  const override = (env.BROWSER_PROFILE ?? "").toLowerCase();
  if (override === "container" || override === "local") return override;
  if (fileExists("/.dockerenv") || Boolean(env.PLAYWRIGHT_BROWSERS_PATH)) return "container";
  return "local";
}

/** The active profile, resolved once at module load (env is stable per process). */
export const BROWSER_PROFILE: BrowserProfile = resolveBrowserProfile();

/**
 * The exact Chromium launch args, exported so telemetry rows self-describe which
 * flag configuration produced them (--single-process present or not). Single
 * source of truth: ensureBrowser() launches with THIS array.
 */
export const BROWSER_LAUNCH_ARGS: readonly string[] = launchArgsForProfile(BROWSER_PROFILE);

const _poolStats = { browserLaunches: 0, launchTotalMs: 0, crashRecoveries: 0 };

/** Cumulative launch/recovery counters (monotonic; callers diff start vs end). */
export function getPoolStats(): { browserLaunches: number; launchTotalMs: number; crashRecoveries: number } {
  return { ..._poolStats };
}

/** Live context-pool occupancy. */
export function getPoolSnapshot(): { contexts: number; busyContexts: number } {
  return { contexts: _contexts.length, busyContexts: _contexts.filter((mc) => mc.busy).length };
}

/**
 * TEST-ONLY pool seam (stability FIX 1 tests): lets the reap sweep be exercised
 * against fabricated contexts without launching Chromium. Throws in production.
 */
export const __testPool = {
  insert(mc: {
    context: Pick<BrowserContext, "close" | "pages">;
    preset: ContextPreset; useCount: number; maxUses: number; createdAt: number; busy: boolean;
  }): void {
    if (process.env.NODE_ENV === "production") throw new Error("__testPool is test-only");
    _contexts.push(mc as unknown as ManagedContext);
  },
  clear(): void {
    if (process.env.NODE_ENV === "production") throw new Error("__testPool is test-only");
    _contexts.length = 0;
  },
};

// ── FIX 4.1: Periodic cleanup of stale browser contexts ──
// Prevents leaked contexts from accumulating until OOM.

/**
 * Is this context safe for a background reaper to close right now?
 * NOT safe while any analysis is actively using it: the `busy` checkout flag is
 * the primary signal, and open pages are the belt-and-braces backstop (covers any
 * path where a page is alive on the context regardless of checkout bookkeeping).
 */
function isContextIdle(mc: ManagedContext): boolean {
  if (mc.busy) return false;
  try {
    if (mc.context.pages().length > 0) return false;
  } catch { /* context already gone — treat as idle so it gets swept from the pool */ }
  return true;
}

/**
 * One reap sweep (stability session FIX 1). Exported so tests can drive it
 * directly. The pre-fix sweep closed contexts on AGE ALONE — including contexts a
 * run was actively using (`busy` was never checked) — so a long run (e.g. a slow
 * transcript phase) or a context handed out shortly before its TTL got its
 * context closed OUT FROM UNDER IT mid-flight: "Target page, context or browser
 * has been closed". Now an in-flight context is never touched by the reaper; a
 * stale-but-busy context is deferred and swept on the first sweep after release
 * (busy clears when its checked-out page closes).
 */
export async function reapStaleContexts(nowMs: number = Date.now()): Promise<{ reaped: number; deferredInFlight: number }> {
  let reaped = 0;
  let deferredInFlight = 0;
  const stale = _contexts.filter(mc => (nowMs - mc.createdAt) > CONTEXT_TTL_MS);
  for (const mc of stale) {
    const ageS = Math.round((nowMs - mc.createdAt) / 1000);
    const ageM = Math.floor(ageS / 60);
    const ageRemS = ageS % 60;
    if (!isContextIdle(mc)) {
      deferredInFlight++;
      console.log(`[browserClient] Stale context still IN USE — deferring reap (age: ${ageM}m ${ageRemS}s, preset: ${mc.preset})`);
      continue;
    }
    console.log(`[browserClient] Evicted stale context (age: ${ageM}m ${ageRemS}s, preset: ${mc.preset}, uses: ${mc.useCount}/${mc.maxUses})`);
    const idx = _contexts.indexOf(mc);
    if (idx >= 0) _contexts.splice(idx, 1);
    try { await mc.context.close(); } catch { /* ignore close errors on stale context */ }
    reaped++;
  }
  return { reaped, deferredInFlight };
}

function startCleanupTimer(): void {
  if (_cleanupTimer) return;
  _cleanupTimer = setInterval(() => { void reapStaleContexts(); }, CLEANUP_INTERVAL_MS);
  // Don't keep the process alive just for cleanup
  if (_cleanupTimer && typeof _cleanupTimer === "object" && "unref" in _cleanupTimer) {
    (_cleanupTimer as NodeJS.Timeout).unref();
  }
}

function stopCleanupTimer(): void {
  if (_cleanupTimer) {
    clearInterval(_cleanupTimer);
    _cleanupTimer = null;
  }
}

// ─── Browser Lifecycle ────────────────────────────────────────────────────────

/**
 * Ensure a browser instance is running. Creates one if needed,
 * restarts if the previous instance disconnected.
 */
export async function ensureBrowser(): Promise<Browser> {
  if (_browser?.isConnected()) return _browser;

  // Prevent concurrent launch attempts
  if (_browserLaunching) {
    // Wait for the other launch to complete
    for (let i = 0; i < 50; i++) {
      await new Promise((r) => setTimeout(r, 100));
      if (_browser?.isConnected()) return _browser;
    }
    throw new Error("[browserClient] Browser launch timed out");
  }

  _browserLaunching = true;
  try {
    console.log(`[browserClient] Launching Chromium with stealth plugin (profile: ${BROWSER_PROFILE})...`);

    // Part 1 instrumentation: time every launch so relaunch cost is measurable.
    const launchStart = Date.now();
    _browser = await chromium.launch({
      headless: true,
      args: [...BROWSER_LAUNCH_ARGS],
    });
    _poolStats.browserLaunches++;
    _poolStats.launchTotalMs += Date.now() - launchStart;

    // Auto-restart on disconnect
    _browser.on("disconnected", () => {
      console.warn("[browserClient] Browser disconnected — will restart on next request");
      _browser = null;
      _contexts.length = 0;
    });

    console.log("[browserClient] Chromium launched successfully");
    return _browser;
  } finally {
    _browserLaunching = false;
  }
}

// ─── Crash Resilience (Session 11, Commit 6) ──────────────────────────────────

/**
 * Does this error mean the browser/context/page is dead (crashed or closed)?
 * In --single-process mode a renderer crash takes down the whole browser, and
 * Playwright then surfaces one of these on the next operation.
 */
export function isBrowserDeadError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes("target page, context or browser has been closed") ||
    msg.includes("target closed") ||
    msg.includes("browser has been closed") ||
    msg.includes("browser has disconnected") ||
    msg.includes("has been closed") ||
    msg.includes("crash") ||
    msg.includes("protocol error") ||
    msg.includes("connection closed") ||
    msg.includes("session closed")
  );
}

/**
 * Drop a dead/crashed browser and all its (now-invalid) contexts so the next
 * ensureBrowser() launches a clean instance. Best-effort — the browser is
 * presumed dead, so close() failures are expected and ignored.
 */
async function hardResetBrowser(): Promise<void> {
  const dead = _browser;
  _browser = null;
  _contexts.length = 0;
  if (dead) {
    try { await dead.close(); } catch { /* already dead */ }
  }
}

// ─── Context Pool ─────────────────────────────────────────────────────────────

/**
 * Get a BrowserContext with the specified preset.
 * Reuses a warm context if one is available and hasn't exceeded maxUses.
 * Creates a new one otherwise.
 *
 * Session 11 (Commit 6): crash-resilient. In --single-process mode a renderer
 * crash takes down the whole browser; a stale isConnected() then lets us hand back
 * a dead context whose newPage() throws "Target ... closed", and every later op in
 * the run cascades the same way (Part 0.2) — this is what turned one hiccup into a
 * whole-run loss. If acquisition fails with that signature we hard-reset the
 * browser (drop the dead instance + contexts) and retry ONCE on a fresh browser,
 * converting the cascade into a single recovery.
 */
export async function getContext(
  preset: ContextPreset = "desktop-chrome",
  maxUses: number = DEFAULT_MAX_USES,
): Promise<{ context: BrowserContext; page: Page }> {
  try {
    return await acquireContextPage(preset, maxUses);
  } catch (err) {
    if (!isBrowserDeadError(err)) throw err;
    _poolStats.crashRecoveries++; // Part 1 instrumentation
    console.warn(`[browserClient] Browser looks dead (${(err as Error).message.slice(0, 80)}) — hard-resetting and retrying once`);
    await hardResetBrowser();
    return await acquireContextPage(preset, maxUses);
  }
}

async function acquireContextPage(
  preset: ContextPreset,
  maxUses: number,
): Promise<{ context: BrowserContext; page: Page }> {
  const browser = await ensureBrowser();

  // Reuse a warm context ONLY if it is not currently checked out (`!busy`).
  // Session 11 (Commit 6): the busy guard makes contexts exclusive per checkout, so
  // two concurrent callers (e.g. two pLimit(2) runs) can't share one context and
  // then have one caller's retireContext()/eviction close it out from under the
  // other — the retire race. busy clears when the handed-out page closes.
  // Stability FIX 1: also refuse near-TTL contexts (isWarmContextReusable) so a
  // checkout can't land seconds before the reaper's TTL boundary.
  const existing = _contexts.find((mc) => isWarmContextReusable(mc, preset));

  if (existing) {
    existing.useCount++;
    existing.busy = true;
    const page = await existing.context.newPage();
    page.once("close", () => { existing.busy = false; });
    return { context: existing.context, page };
  }

  // At capacity: evict the oldest context that is NOT in use. Never close a busy
  // context (that is the retire race). If every context is busy, create one over
  // the soft cap — the TTL cleanup reclaims stale contexts later.
  if (_contexts.length >= MAX_CONCURRENT_CONTEXTS) {
    const idx = _contexts.findIndex((mc) => !mc.busy);
    if (idx >= 0) {
      const [evicted] = _contexts.splice(idx, 1);
      try { await evicted.context.close(); } catch { /* ignore close errors */ }
    }
  }

  // Create new context with preset
  const config = PRESETS[preset];
  const context = await browser.newContext({
    viewport: config.viewport,
    userAgent: config.userAgent,
    isMobile: config.isMobile,
    hasTouch: config.hasTouch,
    deviceScaleFactor: config.deviceScaleFactor,
    locale: config.locale,
    timezoneId: "America/New_York",
    permissions: [],
    // Block unnecessary resources for faster loading
    bypassCSP: true,
  });

  // Block heavy resources to speed up page loads
  await context.route(
    /\.(png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot)$/,
    (route) => route.abort(),
  );

  const managed: ManagedContext = {
    context,
    preset,
    useCount: 1,
    maxUses,
    createdAt: Date.now(),
    busy: true,
  };
  _contexts.push(managed);

  // FIX 4.1: Auto-remove context from pool if it closes unexpectedly
  context.on("close", () => {
    const idx = _contexts.findIndex(mc => mc.context === context);
    if (idx >= 0) {
      _contexts.splice(idx, 1);
      console.log(`[browserClient] Context auto-removed from pool on close (preset: ${preset})`);
    }
  });

  // Start cleanup timer if not already running
  startCleanupTimer();

  const page = await context.newPage();
  page.once("close", () => { managed.busy = false; });
  return { context, page };
}

/**
 * Retire a context immediately (e.g., after detecting a block).
 */
export async function retireContext(context: BrowserContext): Promise<void> {
  const idx = _contexts.findIndex((mc) => mc.context === context);
  if (idx >= 0) {
    _contexts.splice(idx, 1);
  }
  try {
    await context.close();
  } catch { /* ignore */ }
}

/**
 * Shutdown the browser entirely. Called during server shutdown.
 */
export async function shutdown(): Promise<void> {
  stopCleanupTimer();
  for (const mc of _contexts) {
    try { await mc.context.close(); } catch { /* ignore */ }
  }
  _contexts.length = 0;
  if (_browser) {
    try { await _browser.close(); } catch { /* ignore */ }
    _browser = null;
  }
  console.log("[browserClient] Browser pool shut down");
}

// ─── Session Warming ──────────────────────────────────────────────────────────

/**
 * Warm a page by visiting a homepage first with a random pause.
 * Simulates human behavior (arriving from a homepage, not deep-linking).
 */
export async function warmSession(
  page: Page,
  homepageUrl: string,
  minPauseMs: number = 2000,
  maxPauseMs: number = 4000,
): Promise<void> {
  try {
    await page.goto(homepageUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
    const pause = minPauseMs + Math.floor(Math.random() * (maxPauseMs - minPauseMs));
    await page.waitForTimeout(pause);
  } catch (err) {
    // Non-fatal — we can still navigate to the target
    console.warn(`[browserClient] Session warming to ${homepageUrl} failed:`, (err as Error).message);
  }
}

// ─── XHR Interception ─────────────────────────────────────────────────────────

/**
 * Set up XHR interception on a page for a URL pattern.
 * Returns a promise that resolves with the intercepted response body
 * when a matching request is made, or rejects after a timeout.
 */
export function interceptRoute(
  page: Page,
  urlPattern: string | RegExp,
  timeoutMs: number = 10000,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`[browserClient] XHR interception timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    page.route(urlPattern, async (route) => {
      try {
        const response = await route.fetch();
        const body = await response.text();
        clearTimeout(timer);

        // Parse JSON if possible
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve(body);
        }

        // Continue the route so the page doesn't hang
        await route.fulfill({ response });
      } catch (err) {
        clearTimeout(timer);
        reject(err);
        await route.continue().catch(() => {});
      }
    });
  });
}

/**
 * Helper: random delay between min and max ms.
 */
export function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const ms = minMs + Math.floor(Math.random() * (maxMs - minMs));
  return new Promise((r) => setTimeout(r, ms));
}
