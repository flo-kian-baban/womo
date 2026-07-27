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
