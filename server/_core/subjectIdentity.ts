/**
 * WHAT A CAMPAIGN IS ABOUT — encoded once, parsed once (S5, sixth extension).
 *
 * The ledger keys a campaign by a single `subject_hint` string, which has always
 * been `handle@platform`. That works while every subject is one handle. A brand
 * is not: it carries a name-or-url plus up to three optional locators (a Google
 * Maps url, a TikTok channel, an Instagram handle), none of which fit in a
 * handle.
 *
 * ─── The invariant this module exists to hold ───────────────────────────────
 * A subject with NO extras encodes to EXACTLY `handle@platform`, byte for byte,
 * as it always has. Every TikTok and Instagram campaign — every row already in
 * the ledger, and every one written from now on — keys identically before and
 * after this change. Extras are a SUFFIX that simply does not exist for them.
 *
 * That matters because the evidence harnesses cannot catch a regression here:
 * subject identity is not evidence. If the encoding shifted, in-flight
 * campaigns would silently fail to resume and the boot loop would look at rows
 * it could no longer parse. So it is asserted directly instead.
 *
 * ─── Why a suffix rather than JSON throughout ───────────────────────────────
 * Re-encoding everything as JSON would be cleaner on a blank page and would
 * break every existing row. The suffix is chosen so the common case is
 * unchanged and the new case is unambiguous: `::` cannot appear in a platform
 * name, and a handle containing it would already have broken `split("@")`.
 */

/** The separator between `handle@platform` and the encoded extras. */
const EXTRAS_SEP = "::";

export interface SubjectIdentity {
  handle: string;
  platform: string;
  /**
   * Subject-specific locators the platform's own capture tool understands.
   * Absent for every single-handle subject — see the invariant above.
   */
  extras?: Record<string, string>;
}

/**
 * ─── A MATCH IS A PAIR, NOT A SUBJECT (S6) ──────────────────────────────────
 * A match campaign occupies the handle slot with `{creatorObsId}+{brandObsId}`
 * and the platform slot with `MATCH_PSEUDO_PLATFORM`. Encoded that way it needs
 * NO change to `encodeSubject` or `decodeSubject`: it is a handle containing no
 * "@" and no "::", so the existing last-"@" split reads it correctly and the
 * byte-identical invariant above is untouched.
 *
 * `+` is the pair separator because a UUID is hex and hyphens only, so it can
 * never appear inside either id. Two uuids plus the separator and platform is
 * 79 characters, well inside the ledger's varchar(160) — which matters, since
 * 21 live rows already sit exactly at that ceiling (womo_0013).
 *
 * KEYED ON OBSERVATION IDS, not subject ids, deliberately: re-analysing either
 * side yields a different pair identity and therefore a NEW campaign, rather
 * than resuming into a score computed from evidence that no longer exists.
 */
const MATCH_PAIR_SEP = "+";

export function encodeMatchPair(creatorObservationId: string, brandObservationId: string): string {
  return `${creatorObservationId}${MATCH_PAIR_SEP}${brandObservationId}`;
}

/**
 * The inverse. Returns null when the handle is not a well-formed pair — the
 * caller refuses the campaign rather than guessing, in the same spirit as
 * `decodeSubject`'s tolerant degradation.
 */
export function decodeMatchPair(
  handle: string | null | undefined,
): { creatorObservationId: string; brandObservationId: string } | null {
  const raw = handle ?? "";
  const at = raw.indexOf(MATCH_PAIR_SEP);
  if (at <= 0 || at === raw.length - 1) return null;
  const creatorObservationId = raw.slice(0, at);
  const brandObservationId = raw.slice(at + 1);
  if (!creatorObservationId || !brandObservationId) return null;
  if (brandObservationId.includes(MATCH_PAIR_SEP)) return null;
  return { creatorObservationId, brandObservationId };
}

/**
 * `SubjectIdentity` → the ledger's `subject_hint`.
 *
 * With no extras this is `${handle}@${platform}` and nothing else. An empty
 * extras object is treated as no extras, so a caller that always passes `{}`
 * cannot accidentally change the encoding of every campaign.
 */
export function encodeSubject(subject: SubjectIdentity): string {
  const base = `${subject.handle}@${subject.platform}`;
  const extras = subject.extras;
  if (!extras) return base;
  const entries = Object.entries(extras).filter(([, v]) => v !== undefined && v !== null && v !== "");
  if (entries.length === 0) return base;
  // Sorted, so the same subject always encodes to the same string regardless of
  // the order the caller happened to build the object in.
  entries.sort(([a], [b]) => a.localeCompare(b));
  const payload = encodeURIComponent(JSON.stringify(Object.fromEntries(entries)));
  return `${base}${EXTRAS_SEP}${payload}`;
}

/**
 * The ledger's `subject_hint` → `SubjectIdentity`.
 *
 * Tolerant by design: this reads rows written by older code, and a campaign
 * that cannot be parsed must degrade to something the queue can still refuse
 * cleanly rather than throw inside the boot loop.
 */
export function decodeSubject(hint: string | null | undefined): SubjectIdentity {
  const raw = hint ?? "";
  const sepAt = raw.indexOf(EXTRAS_SEP);
  const base = sepAt >= 0 ? raw.slice(0, sepAt) : raw;
  const encoded = sepAt >= 0 ? raw.slice(sepAt + EXTRAS_SEP.length) : "";

  // Split on the LAST "@": a handle may legitimately contain one, a platform
  // name never does.
  const at = base.lastIndexOf("@");
  const handle = at >= 0 ? base.slice(0, at) : base;
  const platform = at >= 0 ? base.slice(at + 1) : "";

  if (!encoded) return { handle, platform };
  try {
    const parsed = JSON.parse(decodeURIComponent(encoded)) as Record<string, string>;
    return { handle, platform, extras: parsed };
  } catch {
    // A corrupt suffix must not make the campaign unreadable — the platform is
    // what the queue needs to decide whether it can run at all.
    return { handle, platform };
  }
}
