/**
 * The eight derived rates.
 *
 * Two things are under test and they are different in kind:
 *
 *  1. THE ARITHMETIC IS THE COLLECTION PIPELINE'S. `assembleTranscribeOutputs`
 *     is the source of truth; this file reproduces its loop independently and
 *     asserts the derivation agrees. If someone "improves" either side into a
 *     sum-ratio, the equivalence test fails — which is the point, because
 *     `Σx ÷ Σviews` and `mean(x ÷ views)` are different statistics and only one
 *     of them is what the extraction prompt was shown.
 *
 *  2. ABSENCE IS NEVER ZERO. Three distinct nothings — platform does not
 *     publish, nothing captured, no column exists — must each produce null, and
 *     a genuinely measured zero must produce 0.
 */
import { describe, it, expect } from "vitest";
import {
  deriveEngagementRates,
  derivedRatesUnavailableOn,
  type RateSourceRow,
} from "./engagementRates";

const row = (r: Partial<RateSourceRow>): RateSourceRow => ({
  viewCount: null, likeCount: null, commentCount: null,
  shareCount: null, saveCount: null, isOriginalAudio: null, videoDuration: null,
  ...r,
});

/**
 * The frozen loop from `webResearch.ts:1286-1324`, transcribed. Deliberately a
 * COPY and not an import: the production function must be checkable against the
 * shape of the original even after the original moves.
 */
function frozenReference(items: Array<{ views: number; likes: number; comments: number; saves: number; shares: number }>) {
  let sumCommentRate = 0, sumSaveRate = 0, sumShareRate = 0, sumLikeRate = 0;
  let rateCount = 0;
  for (const vi of items) {
    if (vi.views > 0) {
      sumCommentRate += vi.comments / vi.views;
      sumSaveRate += vi.saves / vi.views;
      sumShareRate += vi.shares / vi.views;
      sumLikeRate += vi.likes / vi.views;
      rateCount++;
    }
  }
  return {
    avgCommentRate: rateCount > 0 ? sumCommentRate / rateCount : 0,
    avgSaveRate: rateCount > 0 ? sumSaveRate / rateCount : 0,
    avgShareRate: rateCount > 0 ? sumShareRate / rateCount : 0,
    avgLikeRate: rateCount > 0 ? sumLikeRate / rateCount : 0,
  };
}

describe("deriveEngagementRates — the arithmetic is the pipeline's", () => {
  const pool = [
    { views: 1000, likes: 100, comments: 10, saves: 5, shares: 2 },
    { views: 250, likes: 50, comments: 8, saves: 1, shares: 0 },
    { views: 9_000_000, likes: 300_000, comments: 4_000, saves: 12_000, shares: 9_000 },
    { views: 37, likes: 1, comments: 0, saves: 0, shares: 0 },
  ];

  it("reproduces the frozen mean-of-ratios exactly", () => {
    const derived = deriveEngagementRates(
      "tiktok",
      pool.map(v => row({
        viewCount: v.views, likeCount: v.likes, commentCount: v.comments,
        saveCount: v.saves, shareCount: v.shares,
      })),
    );
    const expected = frozenReference(pool);

    expect(derived.avgSaveRate).toBe(expected.avgSaveRate);
    expect(derived.avgShareRate).toBe(expected.avgShareRate);
    expect(derived.avgLikeRate).toBe(expected.avgLikeRate);
    expect(derived.avgCommentRate).toBe(expected.avgCommentRate);
  });

  it("is a mean of ratios, NOT a ratio of sums", () => {
    // One viral post and one small post. The two statistics diverge sharply:
    // the mean of ratios weights each post equally, the ratio of sums is
    // dominated by the viral one. Only the first is what the pipeline computes.
    const rows = [
      row({ viewCount: 100, saveCount: 50 }),      // 50%
      row({ viewCount: 1_000_000, saveCount: 0 }), // 0%
    ];
    const derived = deriveEngagementRates("tiktok", rows);
    expect(derived.avgSaveRate).toBeCloseTo(0.25, 12);          // mean of ratios
    const ratioOfSums = 50 / 1_000_100;
    expect(derived.avgSaveRate).not.toBeCloseTo(ratioOfSums, 6); // and not this
  });

  it("excludes view-less posts from both numerator and denominator", () => {
    const withZeroViewPosts = deriveEngagementRates("tiktok", [
      row({ viewCount: 100, saveCount: 10 }),
      row({ viewCount: 0, saveCount: 999 }),
      row({ viewCount: null, saveCount: 999 }),
    ]);
    expect(withZeroViewPosts.avgSaveRate).toBeCloseTo(0.1, 12);
    expect(withZeroViewPosts.sampledItems).toBe(3);
    expect(withZeroViewPosts.ratedItems).toBe(1);
  });

  it("divides originalAudioRate and duration by EVERY post, not just rated ones", () => {
    const d = deriveEngagementRates("tiktok", [
      row({ viewCount: 100, isOriginalAudio: true, videoDuration: 30 }),
      row({ viewCount: 0, isOriginalAudio: false, videoDuration: 10 }),
    ]);
    expect(d.originalAudioRate).toBe(0.5); // 1 of 2 posts, not 1 of 1 rated
    expect(d.avgDurationSeconds).toBe(20); // 40s over 2 posts
  });
});

describe("deriveEngagementRates — absence is never zero", () => {
  it("returns null for saves and shares on Instagram, and names why", () => {
    // Instagram's pool builder hardcodes saves/shares to 0 because the platform
    // publishes neither. Twelve posts of real likes and views, zero saves.
    const d = deriveEngagementRates("instagram", Array.from({ length: 12 }, () =>
      row({ viewCount: 5000, likeCount: 400, commentCount: 20, saveCount: 0, shareCount: 0 })));

    expect(d.avgSaveRate).toBeNull();
    expect(d.avgShareRate).toBeNull();
    expect(d.notMeasuredOnPlatform).toEqual(["avgSaveRate", "avgShareRate"]);
    // The rates Instagram DOES publish still compute.
    expect(d.avgLikeRate).toBeCloseTo(0.08, 12);
    expect(d.avgCommentRate).toBeCloseTo(0.004, 12);
  });

  it("keeps a genuine TikTok zero as 0, distinct from Instagram's null", () => {
    // @lynlecheung's shape: 21 videos with views, no saves, no shares. A real
    // reading of a real account — it must not read the same as absence.
    const tiktok = deriveEngagementRates("tiktok", Array.from({ length: 21 }, () =>
      row({ viewCount: 300, likeCount: 12, saveCount: 0, shareCount: 0 })));
    const instagram = deriveEngagementRates("instagram", Array.from({ length: 21 }, () =>
      row({ viewCount: 300, likeCount: 12, saveCount: 0, shareCount: 0 })));

    expect(tiktok.avgSaveRate).toBe(0);
    expect(instagram.avgSaveRate).toBeNull();
    expect(tiktok.avgSaveRate).not.toBe(instagram.avgSaveRate);
  });

  it("returns null when posts were captured but none carried a view count", () => {
    // The live code returns 0 here. That is the absence-as-a-number pattern this
    // function exists to stop.
    const d = deriveEngagementRates("tiktok", [
      row({ viewCount: 0, saveCount: 3 }),
      row({ viewCount: null, saveCount: 4 }),
    ]);
    expect(d.avgSaveRate).toBeNull();
    expect(d.avgLikeRate).toBeNull();
    expect(d.sampledItems).toBe(2);
    expect(d.ratedItems).toBe(0);
  });

  it("returns null across the board for an empty pool", () => {
    const d = deriveEngagementRates("tiktok", []);
    expect(d.avgSaveRate).toBeNull();
    expect(d.avgShareRate).toBeNull();
    expect(d.avgLikeRate).toBeNull();
    expect(d.avgCommentRate).toBeNull();
    expect(d.originalAudioRate).toBeNull();
    expect(d.avgDurationSeconds).toBeNull();
    expect(d.sampledItems).toBe(0);
    expect(d.ratedItems).toBe(0);
  });

  it("distinguishes an uncaptured audio flag from a creator using none", () => {
    const neverCaptured = deriveEngagementRates("tiktok", [
      row({ viewCount: 100, isOriginalAudio: null }),
      row({ viewCount: 100, isOriginalAudio: null }),
    ]);
    const capturedAllFalse = deriveEngagementRates("tiktok", [
      row({ viewCount: 100, isOriginalAudio: false }),
      row({ viewCount: 100, isOriginalAudio: false }),
    ]);
    expect(neverCaptured.originalAudioRate).toBeNull();
    expect(capturedAllFalse.originalAudioRate).toBe(0);
  });

  it("distinguishes an uncaptured duration from a zero-length pool", () => {
    const neverCaptured = deriveEngagementRates("tiktok", [
      row({ viewCount: 100, videoDuration: null }),
      row({ viewCount: 100, videoDuration: 0 }),
    ]);
    expect(neverCaptured.avgDurationSeconds).toBeNull();
  });

  it("holds remix and ad rates permanently null, with the reason attached", () => {
    // Their per-post inputs (duetEnabled / stitchEnabled / isAd) are read off
    // the platform and dropped before persistence. No row set can recover them.
    const d = deriveEngagementRates("tiktok", [
      row({ viewCount: 1000, likeCount: 100, saveCount: 5, shareCount: 5 }),
    ]);
    expect(d.remixEnablementRate).toBeNull();
    expect(d.adTagRate).toBeNull();
    expect(d.notPersisted).toEqual(["remixEnablementRate", "adTagRate"]);
  });
});

describe("derivedRatesUnavailableOn", () => {
  it("names Instagram's two blind fields and nothing on TikTok", () => {
    expect(derivedRatesUnavailableOn("instagram")).toEqual(["avgSaveRate", "avgShareRate"]);
    expect(derivedRatesUnavailableOn("Instagram")).toEqual(["avgSaveRate", "avgShareRate"]);
    expect(derivedRatesUnavailableOn("tiktok")).toEqual([]);
    expect(derivedRatesUnavailableOn(null)).toEqual([]);
  });

  it("does not let a caller mutate the shared table through the result", () => {
    const d = deriveEngagementRates("instagram", [row({ viewCount: 10 })]);
    d.notMeasuredOnPlatform.push("avgLikeRate");
    expect(derivedRatesUnavailableOn("instagram")).toEqual(["avgSaveRate", "avgShareRate"]);
  });
});
