/**
 * Session 11 (Commit 6) — the crash-signature classifier decides when to
 * hard-reset + relaunch the browser. It must fire on the real production crash
 * strings (Part 0.2) and their variants, and must NOT fire on ordinary,
 * recoverable scrape errors (a timeout, a block, an empty result) — otherwise a
 * benign failure would needlessly tear down a healthy browser.
 *
 * Stability session FIX 1 — the TTL reaper must never close a context a run is
 * actively using (busy or holding open pages); idle-stale contexts still get
 * cleaned up. FIX 2 — the launch args are pinned (--disable-dev-shm-usage was
 * ALREADY present; the pin stops a future refactor from silently dropping it).
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  isBrowserDeadError,
  reapStaleContexts,
  isWarmContextReusable,
  BROWSER_LAUNCH_ARGS,
  launchArgsForProfile,
  resolveBrowserProfile,
  getPoolSnapshot,
  __testPool,
} from "./scraping/browserClient";

/** Fabricated pool entry: records close() calls; pages() drives the in-flight backstop. */
function fakeCtx(opts: { ageMs: number; busy?: boolean; openPages?: number; preset?: string }) {
  const closed = { count: 0 };
  __testPool.insert({
    context: {
      close: async () => { closed.count++; },
      pages: () => Array.from({ length: opts.openPages ?? 0 }, () => ({})),
    } as never,
    preset: (opts.preset ?? "desktop-chrome") as never,
    useCount: 1,
    maxUses: 5,
    createdAt: Date.now() - opts.ageMs,
    busy: opts.busy ?? false,
  });
  return closed;
}

const MIN = 60_000;

describe("reapStaleContexts (FIX 1: never close in-flight contexts)", () => {
  beforeEach(() => __testPool.clear());

  it("defers a stale context that is BUSY (a run holds it) — not closed, stays pooled", async () => {
    const closed = fakeCtx({ ageMs: 6 * MIN, busy: true });
    const r = await reapStaleContexts();
    expect(closed.count).toBe(0);
    expect(r.deferredInFlight).toBe(1);
    expect(r.reaped).toBe(0);
    expect(getPoolSnapshot().contexts).toBe(1);
  });

  it("defers a stale context that still has OPEN PAGES even if busy-flag is clear (backstop)", async () => {
    const closed = fakeCtx({ ageMs: 6 * MIN, busy: false, openPages: 2 });
    const r = await reapStaleContexts();
    expect(closed.count).toBe(0);
    expect(r.deferredInFlight).toBe(1);
    expect(getPoolSnapshot().contexts).toBe(1);
  });

  it("still reaps an IDLE stale context (cleanup keeps working)", async () => {
    const closed = fakeCtx({ ageMs: 6 * MIN, busy: false, openPages: 0 });
    const r = await reapStaleContexts();
    expect(closed.count).toBe(1);
    expect(r.reaped).toBe(1);
    expect(getPoolSnapshot().contexts).toBe(0);
  });

  it("leaves fresh contexts alone entirely", async () => {
    const closed = fakeCtx({ ageMs: 1 * MIN, busy: false });
    const r = await reapStaleContexts();
    expect(closed.count).toBe(0);
    expect(r.reaped + r.deferredInFlight).toBe(0);
    expect(getPoolSnapshot().contexts).toBe(1);
  });

  it("reaps the released context on the sweep AFTER the run lets go (the deferral converges)", async () => {
    const closed = fakeCtx({ ageMs: 6 * MIN, busy: true });
    await reapStaleContexts();
    expect(closed.count).toBe(0);
    // Run finishes: the checked-out page closes → busy clears. Simulate by
    // re-seeding the same-aged context in its released state.
    __testPool.clear();
    const closedAfter = fakeCtx({ ageMs: 7 * MIN, busy: false });
    const r2 = await reapStaleContexts();
    expect(closedAfter.count).toBe(1);
    expect(r2.reaped).toBe(1);
  });
});

describe("isWarmContextReusable (FIX 1: no near-TTL handouts)", () => {
  const base = { preset: "desktop-chrome" as const, useCount: 1, maxUses: 5, busy: false };
  const now = Date.now();

  it("accepts a young idle same-preset context", () => {
    expect(isWarmContextReusable({ ...base, createdAt: now - 1 * MIN }, "desktop-chrome", now)).toBe(true);
  });
  it("rejects a context within 60s of its 5-min TTL (the reap-after-checkout window)", () => {
    expect(isWarmContextReusable({ ...base, createdAt: now - (4 * MIN + 1000) }, "desktop-chrome", now)).toBe(false);
  });
  it("rejects busy, wrong-preset, and use-exhausted contexts", () => {
    expect(isWarmContextReusable({ ...base, busy: true, createdAt: now - MIN }, "desktop-chrome", now)).toBe(false);
    expect(isWarmContextReusable({ ...base, createdAt: now - MIN }, "mobile-ios", now)).toBe(false);
    expect(isWarmContextReusable({ ...base, useCount: 5, createdAt: now - MIN }, "desktop-chrome", now)).toBe(false);
  });
});

describe("launch-arg profiles (local-first C1)", () => {
  const container = launchArgsForProfile("container");
  const local = launchArgsForProfile("local");

  it("container profile MUST keep --single-process and --disable-dev-shm-usage (Docker medicine intact)", () => {
    expect(container).toContain("--single-process");
    expect(container).toContain("--disable-dev-shm-usage");
    expect(container).toContain("--no-sandbox");
    expect(container).toContain("--disable-setuid-sandbox");
    expect(container).toContain("--disable-gpu");
  });

  it("local profile MUST NOT carry --single-process or sandbox/container flags (the crash-root fix)", () => {
    expect(local).not.toContain("--single-process");
    expect(local).not.toContain("--no-sandbox");
    expect(local).not.toContain("--disable-setuid-sandbox");
    expect(local).not.toContain("--disable-dev-shm-usage");
    expect(local).not.toContain("--disable-gpu");
  });

  it("stealth flags present in BOTH profiles", () => {
    for (const args of [container, local]) {
      expect(args).toContain("--disable-blink-features=AutomationControlled");
      expect(args).toContain("--disable-infobars");
    }
  });

  it("no duplicate flags in either profile", () => {
    expect(new Set(container).size).toBe(container.length);
    expect(new Set(local).size).toBe(local.length);
  });
});

describe("resolveBrowserProfile (detection precedence)", () => {
  const noFile = () => false;
  const dockerenvOnly = (p: string) => p === "/.dockerenv";

  it("BROWSER_PROFILE env override wins in BOTH directions", () => {
    // force local inside a container…
    expect(resolveBrowserProfile({ BROWSER_PROFILE: "local", PLAYWRIGHT_BROWSERS_PATH: "/ms-playwright" }, dockerenvOnly)).toBe("local");
    // …and force container on a laptop
    expect(resolveBrowserProfile({ BROWSER_PROFILE: "container" }, noFile)).toBe("container");
  });

  it("the deployed Railway image auto-detects container with ZERO config: /.dockerenv marker", () => {
    expect(resolveBrowserProfile({}, dockerenvOnly)).toBe("container");
  });

  it("PLAYWRIGHT_BROWSERS_PATH (set in our Dockerfile) also marks container", () => {
    expect(resolveBrowserProfile({ PLAYWRIGHT_BROWSERS_PATH: "/ms-playwright" }, noFile)).toBe("container");
  });

  it("defaults to LOCAL off-container — an analyst laptop needs no configuration", () => {
    expect(resolveBrowserProfile({}, noFile)).toBe("local");
  });

  it("garbage override is ignored, detection proceeds", () => {
    expect(resolveBrowserProfile({ BROWSER_PROFILE: "banana" }, noFile)).toBe("local");
  });
});

describe("isBrowserDeadError", () => {
  it("fires on the exact production crash strings", () => {
    // Verbatim from scrape_events failure_reason (the 17 target_closed events).
    expect(isBrowserDeadError(new Error("browserContext.newPage: Target page, context or browser has been closed"))).toBe(true);
    expect(isBrowserDeadError(new Error("page.evaluate: Target page, context or browser has been closed"))).toBe(true);
  });

  it("fires on crash / disconnect / protocol variants", () => {
    for (const m of [
      "Target closed",
      "Browser has been closed",
      "Browser has disconnected",
      "Page crashed",
      "Protocol error (Target.createTarget): Target closed",
      "Connection closed while reading from the driver",
      "Session closed. Most likely the page has been closed.",
    ]) {
      expect(isBrowserDeadError(new Error(m)), m).toBe(true);
    }
  });

  it("accepts a raw string, not just an Error", () => {
    expect(isBrowserDeadError("Target page, context or browser has been closed")).toBe(true);
  });

  it("does NOT fire on ordinary recoverable scrape errors", () => {
    for (const m of [
      "Timeout 25000ms exceeded",
      "net::ERR_NAME_NOT_RESOLVED",
      "no results via XHR interception or HTML parse",
      "429 Too Many Requests",
      "navigation failed",
      "",
    ]) {
      expect(isBrowserDeadError(new Error(m)), m).toBe(false);
    }
  });
});
