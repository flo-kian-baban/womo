/**
 * The rendered-profile grid harvest — the SECOND pool source.
 *
 * `profile_xhr_scroll` was the only source of a creator's video pool, and on
 * 2026-07-30 it returned HTTP 403 / 39-byte bodies on 30 of 30 attempts across
 * five creators. Every pool that day came from search augmentation, a
 * supplement carrying the whole load: chriswillx 146 videos → 16, khaby.lame
 * 95 → 7, invisible.ads 83 → 2, and lynlecheung was refused outright.
 *
 * The grid is on the page the rendered-text leg already navigates. These tests
 * pin the extraction — which is pure, and therefore provable without a browser.
 */
import { describe, it, expect } from "vitest";
import { parseRenderedGridTiles } from "./scraping/tiktok/profileScraper";

const tile = (href: string | null, alt?: string | null, tileText?: string | null) => ({ href, alt, tileText });

describe("parseRenderedGridTiles — the rendered grid becomes pool items", () => {
  it("harvests id, caption and view count from a creator's own tiles", () => {
    const out = parseRenderedGridTiles("chriswillx", [
      tile("/@chriswillx/video/7667713700136078614", "Why discipline beats motivation", "88.5K"),
      tile("/@chriswillx/video/7667402113659473174", "The 4am myth", "206.7K"),
    ]);

    expect(out.items).toHaveLength(2);
    expect(out.rejected).toBe(0);
    expect(out.anchorsSeen).toBe(2);

    const first = out.items[0] as Record<string, unknown>;
    expect(first.id).toBe("7667713700136078614");
    expect(first.desc).toBe("Why discipline beats motivation");
    expect((first.stats as Record<string, number>).playCount).toBe(88_500);
    expect((first.author as Record<string, string>).uniqueId).toBe("chriswillx");
  });

  it("REJECTS another creator's video — a profile grid is not self-evidently theirs", () => {
    // TikTok renders reposts and recommendation strips on the same page, so
    // "we are on their profile" is not attribution. The href is.
    const out = parseRenderedGridTiles("chriswillx", [
      tile("/@chriswillx/video/111", "mine", "1.2K"),
      tile("/@juarezaale/video/222", "hoover dam", "95.3M"),
    ]);
    expect(out.items).toHaveLength(1);
    expect((out.items[0] as Record<string, unknown>).id).toBe("111");
    expect(out.rejected).toBe(1);
  });

  it("FAILS CLOSED on an href with no author segment", () => {
    // The bare `/video/<id>` form carries no author, so it cannot be verified —
    // and unverifiable means rejected, exactly as on the search path.
    const out = parseRenderedGridTiles("chriswillx", [
      tile("/video/333", "unattributable", "10K"),
      tile(null, "no href at all", "5K"),
    ]);
    expect(out.items).toHaveLength(0);
    expect(out.rejected).toBe(2);
  });

  it("accepts the handle variants TikTok itself uses", () => {
    const out = parseRenderedGridTiles("kaylee.nhi", [
      tile("/@kayleenhi/video/444", "dots stripped", "1K"),
      tile("/@Kaylee.NHI/video/555", "case variant", "2K"),
    ]);
    expect(out.items).toHaveLength(2);
    expect(out.rejected).toBe(0);
  });

  it("dedups repeated anchors — a tile and its overlay link to the same video", () => {
    const out = parseRenderedGridTiles("chriswillx", [
      tile("/@chriswillx/video/666", "once", "3K"),
      tile("/@chriswillx/video/666", "twice", "3K"),
    ]);
    expect(out.items).toHaveLength(1);
    expect(out.anchorsSeen).toBe(1);
  });

  it("never fabricates a createTime — the sampler sorts on it", () => {
    /*
      A tile carries no timestamp. Zero is the honest value; a guessed one would
      silently reorder the 6-3-3 sample and put a recent video in the anchor
      bucket, which is a defect this codebase already has from fill-forward.
    */
    const out = parseRenderedGridTiles("chriswillx", [tile("/@chriswillx/video/777", "no date here", "9K")]);
    expect((out.items[0] as Record<string, unknown>).createTime).toBe(0);
  });

  it("reads no engagement it cannot see — zero, not invented", () => {
    const out = parseRenderedGridTiles("chriswillx", [tile("/@chriswillx/video/888", "x", "1.5M")]);
    const stats = (out.items[0] as Record<string, unknown>).stats as Record<string, number>;
    expect(stats.playCount).toBe(1_500_000);   // the one number a tile carries
    expect(stats.diggCount).toBe(0);
    expect(stats.commentCount).toBe(0);
    expect(stats.shareCount).toBe(0);
    expect(stats.collectCount).toBe(0);
  });

  it("survives a tile with no caption and no readable count", () => {
    const out = parseRenderedGridTiles("chriswillx", [tile("/@chriswillx/video/999", null, "Pinned")]);
    expect(out.items).toHaveLength(1);
    const item = out.items[0] as Record<string, unknown>;
    expect(item.desc).toBe("");
    expect((item.stats as Record<string, number>).playCount).toBe(0);
  });

  it("an empty grid yields nothing and claims nothing", () => {
    // Load-bearing: an empty harvest must never read as proof the account is
    // empty. Only a structured read can prove that — see classifyEmptyCapture.
    const out = parseRenderedGridTiles("chriswillx", []);
    expect(out.items).toHaveLength(0);
    expect(out.rejected).toBe(0);
    expect(out.anchorsSeen).toBe(0);
  });
});
