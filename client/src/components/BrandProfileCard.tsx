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
