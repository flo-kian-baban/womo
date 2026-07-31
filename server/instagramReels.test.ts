/**
 * The /reels/ supplement — the only leg that ADDS videos.
 *
 * Audio extraction and the caption fallback both raise the success rate on
 * videos already collected; neither collects one. Measured 2026-07-31 on the
 * same two profiles in the same minute:
 *
 *     natgeo         grid: 7 photos + 5 reels      /reels/: 12 reels
 *     rachael.pazan  grid: 9 photos + 3 reels      /reels/: 12 reels
 *
 * rachael.pazan's three reels were its entire speech ceiling. These tests pin
 * the merge rule and — the part that matters most — that every degradation
 * returns evidence rather than failing.
 */
import { describe, it, expect } from "vitest";
import { mergeReelsFirst } from "./scraping/instagram/profileScraper";
import type { InstagramPostData } from "./scraping/instagram/types";

const post = (
  shortcode: string,
  media_type: InstagramPostData["media_type"],
  video_url?: string,
): InstagramPostData => ({
  id: shortcode, shortcode, timestamp: 0, caption: `caption ${shortcode}`,
  like_count: 0, comment_count: 0, view_count: 0, media_type, video_url,
});

const grid = [
  post("p1", "photo"), post("p2", "photo"), post("p3", "carousel"),
  post("r1", "video", "https://cdn/r1.mp4"), post("p4", "photo"),
  post("p5", "carousel"), post("p6", "photo"), post("p7", "photo"),
  post("p8", "carousel"), post("p9", "photo"), post("p10", "photo"), post("p11", "photo"),
];

describe("mergeReelsFirst — reels lead, the grid fills, 12 stands", () => {
  it("puts reels ahead of the grid so the speech path reaches them first", () => {
    const reels = [post("r9", "video", "u9"), post("r8", "video", "u8")];
    const merged = mergeReelsFirst(grid, reels);
    expect(merged.slice(0, 2).map(p => p.shortcode)).toEqual(["r9", "r8"]);
  });

  it("holds the 12-post cap — the capture bound is unchanged", () => {
    const reels = Array.from({ length: 12 }, (_, i) => post(`r${i}`, "video", `u${i}`));
    const merged = mergeReelsFirst(grid, reels);
    expect(merged).toHaveLength(12);
    // A creator with a full reels tab spends every slot on transcribable posts.
    expect(merged.every(p => Boolean(p.video_url))).toBe(true);
  });

  it("dedups a reel that the grid already had — no double-counting", () => {
    // r1 appears in both. It must occupy one slot, and the reels copy wins
    // because that is the one carrying a CDN URL from the tab.
    const merged = mergeReelsFirst(grid, [post("r1", "video", "https://cdn/r1.mp4")]);
    expect(merged.filter(p => p.shortcode === "r1")).toHaveLength(1);
    expect(merged).toHaveLength(12);
  });

  /*
    ─── Degradation. Every one of these must return evidence, not fail ────────
    A private account, no reels tab, a block, a shape change, or simply a
    creator who does not post reels. The leg can only ADD videos; it must never
    subtract evidence or break a capture that was already working.
  */
  it("NO REELS AT ALL — the grid stands, untouched and in order", () => {
    const merged = mergeReelsFirst(grid, []);
    expect(merged).toBe(grid);                       // same array, not a rebuild
    expect(merged.map(p => p.shortcode)).toEqual(grid.map(p => p.shortcode));
  });

  it("FEWER THAN 12 REELS — takes what exists and fills the rest from the grid", () => {
    const reels = [post("r7", "video", "u7"), post("r6", "video", "u6"), post("r5", "video", "u5")];
    const merged = mergeReelsFirst(grid, reels);
    expect(merged).toHaveLength(12);
    expect(merged.slice(0, 3).map(p => p.shortcode)).toEqual(["r7", "r6", "r5"]);
    // The grid's captions are still evidence — 20 of 31 transcripts in the
    // verification run came from them — so the remaining slots stay filled.
    expect(merged.slice(3).every(p => grid.some(g => g.shortcode === p.shortcode))).toBe(true);
  });

  it("a THIN grid plus reels still never exceeds the cap", () => {
    const thinGrid = [post("p1", "photo"), post("p2", "photo")];
    const reels = Array.from({ length: 20 }, (_, i) => post(`r${i}`, "video", `u${i}`));
    const merged = mergeReelsFirst(thinGrid, reels);
    expect(merged).toHaveLength(12);
  });

  it("an EMPTY grid is filled entirely from the tab", () => {
    const reels = [post("r1", "video", "u1"), post("r2", "video", "u2")];
    expect(mergeReelsFirst([], reels).map(p => p.shortcode)).toEqual(["r1", "r2"]);
  });

  it("skips a reel with no shortcode rather than emitting a keyless post", () => {
    const merged = mergeReelsFirst([], [
      { ...post("", "video", "u"), id: "" },
      post("r1", "video", "u1"),
    ]);
    expect(merged.map(p => p.shortcode)).toEqual(["r1"]);
  });
});
