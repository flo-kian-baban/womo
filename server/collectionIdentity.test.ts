/**
 * COLLECTION IDENTITY HARNESS — the regression gate for the phased
 * restructuring of the collection stages (S2 Part 0).
 *
 * ─── Why this exists ────────────────────────────────────────────────────────
 * The evidence identity harness (evidenceIdentity.test.ts) starts from BANKED
 * evidence — it proves assembly identity and cannot see anything upstream of
 * it. But Parts 2-4 restructure collection *entirely*: capture, augment and
 * transcribe become phase units that read their inputs from the ledger. That
 * work had no regression gate at all. This is it.
 *
 * ─── The regression class this guards ───────────────────────────────────────
 * A change in MERGE ORDER or SAMPLING INPUT that shifts WHICH VIDEOS GET
 * SELECTED. This is the dangerous one precisely because it is invisible: the
 * pool still looks valid, the counts still look plausible, the run still
 * succeeds — but a different twelve videos become the evidence corpus, so the
 * transcripts differ, the evidence differs, and every downstream score moves.
 * Nothing else in the test suite would catch it.
 *
 * Concretely, the harness pins element-for-element:
 *   1. pool after API collection   — id order, titles, view counts, rejects
 *   2. pool after augmentation     — same, post-search-merge and dedup
 *   3. the 6-3-3 sample            — exact (id, bucket) sequence
 * Order is asserted, not just membership: the sampler consumes the pool in
 * order, so a reordering silently repicks.
 *
 * ─── What it does NOT prove ─────────────────────────────────────────────────
 * That live scraping returns the same videos twice — it never does. The
 * fixtures are RECORDED raw platform payloads (WOMO_COLLECTION_FIXTURE), so
 * this isolates OUR processing of a fixed input from the network's variance,
 * exactly as the evidence harness isolates assembly.
 *
 * Refresh the fixture when TikTok's response shapes drift:
 *   WOMO_COLLECTION_FIXTURE=<path> pnpm exec tsx server/_core/index.ts
 *   (then run one analysis and copy the file into __fixtures__)
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi, beforeEach } from "vitest";

// The search leaf is the only network touch in the augment stage — replaced by
// the recorded raw payloads. Everything else runs the REAL production code.
const searchResponses = new Map<string, unknown[]>();
vi.mock("./scraping/tiktok/searchScraper", () => ({
  searchTikTokVideos: vi.fn(async (keyword: string) => ({
    item_list: searchResponses.get(keyword) ?? [],
    has_more: false,
  })),
  isTransientSearchFailure: () => false,
}));
// Browser contexts are irrelevant when the search leaf is stubbed.
vi.mock("./scraping/browserClient", () => ({
  getContext: vi.fn(async () => { throw new Error("no browser in harness"); }),
  retireContext: vi.fn(async () => {}),
  warmSession: vi.fn(async () => {}),
  randomDelay: vi.fn(async () => {}),
  isBrowserDeadError: () => false,
  BROWSER_LAUNCH_ARGS: [],
}));
// BOUNDARY 4: the transcript leaf. Returns the recorded per-video result so the
// enrichment, ordering and null-handling of the real loop are exercised.
const recordedTranscripts = new Map<string, { text: string; wordCount: number; source: string }>();
vi.mock("./scraping/tiktok/transcriptStrategies", () => ({
  fetchVideoTranscript: vi.fn(async (input: { videoId: string }) => {
    const rec = recordedTranscripts.get(input.videoId);
    return rec ? { result: { transcript: rec } } : null;
  }),
  budgetedTranscriptStrategies: () => [],
  budgetedTranscriptPhase: () => ({}),
}));

import {
  collectPoolFromApi,
  collectPoolFromSupplementalSearch,
  selectLongitudinalSample,
  snapshotPool,
  transcribeSampledVideos,
  type PoolVideoItem,
} from "./webResearch";

const FIXTURE = path.join(import.meta.dirname, "__fixtures__", "collection.tiktok.json");

interface PoolSnapshot {
  videoIds: string[];
  videoItems: PoolVideoItem[];
  viewCounts: number[];
  videoTitles: string[];
  hashtags: string[];
  musicTitles: string[];
  foreignVideosRejected: number;
}
interface CollectionFixture {
  handle: string;
  /** The clock the recorded run sampled with — pinned so temporal buckets
   *  resolve identically on replay. */
  samplingNowSec: number;
  raw: {
    prefetchedProfile: unknown;
    searchResponses: Array<{ query: string; items: unknown[] }>;
  };
  expected: {
    poolAfterApi: PoolSnapshot;
    poolAfterAugment: PoolSnapshot;
    sample: Array<{ id: string; bucket: string }>;
    /** BOUNDARY 4 — the per-video transcript results, in order. */
    transcriptsAfterFetch?: Array<Record<string, unknown>>;
  };
}

const hasFixture = existsSync(FIXTURE);
const suite = hasFixture ? describe : describe.skip;

function loadFixture(): CollectionFixture {
  return JSON.parse(readFileSync(FIXTURE, "utf-8")) as CollectionFixture;
}

/** Fresh accumulator with the same shape the orchestrator builds. */
function freshAcc() {
  return {
    videoItems: [] as PoolVideoItem[],
    seen: new Set<string>(),
    viewCounts: [] as number[],
    videoTitles: [] as string[],
    hashtags: [] as string[],
    musicTitles: [] as string[],
    foreignVideosRejected: 0,
    searchQuotaExhausted: false,
    apiVideoCount: 0,
  };
}

describe("collection identity harness", () => {
  it("has a recorded fixture to prove against", () => {
    expect(hasFixture).toBe(true);
  });
});

suite("collection stages reproduce a recorded run byte-for-byte", () => {
  const fx = hasFixture ? loadFixture() : (null as unknown as CollectionFixture);

  beforeEach(() => {
    searchResponses.clear();
    for (const r of fx.raw.searchResponses) searchResponses.set(r.query, r.items);
  });

  it("the fixture is non-trivial (guards against a vacuous pass)", () => {
    // A fixture with one video and no sample would make every assertion below
    // pass for the wrong reason.
    expect(fx.expected.poolAfterAugment.videoIds.length).toBeGreaterThanOrEqual(10);
    expect(fx.expected.sample.length).toBeGreaterThanOrEqual(6);
    expect(fx.expected.poolAfterAugment.videoTitles.length).toBeGreaterThan(0);
    expect(fx.raw.searchResponses.length).toBeGreaterThan(0);
    // The sample must span more than one bucket, or the 6-3-3 logic is untested.
    expect(new Set(fx.expected.sample.map(s => s.bucket)).size).toBeGreaterThan(1);
  });

  it("BOUNDARY 1 — API collection reproduces the pool exactly, in order", async () => {
    const acc = freshAcc();
    await collectPoolFromApi(fx.handle, fx.raw.prefetchedProfile as never, acc);
    const got = snapshotPool(acc);

    // Order first: this is the assertion that catches a silent re-pick.
    expect(got.videoIds).toEqual(fx.expected.poolAfterApi.videoIds);
    expect(got.videoTitles).toEqual(fx.expected.poolAfterApi.videoTitles);
    expect(got.viewCounts).toEqual(fx.expected.poolAfterApi.viewCounts);
    expect(got.foreignVideosRejected).toBe(fx.expected.poolAfterApi.foreignVideosRejected);
    // …then the whole payload, byte-for-byte.
    expect(JSON.stringify(got.videoItems)).toBe(JSON.stringify(fx.expected.poolAfterApi.videoItems));
  });

  it("BOUNDARY 2 — augmentation merges search results into the same pool, in order", async () => {
    const acc = freshAcc();
    await collectPoolFromApi(fx.handle, fx.raw.prefetchedProfile as never, acc);
    await collectPoolFromSupplementalSearch(fx.handle, fx.handle.toLowerCase(), acc);
    const got = snapshotPool(acc);

    expect(got.videoIds).toEqual(fx.expected.poolAfterAugment.videoIds);
    expect(got.videoTitles).toEqual(fx.expected.poolAfterAugment.videoTitles);
    expect(got.viewCounts).toEqual(fx.expected.poolAfterAugment.viewCounts);
    expect(got.hashtags).toEqual(fx.expected.poolAfterAugment.hashtags);
    expect(got.musicTitles).toEqual(fx.expected.poolAfterAugment.musicTitles);
    // The author guard's reject count is part of the contract — a guard that
    // silently stopped rejecting would change the pool and show up here.
    expect(got.foreignVideosRejected).toBe(fx.expected.poolAfterAugment.foreignVideosRejected);
    expect(JSON.stringify(got.videoItems)).toBe(JSON.stringify(fx.expected.poolAfterAugment.videoItems));
  });

  it("BOUNDARY 3 — the sampler picks the SAME videos in the SAME buckets (end to end)", async () => {
    // Full replay: raw payloads → API collection → augmentation → sampling,
    // with the run's own recorded clock. This is the assertion that catches a
    // silent re-pick, and it is exact: same (id, bucket) sequence or fail.
    const acc = freshAcc();
    await collectPoolFromApi(fx.handle, fx.raw.prefetchedProfile as never, acc);
    await collectPoolFromSupplementalSearch(fx.handle, fx.handle.toLowerCase(), acc);

    const { sampledVideos } = selectLongitudinalSample(fx.handle, acc.videoItems, fx.samplingNowSec);
    expect(sampledVideos.map(s => ({ id: s.item.id, bucket: s.bucket })))
      .toEqual(fx.expected.sample);
  });

  it("BOUNDARY 4 — per-video transcript results are byte-identical, in order", async () => {
    // The surface the transcribe phase touches. Replays the recorded per-video
    // strategy results through the REAL loop, so enrichment (musicMetadata,
    // remixMetadata, videoDuration, collaborations), null-handling for videos
    // with no transcript, and the ORDER of the resulting array are all
    // exercised — not just the text.
    const recorded = fx.expected.transcriptsAfterFetch;
    expect(recorded, "fixture must carry boundary-4 data").toBeTruthy();

    recordedTranscripts.clear();
    for (const t of recorded!) {
      recordedTranscripts.set(String(t.videoId), {
        text: String(t.transcript),
        wordCount: Number(t.wordCount),
        source: String(t.transcriptSource),
      });
    }

    // Rebuild the sampled list the run actually transcribed, from the recorded
    // pool and sample — so this replays the real (item, bucket) pairs.
    const byId = new Map(fx.expected.poolAfterAugment.videoItems.map(v => [v.id, v]));
    const sampled = fx.expected.sample
      .map(s => ({ item: byId.get(s.id)!, bucket: s.bucket as "recent" | "mid" | "anchor" }))
      .filter(s => s.item);

    const got = await transcribeSampledVideos(fx.handle, sampled);
    expect(JSON.stringify(got)).toBe(JSON.stringify(recorded));
  });

  it("BOUNDARY 4b — a video with no transcript is dropped, never fabricated", async () => {
    // The failure that would silently inflate evidence: emitting an entry for a
    // video the strategies could not transcribe.
    recordedTranscripts.clear(); // every lookup misses → leaf returns null
    const byId = new Map(fx.expected.poolAfterAugment.videoItems.map(v => [v.id, v]));
    const sampled = fx.expected.sample
      .map(s => ({ item: byId.get(s.id)!, bucket: s.bucket as "recent" | "mid" | "anchor" }))
      .filter(s => s.item);

    const got = await transcribeSampledVideos(fx.handle, sampled);
    expect(got).toEqual([]);
  });

  it("BOUNDARY 3b — sampling the recorded pool directly reproduces the recorded sample", () => {
    // Same assertion sourced from the recorded pool instead of re-collection,
    // so a sampler regression is distinguishable from a collection regression.
    const { sampledVideos } = selectLongitudinalSample(
      fx.handle, fx.expected.poolAfterAugment.videoItems, fx.samplingNowSec,
    );
    expect(sampledVideos.map(s => ({ id: s.item.id, bucket: s.bucket })))
      .toEqual(fx.expected.sample);
  });
});
