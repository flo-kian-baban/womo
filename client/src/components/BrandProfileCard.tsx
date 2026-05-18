import { useState } from "react";
import type { BrandProfile } from "../../../drizzle/schema";

interface BrandProfileCardProps {
  profile: BrandProfile;
  compact?: boolean;
}

const BRAND_FIELDS = [
  { key: "archetype", label: "Archetype [Jung]", type: "badge" },
  { key: "emotionalPromise", label: "Emotional Promise", type: "quote" },
  { key: "visualLanguage", label: "Visual Language", type: "tags" },
  { key: "audienceTribe", label: "Audience Tribe", type: "text" },
  { key: "culturalTension", label: "Cultural Tension", type: "quote" },
  { key: "barthesMyth", label: "Myth Question [Barthes]", type: "quote" },
];

const WEIGHT_FIELDS = [
  { key: "brandType", label: "Brand Type", type: "text" },
  { key: "campaignType", label: "Campaign Type", type: "badge" },
  { key: "weightAlpha", label: "α — Alignment Weight", type: "weight" },
  { key: "weightBeta", label: "β — Pulse Weight", type: "weight" },
  { key: "weightGamma", label: "γ — Stability Weight", type: "weight" },
  { key: "weightPriority", label: "Weight Priority", type: "text" },
];

const BRAND_ARCHETYPE_META: Record<string, { color: string; icon: string; description: string; signature: string }> = {
  Trust: {
    color: "text-blue-400 border-blue-400/30 bg-blue-400/10",
    icon: "⚔️",
    description: "Built on credibility, safety, and reliability. The consumer must believe before they act.",
    signature: "α=0.5 dominant · γ elevated · β suppressed",
  },
  Community: {
    color: "text-emerald-400 border-emerald-400/30 bg-emerald-400/10",
    icon: "🤝",
    description: "Built on belonging, identity, and shared values. The consumer identifies with the brand.",
    signature: "α=0.4–0.5 dominant · γ=0.3 · β moderate",
  },
  Momentum: {
    color: "text-orange-400 border-orange-400/30 bg-orange-400/10",
    icon: "⚡",
    description: "Built on energy, relevance, and cultural presence. The consumer wants what is exciting right now.",
    signature: "β=0.4–0.6 dominant · α secondary · γ suppressed",
  },
};

function FieldValue({ value, type }: { value: unknown; type: string }) {
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground/40 text-sm italic">—</span>;
  }

  if (type === "badge") {
    return (
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border border-primary/30 bg-primary/10 text-primary">
        {String(value)}
      </span>
    );
  }

  if (type === "tags") {
    const tags = Array.isArray(value) ? value : [];
    return (
      <div className="flex flex-wrap gap-1.5">
        {tags.map((tag: string, i: number) => (
          <span key={i} className="inline-flex items-center px-2 py-0.5 rounded-md text-xs border border-border bg-secondary text-muted-foreground">
            {tag}
          </span>
        ))}
      </div>
    );
  }

  if (type === "quote") {
    return (
      <blockquote className="border-l-2 border-primary/40 pl-3 text-sm text-muted-foreground italic leading-relaxed">
        {String(value)}
      </blockquote>
    );
  }

  if (type === "weight") {
    const w = Number(value);
    return (
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1.5 rounded-full bg-border overflow-hidden max-w-24">
          <div
            className="h-full rounded-full gold-gradient"
            style={{ width: `${w * 100}%` }}
          />
        </div>
        <span className="text-sm font-mono text-primary">{w.toFixed(1)}</span>
      </div>
    );
  }

  return <span className="text-sm text-foreground">{String(value)}</span>;
}

/** Render a star rating as filled/empty dots */
function StarRating({ rating, max = 5 }: { rating: number; max?: number }) {
  const full = Math.round(rating);
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${rating} out of ${max}`}>
      {Array.from({ length: max }, (_, i) => (
        <span
          key={i}
          className={`text-xs ${i < full ? "text-amber-400" : "text-muted-foreground/30"}`}
        >
          ★
        </span>
      ))}
      <span className="ml-1 text-xs font-mono text-foreground/70">{rating.toFixed(1)}</span>
    </span>
  );
}

/** Parse review excerpts string back into individual entries */
function parseReviewExcerpts(raw: string | null | undefined): Array<{ rating: number; author: string; text: string }> {
  if (!raw) return [];
  return raw.split("\n\n").slice(0, 5).map(block => {
    const ratingMatch = block.match(/^\[(\d+)★\]/);
    const authorMatch = block.match(/^\[\d+★\] ([^:]+):/);
    const textMatch = block.match(/"([\s\S]+)"$/);
    return {
      rating: ratingMatch ? parseInt(ratingMatch[1]) : 0,
      author: authorMatch ? authorMatch[1].trim() : "Reviewer",
      text: textMatch ? textMatch[1] : block.replace(/^\[.*?\].*?:/, "").replace(/^"|"$/g, "").trim(),
    };
  }).filter(r => r.text.length > 10);
}

/** Audience Perception panel showing Yelp + Google Maps review data */
function AudiencePerceptionPanel({ profile }: { profile: BrandProfile }) {
  const [expanded, setExpanded] = useState(false);

  const hasYelp = profile.yelpRating !== null && profile.yelpRating !== undefined;
  const hasGoogle = profile.googleRating !== null && profile.googleRating !== undefined;

  if (!hasYelp && !hasGoogle) return null;

  const yelpReviews = parseReviewExcerpts(profile.yelpReviewExcerpts);
  const googleReviews = parseReviewExcerpts(profile.googleReviewExcerpts);
  const allReviews = [...yelpReviews, ...googleReviews];
  const totalReviews = (profile.totalReviews ?? 0);
  const overallRating = profile.overallRating;

  return (
    <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-amber-500/10 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 rounded-md bg-amber-500/20 flex items-center justify-center flex-shrink-0">
            <span className="text-amber-400 text-xs">★</span>
          </div>
          <div>
            <div className="text-xs font-semibold tracking-[0.1em] uppercase text-amber-400/80">
              Audience Perception
            </div>
            <div className="text-xs text-muted-foreground/60 mt-0.5">
              {totalReviews > 0 ? `${totalReviews.toLocaleString()} reviews` : "Review data"} ·{" "}
              {hasYelp && hasGoogle ? "Yelp + Google Maps" : hasYelp ? "Yelp" : "Google Maps"}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {overallRating !== null && overallRating !== undefined && (
            <StarRating rating={overallRating} />
          )}
          <span className="text-muted-foreground/40 text-xs">{expanded ? "▲" : "▼"}</span>
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-amber-500/10">
          {/* Platform ratings */}
          <div className="grid grid-cols-2 gap-3 pt-3">
            {hasYelp && (
              <div className="p-3 rounded-lg bg-background/50 border border-border/50">
                <div className="text-[10px] font-semibold tracking-[0.1em] uppercase text-muted-foreground mb-1.5">
                  Yelp
                </div>
                <StarRating rating={profile.yelpRating!} />
                {profile.yelpReviewCount && (
                  <div className="text-xs text-muted-foreground/60 mt-1">
                    {profile.yelpReviewCount.toLocaleString()} reviews
                  </div>
                )}
              </div>
            )}
            {hasGoogle && (
              <div className="p-3 rounded-lg bg-background/50 border border-border/50">
                <div className="text-[10px] font-semibold tracking-[0.1em] uppercase text-muted-foreground mb-1.5">
                  Google Maps
                </div>
                <StarRating rating={profile.googleRating!} />
                {profile.googleReviewCount && (
                  <div className="text-xs text-muted-foreground/60 mt-1">
                    {profile.googleReviewCount.toLocaleString()} reviews
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Review excerpts */}
          {allReviews.length > 0 && (
            <div className="space-y-2">
              <div className="text-[10px] font-semibold tracking-[0.1em] uppercase text-muted-foreground">
                What Customers Say
              </div>
              {allReviews.slice(0, 5).map((review, i) => (
                <div key={i} className="p-3 rounded-lg bg-background/40 border border-border/30">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-xs font-medium text-foreground/70">{review.author}</span>
                    {review.rating > 0 && (
                      <span className="text-xs text-amber-400">{"★".repeat(review.rating)}</span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed italic">
                    "{review.text.slice(0, 280)}{review.text.length > 280 ? "…" : ""}"
                  </p>
                </div>
              ))}
            </div>
          )}

          {/* Sociological note */}
          <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/15">
            <div className="text-[10px] font-semibold tracking-[0.1em] uppercase text-amber-400/70 mb-1">
              Stuart Hall Decoding Note
            </div>
            <p className="text-xs text-muted-foreground/70 leading-relaxed">
              Review language represents how the audience <em>actually decodes</em> this brand —
              distinct from the brand's self-presentation. Patterns in this data directly inform
              the Barthes Myth, Audience Tribe, and Goffman Stage Gap fields above.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Brand Symbol Decoder Panel ─────────────────────────────────────────────

interface DecodedSignal {
  phrase: string;
  meaning: string;
  informs: string[];
  source: "brand" | "audience";
}

interface BrandDecodedSymbolsData {
  identityClaims: DecodedSignal[];
  statusSignals: DecodedSignal[];
  communityReferences: DecodedSignal[];
  aspirationDrivers: DecodedSignal[];
  audienceLanguage: DecodedSignal[];
  rawKeywords: string[];
  themeLabels: string[];
  symbolicVocabulary: string[];
  symbolicSummary: string;
}

function SignalGroup({ signals, label, color }: { signals: DecodedSignal[]; label: string; color: string }) {
  if (!signals || signals.length === 0) return null;
  return (
    <div>
      <div className={`text-[10px] font-semibold tracking-[0.1em] uppercase mb-2 ${color}`}>{label}</div>
      <div className="space-y-2">
        {signals.map((s, i) => (
          <div key={i} className="p-2.5 rounded-lg bg-background/40 border border-border/30">
            <div className="flex items-start gap-2 mb-1">
              <span className="text-xs font-mono text-foreground/80 leading-snug flex-1">“{s.phrase}”</span>
              <span className={`text-[9px] px-1.5 py-0.5 rounded border flex-shrink-0 ${
                s.source === "audience"
                  ? "border-amber-400/30 bg-amber-400/10 text-amber-400/80"
                  : "border-border/40 bg-secondary text-muted-foreground/60"
              }`}>{s.source}</span>
            </div>
            <p className="text-xs text-muted-foreground/70 leading-relaxed">{s.meaning}</p>
            {s.informs.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {s.informs.map((f, j) => (
                  <span key={j} className="text-[9px] px-1.5 py-0.5 rounded bg-primary/10 text-primary/70 border border-primary/20">
                    {f}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function BrandSymbolDecoderPanel({ profile }: { profile: BrandProfile }) {
  const [expanded, setExpanded] = useState(false);

  const decoded = profile.brandDecodedSymbols as BrandDecodedSymbolsData | null;
  const keywords = (profile.brandRawKeywords as string[] | null) ?? [];
  const themes = (profile.brandThemeLabels as string[] | null) ?? [];
  const vocab = (profile.brandSymbolicVocabulary as string[] | null) ?? [];

  const hasData = decoded || keywords.length > 0 || themes.length > 0;
  if (!hasData) return null;

  const totalSignals = decoded
    ? (decoded.identityClaims?.length ?? 0) +
      (decoded.statusSignals?.length ?? 0) +
      (decoded.communityReferences?.length ?? 0) +
      (decoded.aspirationDrivers?.length ?? 0) +
      (decoded.audienceLanguage?.length ?? 0)
    : 0;

  return (
    <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-violet-500/10 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 rounded-md bg-violet-500/20 flex items-center justify-center flex-shrink-0">
            <span className="text-violet-400 text-xs">◆</span>
          </div>
          <div>
            <div className="text-xs font-semibold tracking-[0.1em] uppercase text-violet-400/80">
              Brand Symbol Decoder
            </div>
            <div className="text-xs text-muted-foreground/60 mt-0.5">
              {themes.length > 0 ? themes.join(" · ") : `${totalSignals} cultural signals decoded`}
            </div>
          </div>
        </div>
        <span className="text-muted-foreground/40 text-xs">{expanded ? "▲" : "▼"}</span>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-5 border-t border-violet-500/10">

          {/* Symbolic Summary */}
          {decoded?.symbolicSummary && (
            <div className="pt-3">
              <div className="text-[10px] font-semibold tracking-[0.1em] uppercase text-violet-400/70 mb-1.5">
                Symbolic Summary
              </div>
              <blockquote className="border-l-2 border-violet-400/40 pl-3 text-sm text-foreground/80 italic leading-relaxed">
                {decoded.symbolicSummary}
              </blockquote>
            </div>
          )}

          {/* Theme Labels */}
          {themes.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold tracking-[0.1em] uppercase text-violet-400/70 mb-2">
                Cultural Themes
              </div>
              <div className="flex flex-wrap gap-2">
                {themes.map((t, i) => (
                  <span key={i} className="px-2.5 py-1 rounded-full text-xs font-medium border border-violet-400/30 bg-violet-400/10 text-violet-300">
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Symbolic Vocabulary */}
          {vocab.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold tracking-[0.1em] uppercase text-violet-400/70 mb-2">
                Symbolic Vocabulary
              </div>
              <div className="flex flex-wrap gap-1.5">
                {vocab.map((w, i) => (
                  <span key={i} className="px-2 py-0.5 rounded-md text-xs border border-border/50 bg-secondary text-foreground/70 font-mono">
                    {w}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Raw Keywords */}
          {keywords.length > 0 && (
            <div>
              <div className="text-[10px] font-semibold tracking-[0.1em] uppercase text-muted-foreground mb-2">
                Raw Keywords
                <span className="ml-2 text-muted-foreground/50 normal-case font-normal tracking-normal">— stored for trend analysis</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {keywords.map((k, i) => (
                  <span key={i} className="px-1.5 py-0.5 rounded text-[10px] border border-border/30 bg-background/50 text-muted-foreground/60">
                    {k}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Signal Groups */}
          {decoded && (
            <div className="space-y-4">
              <SignalGroup signals={decoded.identityClaims} label="Identity Claims → Archetype, Brand Type" color="text-violet-400/80" />
              <SignalGroup signals={decoded.statusSignals} label="Status Signals → Cultural Capital, Symbolic Position" color="text-blue-400/80" />
              <SignalGroup signals={decoded.communityReferences} label="Community References → Audience Tribe, Emotional Promise" color="text-emerald-400/80" />
              <SignalGroup signals={decoded.aspirationDrivers} label="Aspiration Drivers → Barthès Myth, Cultural Tension" color="text-orange-400/80" />
              <SignalGroup signals={decoded.audienceLanguage} label="Audience Language → Stuart Hall Decoding, Goffman Gap" color="text-amber-400/80" />
            </div>
          )}

          {/* Methodology note */}
          <div className="p-3 rounded-lg bg-violet-500/5 border border-violet-500/15">
            <div className="text-[10px] font-semibold tracking-[0.1em] uppercase text-violet-400/70 mb-1">
              Trend Analysis Note
            </div>
            <p className="text-xs text-muted-foreground/70 leading-relaxed">
              Keywords, themes, and decoded signals are stored as semantic artifacts at the time of analysis.
              Over time, comparing these artifacts across brands and creators reveals which shared symbols,
              values, and vocabulary patterns are driving the most successful partnerships.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default function BrandProfileCard({ profile, compact = false }: BrandProfileCardProps) {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-xl bg-green-400/10 border border-green-400/20 flex items-center justify-center flex-shrink-0">
          <span className="text-lg font-serif text-green-400">
            {profile.brandName?.[0]?.toUpperCase() ?? "?"}
          </span>
        </div>
        <div>
          <h3 className="font-semibold text-lg text-foreground">{profile.brandName}</h3>
          <div className="flex items-center gap-2 mt-1">
            {profile.category && (
              <span className="text-xs px-2 py-0.5 rounded-full border border-border bg-secondary text-muted-foreground">
                {profile.category}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* AI Summary */}
      {profile.aiSummary && (
        <div className="p-4 rounded-xl bg-muted/30 border border-border/50">
          <div className="text-[10px] font-semibold tracking-[0.12em] uppercase text-muted-foreground mb-2">
            Cultural Analyst Summary
          </div>
          <p className="text-sm text-foreground/80 leading-relaxed">{profile.aiSummary}</p>
        </div>
      )}

      {compact ? null : (
        <>
          {/* Field Note One: Brand Snapshot */}
          <div>
            <div className="mb-4">
              <h4 className="text-xs font-semibold tracking-[0.1em] uppercase text-muted-foreground">
                Field Note One: Brand Snapshot
              </h4>
              <p className="text-xs text-muted-foreground/60 mt-0.5">Symbolic Position & Cultural Identity</p>
            </div>
            <div className="space-y-3">
              {BRAND_FIELDS.map((field) => {
                const value = profile[field.key as keyof BrandProfile];
                return (
                  <div key={field.key} className="grid grid-cols-[1fr_1.5fr] gap-4 items-start py-2 border-b border-border/30 last:border-0">
                    <span className="text-xs text-muted-foreground pt-0.5">{field.label}</span>
                    <FieldValue value={value} type={field.type} />
                  </div>
                );
              })}
            </div>
          </div>

          {/* Audience Perception Panel */}
          <AudiencePerceptionPanel profile={profile} />

          {/* Brand Symbol Decoder Panel */}
          <BrandSymbolDecoderPanel profile={profile} />

          {/* Weight Configuration */}
          <div>
            <div className="mb-4">
              <h4 className="text-xs font-semibold tracking-[0.1em] uppercase text-muted-foreground">
                Weight Configuration
              </h4>
              <p className="text-xs text-muted-foreground/60 mt-0.5">α/β/γ Weights from Brand Type Table — Chapter 3 Logic</p>
            </div>
            {/* Brand Archetype Classification */}
            {profile.brandArchetypeClassification && (() => {
              const meta = BRAND_ARCHETYPE_META[profile.brandArchetypeClassification];
              if (!meta) return null;
              return (
                <div className={`mb-4 p-3 rounded-xl border ${meta.color}`}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-base">{meta.icon}</span>
                    <span className={`text-xs font-bold tracking-[0.08em] uppercase ${meta.color.split(" ")[0]}`}>
                      {profile.brandArchetypeClassification} Brand
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground/80 leading-relaxed mb-1">{meta.description}</p>
                  <p className={`text-[10px] font-mono ${meta.color.split(" ")[0]} opacity-70`}>{meta.signature}</p>
                </div>
              );
            })()}
            <div className="space-y-3">
              {WEIGHT_FIELDS.map((field) => {
                const value = profile[field.key as keyof BrandProfile];
                return (
                  <div key={field.key} className="grid grid-cols-[1fr_1.5fr] gap-4 items-start py-2 border-b border-border/30 last:border-0">
                    <span className="text-xs text-muted-foreground pt-0.5">{field.label}</span>
                    <FieldValue value={value} type={field.type} />
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
