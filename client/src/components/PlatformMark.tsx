/**
 * Platform identity in ONE place.
 *
 * The queue view used to render a TikTok glyph next to every campaign whatever
 * its platform, which was wrong the moment Instagram shipped. Anything that
 * displays a platform reads it from the DATA and resolves it here.
 *
 * Adding a platform is one entry. Nothing else in the campaign surface knows
 * platform names — that is the point.
 */

export const SUPPORTED_PLATFORMS = ["TikTok", "Instagram"] as const;
export type SupportedPlatform = (typeof SUPPORTED_PLATFORMS)[number];

/** Platform names arrive from the ledger as free text; normalise before lookup. */
function key(platform: string): string {
  return platform.trim().toLowerCase();
}

const ACCENT: Record<string, string> = {
  tiktok: "text-cyan-400",
  instagram: "text-pink-400",
  // Kept so historical rows still render with their own colour rather than
  // falling through to a neutral glyph. YouTube is disabled, not erased.
  youtube: "text-red-400",
  // NOT a platform — a different KIND of subject, which the queue view now
  // carries alongside creators (S5). It gets its own mark because the fallback
  // below means "unknown", and a brand is not unknown.
  brand: "text-amber-400",
};

const LABEL: Record<string, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  youtube: "YouTube",
  brand: "Brand",
};

export function platformLabel(platform: string): string {
  return LABEL[key(platform)] ?? platform;
}

/**
 * The hostnames each platform is reachable at — the ONE place a platform's
 * domains are named.
 *
 * It lives here, beside the glyph and the label, because this file is where
 * platform identity is defined and where "adding a platform is one entry" has
 * to stay true. `normalizeHandle` deliberately stays domain-blind: it reduces
 * any URL to its last path segment for every platform alike, and teaching it
 * about domains would put the same knowledge in two places.
 *
 * Only SUPPORTED platforms appear. A YouTube link resolves to null rather than
 * to a platform the queue would refuse — the disabled list is not this map's
 * business, and inventing an entry for it would let a dead platform be selected.
 */
const DOMAINS: Record<SupportedPlatform, readonly string[]> = {
  TikTok: ["tiktok.com"],
  Instagram: ["instagram.com", "instagr.am"],
};

/**
 * Which platform does this link belong to? `null` when it is not a link, or
 * not one we recognise.
 *
 * NULL IS THE HONEST ANSWER, and the caller must treat it as "no information"
 * rather than as a default. A bare handle is genuinely ambiguous — @nasa exists
 * on both platforms — so guessing from anything but a hostname would be
 * fabricating a choice the analyst did not make.
 */
export function detectPlatform(input: string): SupportedPlatform | null {
  const s = input.trim();
  if (!s) return null;
  let host: string;
  try {
    // Accept a bare "tiktok.com/@user" as readily as a full https:// URL.
    host = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`).hostname.toLowerCase();
  } catch {
    return null;
  }
  for (const [platform, domains] of Object.entries(DOMAINS) as Array<[SupportedPlatform, readonly string[]]>) {
    // endsWith, so www. / m. / vm. subdomains resolve to the same platform.
    if (domains.some(d => host === d || host.endsWith(`.${d}`))) return platform;
  }
  return null;
}

export function PlatformMark({
  platform,
  className = "w-3.5 h-3.5",
  muted = false,
}: {
  platform: string;
  className?: string;
  muted?: boolean;
}) {
  const p = key(platform);
  const tone = muted ? "text-muted-foreground" : (ACCENT[p] ?? "text-muted-foreground");
  const title = platformLabel(platform);

  if (p === "tiktok") {
    return (
      <svg className={`${className} ${tone}`} viewBox="0 0 24 24" fill="currentColor" aria-label={title}>
        <title>{title}</title>
        <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.27 6.27 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.75a8.18 8.18 0 004.77 1.52V6.84a4.84 4.84 0 01-1-.15z" />
      </svg>
    );
  }
  if (p === "instagram") {
    return (
      <svg className={`${className} ${tone}`} viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label={title}>
        <title>{title}</title>
        <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
        <circle cx="12" cy="12" r="5" />
        <circle cx="17.5" cy="6.5" r="1.5" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  if (p === "youtube") {
    return (
      <svg className={`${className} ${tone}`} viewBox="0 0 24 24" fill="currentColor" aria-label={title}>
        <title>{title}</title>
        <path d="M23.5 6.19a3.02 3.02 0 00-2.12-2.14C19.54 3.5 12 3.5 12 3.5s-7.54 0-9.38.55A3.02 3.02 0 00.5 6.19 31.6 31.6 0 000 12a31.6 31.6 0 00.5 5.81 3.02 3.02 0 002.12 2.14c1.84.55 9.38.55 9.38.55s7.54 0 9.38-.55a3.02 3.02 0 002.12-2.14A31.6 31.6 0 0024 12a31.6 31.6 0 00-.5-5.81zM9.55 15.57V8.43L15.82 12l-6.27 3.57z" />
      </svg>
    );
  }
  if (p === "brand") {
    // A storefront, deliberately unlike the three platform glyphs — a brand sits
    // beside them in the queue but is not one of them.
    return (
      <svg className={`${className} ${tone}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
           strokeLinecap="round" strokeLinejoin="round" aria-label={title}>
        <title>{title}</title>
        <path d="M3 9l1.5-5h15L21 9" />
        <path d="M4 9v11h16V9" />
        <path d="M9 20v-6h6v6" />
      </svg>
    );
  }
  // An unknown platform is shown as unknown, not as a default platform.
  return (
    <span className={`${className} ${tone} inline-flex items-center justify-center text-[9px] font-semibold`} title={title}>
      ?
    </span>
  );
}
