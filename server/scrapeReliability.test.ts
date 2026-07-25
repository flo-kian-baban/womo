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
import { deriveCaptureHealth, type CaptureHealthEventInput } from "./db";

const ev = (over: Partial<CaptureHealthEventInput>): CaptureHealthEventInput => ({
  failureReason: null,
  silentFailure: false,
  httpStatus: 200,
  url: "https://www.tiktok.com/@x",
  method: "tiktok_playwright",
  ...over,
});

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

describe("deriveCaptureHealth — reporting-only per-run assessment", () => {
  it("clean: primaries succeeded, no retries, no failures", () => {
    const h = deriveCaptureHealth([ev({}), ev({ method: "tiktok_search_xhr" })]);
    expect(h.status).toBe("clean");
    expect(h.supersededAttempts).toBe(0);
    expect(h.failedSearchQueries).toBe(0);
  });

  it("transcript attempt outcomes are normal chain operation, not degradation", () => {
    const h = deriveCaptureHealth([
      ev({}),
      ev({ failureReason: "transcript subtitle_http: empty — no subtitleInfos", method: "tiktok_desktop_http" }),
      ev({ failureReason: "transcript subtitle_browser: empty", method: "tiktok_playwright" }),
    ]);
    expect(h.status).toBe("clean");
  });

  it("a superseded (retried) attempt marks the run degraded", () => {
    const h = deriveCaptureHealth([
      ev({ failureReason: "search search_xhr_scroll: transient — Target closed", method: "tiktok_search_xhr" }),
      ev({ method: "tiktok_search_xhr", url: "https://…#search=search_xhr_scroll:success-after-retry" }),
    ]);
    expect(h.status).toBe("degraded");
    expect(h.supersededAttempts).toBe(1);
    expect(h.retryOutcomes).toBe(1);
  });

  it("an ultimately-failed search query marks the run degraded and is counted", () => {
    const h = deriveCaptureHealth([
      ev({}),
      ev({ method: "tiktok_search_xhr", silentFailure: true, failureReason: "no results via XHR capture" }),
    ]);
    expect(h.status).toBe("degraded");
    expect(h.failedSearchQueries).toBe(1);
    expect(h.failedPathMethods).toEqual([]);
  });

  it("a non-search path failure lands in failedPathMethods", () => {
    const h = deriveCaptureHealth([
      ev({ failureReason: "TikTok response too small and missing rehydration data", silentFailure: true, method: "tiktok_desktop_http" }),
      ev({}),
    ]);
    expect(h.status).toBe("degraded");
    expect(h.failedPathMethods).toEqual(["tiktok_desktop_http"]);
  });

  it("thin evidence wins the status even when capture was otherwise clean", () => {
    const h = deriveCaptureHealth([ev({})], { transcripts: 2, titles: 5 });
    expect(h.status).toBe("thin");
    expect(h.thinEvidence).toBe(true);
  });

  it("healthy evidence + clean capture → clean (thin rule does not fire)", () => {
    const h = deriveCaptureHealth([ev({})], { transcripts: 8, titles: 30 });
    expect(h.status).toBe("clean");
    expect(h.thinEvidence).toBe(false);
  });
});
