/**
 * 6-3-3 stratified sampler — unit coverage (phased architecture S2).
 *
 * The sampler is FROZEN selection logic: it decides which 12 videos become the
 * evidence corpus, so a drift here silently changes every downstream score. It
 * was previously buried inside fetchTikTokTranscripts and untestable; the S2
 * decomposition extracted it verbatim, and these tests pin its behavior.
 *
 * IMPORTANT: the identity harness cannot reach this code — the harness starts
 * from banked evidence, downstream of sampling. These tests plus the live-run
 * comparison are the only guards on the split.
 *
 * `nowSec` is pinned so the temporal windows are deterministic.
 */
import { describe, expect, it } from "vitest";
import { selectLongitudinalSample, type PoolVideoItem } from "./webResearch";

const NOW = 1_800_000_000;              // fixed "now" for deterministic windows
const DAY = 24 * 3600;
const ago = (days: number) => NOW - days * DAY;

function vid(id: string, createTime: number): PoolVideoItem {
  return {
    id, caption: `caption ${id}`, views: 1000, likes: 100, comments: 10,
    saves: 5, shares: 2, createTime, musicOriginal: true, musicTitle: "",
    musicArtist: "", duetEnabled: false, stitchEnabled: false, isAd: false,
    durationMs: 30_000,
  };
}

describe("selectLongitudinalSample — 6-3-3 stratified sampling", () => {
  it("fills all three buckets from a rich pool and returns them recent→mid→anchor", () => {
    const pool = [
      ...[1, 3, 5, 7, 9, 11, 13].map(d => vid(`r${d}`, ago(d))),        // recent
      ...[200, 240, 300, 330].map(d => vid(`m${d}`, ago(d))),           // 6-18mo → mid
      ...[600, 700, 800, 900].map(d => vid(`a${d}`, ago(d))),           // >18mo → anchor
    ];
    const { sampledVideos } = selectLongitudinalSample("x", pool, NOW);

    expect(sampledVideos).toHaveLength(12);
    expect(sampledVideos.slice(0, 6).every(s => s.bucket === "recent")).toBe(true);
    expect(sampledVideos.slice(6, 9).every(s => s.bucket === "mid")).toBe(true);
    expect(sampledVideos.slice(9, 12).every(s => s.bucket === "anchor")).toBe(true);
  });

  it("takes the SIX most recent videos, newest first", () => {
    const pool = [1, 2, 3, 4, 5, 6, 7, 8].map(d => vid(`r${d}`, ago(d)));
    const { sampledVideos } = selectLongitudinalSample("x", pool, NOW);
    const recent = sampledVideos.filter(s => s.bucket === "recent");
    expect(recent).toHaveLength(6);
    expect(recent.map(s => s.item.id)).toEqual(["r1", "r2", "r3", "r4", "r5", "r6"]);
  });

  it("fill-forward: with no genuinely old videos, mid/anchor are filled from oldest available", () => {
    // All 10 videos are recent — mid and anchor windows are empty.
    const pool = Array.from({ length: 10 }, (_, i) => vid(`v${i}`, ago(i + 1)));
    const { sampledVideos } = selectLongitudinalSample("x", pool, NOW);

    expect(sampledVideos.filter(s => s.bucket === "recent")).toHaveLength(6);
    // The fallback fills the remaining buckets rather than returning only 6.
    expect(sampledVideos.length).toBeGreaterThan(6);
    // …and never re-uses a video already sampled.
    const ids = sampledVideos.map(s => s.item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("never samples the same video into two buckets (dedup holds)", () => {
    const pool = [
      ...[1, 2, 3].map(d => vid(`r${d}`, ago(d))),
      ...[300, 320].map(d => vid(`m${d}`, ago(d))),
      ...[700].map(d => vid(`a${d}`, ago(d))),
    ];
    const { sampledVideos } = selectLongitudinalSample("x", pool, NOW);
    const ids = sampledVideos.map(s => s.item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("excludes videos with no usable timestamp (createTime = 0)", () => {
    const pool = [vid("ok", ago(2)), vid("nodate", 0), vid("ok2", ago(4))];
    const { sampledVideos } = selectLongitudinalSample("x", pool, NOW);
    expect(sampledVideos.map(s => s.item.id)).not.toContain("nodate");
    expect(sampledVideos.length).toBeGreaterThan(0);
  });

  it("an empty pool yields an empty sample rather than throwing", () => {
    const { sampledVideos } = selectLongitudinalSample("x", [], NOW);
    expect(sampledVideos).toEqual([]);
  });

  it("is deterministic — same pool and clock produce the same selection", () => {
    const pool = [
      ...[1, 4, 8, 12, 20, 30, 40].map(d => vid(`r${d}`, ago(d))),
      ...[200, 260, 340].map(d => vid(`m${d}`, ago(d))),
      ...[600, 800].map(d => vid(`a${d}`, ago(d))),
    ];
    const a = selectLongitudinalSample("x", pool, NOW);
    const b = selectLongitudinalSample("x", pool, NOW);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
