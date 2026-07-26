/**
 * Phase-unit contract tests — S2 Part 2.
 *
 * These pin the behaviour the S3 scheduler will depend on: what each phase
 * declares as its input, what outcome and failure class it reports, and that a
 * phase reads BANKED output rather than in-memory state.
 *
 * The collection identity harness proves the DATA is unchanged; these prove the
 * CONTRACT around it is right.
 */
import { describe, expect, it } from "vitest";
import { NOT_READY, type CampaignState } from "../_core/analysisPhase";
import {
  classifyPhaseError,
  freshPoolState,
  makeAugmentPhase,
  makeCapturePhase,
  poolStateFromBanked,
  selectSampleForPlatform,
  type CapturePhaseOutput,
} from "./collectionPhases";
import { registeredPlatforms, toolsetFor } from "./platformTools";
import type { PoolVideoItem } from "../webResearch";

function vid(id: string, createTime: number): PoolVideoItem {
  return {
    id, caption: `c${id}`, views: 10, likes: 1, comments: 0, saves: 0, shares: 0,
    createTime, musicOriginal: false, musicTitle: "", musicArtist: "",
    duetEnabled: false, stitchEnabled: false, isAd: false, durationMs: 1000,
  };
}

describe("platform tool seam", () => {
  it("TikTok is registered with all three tools", () => {
    expect(registeredPlatforms()).toContain("TikTok");
    const ts = toolsetFor("TikTok");
    expect(ts.capture.name).toBe("tiktok:profile_xhr_scroll");
    expect(ts.augment?.name).toBe("tiktok:search_xhr_scroll");
    expect(ts.transcribe.name).toBe("tiktok:transcriptStrategies");
  });

  it("Instagram is registered with all three tools (S4)", () => {
    expect(registeredPlatforms()).toContain("Instagram");
    const ts = toolsetFor("Instagram");
    expect(ts.capture.name).toBe("instagram:profile_multipath");
    expect(ts.augment?.name).toBe("instagram:oembed_supplement");
    expect(ts.transcribe.name).toBe("instagram:reel_speech_to_text");
  });

  it("YouTube is registered, with a NULL augment tool (S4b)", () => {
    expect(registeredPlatforms()).toContain("YouTube");
    const ts = toolsetFor("YouTube");
    expect(ts.capture.name).toBe("youtube:channel_html");
    expect(ts.transcribe.name).toBe("youtube:caption_xml");
    // The contract's optional-phase semantics, exercised for the first time:
    // YouTube has no augmentation step and says so, rather than registering a
    // tool that does nothing.
    expect(ts.augment).toBeNull();
  });

  it("an unregistered platform still fails LOUDLY", () => {
    // The alternative — silently doing nothing — is how a platform ends up
    // producing empty analyses that look successful.
    expect(() => toolsetFor("Twitter" as never)).toThrow(/No phase toolset registered/);
  });

  it("the transcribe tool delegates to the FROZEN 6-3-3 sampler", () => {
    const now = 1_800_000_000;
    const pool = Array.from({ length: 8 }, (_, i) => vid(`v${i}`, now - (i + 1) * 86_400));
    const sample = selectSampleForPlatform("TikTok", "x", pool, now);
    expect(sample.filter(s => s.bucket === "recent")).toHaveLength(6);
    expect(sample.length).toBeGreaterThanOrEqual(6);
  });
});

describe("declared inputs — phases read BANKED output, not memory", () => {
  const capturePhase = makeCapturePhase("TikTok");
  const augmentPhase = makeAugmentPhase("TikTok");

  const emptyState: CampaignState = {
    runId: "r", handle: "someone", platform: "TikTok", phases: {},
  };

  it("capture needs nothing upstream — it is always schedulable", () => {
    expect(capturePhase.inputs(emptyState)).toEqual({ handle: "someone" });
  });

  it("augment is NOT_READY until capture has banked output", () => {
    expect(augmentPhase.inputs(emptyState)).toBe(NOT_READY);

    const withPending: CampaignState = {
      ...emptyState,
      phases: { capture: { phase: "capture", tool: null, status: "running", attemptCount: 1, failureClass: null, nextEarliestAt: null, output: null } },
    };
    expect(augmentPhase.inputs(withPending)).toBe(NOT_READY);
  });

  it("augment reads capture's banked pool once it exists", () => {
    const bankedCapture: CapturePhaseOutput = {
      stats: { displayName: "d", bio: "", followerCount: 1, followingCount: 0, videoCount: 1, totalLikes: 0, location: "" },
      profileTitles: ["t"], profileViewCounts: [10], assessment: null,
      pool: { videoIds: ["a"], videoItems: [vid("a", 1)], viewCounts: [10], videoTitles: ["t"], hashtags: [], musicTitles: [], foreignVideosRejected: 0 },
    };
    const state: CampaignState = {
      ...emptyState,
      phases: { capture: { phase: "capture", tool: "t", status: "complete", attemptCount: 1, failureClass: null, nextEarliestAt: null, output: bankedCapture } },
    };
    const input = augmentPhase.inputs(state);
    expect(input).not.toBe(NOT_READY);
    expect((input as { capture: CapturePhaseOutput }).capture.pool.videoIds).toEqual(["a"]);
  });
});

describe("pool rehydration from banked output", () => {
  it("restores items, dedup set and counters so augment EXTENDS rather than rebuilds", () => {
    const banked = {
      videoItems: [vid("a", 1), vid("b", 2)],
      viewCounts: [10, 20], videoTitles: ["ta", "tb"],
      hashtags: ["#x"], musicTitles: ["m"], foreignVideosRejected: 4,
    };
    const pool = poolStateFromBanked(banked);
    expect(pool.videoItems.map(v => v.id)).toEqual(["a", "b"]);
    // The dedup set must be rebuilt, or augmentation would re-add existing
    // videos and the pool order would drift.
    expect(pool.seen.has("a")).toBe(true);
    expect(pool.seen.has("b")).toBe(true);
    expect(pool.foreignVideosRejected).toBe(4);
    expect(pool.viewCounts).toEqual([10, 20]);
  });

  it("a fresh pool is empty and independent", () => {
    const a = freshPoolState();
    const b = freshPoolState();
    a.videoItems.push(vid("x", 1));
    expect(b.videoItems).toHaveLength(0);
  });
});

describe("failure classification per the contract", () => {
  it("browser death and quota/rate limits are transient (worth requeueing)", () => {
    expect(classifyPhaseError(new Error("Target page, context or browser has been closed"))).toBe("transient");
    expect(classifyPhaseError(new Error("HTTP 429 Too Many Requests"))).toBe("transient");
    expect(classifyPhaseError(new Error("usage exhausted"))).toBe("transient");
    expect(classifyPhaseError(new Error("Navigation timeout of 20000 ms exceeded"))).toBe("transient");
    expect(classifyPhaseError(new Error("socket hang up"))).toBe("transient");
  });

  it("anything unrecognised is structural — parks for a human instead of looping", () => {
    expect(classifyPhaseError(new Error("Cannot read properties of undefined"))).toBe("structural");
    expect(classifyPhaseError(new Error("no results via XHR capture"))).toBe("structural");
  });
});

describe("augment degrades, never blocks", () => {
  it("declares a bounded retry policy for transient failures only", () => {
    const augment = makeAugmentPhase("TikTok");
    expect(augment.retry.maxAttempts).toBe(2);
    expect(augment.retry.backoffMs.transient).toBeDefined();
    // No structural backoff: a dead search path must not be retried forever.
    expect(augment.retry.backoffMs.structural).toBeUndefined();
  });

  it("capture retries transient failures but never a genuine-empty", () => {
    const capture = makeCapturePhase("TikTok");
    expect(capture.retry.backoffMs.transient).toBeDefined();
    expect(capture.retry.backoffMs.genuine_empty).toBeUndefined();
  });
});
