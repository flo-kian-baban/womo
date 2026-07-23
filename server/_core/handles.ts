/**
 * Handle canonicalization (Session 7 — duplicate pre-flight).
 *
 * The persisted subject key and the duplicate-pre-flight lookup must share ONE
 * canonical form. Historically the persisted handle was the LLM's echo of the
 * user's raw input (arbitrary casing, sometimes a URL or "@handle"), and the
 * lookup was exact-case — a latent duplicate-subject vector.
 *
 * Canonical form: handle extracted from URL/@-prefix, trimmed, lowercased.
 * TikTok uniqueIds, Instagram usernames, and YouTube handles are all
 * case-insensitive identifiers, so lowercasing loses nothing.
 *
 * NOTE: webResearch.ts keeps its own case-preserving extractHandle for
 * scraping/display purposes — this module governs persistence and lookup only.
 */

export function canonicalizeHandle(handleOrUrl: string): string {
  const trimmed = (handleOrUrl ?? "").trim().replace(/\/+$/, "");
  const urlMatch = trimmed.match(/(?:tiktok\.com\/@?|youtube\.com\/(?:@|channel\/|user\/)|instagram\.com\/)([^/?#\s]+)/i);
  const raw = urlMatch ? urlMatch[1] : trimmed;
  return raw.replace(/^@/, "").trim().toLowerCase();
}
