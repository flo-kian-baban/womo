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
import { assembleBrandEvidence, buildBrandBaseEvidence, type BrandMonolithBaseline } from "./phases/brandEvidence";
import { assembleBrandCollection } from "./phases/brandPhases";

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
