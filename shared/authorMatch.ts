/**
 * Author verification for creator video pools (Session 10 — Commit 1).
 *
 * The cross-run audit found other creators' videos in a creator's pool. Three
 * compounding fail-opens let it happen:
 *   1. an over-broad XHR match captured TikTok's recommended/trending feeds;
 *   2. the API collection path applied NO author check at all;
 *   3. the search-path guard used `normalizedHandle.includes(authorNorm)`, which
 *      is TRUE when the author is empty ("x".includes("") === true), plus an
 *      `authorId !== ""` escape — so a missing author was ACCEPTED.
 *
 * This is the ONE shared author check every collection path must use before a
 * video enters a creator's pool. It FAILS CLOSED: an item whose author cannot be
 * verified as the target creator (missing, empty, or different) is REJECTED.
 *
 * Match rule: exact equality after aggressive normalization (lowercase; strip a
 * leading @, and remove dots/underscores/hyphens/whitespace). Normalization
 * collapses the handle variants TikTok uses (e.g. "kaylee.nhi" == "kayleenhi"),
 * so exact-after-normalize is both permissive to real variants and strict
 * against foreign creators — unlike the old loose `.includes()`, which matched
 * any substring (and every handle against an empty author).
 */

/** Lowercase, strip a leading @, and remove dots/underscores/hyphens/whitespace. */
export function normalizeCreatorHandle(h: string | null | undefined): string {
  return (h ?? "").toLowerCase().trim().replace(/^@+/, "").replace(/[._\-\s]/g, "");
}

/**
 * True only when `itemAuthorHandle` is verifiably the same creator as
 * `targetHandle`. FAILS CLOSED: empty/missing author (or target) → false.
 */
export function isAuthorMatch(
  targetHandle: string | null | undefined,
  itemAuthorHandle: string | null | undefined,
): boolean {
  const target = normalizeCreatorHandle(targetHandle);
  const author = normalizeCreatorHandle(itemAuthorHandle);
  if (!target || !author) return false; // fail closed — never accept the unverifiable
  return target === author;
}
