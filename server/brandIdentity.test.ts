/**
 * BRAND EVIDENCE IDENTITY HARNESS — the acceptance criterion for S5.
 *
 * ─── The regression class ───────────────────────────────────────────────────
 * Brand evidence is a single string handed to the model. It is built by
 * concatenating up to five blocks, in a fixed order, where an ABSENT block
 * contributes no separator at all. Until now that concatenation lived in two
 * files: `researchBrand` appended the decoded-symbols and mention blocks, and
 * the router appended the TikTok and Instagram blocks to that result.
 *
 * Moving `decodeBrandSymbols` into a derive phase means the symbols block is
 * produced somewhere else entirely. If the reassembly reorders the blocks, or
 * emits a separator for an absent one, the model receives a DIFFERENT prompt —
 * and every downstream field shifts while every test still passes, because
 * nothing else in the system reads that string.
 *
 * ─── The proof ──────────────────────────────────────────────────────────────
 * A real monolith run is recorded (WOMO_BRAND_BASELINE): its unconcatenated
 * parts, and the exact string it produced from them. The harness proves
 * `assembleBrandEvidence` reproduces that string byte-for-byte from those same
 * parts. Same shape as the creator monolith-baseline harness — a recorded
 * reference rather than a frozen function, because brand has no pre-seam copy.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import {
  assembleBrandEvidence, buildBrandBaseEvidence, buildBrandDecoderInputs,
  type BrandMonolithBaseline,
} from "./phases/brandEvidence";
import { assembleBrandCollection, brandDecoderInputsFrom } from "./phases/brandPhases";
import { EMPTY_BRAND_REVIEW_FIELDS, type BrandReviewFields } from "./reviewResearch";

const FIXTURE = path.join(import.meta.dirname, "__fixtures__", "brandBaseline.json");
const bl: BrandMonolithBaseline | null = existsSync(FIXTURE)
  ? (JSON.parse(readFileSync(FIXTURE, "utf8")) as BrandMonolithBaseline)
  : null;

describe("brand evidence identity — the phased assembly reproduces the monolith", () => {
  it("has a recorded baseline to prove against", () => {
    expect(bl, "run a brand analysis with WOMO_BRAND_BASELINE set").not.toBeNull();
  });

  /**
   * THE VACUOUS-PASS GUARD.
   *
   * A brand with no website, no reviews and no mentions produces a baseline
   * whose "parts" are almost entirely absent — and asserting that an empty
   * assembly equals an empty string proves nothing while looking green. The
   * fixture must exercise the real blocks, so the bar is stated here and a thin
   * fixture FAILS rather than passing quietly.
   */
  it("the fixture is NON-TRIVIAL — it exercises the real blocks", () => {
    expect(bl!.observed.semanticWordCount, "no website content — the base block is empty")
      .toBeGreaterThanOrEqual(100);

    const present = [
      bl!.parts.decodedSymbolsBlock,
      bl!.parts.mentionEvidenceBlock,
      bl!.parts.tiktokBlock,
      bl!.parts.instagramBlock,
    ].filter(Boolean).length;
    expect(present, "baseline exercises fewer than two optional blocks").toBeGreaterThanOrEqual(2);

    // The decoded-symbols block is the one the derive split moves, so a fixture
    // without it cannot prove the thing this harness exists to prove.
    expect(bl!.parts.decodedSymbolsBlock, "baseline has no decoded-symbols block")
      .toBeTruthy();

    expect(bl!.expectedEvidenceSummary.length).toBeGreaterThan(500);
  });

  it("BYTE-IDENTICAL: reassembling the recorded parts reproduces the recorded string", () => {
    expect(assembleBrandEvidence(bl!.parts)).toBe(bl!.expectedEvidenceSummary);
  });

  it("every recorded block actually appears in the produced string", () => {
    // Guards a reassembly that happens to match by dropping a block the
    // baseline also dropped.
    for (const block of [
      bl!.parts.decodedSymbolsBlock,
      bl!.parts.mentionEvidenceBlock,
      bl!.parts.tiktokBlock,
      bl!.parts.instagramBlock,
    ]) {
      if (block) expect(bl!.expectedEvidenceSummary).toContain(block);
    }
  });
});

/**
 * THE DERIVE SPLIT, ARBITRATED.
 *
 * `decodeBrandSymbols` used to run INSIDE `researchBrand`, so the symbols block
 * was already present when the base summary was built. Split out, collection
 * produces its parts WITHOUT symbols and a later derive phase supplies them —
 * a different producer, a different moment, the same slot.
 *
 * These replay the recorded baseline through that new ordering and require the
 * result to equal the recorded string byte-for-byte. If the split cannot
 * preserve it, these fail; the harness is the arbiter, not the implementation.
 */
/**
 * THE BASE BLOCK, REBUILT.
 *
 * A brand CAPTURE phase does not receive the base summary — it rebuilds it from
 * the website crawl, the search snippets and the review block. Pinning only the
 * finished string cannot tell a faithful rebuild from a lucky one, so the
 * baseline records the inputs too and the harness rebuilds from them.
 */
describe("the base block is rebuilt byte-for-byte from its recorded inputs", () => {
  it("the baseline records what the base was built FROM", () => {
    expect(bl!.baseInputs, "re-record the baseline: it predates baseInputs").toBeTruthy();
  });

  it("the fixture's base inputs are NON-TRIVIAL", () => {
    const i = bl!.baseInputs!;
    // Website content AND snippets AND a review block — all three optional
    // elements populated, so the filter(Boolean) asymmetry is actually exercised.
    expect(i.description.length).toBeGreaterThan(500);
    expect(i.snippets.length).toBeGreaterThanOrEqual(3);
    expect(i.audiencePerceptionBlock, "no review block — the third element is untested").toBeTruthy();
  });

  it("BYTE-IDENTICAL: rebuilding from the recorded inputs reproduces the recorded base", () => {
    expect(buildBrandBaseEvidence(bl!.baseInputs!)).toBe(bl!.parts.base);
  });

  it("and that rebuilt base still assembles into the recorded full string", () => {
    // End to end: rebuild the base, then run the outer assembly over it.
    const rebuilt = buildBrandBaseEvidence(bl!.baseInputs!);
    expect(assembleBrandEvidence({ ...bl!.parts, base: rebuilt }))
      .toBe(bl!.expectedEvidenceSummary);
  });

  it("only the first 8 snippets reach the prompt — the cap is frozen", () => {
    const i = bl!.baseInputs!;
    if (i.snippets.length > 8) {
      expect(buildBrandBaseEvidence(i)).not.toContain(i.snippets[8]);
    }
    expect(buildBrandBaseEvidence(i)).toContain(i.snippets[0]);
  });

  it("an absent element contributes NO line — the same asymmetry as the outer assembly", () => {
    const bare = buildBrandBaseEvidence({
      brandName: "X", websiteUrl: null, description: "", snippets: [], audiencePerceptionBlock: null,
    });
    expect(bare).toContain("Website: Not provided");
    expect(bare).not.toContain("Website Content:");
    expect(bare).not.toContain("Key Snippets:");
  });
});

describe("the derive split preserves the recorded string exactly", () => {
  it("collection-without-symbols, then derive-supplies-symbols, reassembles identically", () => {
    // 1. What collection now returns: every block EXCEPT the symbols one.
    const fromCollection = {
      base: bl!.parts.base,
      mentionEvidenceBlock: bl!.parts.mentionEvidenceBlock,
      tiktokBlock: bl!.parts.tiktokBlock,
      instagramBlock: bl!.parts.instagramBlock,
    };
    // 2. What the derive phase later contributes, into the same slot.
    const afterDerive = { ...fromCollection, decodedSymbolsBlock: bl!.parts.decodedSymbolsBlock };

    expect(assembleBrandEvidence(afterDerive)).toBe(bl!.expectedEvidenceSummary);
  });

  it("the symbols block still lands BEFORE mentions, tiktok and instagram", () => {
    // The split's real hazard is not omission but REORDERING — appending the
    // late-arriving block at the end would still contain every block and still
    // look plausible, while handing the model a differently-ordered prompt.
    const s = bl!.expectedEvidenceSummary;
    const symbolsAt = s.indexOf(bl!.parts.decodedSymbolsBlock!);
    expect(symbolsAt).toBeGreaterThan(0);
    for (const later of [bl!.parts.tiktokBlock, bl!.parts.instagramBlock]) {
      if (later) expect(symbolsAt).toBeLessThan(s.indexOf(later));
    }
  });

  it("a derive phase that produces NOTHING degrades to the no-symbols string", () => {
    // deriveBrandSymbols is non-fatal by design: a failed decoder must yield a
    // brand analysis without symbols, not no brand analysis.
    const withoutSymbols = assembleBrandEvidence({ ...bl!.parts, decodedSymbolsBlock: null });
    expect(withoutSymbols).not.toContain(bl!.parts.decodedSymbolsBlock!);
    expect(withoutSymbols).toContain(bl!.parts.base);
    if (bl!.parts.tiktokBlock) expect(withoutSymbols).toContain(bl!.parts.tiktokBlock);
  });
});

describe("the assembly rule itself — order, and the absent-block asymmetry", () => {
  const parts = {
    base: "BASE",
    decodedSymbolsBlock: "SYMBOLS",
    mentionEvidenceBlock: "MENTIONS",
    tiktokBlock: "TIKTOK",
    instagramBlock: "INSTAGRAM",
  };

  it("blocks appear in the frozen order", () => {
    expect(assembleBrandEvidence(parts))
      .toBe("BASE\n\nSYMBOLS\n\nMENTIONS\n\nTIKTOK\n\nINSTAGRAM");
  });

  it("an ABSENT block contributes no separator — this is why it is not a join", () => {
    expect(assembleBrandEvidence({ ...parts, mentionEvidenceBlock: null }))
      .toBe("BASE\n\nSYMBOLS\n\nTIKTOK\n\nINSTAGRAM");
    expect(assembleBrandEvidence({ base: "BASE" })).toBe("BASE");
  });

  it("empty-string and null blocks are both absent — no trailing separators", () => {
    expect(assembleBrandEvidence({ base: "BASE", tiktokBlock: "", instagramBlock: null }))
      .toBe("BASE");
  });

  it("the base is never prefixed, even when it is empty", () => {
    expect(assembleBrandEvidence({ base: "", decodedSymbolsBlock: "S" })).toBe("\n\nS");
  });
});

/**
 * THE PHASED ASSEMBLY, ARBITRATED (S5 step 3).
 *
 * `assembleBrandCollection` is where a phased brand run either reproduces the
 * monolith's string byte-for-byte or silently does not. These drive it with
 * BANKED-PHASE-SHAPED inputs reconstructed from the recorded baseline, so the
 * thing under test is the routing of banked pieces into the two pinned
 * builders — not the builders themselves, which are already pinned above.
 *
 * The TikTok and Instagram blocks are deliberately excluded: the router still
 * owns those inputs until step 4, so collection's string is the recorded one
 * MINUS those two blocks.
 */
describe("assembleBrandCollection rebuilds from banked phase outputs", () => {
  /** The baseline's parts, rearranged into what the four phases would bank. */
  function bankedFromBaseline() {
    const i = bl!.baseInputs!;
    return {
      capture: {
        brandName: i.brandName,
        websiteUrl: i.websiteUrl,
        // Capture's own values are irrelevant here — augment's rescue carries
        // the final description and the EXTENDED snippets, which is exactly the
        // ordering constraint the phases encode.
        description: "",
        snippets: [],
        semanticWordCount: 0,
        crawledPages: [],
      },
      augment: {
        rescue: {
          description: i.description,
          snippets: i.snippets,
          googleFallbackRan: false,
          youtubeFallbackRan: false,
        },
        perception: {
          audiencePerceptionBlock: i.audiencePerceptionBlock,
          totalReviews: bl!.observed.totalReviews,
          review: { ...EMPTY_BRAND_REVIEW_FIELDS, totalReviews: bl!.observed.totalReviews },
          mentionEvidenceBlock: bl!.parts.mentionEvidenceBlock ?? null,
          totalMentions: bl!.observed.totalMentions,
          mentions: null,
        },
      },
      derive: {
        decodedSymbols: null,
        decodedSymbolsBlock: bl!.parts.decodedSymbolsBlock ?? null,
      },
    };
  }

  it("BYTE-IDENTICAL: the base it builds equals the recorded base", () => {
    expect(assembleBrandCollection(bankedFromBaseline()).evidenceParts.base)
      .toBe(bl!.parts.base);
  });

  it("BYTE-IDENTICAL: the collection string equals the recorded string minus the router's blocks", () => {
    // What the monolith produced, with the two router-owned blocks removed —
    // built through the SAME pinned assembly, so this is not a second
    // implementation of the rule.
    const expectedWithoutRouterBlocks = assembleBrandEvidence({
      ...bl!.parts, tiktokBlock: null, instagramBlock: null,
    });
    expect(assembleBrandCollection(bankedFromBaseline()).evidenceSummary)
      .toBe(expectedWithoutRouterBlocks);
  });

  it("the symbols block still precedes the mention block", () => {
    const s = assembleBrandCollection(bankedFromBaseline()).evidenceSummary;
    if (bl!.parts.decodedSymbolsBlock && bl!.parts.mentionEvidenceBlock) {
      expect(s.indexOf(bl!.parts.decodedSymbolsBlock))
        .toBeLessThan(s.indexOf(bl!.parts.mentionEvidenceBlock));
    }
    expect(s).toContain(bl!.parts.decodedSymbolsBlock!);
  });

  it("a derive phase that produced nothing yields the string without symbols", () => {
    const banked = bankedFromBaseline();
    const out = assembleBrandCollection({ ...banked, derive: null });
    expect(out.evidenceSummary).not.toContain(bl!.parts.decodedSymbolsBlock!);
    expect(out.evidenceSummary).toContain(bl!.parts.base);
  });

  it("it never emits the router's blocks — those are step 4's business", () => {
    const s = assembleBrandCollection(bankedFromBaseline()).evidenceSummary;
    if (bl!.parts.tiktokBlock) expect(s).not.toContain(bl!.parts.tiktokBlock);
    if (bl!.parts.instagramBlock) expect(s).not.toContain(bl!.parts.instagramBlock);
  });
});

/**
 * THE DECODER'S INPUTS — the blind spot, now covered.
 *
 * ─── What this harness could not see ────────────────────────────────────────
 * Everything above replays RECORDED parts through the assembly. That pins the
 * string handed to the EXTRACTION model, and it is genuinely byte-exact — but
 * every one of those parts is an INPUT to the harness, never an output of the
 * code under test. `decodedSymbolsBlock` in particular is read straight from the
 * fixture, so whatever produced it was never exercised.
 *
 * The symbol decoder sits upstream of that block and reads two different strings
 * built from the same raw material. When `decodeBrandSymbols` moved into a
 * derive phase (4a36492), those two strings were rebuilt from a narrower slice
 * of the banked evidence — the description WITHOUT its 63 snippets, and the
 * formatted perception block in place of the raw review text. Different corpus,
 * different symbols, different symbols block, different extraction prompt.
 * Twenty-two green assertions and not one of them could fail.
 *
 * ─── What is pinned now ─────────────────────────────────────────────────────
 * The construction is one shared function; these prove it is the MONOLITH's
 * construction, and that the phase routes the banked pieces into it intact. The
 * expected values are transcribed literally from `researchBrand` rather than
 * computed by calling the builder — a second statement of the rule, so this is
 * an arbiter and not a tautology.
 */
describe("the symbol decoder receives the monolith's inputs, byte for byte", () => {
  /**
   * `researchBrand`'s decoder-input construction as it stood before it was
   * lifted. Deliberately duplicated here — a harness that calls the function it
   * is pinning proves only that the function equals itself.
   */
  function monolithDecoderInputs(i: {
    description: string;
    snippets: string[];
    yelpReviewExcerpts: string;
    googleReviewExcerpts: string;
    combinedReviewText: string;
  }): { websiteText: string; reviewText: string } {
    const websiteTextParts = [i.description, ...i.snippets].filter(Boolean);
    const directWebTextLength = websiteTextParts.join(" ").length;
    if (directWebTextLength < 150) {
      if (i.yelpReviewExcerpts) websiteTextParts.push(`Yelp customer reviews: ${i.yelpReviewExcerpts.slice(0, 800)}`);
      if (i.googleReviewExcerpts) websiteTextParts.push(`Google Maps customer reviews: ${i.googleReviewExcerpts.slice(0, 800)}`);
    }
    return { websiteText: websiteTextParts.join("\n"), reviewText: i.combinedReviewText };
  }

  /**
   * Review values the baseline does not record, chosen to be mutually
   * distinguishable: if the phase substitutes one for another — which is exactly
   * the defect — the assertion names which substitution happened.
   */
  const REVIEW: BrandReviewFields = {
    yelpRating: 4.5,
    yelpReviewCount: 120,
    yelpReviewExcerpts: `[5★] Ada: "${"y".repeat(900)}"`,
    googleRating: 4.2,
    googleReviewCount: 128,
    googleReviewExcerpts: `[4★] Grace: "${"g".repeat(900)}"`,
    combinedReviewText: "RAW-COMBINED-REVIEW-TEXT",
    overallRating: 4.35,
    totalReviews: 248,
  };

  /** A banked augment output carrying the baseline's real rescued evidence. */
  function bankedAugment(over: Partial<BrandReviewFields> = {}) {
    const i = bl!.baseInputs!;
    return {
      rescue: {
        description: i.description,
        snippets: i.snippets,
        googleFallbackRan: false,
        youtubeFallbackRan: false,
      },
      perception: {
        audiencePerceptionBlock: i.audiencePerceptionBlock,
        totalReviews: REVIEW.totalReviews,
        review: { ...REVIEW, ...over },
        mentionEvidenceBlock: bl!.parts.mentionEvidenceBlock ?? null,
        totalMentions: bl!.observed.totalMentions,
        mentions: null,
      },
    };
  }

  it("BYTE-IDENTICAL: the phase's decoder inputs equal the monolith's, from the recorded baseline", () => {
    const i = bl!.baseInputs!;
    const expected = monolithDecoderInputs({
      description: i.description,
      snippets: i.snippets,
      yelpReviewExcerpts: REVIEW.yelpReviewExcerpts,
      googleReviewExcerpts: REVIEW.googleReviewExcerpts,
      combinedReviewText: REVIEW.combinedReviewText,
    });
    expect(brandDecoderInputsFrom(bankedAugment() as never)).toEqual(expected);
  });

  /**
   * THE REGRESSION, NAMED. Both halves of 4a36492's divergence, each asserted
   * against the specific wrong value it used to carry — so a re-introduction
   * fails loudly rather than shifting a string nobody is watching.
   */
  it("the corpus carries the SNIPPETS, not the description alone", () => {
    const { websiteText } = brandDecoderInputsFrom(bankedAugment() as never);
    const snippets = bl!.baseInputs!.snippets;
    expect(snippets.length, "fixture has too few snippets to prove this").toBeGreaterThan(10);
    for (const s of snippets) expect(websiteText).toContain(s);
    expect(websiteText).not.toBe(bl!.baseInputs!.description);
  });

  it("the review text is the RAW combined text, not the formatted perception block", () => {
    const { reviewText } = brandDecoderInputsFrom(bankedAugment() as never);
    expect(reviewText).toBe(REVIEW.combinedReviewText);
    expect(reviewText).not.toBe(bl!.baseInputs!.audiencePerceptionBlock);
  });

  it("a thin website corpus is rescued by review excerpts — Yelp first, each capped at 800", () => {
    const thin = buildBrandDecoderInputs({
      description: "tiny",
      snippets: [],
      yelpReviewExcerpts: REVIEW.yelpReviewExcerpts,
      googleReviewExcerpts: REVIEW.googleReviewExcerpts,
      combinedReviewText: REVIEW.combinedReviewText,
    });
    expect(thin.websiteText).toBe([
      "tiny",
      `Yelp customer reviews: ${REVIEW.yelpReviewExcerpts.slice(0, 800)}`,
      `Google Maps customer reviews: ${REVIEW.googleReviewExcerpts.slice(0, 800)}`,
    ].join("\n"));
    // The cap is a slice, not a truncation marker — 800 chars of a 900-char body.
    expect(thin.websiteText).toContain("y".repeat(777));
    expect(thin.websiteText).not.toContain("y".repeat(900));
  });

  it("the rescue does NOT run once the corpus reaches 150 chars", () => {
    const at150 = buildBrandDecoderInputs({
      description: "d".repeat(150),
      snippets: [],
      ...REVIEW,
    });
    expect(at150.websiteText).toBe("d".repeat(150));

    const under = buildBrandDecoderInputs({
      description: "d".repeat(149),
      snippets: [],
      ...REVIEW,
    });
    expect(under.websiteText).toContain("Yelp customer reviews:");
  });

  it("the length probe joins with a SPACE while the corpus joins with a NEWLINE", () => {
    // Equal lengths, different strings. Transcribed as the monolith wrote it;
    // unifying the two separators would be a silent rewrite of the corpus.
    const out = buildBrandDecoderInputs({
      description: "a", snippets: ["b", "c"], ...EMPTY_BRAND_REVIEW_FIELDS,
    });
    expect(out.websiteText).toBe("a\nb\nc");
  });

  it("blank elements contribute nothing — filter(Boolean) runs before the probe", () => {
    const out = buildBrandDecoderInputs({
      description: "", snippets: ["", "kept", ""], ...EMPTY_BRAND_REVIEW_FIELDS,
    });
    expect(out.websiteText).toBe("kept");
  });

  /**
   * The strongest form of the claim, available only once a baseline is recorded
   * against the repaired code: the decoder inputs a REAL monolith run produced,
   * reproduced from that same run's banked evidence. Skipped — visibly — on a
   * fixture that predates the field, rather than passing on nothing.
   */
  it.skipIf(!bl?.decoderInputs)(
    "BYTE-IDENTICAL against the decoder inputs a real run recorded",
    () => {
      const recorded = bl!.decoderInputs!;
      expect(brandDecoderInputsFrom(bankedAugment({
        combinedReviewText: recorded.reviewText,
      }) as never).websiteText).toBe(recorded.websiteText);
      expect(brandDecoderInputsFrom(bankedAugment({
        combinedReviewText: recorded.reviewText,
      }) as never).reviewText).toBe(recorded.reviewText);
    },
  );
});
