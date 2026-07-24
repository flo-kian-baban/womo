/**
 * Session 11 (Commit 6) — the crash-signature classifier decides when to
 * hard-reset + relaunch the browser. It must fire on the real production crash
 * strings (Part 0.2) and their variants, and must NOT fire on ordinary,
 * recoverable scrape errors (a timeout, a block, an empty result) — otherwise a
 * benign failure would needlessly tear down a healthy browser.
 */
import { describe, it, expect } from "vitest";
import { isBrowserDeadError } from "./scraping/browserClient";

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
