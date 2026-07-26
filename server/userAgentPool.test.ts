/**
 * THE DESKTOP USER-AGENT POOL IS DESKTOP-ONLY — the guard that keeps it so.
 *
 * ─── The regression class ───────────────────────────────────────────────────
 * A mobile agent in the shared pool is invisible in every way a bug is normally
 * caught. The request succeeds (HTTP 200), the body is a real page, the JSON
 * parses, no exception is thrown, and the parser returns a well-formed EMPTY
 * result. Measured on TikTok video pages: a mobile agent gets `webapp.reflow.*`
 * instead of `webapp.video-detail`, so `extractSubtitleInfos` reports
 * found=true / n=0 — indistinguishable from a video with no subtitles. Six
 * videos the pipeline had banked as "no subtitles" produced subtitles on 4/6
 * with a desktop agent and 0/6 with a mobile one.
 *
 * Nothing downstream catches it: `fetchHtml` re-rolls the agent only on a
 * transport error, and `detectSilentFailure` is not wired into the video-page
 * paths. So the pool composition itself is the invariant worth pinning.
 *
 * Read as source rather than imported: USER_AGENTS is module-private, and
 * exporting it purely for a test would widen the surface this test exists to
 * protect. Same idiom as analysisQueue.test.ts and youtubeDisabled.test.ts.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { randomMobileUserAgent } from "./scraping/httpClient";

const httpClientSrc = readFileSync(
  path.join(import.meta.dirname, "scraping", "httpClient.ts"), "utf8",
);

/** The literal entries of a named string-array pool, from source. */
function poolEntries(name: string): string[] {
  const block = httpClientSrc.match(new RegExp(`const ${name}: string\\[\\] = \\[([\\s\\S]*?)\\n\\];`));
  if (!block) throw new Error(`${name} pool not found — was it renamed?`);
  return [...block[1].matchAll(/"([^"]+)"/g)].map(m => m[1]);
}

/** Tokens that make a server treat the request as a phone. */
const MOBILE_TOKENS = ["Android", "iPhone", "iPad", "Mobile"];

describe("USER_AGENTS is desktop-only", () => {
  const desktop = poolEntries("USER_AGENTS");

  it("is a non-trivial pool (rotation still happens)", () => {
    // If this pool were ever emptied or collapsed to one entry, every fetch
    // would carry an identical fingerprint — a different failure, so assert the
    // rotation still exists rather than only that mobile is gone.
    expect(desktop.length).toBeGreaterThanOrEqual(8);
    expect(new Set(desktop).size).toBe(desktop.length); // no duplicates
  });

  it("contains NO mobile user agents", () => {
    const offenders = desktop.filter(ua => MOBILE_TOKENS.some(t => ua.includes(t)));
    expect(
      offenders,
      `mobile agents in the DESKTOP pool — ~${Math.round(100 * offenders.length / desktop.length)}% of every ` +
      "fetch would present as a phone. A caller that wants mobile must pin " +
      "randomMobileUserAgent() via extraHeaders instead.",
    ).toEqual([]);
  });

  it("every entry actually looks like a desktop browser", () => {
    // Positive assertion, not just the absence of tokens: a junk string would
    // pass the negative check above.
    for (const ua of desktop) {
      expect(ua, `not a desktop UA: ${ua}`).toMatch(/Windows NT|Macintosh|X11; Linux/);
    }
  });
});

describe("the mobile capability is preserved, just made explicit", () => {
  it("the dedicated mobile pool still exists and is all-mobile", () => {
    const mobile = poolEntries("MOBILE_USER_AGENTS");
    expect(mobile.length).toBeGreaterThanOrEqual(4);
    for (const ua of mobile) {
      expect(ua, `not a mobile UA: ${ua}`).toMatch(/Android|iPhone|iPad|Mobile/);
    }
  });

  it("randomMobileUserAgent() only ever returns mobile agents", () => {
    // The path that NEEDS mobile (fetchViaMobileWeb — TikTok serves desktop
    // agents a block page on profile URLs) depends on this at runtime.
    for (let i = 0; i < 60; i++) {
      expect(randomMobileUserAgent()).toMatch(/Android|iPhone|iPad|Mobile/);
    }
  });

  it("the agents removed from the desktop pool are still reachable deliberately", () => {
    // Removing them from the shared pool must not have removed the CAPABILITY.
    const mobile = poolEntries("MOBILE_USER_AGENTS").join("\n");
    for (const device of ["Pixel 8", "SM-S928B", "iPhone OS 17_5", "iPhone OS 17_4"]) {
      expect(mobile, `${device} is no longer reachable via randomMobileUserAgent()`).toContain(device);
    }
  });
});

describe("callers that want mobile can still override the pool", () => {
  it("extraHeaders is spread AFTER User-Agent in fetchHtml", () => {
    // This ordering is what makes the override work. If a future edit hoists
    // extraHeaders above the User-Agent line, fetchViaMobileWeb silently starts
    // sending a DESKTOP agent to m.tiktok.com and profile capture breaks.
    const headerBlock = httpClientSrc.match(/headers: \{([\s\S]*?)\n {8}\},/);
    expect(headerBlock, "fetchHtml header block not found").not.toBeNull();
    const uaIdx = headerBlock![1].indexOf('"User-Agent"');
    const extraIdx = headerBlock![1].indexOf("...extraHeaders");
    expect(uaIdx).toBeGreaterThanOrEqual(0);
    expect(extraIdx).toBeGreaterThan(uaIdx);
  });

  it("fetchViaMobileWeb pins a mobile agent explicitly", () => {
    const profileSrc = readFileSync(
      path.join(import.meta.dirname, "scraping", "tiktok", "profileScraper.ts"), "utf8",
    );
    expect(profileSrc).toMatch(/"User-Agent":\s*randomMobileUserAgent\(\)/);
  });
});
