/**
 * content_items attribution reporting.
 *
 * THE DEFECT THIS GUARDS: `insertContentItems` upserts on
 * (platform, platform_video_id, subject_id) — a key that omits observation_id.
 * On a re-analysis every repeated video collides, its row is refreshed in place
 * while still belonging to the FIRST observation that stored it, and zero rows
 * are attributed to the new observation. Postgres raises nothing, so the write
 * used to record `success` while the observation ended up with no content
 * evidence of its own — 15 observations in production, all re-analyses.
 *
 * The Postgres behaviour itself is proven in
 * integration/contentAttribution.integration.ts. What is unit-testable here is
 * the DECISION: given a write result, is this component honest to call a
 * success? That decision is what drives persistence_status, and through
 * summarizePersistence, the run's own status.
 */
import { describe, expect, it } from "vitest";
import { reportContentItemsWrite } from "./routers";

describe("reportContentItemsWrite", () => {
  it("a clean first analysis is a plain success with nothing to explain", () => {
    // Every row landed on this observation: the ordinary case, and the only one
    // that should produce no commentary at all.
    expect(reportContentItemsWrite({ attributed: 83, collided: 0 }, 83, "videos")).toBeUndefined();
  });

  it("FAILS when a non-empty pool attributes nothing — the bug's exact signature", () => {
    const report = reportContentItemsWrite({ attributed: 0, collided: 83 }, 83, "videos");
    expect(report?.status).toBe("failed");
    // The reason must say what actually happened, not "no data": the run DID
    // capture 83 videos, and a reader who is told otherwise will mis-triage it.
    expect(report?.reason).toContain("83 videos written");
    expect(report?.reason).toContain("ZERO attributed");
    expect(report?.reason).toContain("earlier observation");
  });

  it("reports PARTIAL attribution as a success that still explains itself", () => {
    // Real shape from run b79c016a: 102 of 129 pool videos were new, 27 already
    // existed. The observation has evidence, so this is not a failure — but 27
    // videos' rows belong to an older observation and that must be visible.
    const report = reportContentItemsWrite({ attributed: 102, collided: 27 }, 129, "videos");
    expect(report?.status).toBe("success");
    expect(report?.reason).toContain("102 of 129");
    expect(report?.reason).toContain("27 stayed attached to an earlier observation");
  });

  it("does not cry failure when there was nothing to write", () => {
    // An empty pool is the caller's `skipped_no_data` case; it must never be
    // reported as an attribution failure.
    expect(reportContentItemsWrite({ attributed: 0, collided: 0 }, 0, "videos")).toBeUndefined();
  });

  it("carries the caller's label so brand and creator components read distinctly", () => {
    // All four call sites share one function; a report that says "videos" on the
    // Instagram path would send a reader to the wrong pipeline.
    expect(reportContentItemsWrite({ attributed: 0, collided: 5 }, 5, "Instagram posts")?.reason)
      .toContain("5 Instagram posts written");
    expect(reportContentItemsWrite({ attributed: 0, collided: 3 }, 3, "mention videos")?.reason)
      .toContain("3 mention videos written");
  });

  it("a single attributed row is enough to not be a failure", () => {
    // Boundary: the component's claim is "this observation owns evidence", not
    // "this observation owns ALL the evidence".
    expect(reportContentItemsWrite({ attributed: 1, collided: 82 }, 83, "videos")?.status).toBe("success");
  });
});
