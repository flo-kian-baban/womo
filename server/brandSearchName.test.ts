/**
 * THE SEARCH TERM, AND THE TRAJECTORY — two small pure functions, pinned.
 *
 * ─── Why the search name has its own file ───────────────────────────────────
 * Every off-site lookup a brand makes — Yelp, Google Places, the TikTok mention
 * queries, both search fallbacks — was handed a name derived from the URL WITH
 * THE TLD STILL ATTACHED. Yelp said so in its own log line:
 *
 *     [yelp] No business results found for "glossier.com" in Canada
 *
 * Nine mention searches across two brands returned HTTP 200 and zero results,
 * because they were searching for "glossier.com haul". The measurement that
 * question 18 rests on — a 2.75:1 projected-to-received evidence ratio — was
 * therefore partly an artifact of this string, not a property of brands.
 *
 * These pin the derivation directly. A search that returns nothing is
 * indistinguishable from a brand nobody talks about, which is exactly why the
 * defect survived: it looked like data.
 */
import { describe, expect, it } from "vitest";
import { brandSearchName } from "./phases/brandPhases";
import { computeReviewTrajectory, type ReviewEntry } from "./reviewResearch";

describe("brandSearchName — what a customer would type", () => {
  it("strips the TLD from a plain domain", () => {
    expect(brandSearchName("https://www.glossier.com")).toBe("glossier");
    expect(brandSearchName("https://www.allbirds.com")).toBe("allbirds");
  });

  it("takes the REGISTRABLE label, not the subdomain", () => {
    // The naive fix — first label — turns shop.glossier.com into "shop",
    // which searches worse than the bug it replaces.
    expect(brandSearchName("https://shop.glossier.com")).toBe("glossier");
    expect(brandSearchName("https://store.us.allbirds.com")).toBe("allbirds");
  });

  it("handles multi-part public suffixes", () => {
    expect(brandSearchName("https://www.harpercollins.co.uk")).toBe("harpercollins");
    expect(brandSearchName("https://example.com.au")).toBe("example");
  });

  it("drops the path, query and port", () => {
    expect(brandSearchName("https://www.glossier.com/en-ca/products/balm-dotcom")).toBe("glossier");
    expect(brandSearchName("http://localhost:3000")).toBe("localhost");
  });

  it("hyphens and underscores become spaces — that is how a name is searched", () => {
    expect(brandSearchName("https://www.rose-kebab.com")).toBe("rose kebab");
    expect(brandSearchName("https://big_sky_bakery.com")).toBe("big sky bakery");
  });

  /**
   * The plain-name path was ALREADY correct and must stay untouched: someone
   * typing "Glossier" got "Glossier", and a name-only subject has no website to
   * derive from. The bug was URL-input-only.
   */
  it("a plain name is returned verbatim, including its casing and spaces", () => {
    expect(brandSearchName("Glossier")).toBe("Glossier");
    expect(brandSearchName("LOCAL Public Eatery")).toBe("LOCAL Public Eatery");
    expect(brandSearchName("Roses Kebab Land")).toBe("Roses Kebab Land");
  });

  it("never returns empty for a parseable input", () => {
    for (const input of ["https://a.com", "https://www.x.co.uk", "Y", "https://-.com"]) {
      expect(brandSearchName(input).length, `empty for ${input}`).toBeGreaterThan(0);
    }
  });
});

/**
 * ─── The trajectory: recorded, not read ─────────────────────────────────────
 * This never reaches the model. It is stored in `persistence_status._meta` for
 * Jason's question 20. What it must NOT do is invent a direction it cannot
 * support — the whole reason it reports its own coverage.
 */
describe("computeReviewTrajectory — honest about what it could read", () => {
  const NOW = Date.parse("2026-07-27");
  const at = (iso: string, rating: number): ReviewEntry =>
    ({ author: "a", rating, text: "t", date: iso });

  it("splits recent from older at twelve months and reports the delta", () => {
    const t = computeReviewTrajectory([
      at("2026-06-01", 5), at("2026-05-01", 5),
      at("2024-01-01", 3), at("2023-06-01", 3),
    ], NOW);
    expect(t.recentCount).toBe(2);
    expect(t.olderCount).toBe(2);
    expect(t.recentAvgRating).toBe(5);
    expect(t.olderAvgRating).toBe(3);
    expect(t.ratingDelta).toBe(2);
    expect(t.trajectory).toBe("improving");
  });

  it("declining and stable are distinguished by an epsilon, not by sign alone", () => {
    const declining = computeReviewTrajectory([at("2026-06-01", 2), at("2023-01-01", 5)], NOW);
    expect(declining.trajectory).toBe("declining");
    // A tenth of a star across two cohorts is noise, and calling it a trend
    // would be the invented number this exists to avoid.
    const stable = computeReviewTrajectory([at("2026-06-01", 4.1), at("2023-01-01", 4)], NOW);
    expect(stable.ratingDelta).toBeCloseTo(0.1, 5);
    expect(stable.trajectory).toBe("stable");
  });

  it("ONE-SIDED data is a snapshot, not a trajectory", () => {
    const recentOnly = computeReviewTrajectory([at("2026-06-01", 5), at("2026-05-01", 4)], NOW);
    expect(recentOnly.recentCount).toBe(2);
    expect(recentOnly.olderCount).toBe(0);
    expect(recentOnly.ratingDelta).toBeNull();
    expect(recentOnly.trajectory).toBe("insufficient_data");
  });

  /**
   * COVERAGE IS REPORTED, because only Google Maps dates parse. Yelp's are
   * scraped free text ("3 months ago") and are deliberately not guessed at — a
   * trajectory built from 2 of 5 reviews must say so.
   */
  it("counts only reviews whose date it could actually read, and says how many", () => {
    const t = computeReviewTrajectory([
      at("2026-06-01", 5),
      at("2023-01-01", 3),
      { author: "y", rating: 4, text: "t", date: "3 months ago" },
      { author: "y", rating: 4, text: "t", date: "" },
      { author: "y", rating: 4, text: "t" },
    ], NOW);
    expect(t.totalIngested).toBe(5);
    expect(t.datedReviews).toBe(2);
    expect(t.trajectory).toBe("improving");
  });

  it("an unrated review is excluded — a 0 star is 'no rating', not a bad one", () => {
    const t = computeReviewTrajectory([
      at("2026-06-01", 0), at("2026-05-01", 5), at("2023-01-01", 5),
    ], NOW);
    expect(t.datedReviews).toBe(2);
    expect(t.recentAvgRating).toBe(5);
  });

  it("no reviews at all is insufficient_data, not a neutral zero", () => {
    const t = computeReviewTrajectory([], NOW);
    expect(t).toMatchObject({
      datedReviews: 0, totalIngested: 0, ratingDelta: null, trajectory: "insufficient_data",
      recentAvgRating: null, olderAvgRating: null,
    });
  });
});
