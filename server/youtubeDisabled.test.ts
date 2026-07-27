/**
 * YOUTUBE IS DISABLED — the guard that keeps it that way.
 *
 * YouTube is not a platform this product supports. Its toolset and scrapers are
 * still in the source (the diagnosis is complete and worth keeping — see
 * docs/YOUTUBE_DISABLED.md), which is exactly why this file exists: unreachable
 * code that still LOOKS wired is easy to re-register by accident.
 *
 * The rule: a platform is capable if and only if it is in the REGISTRY. Every
 * other layer — routers, queue, runner — must agree, and here that agreement is
 * asserted rather than assumed.
 */
import { describe, expect, it } from "vitest";
import { isRunnableSubject } from "./queue/analysisQueue";
import { readFileSync } from "node:fs";
import path from "node:path";
import { registeredPlatforms, toolsetFor, YOUTUBE_TOOLSET } from "./phases/platformTools";
import type { PlatformName } from "./_core/analysisPhase";

const routersSrc = readFileSync(path.join(import.meta.dirname, "routers.ts"), "utf8");
const queueSrc = readFileSync(path.join(import.meta.dirname, "queue", "analysisQueue.ts"), "utf8");

describe("YouTube is disabled at the registry", () => {
  it("exactly two platforms are supported", () => {
    expect(registeredPlatforms().sort()).toEqual(["Instagram", "TikTok"]);
  });

  it("resolving a YouTube toolset throws, exactly like an unknown platform", () => {
    expect(() => toolsetFor("YouTube")).toThrow(/No phase toolset registered/);
    expect(() => toolsetFor("Twitter" as PlatformName)).toThrow(/No phase toolset registered/);
  });

  it("the toolset is KEPT in the source, just unregistered", () => {
    // Deleting it would discard a complete diagnosis; registering it would put a
    // broken path back in front of users. It must stay in this middle state, so
    // assert the middle state rather than trusting a comment.
    expect(YOUTUBE_TOOLSET.capture.name).toBe("youtube:channel_html");
    expect(YOUTUBE_TOOLSET.capture.platform).toBe("YouTube");
    expect(registeredPlatforms()).not.toContain("YouTube");
  });
});

describe("YouTube cannot be submitted or resumed", () => {
  it("creator.submit's platform enum does not accept YouTube", () => {
    // Read as source for the same reason analysisQueue.test.ts does: importing
    // routers.ts pulls the whole server graph into a unit suite.
    const enumLine = routersSrc.match(/platform:\s*z\.enum\(\[[^\]]*\]\)/);
    expect(enumLine, "creator.submit platform enum not found").not.toBeNull();
    expect(enumLine![0]).not.toMatch(/YouTube/);
    expect(enumLine![0]).toMatch(/TikTok/);
    expect(enumLine![0]).toMatch(/Instagram/);
  });

  it("creator.reanalyze cannot coerce a stored youtube profile back into a campaign", () => {
    // Legacy YouTube rows still exist in the database and stay readable; what
    // must not happen is one of them being turned into a fresh campaign.
    expect(routersSrc).not.toMatch(/lower === "youtube"/);
  });

  /**
   * THE RESUMPTION HOLE this guards: the ledger outlives a release, so the boot
   * loop can meet a YouTube campaign enqueued when YouTube still worked.
   *
   * This used to pattern-match the inline guard in processCampaign. That rule
   * became two — the worker's and `creator.resumeRun`'s, which had drifted to
   * "TikTok only" — so it was extracted into `isRunnableSubject` and both now
   * ask it. The assertion moved with it, and EXECUTES the rule rather than
   * reading its source, which is the stronger form.
   */
  it("the queue refuses a ledger campaign whose platform is no longer supported", () => {
    expect(isRunnableSubject("YouTube"), "YouTube must never be runnable").toBe(false);
    expect(isRunnableSubject("Vine"), "an unknown platform must not be runnable").toBe(false);
    expect(isRunnableSubject(""), "an unparseable subject hint must not be runnable").toBe(false);
    // …and the supported subjects still are.
    expect(isRunnableSubject("TikTok")).toBe(true);
    expect(isRunnableSubject("Instagram")).toBe(true);
    expect(isRunnableSubject("Brand"), "brand runs without a toolset by design").toBe(true);
  });

  it("both the worker and resumeRun ask the SAME rule", () => {
    // A second copy is how resumeRun came to refuse Instagram for two sessions
    // after S4 shipped it.
    expect(queueSrc).toContain("isRunnableSubject(platform)");
    expect(routersSrc).toContain("isRunnableSubject(platform)");
    expect(routersSrc, "resumeRun still hardcodes a platform").not.toMatch(/platform !== "TikTok"/);
  });

  it("no live server path names YouTube as a runnable platform", () => {
    // A sweep rather than a spot-check: if a future change reintroduces YouTube
    // to any dispatch list, one of the assertions above or this one fails.
    for (const src of [routersSrc, queueSrc]) {
      expect(src).not.toMatch(/"YouTube"\s*(?:,|\])/);
    }
  });
});
