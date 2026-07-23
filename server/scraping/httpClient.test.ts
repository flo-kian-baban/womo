/**
 * Session 8 — scrape telemetry silent-failure semantics (no DB, no network).
 *
 * Regression lock for the Commit-1 fix: logScrapeSuccess must evaluate the REAL
 * response body. It previously called detectSilentFailure(platform, "", url)
 * with an empty string, which for TikTok always hits the "body < 5000 and no
 * rehydration" branch and stamped silent_failure_detected=true on every
 * auto-logged TikTok HTTP success. These tests pin the underlying predicate so
 * a real page is NOT flagged and only genuinely empty/blocked responses are.
 */
import { describe, it, expect } from "vitest";
import { detectSilentFailure } from "./httpClient";

const url = "https://m.tiktok.com/@realcreator";

// A full TikTok profile page: rehydration JSON present, real follower count,
// non-empty itemList, and > 5000 bytes — i.e. a genuine success.
const fullTikTokBody = `<!doctype html><html><head></head><body>
<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify({
  __DEFAULT_SCOPE__: {
    "webapp.user-detail": {
      userInfo: { user: { id: "42", uniqueId: "realcreator" }, stats: { followerCount: 123456 } },
      itemList: [{ id: "v1" }, { id: "v2" }],
    },
  },
})}</script>
${"<div>padding</div>".repeat(400)}
</body></html>`;

describe("detectSilentFailure — Commit 1 (real body must be evaluated)", () => {
  it("an EMPTY body is (wrongly) reported as a silent failure — the exact false positive the bug produced", () => {
    // This is precisely what logScrapeSuccess used to pass. Documented here so
    // the fix (threading the real body) is understood as necessary, not cosmetic.
    const r = detectSilentFailure("tiktok", "", url);
    expect(r.isFailed).toBe(true);
    expect(r.reason).toBe("TikTok response too small and missing rehydration data");
  });

  it("a FULL TikTok success page is NOT flagged (post-fix behavior for auto-logged successes)", () => {
    const r = detectSilentFailure("tiktok", fullTikTokBody, url);
    expect(r.isFailed).toBe(false);
  });

  it("a genuinely tiny/blocked TikTok response IS still flagged", () => {
    const r = detectSilentFailure("tiktok", "<html><body>nope</body></html>", url);
    expect(r.isFailed).toBe(true);
  });

  it("a TikTok soft block (rehydration present, followerCount=0, empty itemList) IS flagged", () => {
    const softBlock = `<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__">${JSON.stringify({
      __DEFAULT_SCOPE__: { "webapp.user-detail": { userInfo: { user: { id: "1" }, stats: { followerCount: 0 } }, itemList: [] } },
    })}</script>`;
    expect(detectSilentFailure("tiktok", softBlock, url).isFailed).toBe(true);
  });

  it("Instagram was never affected — an empty body is not a silent failure for IG", () => {
    // Confirms the bug was TikTok-only: the empty-body path returns isFailed=false
    // for Instagram, so IG auto-logs were correct even before the fix.
    expect(detectSilentFailure("instagram", "", url).isFailed).toBe(false);
  });
});
