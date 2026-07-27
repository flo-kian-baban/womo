/**
 * Instagram GraphQL user-node merging — corpus-rebuild item 4.
 *
 * All four Instagram runs in the 20-creator rebuild banked videoCount 0 —
 * natgeo among them, at ~30k real posts — and the 0 flowed into the model's
 * evidence inputs and left creator_observations.video_count null. The cause:
 * the XHR listener kept the FIRST user node it saw, and Instagram's GraphQL
 * responses carry user nodes with different subsets of fields — the first is
 * typically a light node (followers, bio) with no posts count, and the node
 * that carries `edge_owner_to_timeline_media.count` arrived later and was
 * discarded.
 */
import { describe, expect, it } from "vitest";
import { mergeUserNodes } from "./scraping/instagram/profileScraper";

describe("mergeUserNodes — later nodes fill gaps, never overwrite", () => {
  it("the light-node-first case: a later node supplies the missing posts count", () => {
    const light = { username: "natgeo", biography: "bio", follower_count: 268938069 };
    const full = {
      username: "natgeo",
      follower_count: 999, // must NOT overwrite the first-seen value
      edge_owner_to_timeline_media: { count: 29876 },
    };
    const merged = mergeUserNodes(light, full);
    expect(merged.follower_count).toBe(268938069);
    expect((merged.edge_owner_to_timeline_media as { count: number }).count).toBe(29876);
    expect(merged.biography).toBe("bio");
  });

  it("null base adopts the incoming node whole", () => {
    const node = { username: "x", media_count: 12 };
    expect(mergeUserNodes(null, node)).toBe(node);
  });

  it("a null field counts as missing and is fillable", () => {
    const merged = mergeUserNodes({ username: "x", category: null }, { category: "Media" });
    expect(merged.category).toBe("Media");
  });

  it("nothing to add → the SAME reference back, so callers can log honestly", () => {
    const base = { username: "x", media_count: 12 };
    expect(mergeUserNodes(base, { username: "x" })).toBe(base);
  });
});
