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

let _browser: Browser | null = null;
let _browserLaunching = false;
const _contexts: ManagedContext[] = [];
let _cleanupTimer: ReturnType<typeof setInterval> | null = null;

// ── FIX 4.1: Periodic cleanup of stale browser contexts ──
// Prevents leaked contexts from accumulating until OOM.
function startCleanupTimer(): void {
  if (_cleanupTimer) return;
  _cleanupTimer = setInterval(async () => {
    const now = Date.now();
    const stale = _contexts.filter(mc => (now - mc.createdAt) > CONTEXT_TTL_MS);
    for (const mc of stale) {
      const ageS = Math.round((now - mc.createdAt) / 1000);
      const ageM = Math.floor(ageS / 60);
      const ageRemS = ageS % 60;
      console.log(`[browserClient] Evicted stale context (age: ${ageM}m ${ageRemS}s, preset: ${mc.preset}, uses: ${mc.useCount}/${mc.maxUses})`);
      const idx = _contexts.indexOf(mc);
      if (idx >= 0) _contexts.splice(idx, 1);
      try { await mc.context.close(); } catch { /* ignore close errors on stale context */ }
    }
  }, CLEANUP_INTERVAL_MS);
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
    console.log("[browserClient] Launching Chromium with stealth plugin...");

    _browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-blink-features=AutomationControlled",
        "--disable-infobars",
        // Required in headless Docker to prevent GPU initialization crashes
        "--disable-gpu",
        "--disable-software-rasterizer",
        "--single-process",
      ],
    });

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
  const existing = _contexts.find(
    (mc) => mc.preset === preset && mc.useCount < mc.maxUses && !mc.busy,
  );

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
