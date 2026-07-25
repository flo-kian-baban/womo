/**
 * Scraper-reliability session — unit tests for the pure decision functions of
 * the new strategy chains.
 *
 *   classifyEmptyCapture      (profileScraper) — the transient-vs-genuine
 *                             discriminator behind the empty-capture retry.
 *                             Approved amendment 1: an ABSENT or unreadable
 *                             videoCount is NOT zero — default to retry. Only a
 *                             confirmed 0 from a healthy structured read
 *                             (XHR / rehydration) is genuine-empty.
 *   isTransientSearchFailure  (searchScraper) — decides when the search chain's
 *                             one bounded retry fires (runtime plumbing death),
 *                             and when it must NOT (clean empties, hard blocks).
 */
import { describe, expect, it } from "vitest";
import { classifyEmptyCapture } from "./scraping/tiktok/profileScraper";
import { isTransientSearchFailure } from "./scraping/tiktok/searchScraper";

describe("classifyEmptyCapture — amended discriminator", () => {
  it("confirmed 0 from XHR user-detail → genuine_empty (clean fast reject, no retry)", () => {
    expect(classifyEmptyCapture({ statedVideoCount: 0, statedCountSource: "xhr" })).toBe("genuine_empty");
  });

  it("confirmed 0 from rehydration JSON → genuine_empty", () => {
    expect(classifyEmptyCapture({ statedVideoCount: 0, statedCountSource: "rehydration" })).toBe("genuine_empty");
  });

  it("stated videos exist → retry (capture missed them)", () => {
    expect(classifyEmptyCapture({ statedVideoCount: 83, statedCountSource: "xhr" })).toBe("retry");
    expect(classifyEmptyCapture({ statedVideoCount: 1, statedCountSource: "rehydration" })).toBe("retry");
  });

  it("ABSENT videoCount → retry (amendment 1: absent is NOT zero)", () => {
    expect(classifyEmptyCapture({ statedVideoCount: null, statedCountSource: null })).toBe("retry");
  });

  it("0 via weak regex read → retry (a degraded page can drop fields; regex 0 proves nothing)", () => {
    expect(classifyEmptyCapture({ statedVideoCount: 0, statedCountSource: "regex" })).toBe("retry");
  });
});

describe("isTransientSearchFailure — retry trigger conditions", () => {
  it("context/page/browser death → transient (the observed browser-death class)", () => {
    expect(isTransientSearchFailure("browserContext.newPage: Target page, context or browser has been closed")).toBe(true);
    expect(isTransientSearchFailure("page.goto: Target page, context or browser has been closed")).toBe(true);
    expect(isTransientSearchFailure("page.evaluate: Target page, context or browser has been closed")).toBe(true);
    expect(isTransientSearchFailure("Browser has been closed")).toBe(true);
  });

  it("navigation aborts and timeouts → transient", () => {
    expect(isTransientSearchFailure("page.goto: net::ERR_ABORTED at https://www.tiktok.com/search")).toBe(true);
    expect(isTransientSearchFailure("page.goto: Timeout 20000ms exceeded.")).toBe(true);
    expect(isTransientSearchFailure("navigating to \"…\", waiting until \"domcontentloaded\" — frame was detached")).toBe(true);
  });

  it("non-runtime failures are NOT transient — no retry", () => {
    expect(isTransientSearchFailure(undefined)).toBe(false);
    expect(isTransientSearchFailure("")).toBe(false);
    expect(isTransientSearchFailure("HTTP 429 Too Many Requests")).toBe(false);
    expect(isTransientSearchFailure("Access Denied")).toBe(false);
  });
});
