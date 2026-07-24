/**
 * Session 9 (C1) — location matcher no longer matches common non-English words.
 *
 * The bug: matching short city abbreviations ("LA", "NYC") case-insensitively
 * let a two-letter code match a common lowercase word in another language — the
 * Spanish/French article "la" matched "LA" (Los Angeles). The fix keeps full
 * names case-insensitive but requires abbreviations in uppercase.
 */
import { describe, it, expect } from "vitest";
import { matchKnownCity } from "./webResearch";

describe("matchKnownCity — mechanism-safe abbreviation handling", () => {
  it("does NOT match the lowercase Spanish/French article 'la' as Los Angeles", () => {
    expect(matchKnownCity("Dios es rey, la fe es todo")).toBeNull(); // Spanish
    expect(matchKnownCity("la vie est belle avec la foi")).toBeNull(); // French
    expect(matchKnownCity("something la something")).toBeNull();
  });

  it("does NOT match other lowercase words that happen to equal an abbreviation", () => {
    // No general lowercase word can match an uppercase-only abbreviation.
    expect(matchKnownCity("nyc lowercase noise")).toBeNull();
  });

  it("STILL matches a genuine uppercase abbreviation", () => {
    expect(matchKnownCity("based in LA")).toBe("LA");
    expect(matchKnownCity("repping NYC all day")).toBe("NYC");
  });

  it("matches full city names case-insensitively (unchanged, unambiguous)", () => {
    expect(matchKnownCity("living in toronto")).toBe("toronto");
    expect(matchKnownCity("Los Angeles vibes")).toBe("Los Angeles");
    expect(matchKnownCity("LONDON calling")).toBe("LONDON");
  });

  it("requires word boundaries (no substring matches)", () => {
    expect(matchKnownCity("laptop repairs")).toBeNull();   // 'la' inside 'laptop'
    expect(matchKnownCity("clandestine")).toBeNull();      // 'la' inside 'clandestine'
  });

  it("returns null when no city is present", () => {
    expect(matchKnownCity("no location here at all")).toBeNull();
    expect(matchKnownCity("")).toBeNull();
  });
});
