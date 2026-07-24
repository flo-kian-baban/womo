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

describe("fetchTikTokVideosFromAPI author guard", () => {
  it("keeps only the creator's own videos and counts the rest as rejected", async () => {
    const { items, rejected } = await fetchTikTokVideosFromAPI("testcreator");
    const ids = items.map(i => i.id).sort();
    expect(ids).toEqual(["own1", "own2"]);            // foreign + author-less excluded
    expect(rejected).toBe(2);                          // juarezaale + author-less
    // duration is carried through for the kept items (Commit 2 relevance)
    expect(items.find(i => i.id === "own1")?.durationMs).toBe(12);
  });
});
