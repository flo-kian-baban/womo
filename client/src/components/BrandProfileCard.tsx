import { useState } from "react";
import FieldExplainer from "./FieldExplainer";

// Flattened brand profile as returned by getBrandProfileById in db.ts.
type BrandProfile = Record<string, any> & { id: string };

interface BrandProfileCardProps {
  profile: BrandProfile;
  compact?: boolean;
  onReanalyze?: () => void;
  isReanalyzing?: boolean;
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

// Re-export for use in parent components
export type { BrandProfileCardProps };

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

function BrandVideoTranscriptPanel({ profile }: { profile: BrandProfile }) {
  const [expanded, setExpanded] = useState(false);

  const transcripts = (profile.brandVideoTranscripts as Array<{ videoId: string; caption: string; postedDate?: string }> | null) ?? [];
  if (transcripts.length === 0) return null;

  return (
    <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-cyan-500/10 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 rounded-md bg-cyan-500/20 flex items-center justify-center flex-shrink-0">
            <span className="text-cyan-400 text-xs">▶</span>
          </div>
          <div>
            <div className="text-xs font-semibold tracking-[0.1em] uppercase text-cyan-400/80">
              Brand Video Captions
            </div>
            <div className="text-xs text-muted-foreground/60 mt-0.5">
              {transcripts.length} video{transcripts.length !== 1 ? 's' : ''} analyzed
            </div>
          </div>
        </div>
        <span className="text-muted-foreground/40 text-xs">{expanded ? "▲" : "▼"}</span>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t border-cyan-500/10 pt-4">
          {transcripts.map((transcript, idx) => (
            <div key={idx} className="rounded-lg bg-background/50 border border-border/30 p-3">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="text-xs font-mono text-muted-foreground/60">Video {idx + 1}</div>
                {transcript.postedDate && (
                  <div className="text-xs text-muted-foreground/40">
                    {new Date(transcript.postedDate).toLocaleDateString()}
                  </div>
                )}
              </div>
              <p className="text-sm text-foreground/80 leading-relaxed line-clamp-3">
                {transcript.caption}
              </p>
            </div>
          ))}
          <div className="p-3 rounded-lg bg-cyan-500/5 border border-cyan-500/15">
            <div className="text-[10px] font-semibold tracking-[0.1em] uppercase text-cyan-400/70 mb-1">
              Transcript Analysis Note
            </div>
            <p className="text-xs text-muted-foreground/70 leading-relaxed">
              Video captions are the descriptions brands write when posting on TikTok — intentional messaging that signals brand voice, values, and cultural positioning. These captions feed directly into the brand's symbolic vocabulary and decoded symbols.
            </p>
          </div>
        </div>
      )}
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
              <div className="text-[10px] font-semibold tracking-[0.1em] uppercase text-violet-400/70 mb-1">
                Symbolic Vocabulary [Semiotic Identity]
              </div>
              <FieldExplainer fieldKey="brandSymbolicVocabulary" />
              <div className="flex flex-wrap gap-1.5 mt-2">
                {vocab.map((w, i) => (
                  <span key={i} className="px-2 py-0.5 rounded-md text-xs border border-violet-400/25 bg-violet-400/5 text-violet-300 font-mono">
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

export default function BrandProfileCard({ profile, compact = false, onReanalyze, isReanalyzing = false }: BrandProfileCardProps) {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4 flex-1">
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
        {onReanalyze && !compact && (
          <button
            onClick={onReanalyze}
            disabled={isReanalyzing}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-primary/30 bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5 flex-shrink-0"
          >
            {isReanalyzing ? (
              <>
                <span className="w-3 h-3 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
                Re-analyzing...
              </>
            ) : (
              <>
                <span>🔄</span>
                Re-analyze
              </>
            )}
          </button>
        )}
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

          {/* TikTok Audience Intelligence — P1-5, P3-1, P3-2 */}
          {(profile.mentionTotalCount > 0 || profile.mentionAudienceSummary) && (
            <div className="rounded-xl border border-teal-500/20 bg-teal-500/5 p-4 space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-6 h-6 rounded-md bg-teal-500/20 flex items-center justify-center flex-shrink-0">
                  <span className="text-teal-400 text-xs">📡</span>
                </div>
                <div className="flex-1">
                  <div className="text-xs font-semibold tracking-[0.1em] uppercase text-teal-400/80">
                    TikTok Audience Intelligence
                  </div>
                  <div className="text-xs text-muted-foreground/60 mt-0.5">
                    {profile.mentionTotalCount ?? 0} mentions
                    {profile.mentionUniqueAuthors ? ` from ${profile.mentionUniqueAuthors} unique creators` : ""}
                  </div>
                </div>
                {/* P3-1: Mention Sentiment with confidence badge */}
                {profile.mentionSentiment && profile.mentionSentiment !== "insufficient_data" && (
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                      profile.mentionSentiment === "positive" ? "text-green-400 bg-green-400/10 border-green-400/30" :
                      profile.mentionSentiment === "mixed" ? "text-yellow-400 bg-yellow-400/10 border-yellow-400/30" :
                      "text-red-400 bg-red-400/10 border-red-400/30"
                    }`}>
                      {profile.mentionSentiment === "positive" ? "Positive" :
                       profile.mentionSentiment === "mixed" ? "Mixed" : "Negative"}
                    </span>
                    {profile.mentionSentimentConfidence && (
                      <span className={`flex items-center gap-1 text-[10px] font-medium ${
                        profile.mentionSentimentConfidence === "high" ? "text-green-400" :
                        profile.mentionSentimentConfidence === "medium" ? "text-yellow-400" :
                        "text-red-400"
                      }`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${
                          profile.mentionSentimentConfidence === "high" ? "bg-green-400" :
                          profile.mentionSentimentConfidence === "medium" ? "bg-yellow-400" :
                          "bg-red-400"
                        }`} />
                        {profile.mentionSentimentConfidence === "high" ? "High" :
                         profile.mentionSentimentConfidence === "medium" ? "Med" : "Low"}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Audience Summary */}
              {profile.mentionAudienceSummary && (
                <div>
                  <div className="text-[10px] font-semibold tracking-[0.1em] uppercase text-teal-400/70 mb-1.5">
                    Audience Intelligence
                  </div>
                  <p className="text-xs text-foreground/80 leading-relaxed">
                    {profile.mentionAudienceSummary}
                  </p>
                </div>
              )}

              {/* P3-2: Mention Music Signals with Artists */}
              {((profile.mentionMusicSignals as string[] | null)?.length ?? 0) > 0 && (
                <div>
                  <div className="text-[10px] font-semibold tracking-[0.1em] uppercase text-teal-400/70 mb-1.5">
                    Music Signals in Mentions
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {((profile.mentionMusicSignals as string[]) ?? []).map((title: string, i: number) => {
                      const artists = (profile.mentionMusicArtists as string[] | null) ?? [];
                      const artist = artists[i];
                      return (
                        <span key={i} className="px-2 py-0.5 rounded-md text-xs border border-teal-400/20 bg-teal-400/5 text-teal-300">
                          {title}{artist ? ` — ${artist}` : ""}
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Hashtag Cloud */}
              {((profile.mentionHashtagCloud as string[] | null)?.length ?? 0) > 0 && (
                <div>
                  <div className="text-[10px] font-semibold tracking-[0.1em] uppercase text-teal-400/70 mb-1.5">
                    Hashtag Signals
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {((profile.mentionHashtagCloud as string[]) ?? []).map((tag: string, i: number) => (
                      <span key={i} className="px-1.5 py-0.5 rounded text-[10px] border border-border/30 bg-background/50 text-muted-foreground/60">
                        #{tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Instagram Channel Intelligence */}
          {profile.instagramHandle && (
            <div className="rounded-xl border border-fuchsia-500/20 bg-fuchsia-500/5 p-4 space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-6 h-6 rounded-md bg-fuchsia-500/20 flex items-center justify-center flex-shrink-0">
                  <svg className="w-3.5 h-3.5 text-fuchsia-400" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/>
                  </svg>
                </div>
                <div className="flex-1">
                  <div className="text-xs font-semibold tracking-[0.1em] uppercase text-fuchsia-400/80">
                    Instagram Channel Intelligence
                  </div>
                  <div className="text-xs text-muted-foreground/60 mt-0.5">
                    @{profile.instagramHandle}
                    {profile.instagramProfileUrl && (
                      <a
                        href={profile.instagramProfileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-1.5 text-fuchsia-400/60 hover:text-fuchsia-400 transition-colors"
                      >
                        ↗
                      </a>
                    )}
                  </div>
                </div>
              </div>

              {/* Instagram Metrics Grid */}
              {(profile.followerCount || (profile as any).instagramFollowerCount) && (
                <div className="grid grid-cols-3 gap-2">
                  {profile.followerCount > 0 && (
                    <div className="p-2.5 rounded-lg bg-background/50 border border-border/30 text-center">
                      <div className="text-[10px] font-semibold tracking-[0.1em] uppercase text-muted-foreground/60 mb-1">Followers</div>
                      <div className="text-sm font-mono text-foreground/80">{(profile.followerCount || 0).toLocaleString()}</div>
                    </div>
                  )}
                  {(profile as any).tiktokAudienceSize && (
                    <div className="p-2.5 rounded-lg bg-background/50 border border-border/30 text-center">
                      <div className="text-[10px] font-semibold tracking-[0.1em] uppercase text-muted-foreground/60 mb-1">Engagement</div>
                      <div className="text-sm font-mono text-foreground/80">
                        {profile.tiktokEngagementRate ? `${Number(profile.tiktokEngagementRate).toFixed(1)}%` : "—"}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Bio */}
              {(profile as any).brandVideoTranscripts === null && profile.aiSummary && profile.instagramHandle && (
                <div>
                  <div className="text-[10px] font-semibold tracking-[0.1em] uppercase text-fuchsia-400/70 mb-1.5">
                    Channel Bio
                  </div>
                  <p className="text-xs text-foreground/80 leading-relaxed italic">
                    "{(profile as any).bio || "—"}"
                  </p>
                </div>
              )}

              {/* Instagram Post Captions */}
              {(() => {
                // Look for Instagram content items from the content_items table
                const igTranscripts = ((profile as any).brandVideoTranscripts as Array<{ videoId: string; caption: string }> | null) ?? [];
                const igPosts = igTranscripts.filter(t => t.videoId?.startsWith("ig-post-"));
                if (igPosts.length === 0) return null;
                return (
                  <div>
                    <div className="text-[10px] font-semibold tracking-[0.1em] uppercase text-fuchsia-400/70 mb-1.5">
                      Recent Post Captions
                    </div>
                    <div className="space-y-1.5">
                      {igPosts.slice(0, 6).map((post, i) => (
                        <div key={i} className="p-2 rounded-lg bg-background/40 border border-border/30">
                          <p className="text-xs text-foreground/70 leading-relaxed line-clamp-2">
                            {post.caption}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* Field Note Two: Brand Identity Framework */}
          {((profile as any).brandGoffmanStageConsistency || (profile as any).brandStuartHallDecoding || (profile as any).brandCulturalCapital) && (
            <div>
              <div className="mb-4">
                <h4 className="text-xs font-semibold tracking-[0.1em] uppercase text-muted-foreground">
                  Field Note Two: Brand Identity Framework
                </h4>
                <p className="text-xs text-muted-foreground/60 mt-0.5">Bourdieu · Goffman · Stuart Hall · Symbolic Capital</p>
              </div>
              <div className="space-y-3">
                {[
                  { key: "brandCulturalCapital", label: "Cultural Capital [Bourdieu]", type: "badge" },
                  { key: "brandGoffmanStageConsistency", label: "Presentation Consistency [Goffman]", type: "status" },
                  { key: "brandDriftSignal", label: "Identity Drift Signal", type: "status" },
                  { key: "brandStuartHallDecoding", label: "Audience Decoding Mode [Stuart Hall]", type: "status" },
                  { key: "brandAudienceDecodingSplit", label: "Audience Decoding Split", type: "boolean" },
                ].map((field) => {
                  const raw = (profile as any)[field.key];
                  if (raw === null || raw === undefined) return null;
                  let displayValue: React.ReactNode;
                  if (field.type === "status") {
                    const statusColors: Record<string, string> = {
                      Consistent: "text-green-400 bg-green-400/10 border-green-400/30",
                      "Minor Gap": "text-yellow-400 bg-yellow-400/10 border-yellow-400/30",
                      "Minor Inconsistency": "text-yellow-400 bg-yellow-400/10 border-yellow-400/30",
                      "Significant Gap": "text-red-400 bg-red-400/10 border-red-400/30",
                      Inconsistent: "text-red-400 bg-red-400/10 border-red-400/30",
                      "Zero Change": "text-green-400 bg-green-400/10 border-green-400/30",
                      "Minor Drift": "text-yellow-400 bg-yellow-400/10 border-yellow-400/30",
                      "Significant Drift": "text-orange-400 bg-orange-400/10 border-orange-400/30",
                      "Full Pivot": "text-red-400 bg-red-400/10 border-red-400/30",
                      Dominant: "text-green-400 bg-green-400/10 border-green-400/30",
                      Negotiated: "text-yellow-400 bg-yellow-400/10 border-yellow-400/30",
                      Oppositional: "text-red-400 bg-red-400/10 border-red-400/30",
                    };
                    const colorClass = statusColors[String(raw)] ?? "text-primary bg-primary/10 border-primary/30";
                    displayValue = (
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${colorClass}`}>
                        {String(raw)}
                      </span>
                    );
                  } else if (field.type === "boolean") {
                    displayValue = (
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                        raw ? "text-amber-400 bg-amber-400/10 border-amber-400/30" : "text-green-400 bg-green-400/10 border-green-400/30"
                      }`}>
                        {raw ? "Divided Decoding" : "Unified Decoding"}
                      </span>
                    );
                  } else {
                    displayValue = (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border border-primary/30 bg-primary/10 text-primary">
                        {String(raw)}
                      </span>
                    );
                  }
                  return (
                    <div key={field.key} className="py-2 border-b border-border/30 last:border-0">
                      <div className="grid grid-cols-[1fr_1.5fr] gap-4 items-start">
                        <span className="text-xs text-muted-foreground pt-0.5">{field.label}</span>
                        {displayValue}
                      </div>
                      <FieldExplainer fieldKey={field.key} value={String(raw)} />
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Field Note Three: Brand Cultural Trajectory */}
          {((profile as any).brandRogersAdopterStage || (profile as any).brandLifecyclePhase || (profile as any).brandBarthesNicheMeaning) && (
            <div>
              <div className="mb-4">
                <h4 className="text-xs font-semibold tracking-[0.1em] uppercase text-muted-foreground">
                  Field Note Three: Brand Cultural Trajectory
                </h4>
                <p className="text-xs text-muted-foreground/60 mt-0.5">Rogers · Turner · Barthes — Lifecycle & Momentum Analysis</p>
              </div>
              <div className="space-y-3">
                {[
                  { key: "brandRogersAdopterStage", label: "Market Adopter Stage [Rogers]", type: "badge" },
                  { key: "brandTurnerLiminalPhase", label: "Liminal Phase [Turner]", type: "badge" },
                  { key: "brandLifecyclePhase", label: "Brand Lifecycle Phase", type: "badge" },
                  { key: "brandBarthesNicheMeaning", label: "Niche Mythological Meaning [Barthes]", type: "quote" },
                ].map((field) => {
                  const raw = (profile as any)[field.key];
                  if (raw === null || raw === undefined) return null;
                  let displayValue: React.ReactNode;
                  if (field.type === "quote") {
                    displayValue = (
                      <blockquote className="border-l-2 border-primary/30 pl-3 text-sm text-foreground/80 italic leading-relaxed">
                        {String(raw)}
                      </blockquote>
                    );
                  } else {
                    displayValue = (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border border-primary/30 bg-primary/10 text-primary">
                        {String(raw)}
                      </span>
                    );
                  }
                  return (
                    <div key={field.key} className="py-2 border-b border-border/30 last:border-0">
                      <div className="grid grid-cols-[1fr_1.5fr] gap-4 items-start">
                        <span className="text-xs text-muted-foreground pt-0.5">{field.label}</span>
                        {displayValue}
                      </div>
                      <FieldExplainer fieldKey={field.key} value={String(raw)} />
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Brand Video Captions Panel */}
          <BrandVideoTranscriptPanel profile={profile} />

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
