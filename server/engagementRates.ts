/**
 * THE EIGHT ENGAGEMENT RATES, DERIVED FROM THE ROWS THAT ALREADY HOLD THEM.
 *
 * ─── What was wrong ─────────────────────────────────────────────────────────
 * `assembleTranscribeOutputs` computes eight rates over the collected video
 * pool (`webResearch.ts:1282-1326`), hands four of them to the extraction
 * prompt (`:2205-2219`), folds two into `observations.engagement_rate`, and
 * then drops the `EngagementSignals` object on the floor. It is never returned
 * from `CreatorResearchResult`, so **not one of the eight is retrievable** —
 * including the save and share rates, which are the only public evidence we
 * hold that an audience files a creator's work away or passes it on.
 *
 * ─── Why this derives instead of storing ────────────────────────────────────
 * Every input the rates need is ALREADY PERSISTED per post. `view_count`,
 * `save_count`, `share_count`, `like_count` and `comment_count` sit on the same
 * `content_items` row, written from the same pool element the live computation
 * read. A stored aggregate would be a second source of truth for one number and
 * would go stale the moment a re-analysis wrote new content rows. Deriving also
 * reaches BACKWARDS: every observation already in the corpus gets its rates
 * without a re-run.
 *
 * The row set is exact, not approximate. The chain is 1:1 with no filtering —
 * `videoItems` → `discoveredVideoPool` (a sort and a map) → `contentRows` (a
 * map) → `insertContentItems`. The upsert conflict target is
 * `(platform, platform_video_id, observation_id)`, so a re-run under a new
 * observation inserts fresh rows rather than colliding into the old ones; the
 * same video id is on record under three separate observations for two
 * creators. Scope to one observation and you have that run's pool, entire.
 *
 * ─── ABSENCE IS NULL. IT IS NEVER ZERO. ─────────────────────────────────────
 * This is the whole reason the function exists rather than a SQL fragment at
 * the call site. There are three different nothings here and they must not
 * collapse into `0`:
 *
 *   1. THE PLATFORM DOES NOT EXPOSE IT. Instagram's pool builder hardcodes
 *      `saves: 0, shares: 0` (`platformTools.ts:503-505`) because Instagram
 *      publishes neither. All 240 Instagram rows carrying engagement read
 *      exactly 0 on both, maximum 0. That is the field being absent, not an
 *      audience declining to save. → `null`, named in `notMeasuredOnPlatform`.
 *
 *   2. NOTHING WAS CAPTURED. No rows, or no row with a view count to divide
 *      by. → `null`.
 *
 *   3. THE INPUT WAS NEVER GIVEN A COLUMN. `duetEnabled`, `stitchEnabled` and
 *      `isAd` are read off the platform, live on `PoolVideoItem`, and are
 *      dropped when `discoveredVideoPool` is built. `content_items` has no
 *      column for any of them, so `remixEnablementRate` and `adTagRate` cannot
 *      be derived at all — by anyone, from this schema. → permanently `null`,
 *      named in `notPersisted`. Recovering them needs DDL.
 *
 * A genuine measured zero stays `0`. `@lynlecheung` has 21 TikTok videos with
 * views and no saves or shares on any of them — a real reading of a real small
 * account, and it must not be indistinguishable from Instagram's structural
 * blank.
 *
 * ─── The arithmetic is COPIED, not improved ─────────────────────────────────
 * Each formula below reproduces `assembleTranscribeOutputs` exactly, including
 * its choice of denominator, which differs between the two families:
 *   - the four view-denominated rates are a MEAN OF PER-POST RATIOS over posts
 *     with views > 0 — `Σ(x/views) ÷ count(views>0)`, NOT `Σx ÷ Σviews`, which
 *     is a different statistic;
 *   - `originalAudioRate` and `avgDurationSeconds` divide by EVERY pooled post,
 *     including ones with no views.
 * Nothing here computes a new metric. The engine reads none of this.
 */

/** The per-post fields the rates are derived from. A `content_items` row. */
export interface RateSourceRow {
  viewCount: number | null;
  likeCount: number | null;
  commentCount: number | null;
  shareCount: number | null;
  saveCount: number | null;
  isOriginalAudio: boolean | null;
  videoDuration: number | null;
}

export interface DerivedEngagementRates {
  /** Mean of comments÷views across posts with views. Parasocial address. */
  avgCommentRate: number | null;
  /** Mean of saves÷views. TikTok only — Instagram does not publish it. */
  avgSaveRate: number | null;
  /** Mean of shares÷views. TikTok only — Instagram does not publish it. */
  avgShareRate: number | null;
  /** Mean of likes÷views across posts with views. */
  avgLikeRate: number | null;
  /** Fraction of ALL pooled posts on creator-original audio. */
  originalAudioRate: number | null;
  /** Permanently null — duet/stitch flags have no column. See `notPersisted`. */
  remixEnablementRate: null;
  /** Permanently null — the ad flag has no column. See `notPersisted`. */
  adTagRate: null;
  /** Mean duration in seconds over ALL pooled posts. */
  avgDurationSeconds: number | null;
  /** Posts the rates were derived over — the denominator for the last two. */
  sampledItems: number;
  /** Posts with views > 0 — the denominator for the first four. */
  ratedItems: number;
  /** Rates this platform does not publish. Null here means absent, not zero. */
  notMeasuredOnPlatform: string[];
  /** Rates whose per-post input has no column. Null regardless of platform. */
  notPersisted: string[];
}

/**
 * Rates whose per-post input is discarded before persistence, so no schema
 * change short of DDL can recover them.
 */
const NOT_PERSISTED = ["remixEnablementRate", "adTagRate"] as const;

/**
 * Rates a platform does not publish at all. The per-post column exists and is
 * written, but what is written is a constant standing in for a field the
 * platform never gave us — so the aggregate is not a measurement.
 *
 * Keyed by the normalized platform value stored on `content_items`.
 */
const NOT_MEASURED_BY_PLATFORM: Record<string, readonly string[]> = {
  instagram: ["avgSaveRate", "avgShareRate"],
};

export function derivedRatesUnavailableOn(platform: string | null | undefined): readonly string[] {
  return NOT_MEASURED_BY_PLATFORM[(platform ?? "").toLowerCase()] ?? [];
}

/**
 * Derive all eight rates for ONE observation's pool.
 *
 * `platform` gates the rates the platform does not publish; pass the value
 * stored on the rows (`tiktok` / `instagram`). `rows` must already be scoped to
 * a single observation — this function does no filtering of its own, because
 * choosing the row set is the caller's decision and womo_0011 made it once.
 */
export function deriveEngagementRates(
  platform: string | null | undefined,
  rows: readonly RateSourceRow[],
): DerivedEngagementRates {
  const notMeasuredOnPlatform = [...derivedRatesUnavailableOn(platform)];
  const notPersisted = [...NOT_PERSISTED];

  const base: DerivedEngagementRates = {
    avgCommentRate: null,
    avgSaveRate: null,
    avgShareRate: null,
    avgLikeRate: null,
    originalAudioRate: null,
    remixEnablementRate: null,
    adTagRate: null,
    avgDurationSeconds: null,
    sampledItems: rows.length,
    ratedItems: 0,
    notMeasuredOnPlatform,
    notPersisted,
  };

  if (rows.length === 0) return base;

  // ── The four view-denominated rates ────────────────────────────────────────
  // Mean of per-post ratios over posts with views. A post with no views has no
  // denominator, so it is excluded from BOTH the sum and the count — which is
  // what the live computation does, and why `ratedItems` is reported separately
  // from `sampledItems`.
  let sumComment = 0, sumSave = 0, sumShare = 0, sumLike = 0;
  let rateCount = 0;
  for (const r of rows) {
    const views = r.viewCount ?? 0;
    if (views > 0) {
      sumComment += (r.commentCount ?? 0) / views;
      sumSave += (r.saveCount ?? 0) / views;
      sumShare += (r.shareCount ?? 0) / views;
      sumLike += (r.likeCount ?? 0) / views;
      rateCount++;
    }
  }
  base.ratedItems = rateCount;

  // `rateCount === 0` is "we captured posts but none carried a view count" —
  // nothing to divide by. The live code returns 0 here; that is the absence-as-
  // a-number pattern this function exists to stop, so it stays null.
  if (rateCount > 0) {
    base.avgCommentRate = sumComment / rateCount;
    base.avgLikeRate = sumLike / rateCount;
    if (!notMeasuredOnPlatform.includes("avgSaveRate")) base.avgSaveRate = sumSave / rateCount;
    if (!notMeasuredOnPlatform.includes("avgShareRate")) base.avgShareRate = sumShare / rateCount;
  }

  // ── Original-audio rate ────────────────────────────────────────────────────
  // Denominator is EVERY pooled post, matching the live computation. A row
  // whose flag is NULL was never given one by the scrape; it counts in the
  // denominator (as the live boolean's falsy branch does) but a pool where NO
  // row carries the flag is a capture gap, not a creator using no original
  // audio — that returns null rather than 0.
  let originalCount = 0;
  let originalKnown = 0;
  for (const r of rows) {
    if (r.isOriginalAudio !== null) originalKnown++;
    if (r.isOriginalAudio === true) originalCount++;
  }
  if (originalKnown > 0) base.originalAudioRate = originalCount / rows.length;

  // ── Average duration ───────────────────────────────────────────────────────
  // Same all-posts denominator. Per-post seconds were rounded at write time
  // (`durationSec: Math.round(durationMs / 1000)`), so this can differ from the
  // live value by under half a second per post — the rounding is in the stored
  // input, not introduced here.
  let sumDuration = 0;
  let durationKnown = 0;
  for (const r of rows) {
    const seconds = r.videoDuration ?? 0;
    if (seconds > 0) {
      sumDuration += seconds;
      durationKnown++;
    }
  }
  if (durationKnown > 0) base.avgDurationSeconds = sumDuration / rows.length;

  return base;
}
