import { writeFileSync } from "node:fs";

/**
 * THE ONE PLACE BRAND EVIDENCE IS ASSEMBLED (S5, Part 1).
 *
 * ─── Why this file exists before any brand tool does ────────────────────────
 * Brand evidence is currently concatenated in TWO places: `researchBrand`
 * appends the decoded-symbols and audience-mention blocks to its own summary,
 * and the router then appends the TikTok and Instagram blocks to that. Moving
 * `decodeBrandSymbols` into a derive phase means that concatenation happens in
 * a different order in a different file — which is exactly how a byte-identical
 * string stops being byte-identical.
 *
 * So the assembly is lifted here FIRST, unchanged, and both the monolith and
 * the phased path call it. The harness then proves this function reproduces a
 * recorded real run byte-for-byte. Nothing about the string changes; only where
 * it is built.
 *
 * ─── The order is the contract ──────────────────────────────────────────────
 *   base                                    (researchBrand's own summary)
 *   + "\n\n" + brand decoded symbols        (an LLM call — the derive split)
 *   + "\n\n" + audience mentions
 *   + "\n\n" + brand TikTok channel
 *   + "\n\n" + brand Instagram
 *
 * Each block is omitted entirely when its source produced nothing — an absent
 * block contributes NO separator, which is why this cannot be expressed as a
 * join. That asymmetry is the whole reason the seam is worth having.
 */

/**
 * The inputs the BASE block is built from.
 *
 * Recorded as well as the finished string, because a brand capture phase has to
 * REBUILD this base rather than receive it — and a harness that only pins the
 * finished string cannot tell a faithful rebuild from a lucky one.
 */
export interface BrandBaseEvidenceInputs {
  brandName: string;
  websiteUrl: string | null;
  description: string;
  snippets: string[];
  audiencePerceptionBlock: string | null;
}

/**
 * The BASE evidence block, verbatim.
 *
 * Lifted unchanged out of `researchBrand` so the monolith and any phased path
 * build it from one place. Every element, its order, the `.filter(Boolean)` and
 * the final `.trim()` are load-bearing: an empty element contributes NO line,
 * which is the same absent-block asymmetry the outer assembly has, and the
 * INSTRUCTIONS text is frozen prompt content.
 */
export function buildBrandBaseEvidence(i: BrandBaseEvidenceInputs): string {
  return [
    "BRAND RESEARCH EVIDENCE",
    "=======================",
    `Brand Name: ${i.brandName}`,
    `Website: ${i.websiteUrl ?? "Not provided"}`,
    i.description ? `Website Content:\n${i.description}` : "",
    i.snippets.length > 0 ? `\nKey Snippets:\n${i.snippets.slice(0, 8).join("\n")}` : "",
    i.audiencePerceptionBlock ? `\n\n${i.audiencePerceptionBlock}` : "",
    "",
    "INSTRUCTIONS FOR ANALYSIS:",
    "Based on the above evidence, extract the brand's cultural profile. If the website content is limited,",
    "use your knowledge of this brand/business name to supplement, but clearly ground your analysis in",
    "what the evidence shows. Do NOT invent a brand identity that contradicts the evidence.",
    "Pay special attention to the AUDIENCE PERCEPTION section — review language reveals how customers",
    "actually decode the brand, which may differ from the brand's self-presentation.",
  ].filter(Boolean).join("\n").trim();
}

// ─── The symbol decoder's inputs ─────────────────────────────────────────────

/**
 * THE OTHER THING THAT MUST BE BYTE-IDENTICAL, and was not.
 *
 * `assembleBrandEvidence` pins the string the EXTRACTION model reads. The symbol
 * decoder reads a different pair of strings entirely, built earlier from the same
 * raw material — and when `decodeBrandSymbols` moved into a derive phase (S5 step
 * 3) those two strings were rebuilt from a narrower slice of the banked evidence:
 * the description without its snippets, and the FORMATTED perception block in
 * place of the raw review text. Different decoder inputs mean different symbols,
 * a different symbols block, and so a different extraction prompt — a change to
 * WHAT is gathered, wearing the clothes of a refactor.
 *
 * The evidence harness could not see it: it replays RECORDED parts through the
 * assembly and never runs the decoder, so the inputs that produced those parts
 * were outside its reach. So the construction is lifted here, both the monolith
 * and the phase call it, and the harness pins it directly.
 *
 * ─── Details that are load-bearing ──────────────────────────────────────────
 *  - The length probe joins with a SPACE; the emitted corpus joins with a
 *    NEWLINE. Equal lengths, different strings — transcribed as the monolith
 *    wrote them rather than unified.
 *  - `.filter(Boolean)` runs BEFORE the rescue, so an empty description or a
 *    blank snippet contributes nothing to the 150-char probe.
 *  - The rescue appends Yelp BEFORE Google Maps, each capped at 800 chars.
 *  - `reviewText` is the RAW combined review text — never the formatted
 *    perception block, which is what the phased split substituted.
 */
export interface BrandDecoderInputSources {
  /** The RESCUED description — capture's, widened by augment's fallbacks. */
  description: string;
  /** The EXTENDED snippets, in order. Dropping these was the S5 step 3 defect. */
  snippets: string[];
  /** `[5★] Author: "…"` lines, or "" when there is no Yelp source. */
  yelpReviewExcerpts: string;
  /** Same, for Google Maps. */
  googleReviewExcerpts: string;
  /** Every review's text concatenated — `fetchBrandReviews`'s own field. */
  combinedReviewText: string;
}

/** Exactly the two strings `deriveBrandSymbols` receives. */
export interface BrandDecoderInputs {
  websiteText: string;
  reviewText: string;
}

/**
 * Build the symbol decoder's two inputs, VERBATIM from `researchBrand`.
 *
 * The rescue exists because a Cloudflare-blocked fetch leaves almost no brand
 * text: rather than decode nothing, the reviews stand in as the brand corpus.
 * That is a deliberate behaviour, not an accident of the old code, and it was
 * lost in the phased split along with the snippets.
 */
export function buildBrandDecoderInputs(i: BrandDecoderInputSources): BrandDecoderInputs {
  const websiteTextParts = [
    i.description,
    ...i.snippets,
  ].filter(Boolean);

  // If direct website fetch yielded very little text (<150 chars), supplement with review excerpts in the website corpus
  // so the decoder has enough signal to work with
  const directWebTextLength = websiteTextParts.join(" ").length;
  if (directWebTextLength < 150) {
    // Add Yelp and Google snippets as supplementary brand text
    if (i.yelpReviewExcerpts) websiteTextParts.push(`Yelp customer reviews: ${i.yelpReviewExcerpts.slice(0, 800)}`);
    if (i.googleReviewExcerpts) websiteTextParts.push(`Google Maps customer reviews: ${i.googleReviewExcerpts.slice(0, 800)}`);
    console.log(`[webResearch] Direct web text too short (${directWebTextLength} chars) — using review text as website corpus fallback for Symbol Decoder`);
  }

  return {
    websiteText: websiteTextParts.join("\n"),
    reviewText: i.combinedReviewText,
  };
}

// ─── Data confidence ─────────────────────────────────────────────────────────

/**
 * A brand's data-confidence level, VERBATIM from `researchBrand`.
 *
 * Lifted for the same reason `selectBrandReviewFields` was: it is now read by
 * both the monolith and the phased persistence path, and a second copy of a
 * bucketing rule is how one path starts recording "medium" where the other
 * records "high". P1-4's review boost is part of the rule, not a decoration —
 * reviews are genuine audience evidence and the thresholds were set with them
 * counted.
 */
export function brandDataConfidence(
  semanticWordCount: number,
  totalReviews: number,
): "high" | "medium" | "low" {
  const reviewEvidenceBoost = totalReviews >= 30 ? 1000 :
    totalReviews >= 10 ? 500 : 0;
  const evidenceScore = semanticWordCount + reviewEvidenceBoost;
  return evidenceScore >= 2000 ? "high" :
    evidenceScore >= 500 ? "medium" :
      "low";
}

/** The already-formatted blocks, in assembly order. Absent = omit entirely. */
export interface BrandEvidenceParts {
  /** `researchBrand`'s summary BEFORE symbols and mentions were appended. */
  base: string;
  /** `formatBrandDecodedSymbolsBlock(...)` output, unprefixed. */
  decodedSymbolsBlock?: string | null;
  /** `formatAudienceMentionEvidenceBlock(...)` output, unprefixed. */
  mentionEvidenceBlock?: string | null;
  /** `formatBrandTikTokEvidenceBlock(...)` output, unprefixed. */
  tiktokBlock?: string | null;
  /** The Instagram evidence block, unprefixed. */
  instagramBlock?: string | null;
}

/**
 * Assemble the exact string handed to `extractBrandProfile`.
 *
 * VERBATIM in behaviour: `researchBrand` prefixed its two blocks with "\n\n"
 * inside the block expression, and the router prefixed its two with "\n\n" at
 * the concatenation. Both collapse to the same rule — a present block is joined
 * by exactly one blank line — so it is written once here.
 */
export function assembleBrandEvidence(parts: BrandEvidenceParts): string {
  let out = parts.base;
  for (const block of [
    parts.decodedSymbolsBlock,
    parts.mentionEvidenceBlock,
    parts.tiktokBlock,
    parts.instagramBlock,
  ]) {
    if (block) out += `\n\n${block}`;
  }
  return out;
}

/**
 * What a brand monolith baseline records — the mirror of MonolithBaseline for
 * creators. Inputs plus the string the monolith actually produced from them, so
 * the harness proves reassembly rather than re-deriving.
 */
export interface BrandMonolithBaseline {
  brand: string;
  parts: BrandEvidenceParts;
  /** What the base block was built FROM — see BrandBaseEvidenceInputs. */
  baseInputs?: BrandBaseEvidenceInputs;
  /**
   * The two strings the SYMBOL DECODER received. Optional because fixtures
   * recorded before this field existed do not carry it — the harness says so
   * out loud rather than skipping quietly.
   */
  decoderInputs?: BrandDecoderInputs;
  /** The exact `brandEvidenceSummary` the monolith handed the model. */
  expectedEvidenceSummary: string;
  /** Coarse shape of the run, so a vacuous fixture can be refused by the harness. */
  observed: {
    semanticWordCount: number;
    totalReviews: number;
    totalMentions: number;
    hasTikTokChannel: boolean;
    hasInstagram: boolean;
  };
}

/**
 * Env-gated baseline dump (`WOMO_BRAND_BASELINE=<path>`), the brand mirror of
 * `maybeDumpMonolithBaseline`.
 *
 * Brand has no frozen pre-seam copy to compare against — the monolith IS the
 * reference, and moving it onto the phase spine is what removes that reference
 * from the live path. So a real run records its parts AND the string it
 * produced, and the harness proves reassembly reproduces the string exactly.
 *
 * Inert unless the env var is set; failures swallowed. A debug hook must never
 * be able to fail a real analysis.
 */
export function maybeDumpBrandBaseline(baseline: BrandMonolithBaseline): void {
  const target = process.env.WOMO_BRAND_BASELINE;
  if (!target) return;
  try {
    writeFileSync(target, JSON.stringify(baseline, null, 2), "utf-8");
    console.log(`[brandEvidence] brand baseline written: ${target}`);
  } catch (err) {
    console.warn("[brandEvidence] baseline dump failed (ignored):", err);
  }
}
