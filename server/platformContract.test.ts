/**
 * The platform contract's S4 extensions.
 *
 * ─── What these guard ───────────────────────────────────────────────────────
 * The architectural rule is that shared code must never learn a platform's
 * name. Three things did not fit the pre-S4 contract and would have forced a
 * branch: the evidence gates (frozen, platform-worded), Instagram's business
 * signal (evidence the shared assembly could not produce), and non-temporal
 * sampling (`bucket` was a temporal enum). Each became a TOOL, so the driver
 * only ever asks the toolset.
 *
 * These tests are about the CONTRACT, not about any one platform: every
 * registered toolset must satisfy them, so registering a platform that quietly
 * omits a member fails here rather than in production.
 */
import { describe, expect, it } from "vitest";
import { toolsetFor, registeredPlatforms, type GateVerdict } from "./phases/platformTools";
import { PHASE_NAMES, type PlatformName } from "./_core/analysisPhase";

describe("registry", () => {
  it("resolves every registered platform to a complete toolset", () => {
    for (const platform of registeredPlatforms()) {
      const t = toolsetFor(platform);
      expect(t.capture, `${platform} capture`).toBeTruthy();
      expect(t.transcribe, `${platform} transcribe`).toBeTruthy();
      // augment may legitimately be null — optional by design.
      expect(typeof t.gate, `${platform} gate`).toBe("function");
      expect(typeof t.evidenceExtras, `${platform} evidenceExtras`).toBe("function");
      expect(typeof t.profileUrl, `${platform} profileUrl`).toBe("function");
    }
  });

  it("throws loudly for an unregistered platform rather than silently doing nothing", () => {
    const unregistered = (["TikTok", "Instagram", "YouTube"] as PlatformName[])
      .filter(p => !registeredPlatforms().includes(p));
    for (const p of unregistered) {
      expect(() => toolsetFor(p)).toThrow(/No phase toolset registered/);
    }
    expect(() => toolsetFor("Twitter" as PlatformName)).toThrow(/No phase toolset registered/);
  });

  it("every tool declares the platform it belongs to", () => {
    for (const platform of registeredPlatforms()) {
      const t = toolsetFor(platform);
      expect(t.capture.platform).toBe(platform);
      expect(t.transcribe.platform).toBe(platform);
      if (t.augment) expect(t.augment.platform).toBe(platform);
    }
  });

  it("produces a plausible profile URL containing the handle", () => {
    for (const platform of registeredPlatforms()) {
      const url = toolsetFor(platform).profileUrl("some.creator");
      expect(url).toMatch(/^https:\/\//);
      expect(url).toContain("some.creator");
    }
  });
});

describe("evidenceExtras — platform-specific evidence, appended verbatim", () => {
  it("is PURE: same banked input, same string, every time", () => {
    // The assembly is byte-compared, so a non-deterministic extras block would
    // break the identity proof in a way that only shows up on a real run.
    for (const platform of registeredPlatforms()) {
      const input = { handle: "x", capture: { stats: { followerCount: 1 } } };
      const a = toolsetFor(platform).evidenceExtras(input);
      const b = toolsetFor(platform).evidenceExtras(input);
      expect(a).toBe(b);
      expect(typeof a).toBe("string");
    }
  });

  it("TikTok contributes nothing — its assembly must stay byte-identical", () => {
    // Guarded for real by evidenceIdentity.test.ts against the frozen pre-seam
    // reference; asserted here so the intent is visible at the contract level.
    expect(toolsetFor("TikTok").evidenceExtras({ handle: "x", capture: {} })).toBe("");
  });

  it("survives a capture shape it does not recognise", () => {
    // A resumed campaign can hand the assembly banked output from an older
    // schema; extras must degrade to "" rather than throw mid-assembly.
    for (const platform of registeredPlatforms()) {
      expect(() => toolsetFor(platform).evidenceExtras({ handle: "x", capture: null })).not.toThrow();
      expect(() => toolsetFor(platform).evidenceExtras({ handle: "x", capture: { nope: 1 } })).not.toThrow();
    }
  });
});

describe("gate — the platform decides, the driver only asks", () => {
  const ok = (v: GateVerdict) => v.ok;

  it("refuses a null capture on every platform", () => {
    for (const platform of registeredPlatforms()) {
      const v = toolsetFor(platform).gate({ handle: "x", capture: null, augment: null, transcribe: null });
      expect(ok(v), `${platform} should refuse an absent capture`).toBe(false);
      if (!v.ok) {
        expect(v.message.length).toBeGreaterThan(20); // an honest message, not a code
        expect(v.message).toContain("x");             // names the creator
      }
    }
  });

  it("returns DATA, never throws — the driver owns the throw", () => {
    // If a gate threw, the campaign could not classify it into a terminal
    // outcome and the queue would report a crash instead of a refusal.
    for (const platform of registeredPlatforms()) {
      expect(() => toolsetFor(platform).gate({
        handle: "x", capture: { stats: {} }, augment: undefined, transcribe: undefined,
      })).not.toThrow();
    }
  });

  it("TikTok: quota exhausted with no content is refused as rate-limiting, not as absence", () => {
    // The distinction is load-bearing: telling an analyst "no content found"
    // when we were rate-limited sends them to delete a good profile.
    const v = toolsetFor("TikTok").gate({
      handle: "creator",
      capture: { stats: { followerCount: 100, bio: "b" }, pool: { videoTitles: [] } },
      augment: { quotaExhausted: true, pool: { videoTitles: [] } },
      transcribe: { transcripts: [] },
    });
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.code).toBe("TOO_MANY_REQUESTS");
      expect(v.message).toContain("rate-limited");
    }
  });

  it("TikTok: thin evidence is a min-data refusal, with the counts that justify it", () => {
    const v = toolsetFor("TikTok").gate({
      handle: "creator",
      capture: { stats: { followerCount: 100, bio: "b" }, pool: { videoTitles: ["one"] } },
      augment: { quotaExhausted: false, pool: { videoTitles: ["one"] } },
      transcribe: { transcripts: [], discoveredVideoPool: [] },
    });
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.code).toBe("PRECONDITION_FAILED");
      expect(v.message).toContain("Insufficient data");
      expect(v.message).toContain("video titles");
    }
  });

  it("TikTok: sufficient evidence passes", () => {
    const titles = ["a", "b", "c", "d", "e"];
    const v = toolsetFor("TikTok").gate({
      handle: "creator",
      capture: { stats: { followerCount: 100, bio: "b" }, pool: { videoTitles: titles } },
      augment: { quotaExhausted: false, pool: { videoTitles: titles } },
      transcribe: { transcripts: [], discoveredVideoPool: [1, 2] },
    });
    expect(v.ok).toBe(true);
  });
});

describe("sampling buckets", () => {
  it("a sampler may report unbucketed rather than fabricating a temporal claim", () => {
    // Typing-level guard: `unbucketed` must remain assignable. Stamping a
    // non-temporal sample as "recent" would put a claim in the ledger and in
    // content_items.temporal_bucket that the sampler never made.
    const buckets: Array<import("./_core/analysisPhase").SampleBucket> =
      ["recent", "mid", "anchor", "unbucketed"];
    expect(buckets).toHaveLength(4);
  });
});

describe("the shared layers never learn a platform's name", () => {
  it("the phase names are platform-independent", () => {
    expect(PHASE_NAMES).toEqual(["capture", "augment", "transcribe", "derive", "extract_commit"]);
  });
});

describe("engagementRate — platform-specific by design, NOT normalised", () => {
  const pool = (likes: number[]) => likes.map((l, i) => ({
    id: `v${i}`, caption: "", views: 0, likes: l, comments: 0, saves: 0, shares: 0,
    createTime: 0, musicOriginal: false, musicTitle: "", musicArtist: "",
    duetEnabled: false, stitchEnabled: false, isAd: false, durationMs: 0,
  }));

  it("TikTok prefers its per-video interaction rate over any views fallback", () => {
    // "(likes + comments) / plays, not views/followers — the true interaction
    // rate, which will never exceed 100%." Rounding path: *100*100 / 100.
    const rate = toolsetFor("TikTok").engagementRate({
      followerCount: 1000, avgViews: 500,
      engagementSignals: { avgLikeRate: 0.05, avgCommentRate: 0.01 } as never,
      pool: pool([]),
    });
    expect(rate).toBe(6);
  });

  it("TikTok falls back to views/followers when there are no per-video signals", () => {
    const rate = toolsetFor("TikTok").engagementRate({
      followerCount: 1000, avgViews: 500, engagementSignals: undefined, pool: pool([]),
    });
    expect(rate).toBe(50); // 500/1000 → 50.0
  });

  it("Instagram uses mean LIKES over followers — the monolith's exact value", () => {
    // Reproduces the real captured baseline: vnillalondon, 25,568 followers,
    // 12 posts averaging 8,403 likes → 32.9. The shared TikTok formula would
    // give 100 here (clamped from 749%), which is why this is a tool.
    const likes = [8403 * 12, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const rate = toolsetFor("Instagram").engagementRate({
      followerCount: 25568, avgViews: 191620, engagementSignals: undefined, pool: pool(likes),
    });
    expect(rate).toBe(32.9);
  });

  it("the two formulas genuinely DISAGREE on the same input — do not unify them", () => {
    const likes = [8403 * 12, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const input = {
      followerCount: 25568, avgViews: 191620,
      engagementSignals: undefined, pool: pool(likes),
    };
    expect(toolsetFor("Instagram").engagementRate(input)).toBe(32.9);
    expect(toolsetFor("TikTok").engagementRate(input)).toBe(100);
  });

  it("both return 0 rather than dividing by zero followers", () => {
    for (const p of registeredPlatforms()) {
      expect(toolsetFor(p).engagementRate({
        followerCount: 0, avgViews: 100, engagementSignals: undefined, pool: pool([5, 5]),
      })).toBe(0);
    }
  });

  it("is pure — same input, same rate", () => {
    for (const p of registeredPlatforms()) {
      const input = { followerCount: 100, avgViews: 10, engagementSignals: undefined, pool: pool([1, 2]) };
      expect(toolsetFor(p).engagementRate(input)).toBe(toolsetFor(p).engagementRate(input));
    }
  });
});
