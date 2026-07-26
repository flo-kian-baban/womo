/**
 * INSTAGRAM COLLECTION IDENTITY HARNESS — the per-platform sibling of
 * collectionIdentity.test.ts (S4b).
 *
 * ─── The regression class ───────────────────────────────────────────────────
 * The same one the TikTok harness guards: a change in MERGE ORDER or SAMPLING
 * INPUT that shifts WHICH POSTS BECOME THE CORPUS. It is dangerous precisely
 * because it is invisible — the pool still looks valid, the counts still look
 * plausible, the run still succeeds, but a different set of reels becomes the
 * evidence and every downstream score moves.
 *
 * Replays a RECORDED capture (WOMO_COLLECTION_FIXTURE) through the REAL tools.
 * No network: the recorded posts are handed to the real seedPool, the real
 * augment and the real sampler.
 *
 * ─── Which boundaries are meaningful HERE ───────────────────────────────────
 * Instagram is not TikTok, and the harness says so rather than asserting
 * TikTok's shape and calling it covered:
 *   1 pool after capture   — meaningful: posts → pool, order and dedup.
 *   2 pool after augment   — meaningful but conditional: oEmbed supplements
 *                            ONLY captions of 10 characters or fewer, so on a
 *                            fixture with no short captions it is a genuine
 *                            no-op. The precondition is asserted, so a future
 *                            fixture with short captions fails loudly here
 *                            instead of silently making a network call.
 *   3 sample selection     — meaningful: first 6 with a usable video URL, and
 *                            every bucket `unbucketed` (NOT temporal).
 *   4 transcript results   — recorded only. The fetch is Gemini/Whisper over
 *                            downloaded audio; replaying it would test the
 *                            model, not our processing.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { toolsetFor, __rememberInstagramVideoUrls } from "./phases/platformTools";
import { freshPoolState } from "./phases/collectionPhases";

const FIXTURE = path.join(import.meta.dirname, "__fixtures__", "collection.instagram.json");

interface Fixture {
  handle: string;
  raw: { prefetchedProfile: { posts: Array<Record<string, unknown>>; source: string } | null };
  expected: {
    poolAfterApi: { videoItems: Array<{ id: string }>; videoTitles: string[]; viewCounts: number[] };
    poolAfterAugment: { videoItems: Array<{ id: string }>; videoTitles: string[] };
    sample: Array<{ id: string; bucket: string }>;
    transcriptsAfterFetch: Array<{ videoId: string; transcript: string; transcriptSource?: string }>;
  };
}

const fx: Fixture | null = existsSync(FIXTURE) ? JSON.parse(readFileSync(FIXTURE, "utf8")) : null;

/** Rebuild the CaptureToolResult shape the phase hands to seedPool. */
function capturedFromFixture(f: Fixture) {
  return {
    stats: { displayName: "", bio: "", followerCount: 0, followingCount: 0, videoCount: 0, totalLikes: 0, location: "" },
    profileTitles: [], profileViewCounts: [],
    nativeProfile: f.raw.prefetchedProfile,
  } as never;
}

describe("instagram collection identity harness", () => {
  beforeEach(() => {
    if (fx?.raw.prefetchedProfile) {
      __rememberInstagramVideoUrls(fx.handle, fx.raw.prefetchedProfile.posts as never);
    }
  });

  it("has a recorded fixture to prove against", () => {
    expect(fx, "run a capture with WOMO_COLLECTION_FIXTURE set").not.toBeNull();
    expect(fx!.raw.prefetchedProfile).not.toBeNull();
  });

  it("the fixture is non-trivial FOR INSTAGRAM (guards a vacuous pass)", () => {
    // The bar is per-platform. Instagram has no search augmentation and no
    // 6-3-3 sample, so asserting TikTok's thresholds here would be theatre.
    // What matters: real posts, a real sample, and at least one transcript.
    expect(fx!.raw.prefetchedProfile!.posts.length).toBeGreaterThanOrEqual(6);
    expect(fx!.expected.poolAfterApi.videoItems.length).toBeGreaterThanOrEqual(6);
    expect(fx!.expected.sample.length).toBeGreaterThanOrEqual(3);
    expect(fx!.expected.transcriptsAfterFetch.length).toBeGreaterThan(0);
  });

  it("BOUNDARY 1 — seeding the pool from recorded posts reproduces it exactly, in order", async () => {
    const pool = freshPoolState();
    await toolsetFor("Instagram").capture.seedPool(fx!.handle, capturedFromFixture(fx!), pool);

    // Order is asserted, not just membership: the sampler consumes the pool in
    // order, so a reordering silently repicks which reels get transcribed.
    expect(pool.videoItems.map(v => v.id)).toEqual(fx!.expected.poolAfterApi.videoItems.map(v => v.id));
    expect(pool.videoTitles).toEqual(fx!.expected.poolAfterApi.videoTitles);
    expect(pool.viewCounts).toEqual(fx!.expected.poolAfterApi.viewCounts);
  });

  it("BOUNDARY 1b — a repeated post is deduped rather than doubling the pool", async () => {
    const doubled = {
      ...fx!.raw.prefetchedProfile!,
      posts: [...fx!.raw.prefetchedProfile!.posts, ...fx!.raw.prefetchedProfile!.posts],
    };
    const pool = freshPoolState();
    await toolsetFor("Instagram").capture.seedPool(
      fx!.handle, { ...capturedFromFixture(fx!), nativeProfile: doubled } as never, pool,
    );
    expect(pool.videoItems.map(v => v.id)).toEqual(fx!.expected.poolAfterApi.videoItems.map(v => v.id));
  });

  it("BOUNDARY 2 — augmentation is a genuine NO-OP when no caption is short", async () => {
    // The precondition is asserted rather than assumed. oEmbed supplements only
    // captions of <= 10 chars; if a future fixture contains one, this fails here
    // rather than quietly reaching the network mid-test.
    const shortCaptions = fx!.raw.prefetchedProfile!.posts
      .filter(p => String(p.caption ?? "").length <= 10);
    expect(shortCaptions, "fixture would trigger a live oEmbed fetch").toHaveLength(0);

    const pool = freshPoolState();
    await toolsetFor("Instagram").capture.seedPool(fx!.handle, capturedFromFixture(fx!), pool);
    const before = pool.videoItems.map(v => `${v.id}:${v.caption}`);

    await toolsetFor("Instagram").augment!.augment(fx!.handle, pool);

    expect(pool.videoItems.map(v => `${v.id}:${v.caption}`)).toEqual(before);
    expect(pool.videoItems.map(v => v.id)).toEqual(fx!.expected.poolAfterAugment.videoItems.map(v => v.id));
  });

  it("BOUNDARY 3 — the sampler picks the SAME reels, and calls them unbucketed", async () => {
    const pool = freshPoolState();
    await toolsetFor("Instagram").capture.seedPool(fx!.handle, capturedFromFixture(fx!), pool);

    const sample = toolsetFor("Instagram").transcribe.selectSample(fx!.handle, pool.videoItems, 0);

    expect(sample.map(s => ({ id: s.item.id, bucket: s.bucket })))
      .toEqual(fx!.expected.sample.map(s => ({ id: s.id, bucket: s.bucket })));
    // The claim the whole `unbucketed` extension exists to make: feed order is
    // not a temporal stratification, and the ledger must not say otherwise.
    expect(new Set(sample.map(s => s.bucket))).toEqual(new Set(["unbucketed"]));
  });

  it("BOUNDARY 3b — the sample is bounded at 6 and only includes fetchable reels", async () => {
    const pool = freshPoolState();
    await toolsetFor("Instagram").capture.seedPool(fx!.handle, capturedFromFixture(fx!), pool);
    const sample = toolsetFor("Instagram").transcribe.selectSample(fx!.handle, pool.videoItems, 0);

    expect(sample.length).toBeLessThanOrEqual(6);
    // A reel with no CDN URL cannot be transcribed; selecting one would burn a
    // sample slot on a guaranteed miss.
    const withUrl = new Set(
      fx!.raw.prefetchedProfile!.posts
        .filter(p => Boolean(p.video_url))
        .map(p => String(p.shortcode ?? p.id)),
    );
    for (const s of sample) expect(withUrl.has(s.item.id)).toBe(true);
  });

  it("BOUNDARY 4 — recorded transcripts are speech-to-text, in order, non-empty", async () => {
    // Recorded, not replayed: the fetch is a model call over downloaded audio,
    // so replaying it would test Gemini rather than our processing. What is
    // pinned is the classification, which is FROZEN and differs from TikTok's.
    const ts = fx!.expected.transcriptsAfterFetch;
    expect(ts.length).toBeGreaterThan(0);
    for (const t of ts) {
      expect(t.transcript.length).toBeGreaterThan(0);
      expect(t.transcriptSource).toBe("speech_to_text");
    }
    const ids = ts.map(t => t.videoId);
    expect(new Set(ids).size).toBe(ids.length); // no duplicate videos
  });
});
