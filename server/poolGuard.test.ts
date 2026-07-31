/**
 * Session 10 (Commit 1) — the API collection path author-guards each item.
 * A mixed feed (own + foreign + author-less) must yield ONLY the creator's own
 * videos, and report the rejected count.
 */
import { describe, it, expect, vi } from "vitest";

// Mock the profile scraper so we control the exact itemList the API path sees.
vi.mock("./scraping/tiktok/profileScraper", () => ({
  scrapeTikTokProfile: vi.fn(async () => ({
    userInfo: { userInfo: { user: { secUid: "sec-123", uniqueId: "testcreator" } } },
    posts: {
      data: {
        itemList: [
          { id: "own1", desc: "mine", stats: {}, music: {}, video: { duration: 12 }, author: { uniqueId: "testcreator" } },
          { id: "own2", desc: "mine too", stats: {}, music: {}, video: { duration: 8 }, author: { uniqueId: "TestCreator" } }, // case variant
          { id: "foreign1", desc: "hoover dam", stats: {}, music: {}, video: { duration: 20 }, author: { uniqueId: "juarezaale" } },
          { id: "authorless", desc: "trending", stats: {}, music: {}, video: { duration: 30 }, author: { uniqueId: "" } },
        ],
      },
    },
  })),
}));

import { fetchTikTokVideosFromAPI } from "./webResearch";
import { scrapeTikTokProfile } from "./scraping/tiktok/profileScraper";

describe("fetchTikTokVideosFromAPI author guard", () => {
  it("keeps only the creator's own videos and counts the rest as rejected", async () => {
    const { items, rejected } = await fetchTikTokVideosFromAPI("testcreator");
    const ids = items.map(i => i.id).sort();
    expect(ids).toEqual(["own1", "own2"]);            // foreign + author-less excluded
    expect(rejected).toBe(2);                          // juarezaale + author-less
    // duration is carried through and normalized to ms (Commit 2): 12s → 12000ms.
    expect(items.find(i => i.id === "own1")?.durationMs).toBe(12000);
  });

  // Session 11 (Commit 1): when the caller hands in a profile it already scraped,
  // the API path must NOT scrape the same page a second time.
  it("reuses a prefetched profile instead of scraping again", async () => {
    const mockScrape = vi.mocked(scrapeTikTokProfile);
    const prefetched = await scrapeTikTokProfile("testcreator");
    mockScrape.mockClear();
    const { items } = await fetchTikTokVideosFromAPI("testcreator", prefetched);
    expect(mockScrape).not.toHaveBeenCalled();         // no second scrape
    expect(items.map(i => i.id).sort()).toEqual(["own1", "own2"]);
  });

  /*
    ── A POOL WITH NO secUid IS STILL A POOL ─────────────────────────────────
    This function used to `return` on a missing secUid BEFORE reading itemList
    — a vestige of the Phase-1 design where secUid keyed a SEPARATE post-list
    API call that no longer exists.

    It cost a real capture. Live, 2026-07-31: profile_rendered_grid harvested
    21 videos for @lynlecheung and scrapeTikTokProfile logged "final result —
    21 videos"; this guard returned zero one line later, because the leg that
    supplied them (the rendered grid) carries no secUid. The capture phase saw
    an empty pool, burned its three attempts, and the campaign was refused.

    Any leg that can supply videos without a structured user payload hits this,
    so the test pins the shape rather than the leg.
  */
  it("keeps videos from a leg that carries NO secUid — the list is the pool, not the key", async () => {
    vi.mocked(scrapeTikTokProfile).mockResolvedValueOnce({
      // What the embed + rendered-grid combination produces: real base fields,
      // real videos, and no secUid anywhere.
      userInfo: { userInfo: { user: { uniqueId: "testcreator" } } },
      posts: {
        data: {
          itemList: [
            { id: "grid1", desc: "harvested", stats: {}, music: {}, video: { duration: 15 }, author: { uniqueId: "testcreator" } },
            { id: "grid2", desc: "also mine", stats: {}, music: {}, video: { duration: 9 }, author: { uniqueId: "testcreator" } },
            { id: "gridForeign", desc: "someone else", stats: {}, music: {}, video: { duration: 5 }, author: { uniqueId: "juarezaale" } },
          ],
        },
      },
    } as never);

    const { items, rejected } = await fetchTikTokVideosFromAPI("testcreator");
    expect(items.map(i => i.id).sort()).toEqual(["grid1", "grid2"]);
    // The author guard still applies to every item, secUid or not.
    expect(rejected).toBe(1);
  });

  it("an empty list is still empty — the fix does not invent a pool", async () => {
    vi.mocked(scrapeTikTokProfile).mockResolvedValueOnce({
      userInfo: { userInfo: { user: { uniqueId: "testcreator" } } },
      posts: { data: { itemList: [] } },
    } as never);
    const { items, rejected } = await fetchTikTokVideosFromAPI("testcreator");
    expect(items).toHaveLength(0);
    expect(rejected).toBe(0);
  });
});
