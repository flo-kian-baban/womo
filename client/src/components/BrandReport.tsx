/**
 * THE BRAND REPORT — the last report surface (B3).
 *
 * ─── Same five sections as the creator report ───────────────────────────────
 * The creator report was reorganised around the accept/decline decision; the
 * brand page was still the old stack of coloured cards, so the two halves of a
 * match read as two different products. The order here is the creator's order,
 * and it is the order of the same decision:
 *
 *   1 EXECUTIVE   who this brand is and what the analysis concluded — seconds
 *   2 ANALYSIS    every framework reading, in full
 *   3 TRUST       how far to believe it, and why
 *   4 SUPPORT     the evidence underneath
 *   5 COST        how the report was produced
 *
 * ─── NOTHING IS REMOVED ─────────────────────────────────────────────────────
 * Every field, chip and panel that BrandProfileCard rendered is here — surfaced
 * or one disclosure down — and every disclosure states what it holds. Three
 * things that BrandProfileCard COULD NOT reach are now reachable: the run's
 * phase-level account (§5), the run's capture and LLM health (§3), and the
 * projected-versus-received balance of the evidence (§1).
 *
 * ─── COMPOSED, NOT WRAPPED ──────────────────────────────────────────────────
 * The shared vocabulary is imported, not re-implemented: the type scale and
 * container classes from reportType, ReviewStatusBadge / PendingReviewBanner
 * from ReviewGate, RunCostAndProcess for §5, CHIP_NEUTRAL and formatNum from
 * CreatorProfileCard, FieldExplainer for the explained fields. No panel from
 * BrandProfileCard is embedded whole — each was rebuilt in the shared
 * vocabulary, because embedding one would have re-imported its colour.
 *
 * ─── Colour ─────────────────────────────────────────────────────────────────
 * CATEGORICAL RENDERS NEUTRAL, ORDINAL CARRIES COLOUR. The old page used amber
 * for audience perception, cyan for captions, violet for the decoder, teal for
 * TikTok and fuchsia for Instagram — five hues that meant only "different
 * section". They are gone. What keeps colour: confidence level, capture health,
 * mention sentiment and its confidence — each a position on a scale where the
 * low end is asking the analyst for a decision.
 */
import { useState } from "react";
import {
  ChevronDown, ChevronUp, ExternalLink, RefreshCw, Layers, FileText, Shield,
  Film, Receipt, AlertTriangle, Info, Star, MessageSquare, Globe, Radio,
  Instagram, Music, Hash, Sparkles, Scale,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import FieldExplainer, { EXPLAINED_FIELD_KEYS } from "./FieldExplainer";
import { PendingReviewBanner, ReviewStatusBadge } from "./ReviewGate";
import { RunCostAndProcess } from "./RunCostAndProcess";
import { CHIP_NEUTRAL, formatNum } from "./CreatorProfileCard";
import { EvidenceBalance } from "./EvidenceBalance";
import {
  T_TITLE, T_SECTION, T_SUB, T_BODY, T_LABEL, T_DETAIL, T_MICRO,
  T_FIGURE_SM, BOX, PANEL, PANEL_OPEN, PANEL_HEAD, PANEL_BODY, EASE_EXPO,
} from "@/lib/reportType";

type Brand = Record<string, any> & { id: string };

// ─── The field tables, unchanged in content ──────────────────────────────────

const BRAND_FIELDS = [
  { key: "archetype", label: "Archetype [Jung]", type: "badge" },
  { key: "emotionalPromise", label: "Emotional Promise", type: "quote" },
  { key: "visualLanguage", label: "Visual Language", type: "tags" },
  { key: "audienceTribe", label: "Audience Tribe", type: "text" },
  { key: "culturalTension", label: "Cultural Tension", type: "quote" },
  { key: "barthesMyth", label: "Myth Question [Barthes]", type: "quote" },
];

const IDENTITY_FIELDS = [
  { key: "brandCulturalCapital", label: "Cultural Capital [Bourdieu]", type: "badge" },
  { key: "brandGoffmanStageConsistency", label: "Presentation Consistency [Goffman]", type: "badge" },
  { key: "brandDriftSignal", label: "Identity Drift Signal", type: "badge" },
  { key: "brandStuartHallDecoding", label: "Audience Decoding Mode [Stuart Hall]", type: "badge" },
  { key: "brandAudienceDecodingSplit", label: "Audience Decoding Split", type: "decodingSplit" },
];

const TRAJECTORY_FIELDS = [
  { key: "brandRogersAdopterStage", label: "Market Adopter Stage [Rogers]", type: "badge" },
  { key: "brandTurnerLiminalPhase", label: "Liminal Phase [Turner]", type: "badge" },
  { key: "brandLifecyclePhase", label: "Brand Lifecycle Phase", type: "badge" },
  { key: "brandBarthesNicheMeaning", label: "Niche Mythological Meaning [Barthes]", type: "quote" },
];

const WEIGHT_FIELDS = [
  { key: "brandType", label: "Brand Type", type: "text" },
  { key: "campaignType", label: "Campaign Type", type: "badge" },
  { key: "weightAlpha", label: "α — Alignment Weight", type: "weight" },
  { key: "weightBeta", label: "β — Pulse Weight", type: "weight" },
  { key: "weightGamma", label: "γ — Stability Weight", type: "weight" },
  { key: "weightPriority", label: "Weight Priority", type: "text" },
];

/**
 * The three weighting archetypes.
 *
 * NEUTRALISED. Each carried its own hue (Trust blue, Community emerald,
 * Momentum orange) and an emoji — a categorical use of colour, and the same
 * defect the creator report removed everywhere else. The name and the α/β/γ
 * signature carry the distinction; they always did.
 */
const BRAND_ARCHETYPE_META: Record<string, { description: string; signature: string }> = {
  Trust: {
    description: "Built on credibility, safety, and reliability. The consumer must believe before they act.",
    signature: "α=0.5 dominant · γ elevated · β suppressed",
  },
  Community: {
    description: "Built on belonging, identity, and shared values. The consumer identifies with the brand.",
    signature: "α=0.4–0.5 dominant · γ=0.3 · β moderate",
  },
  Momentum: {
    description: "Built on energy, relevance, and cultural presence. The consumer wants what is exciting right now.",
    signature: "β=0.4–0.6 dominant · α secondary · γ suppressed",
  },
};

// ─── Ordinal treatments — the only colour on the page ────────────────────────

const CONFIDENCE_TONE: Record<string, string> = {
  high: "text-foreground/75 border-border/60 bg-secondary/50",
  medium: "text-amber-400 border-amber-400/35 bg-amber-400/10",
  low: "text-red-400 border-red-400/35 bg-red-400/10",
};
const HEALTH_TONE: Record<string, string> = {
  clean: "text-foreground/75 border-border/60 bg-secondary/50",
  degraded: "text-amber-400 border-amber-400/35 bg-amber-400/10",
  thin: "text-amber-400 border-amber-400/35 bg-amber-400/10",
};
/**
 * Sentiment is ORDINAL — a position on a favourability scale — so it keeps
 * colour, mapped onto exactly the same three tones as confidence: the quiet
 * end is neutral, and only the end that asks for a decision is coloured.
 */
const SENTIMENT_TONE: Record<string, string> = {
  positive: "text-foreground/75 border-border/60 bg-secondary/50",
  mixed: "text-amber-400 border-amber-400/35 bg-amber-400/10",
  negative: "text-red-400 border-red-400/35 bg-red-400/10",
};

function Pill({ tone, children, title }: { tone: string; children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] font-medium ${tone}`}>
      {children}
    </span>
  );
}

// ─── Section frame — identical to the creator report's ───────────────────────

function Section({
  n, title, blurb, icon: Icon, children,
}: {
  n: number; title: string; blurb: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <section className="pt-7 first:pt-0 border-t border-border/40 first:border-0">
      <div className="flex items-baseline gap-2.5 mb-4">
        <span className="text-xs font-mono tabular-nums text-muted-foreground/40">{n}</span>
        <Icon className="w-3.5 h-3.5 text-muted-foreground/50 self-center" />
        <h2 className={T_SECTION}>{title}</h2>
        <span className={`${T_DETAIL} hidden sm:inline`}>{blurb}</span>
      </div>
      {children}
    </section>
  );
}

/** A disclosure whose collapsed state always says what it holds. */
function Disclosure({
  label, summary, children, defaultOpen = false,
}: { label: string; summary: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`${open ? PANEL_OPEN : PANEL} ${EASE_EXPO} overflow-hidden`}>
      <button onClick={() => setOpen(v => !v)} className={PANEL_HEAD}>
        <span className={T_SUB}>{label}</span>
        <span className={`${T_DETAIL} tabular-nums`}>{summary}</span>
        {open ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground/50 ml-auto" />
              : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/50 ml-auto" />}
      </button>
      {open && <div className={PANEL_BODY}>{children}</div>}
    </div>
  );
}

/** Qualifying lines, typed by what they ask of the reader. Same three kinds. */
function Note({ kind, children }: { kind: "warning" | "caveat" | "context"; children: React.ReactNode }) {
  if (kind === "context") return <p className={`${T_DETAIL} pl-3`}>{children}</p>;
  const warn = kind === "warning";
  return (
    <div className={`flex items-start gap-2.5 pl-3 border-l-2 ${warn ? "border-amber-400/60" : "border-border/60"}`}>
      {warn
        ? <AlertTriangle className="w-3.5 h-3.5 text-amber-400/90 flex-shrink-0 mt-0.5" />
        : <Info className="w-3.5 h-3.5 text-muted-foreground/50 flex-shrink-0 mt-0.5" />}
      <p className={`text-xs leading-relaxed ${warn ? "text-amber-400/90 font-medium" : "text-foreground/70"}`}>
        {children}
      </p>
    </div>
  );
}

function TrustLine({
  label, value, detail, tone,
}: { label: string; value: string; detail?: string; tone: string }) {
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <span className={`${T_MICRO} w-[150px] flex-shrink-0`}>{label}</span>
        <Pill tone={tone}>{value}</Pill>
      </div>
      {detail && <p className={`${T_DETAIL} mt-1 pl-[158px]`}>{detail}</p>}
    </div>
  );
}

// ─── Field rendering ─────────────────────────────────────────────────────────

/**
 * A field's value.
 *
 * `badge` was primary-tinted, which spent the single accent on archetypes,
 * adopter stages and decoding modes — categorical positions, every one. It is
 * CHIP_NEUTRAL now, the same chip the creator report uses for the same class of
 * value. `weight` had a gold GRADIENT on the bar; a gradient on data is
 * decoration, so the fill is flat and the number sits beside it.
 */
function FieldValue({ value, type }: { value: unknown; type: string }) {
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground/40 text-sm italic">—</span>;
  }

  if (type === "badge") {
    /* `w-fit` is LOAD-BEARING. This span is a direct grid child, and a grid
       stretches its items, so an `inline-flex` chip ballooned to the full
       538px of the value column — a pill the width of a paragraph. */
    return (
      <span className={`inline-flex w-fit items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${CHIP_NEUTRAL}`}>
        {String(value)}
      </span>
    );
  }

  if (type === "decodingSplit") {
    // A boolean, but the two states are not "yes/no" — they are two readings.
    // The dot carries the state, exactly as the creator report's booleans do.
    const split = Boolean(value);
    return (
      <span className="inline-flex w-fit items-center gap-2">
        <span className={`w-1.5 h-1.5 rounded-full ${split ? "bg-foreground/55" : "bg-muted-foreground/25"}`} />
        <span className="text-xs font-medium text-foreground/85">
          {split ? "Divided Decoding" : "Unified Decoding"}
        </span>
      </span>
    );
  }

  if (type === "tags") {
    /*
      ─── A FIELD THAT HAS NEVER RENDERED ────────────────────────────────────
      The old renderer was `Array.isArray(value) ? value : []`, and
      `visual_language` is stored as a COMMA-SEPARATED STRING — measured on all
      15 brands in the corpus, every one a string, not one an array. So the
      value fell into the empty-array branch and Visual Language has been blank
      on every brand profile the product has ever shown. The extractor was
      writing it the whole time.

      Splitting on commas is the whole fix. Duplicates are NOT collapsed —
      glossier.com genuinely stores "minimalist" four times, and silently
      deduplicating would edit what the run reported.
    */
    const tags = Array.isArray(value)
      ? value.map(String)
      : String(value).split(",").map(s => s.trim()).filter(Boolean);
    if (tags.length === 0) return <span className="text-muted-foreground/40 text-sm italic">—</span>;
    return (
      <div className="flex flex-wrap gap-1.5">
        {tags.map((tag: string, i: number) => (
          <span key={i} className="inline-flex items-center px-2 py-0.5 rounded-md text-xs border border-border/50 bg-secondary/50 text-foreground/70">
            {tag}
          </span>
        ))}
      </div>
    );
  }

  if (type === "quote") {
    return (
      <blockquote className="border-l-2 border-border/60 pl-3 text-sm text-foreground/75 italic leading-relaxed">
        {String(value)}
      </blockquote>
    );
  }

  if (type === "weight") {
    const w = Number(value);
    return (
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1.5 rounded-full bg-secondary/60 border border-border/50 overflow-hidden max-w-24">
          <div className="h-full bg-foreground/45" style={{ width: `${w * 100}%` }} />
        </div>
        <span className="text-sm font-mono tabular-nums text-foreground/80">{w.toFixed(1)}</span>
      </div>
    );
  }

  return <span className="text-sm text-foreground">{String(value)}</span>;
}

/** One labelled row, at the creator report's measure and with its explainer. */
function FieldRow({ field, value }: { field: { key: string; label: string; type: string }; value: unknown }) {
  return (
    <div className="py-2 border-b border-border/25 last:border-0">
      <div className="grid grid-cols-[minmax(150px,210px)_1fr] gap-5 items-baseline max-w-3xl">
        <span className={T_LABEL}>{field.label}</span>
        <FieldValue value={value} type={field.type} />
      </div>
      {EXPLAINED_FIELD_KEYS.has(field.key) && (
        <div className="mt-1">
          <FieldExplainer fieldKey={field.key} value={value != null ? String(value) : null} />
        </div>
      )}
    </div>
  );
}

function FieldNote({
  title, subtitle, fields, profile,
}: {
  title: string; subtitle: string;
  fields: Array<{ key: string; label: string; type: string }>;
  profile: Brand;
}) {
  return (
    <div>
      <div className="mb-2.5">
        <h3 className={T_SUB}>{title}</h3>
        <p className={`${T_DETAIL} mt-1`}>{subtitle}</p>
      </div>
      <div className="space-y-2.5">
        {/*
          EVERY FIELD RENDERS, populated or not. The old page returned null for
          a null value, so a field that the run failed to produce vanished and
          read as a field that does not exist. An em dash says "asked, not
          answered" — which is a different fact.
        */}
        {fields.map(f => <FieldRow key={f.key} field={f} value={profile[f.key]} />)}
      </div>
    </div>
  );
}

// ─── Reviews ─────────────────────────────────────────────────────────────────

/**
 * A rating, rendered by FILL rather than by hue.
 *
 * The stars were amber. A rating is genuinely ordinal, so colour would be
 * permitted — but amber already means "warning" on both reports, and a 4.4★
 * brand is not a warning. The count of filled stars is the ordinal encoding;
 * it needs no second one.
 */
function StarRating({ rating, max = 5 }: { rating: number; max?: number }) {
  const full = Math.round(rating);
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${rating} out of ${max}`}>
      {Array.from({ length: max }, (_, i) => (
        <Star key={i} className={`w-3 h-3 ${i < full ? "fill-foreground/60 text-foreground/60" : "text-muted-foreground/25"}`} />
      ))}
      <span className="ml-1.5 text-xs font-mono tabular-nums text-foreground/75">{rating.toFixed(1)}</span>
    </span>
  );
}

/** Parse review excerpts string back into individual entries. Unchanged. */
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

// ─── Decoded signals ─────────────────────────────────────────────────────────

interface DecodedSignal {
  phrase: string; meaning: string; informs: string[]; source: "brand" | "audience";
}

/**
 * One group of decoded signals.
 *
 * The five groups took five hues (violet, blue, emerald, orange, amber) that
 * encoded nothing but group order — the same defect as colouring timeline bars
 * by array index. The HEADING names the group and names what it informs; the
 * source chip is the only thing that varies, and it varies by word.
 */
function SignalGroup({ signals, label }: { signals: DecodedSignal[] | undefined; label: string }) {
  if (!signals || signals.length === 0) return null;
  return (
    <div>
      <div className={`${T_MICRO} mb-2`}>{label}</div>
      <div className="space-y-2">
        {signals.map((s, i) => (
          <div key={i} className={`p-2.5 ${BOX}`}>
            <div className="flex items-start gap-2 mb-1">
              <span className="text-xs font-mono text-foreground/80 leading-snug flex-1">“{s.phrase}”</span>
              {/* PROJECTED vs RECEIVED at the level of a single phrase — the
                  same distinction §1's balance strip makes for the whole
                  profile. One treatment; the word carries it. */}
              <span className={`text-[9px] px-1.5 py-0.5 rounded border flex-shrink-0 ${
                s.source === "audience"
                  ? "border-border/60 bg-secondary/70 text-foreground/70 font-medium"
                  : "border-border/40 bg-secondary/30 text-muted-foreground/60"
              }`}>{s.source}</span>
            </div>
            <p className="text-xs text-muted-foreground/70 leading-relaxed">{s.meaning}</p>
            {s.informs.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {s.informs.map((f, j) => (
                  <span key={j} className="text-[9px] px-1.5 py-0.5 rounded border border-border/40 bg-secondary/40 text-muted-foreground/70">
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

// ─── The report ──────────────────────────────────────────────────────────────

export default function BrandReport({
  profile, onReanalyze, isReanalyzing = false,
}: { profile: Brand; onReanalyze?: () => void; isReanalyzing?: boolean }) {
  const isPending = profile.reviewStatus === "pending";

  const diagnostics = trpc.creator.getDiagnostics.useQuery(
    { observationId: profile.observationId }, { staleTime: 60_000, retry: false },
  );
  const d = diagnostics.data as any;

  const decoded = (profile.brandDecodedSymbols ?? null) as (Record<string, DecodedSignal[]> & { symbolicSummary?: string }) | null;
  const vocab: string[] = profile.brandSymbolicVocabulary ?? [];
  const themes: string[] = profile.brandThemeLabels ?? [];
  const brandKeywords: string[] = profile.brandRawKeywords ?? [];
  const mentionKeywords: string[] = profile.mentionRawKeywords ?? [];
  const hashtagCloud: string[] = profile.mentionHashtagCloud ?? [];
  const musicSignals: string[] = profile.mentionMusicSignals ?? [];
  const musicArtists: string[] = profile.mentionMusicArtists ?? [];
  const transcripts: Array<{ videoId: string; caption: string; postedDate?: string }> =
    profile.brandVideoTranscripts ?? [];

  const decodedCount = decoded
    ? (decoded.identityClaims?.length ?? 0) + (decoded.statusSignals?.length ?? 0)
      + (decoded.communityReferences?.length ?? 0) + (decoded.aspirationDrivers?.length ?? 0)
      + (decoded.audienceLanguage?.length ?? 0)
    : 0;

  const yelpReviews = parseReviewExcerpts(profile.yelpReviewExcerpts);
  const googleReviews = parseReviewExcerpts(profile.googleReviewExcerpts);
  const allReviews = [...yelpReviews, ...googleReviews];
  const hasYelp = profile.yelpRating != null;
  const hasGoogle = profile.googleRating != null;

  const igPosts = transcripts.filter(t => t.videoId?.startsWith("ig-post-"));
  const tiktokCaptions = transcripts.filter(t => !t.videoId?.startsWith("ig-post-"));

  return (
    <div className="space-y-0">
      {isPending && <div className="mb-5"><PendingReviewBanner /></div>}

      {/* ══ 1 EXECUTIVE SUMMARY ══════════════════════════════════════════ */}
      <Section n={1} title="Executive summary" blurb="who this brand is, and what the analysis concluded" icon={Layers}>
        <div className="space-y-4">
          <div className="flex items-start gap-3 flex-wrap">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className={T_TITLE}>{profile.brandName}</h1>
                <ReviewStatusBadge status={profile.reviewStatus} />
              </div>
              <div className={`flex items-center gap-2 mt-1.5 flex-wrap ${T_DETAIL}`}>
                {profile.category && <span>{profile.category}</span>}
                {profile.brandUrl && (
                  <a href={String(profile.brandUrl)} target="_blank" rel="noreferrer"
                     className="inline-flex items-center gap-1 hover:text-foreground transition-colors">
                    <Globe className="w-3 h-3" /> {String(profile.brandUrl).replace(/^https?:\/\//, "").replace(/\/$/, "")}
                  </a>
                )}
                {profile.instagramHandle && (
                  <a href={String(profile.instagramProfileUrl ?? `https://instagram.com/${profile.instagramHandle}`)}
                     target="_blank" rel="noreferrer"
                     className="inline-flex items-center gap-1 hover:text-foreground transition-colors">
                    <Instagram className="w-3 h-3" /> @{profile.instagramHandle}
                  </a>
                )}
                {profile.tiktokChannelUrl && (
                  <a href={String(profile.tiktokChannelUrl)} target="_blank" rel="noreferrer"
                     className="inline-flex items-center gap-1 hover:text-foreground transition-colors">
                    <ExternalLink className="w-3 h-3" /> TikTok
                  </a>
                )}
                {profile.observedAt && (
                  <span>· analysed {new Date(profile.observedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
                )}
              </div>
            </div>
            {onReanalyze && (
              <button onClick={onReanalyze} disabled={isReanalyzing}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border text-[11px] text-muted-foreground hover:text-foreground transition-colors flex-shrink-0">
                <RefreshCw className={`w-3 h-3 ${isReanalyzing ? "animate-spin" : ""}`} />
                {isReanalyzing ? "Queueing…" : "Re-analyze"}
              </button>
            )}
          </div>

          {/* The headline reading + the trust flags that qualify it */}
          <div className="flex items-center gap-2 flex-wrap">
            {profile.archetype && (
              <span className={`inline-flex items-center px-2.5 py-1 rounded-full border text-xs font-medium ${CHIP_NEUTRAL}`}>
                {profile.archetype}
              </span>
            )}
            {profile.brandType && <span className={T_LABEL}>{profile.brandType}</span>}
            {profile.brandTone && <span className={T_LABEL}>· {profile.brandTone}</span>}
            <span className="ml-auto flex items-center gap-1.5 flex-wrap">
              {profile.dataConfidenceLevel && (
                <Pill tone={CONFIDENCE_TONE[String(profile.dataConfidenceLevel)] ?? CHIP_NEUTRAL}
                      title="Stored on the observation at extract time.">
                  {String(profile.dataConfidenceLevel)} confidence
                </Pill>
              )}
              {d && (
                <Pill tone={HEALTH_TONE[d.captureHealth.status] ?? CHIP_NEUTRAL}
                      title="How the capture itself went — reporting only, never an input to scoring">
                  capture {d.captureHealth.status}
                </Pill>
              )}
              {profile.overallRating != null && (
                <Pill tone={CHIP_NEUTRAL} title={`${(profile.totalReviews ?? 0).toLocaleString()} reviews`}>
                  {Number(profile.overallRating).toFixed(1)}★ overall
                </Pill>
              )}
            </span>
          </div>

          {themes.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {themes.map((t, i) => (
                <span key={i} className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] ${CHIP_NEUTRAL}`}>{t}</span>
              ))}
            </div>
          )}

          {profile.aiSummary && <p className={`${T_BODY} max-w-3xl`}>{profile.aiSummary}</p>}

          {/*
            THE BALANCE STRIP — the one genuinely new reading on this page.
            A brand profile assembled from 2,411 words of the brand's own site
            and 40 customer reviews is a different object from one assembled the
            other way round, and nothing on the old page said which you had.
          */}
          <div className={`p-4 ${BOX}`}>
            <EvidenceBalance profile={profile} />
          </div>

          {/* Metrics */}
          <div className={`grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-6 gap-y-4 p-4 ${BOX}`}>
            <Metric icon={Radio} label="TikTok audience" value={profile.tiktokAudienceSize} />
            <Metric icon={Sparkles} label="TikTok eng. rate" value={profile.tiktokEngagementRate} suffix="%" />
            <Metric icon={Star} label="Reviews" value={profile.totalReviews} />
            <Metric icon={MessageSquare} label="Mentions" value={profile.mentionTotalCount} />
            <Metric icon={FileText} label="Site words" value={profile.semanticWordCount} />
            <Metric icon={Globe} label="Pages crawled" value={profile.crawledPagesCount} />
          </div>
        </div>
      </Section>

      {/* ══ 2 DETAILED ANALYSIS ══════════════════════════════════════════ */}
      <Section n={2} title="Detailed analysis" blurb="every framework reading, in full" icon={FileText}>
        <div className="space-y-5">
          <FieldNote title="Field Note One: Brand Snapshot"
            subtitle="Symbolic Position & Cultural Identity"
            fields={BRAND_FIELDS} profile={profile} />

          <FieldNote title="Field Note Two: Brand Identity Framework"
            subtitle="Bourdieu · Goffman · Stuart Hall · Symbolic Capital"
            fields={IDENTITY_FIELDS} profile={profile} />

          <FieldNote title="Field Note Three: Brand Cultural Trajectory"
            subtitle="Rogers · Turner · Barthes — Lifecycle & Momentum Analysis"
            fields={TRAJECTORY_FIELDS} profile={profile} />

          {/* Weight configuration — what the fit engine will actually use. */}
          <div>
            <div className="mb-2.5">
              <h3 className={T_SUB}>Weight Configuration</h3>
              <p className={`${T_DETAIL} mt-1`}>α/β/γ weights from the brand-type table — Chapter 3 logic</p>
            </div>
            {profile.brandArchetypeClassification && (() => {
              const meta = BRAND_ARCHETYPE_META[String(profile.brandArchetypeClassification)];
              if (!meta) return null;
              return (
                <div className={`mb-3 p-3 ${BOX}`}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <Scale className="w-3.5 h-3.5 text-muted-foreground/50" />
                    <span className={T_SUB}>{String(profile.brandArchetypeClassification)} brand</span>
                  </div>
                  <p className={`${T_DETAIL} mb-1`}>{meta.description}</p>
                  <p className="text-[10px] font-mono text-muted-foreground/60">{meta.signature}</p>
                </div>
              );
            })()}
            <div className="space-y-2.5">
              {WEIGHT_FIELDS.map(f => <FieldRow key={f.key} field={f} value={profile[f.key]} />)}
            </div>
          </div>

          {/* Decoded signals — the SINGLE rendering, in section 2 where a
              finding belongs, matching the creator report's placement. */}
          {(decodedCount > 0 || vocab.length > 0 || decoded?.symbolicSummary) && (
            <div>
              <div className="mb-2.5">
                <h3 className={T_SUB}>Brand Symbol Decoder</h3>
                <p className={`${T_DETAIL} mt-1`}>
                  {decodedCount} cultural signal{decodedCount === 1 ? "" : "s"} decoded
                  {themes.length > 0 ? ` · ${themes.join(" · ")}` : ""}
                </p>
              </div>
              <div className="space-y-4">
                {decoded?.symbolicSummary && (
                  <blockquote className="border-l-2 border-border/60 pl-3 text-sm text-foreground/80 italic leading-relaxed max-w-3xl">
                    {decoded.symbolicSummary}
                  </blockquote>
                )}

                {vocab.length > 0 && (
                  <div>
                    <div className={`${T_MICRO} mb-1`}>Symbolic vocabulary [semiotic identity]</div>
                    <FieldExplainer fieldKey="brandSymbolicVocabulary" />
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {vocab.map((w, i) => (
                        <span key={i} className="px-2 py-0.5 rounded-md text-xs border border-border/50 bg-secondary/50 text-foreground/75 font-mono">
                          {w}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {decoded && (
                  <div className="space-y-4">
                    <SignalGroup signals={decoded.identityClaims} label="Identity claims → archetype, brand type" />
                    <SignalGroup signals={decoded.statusSignals} label="Status signals → cultural capital, symbolic position" />
                    <SignalGroup signals={decoded.communityReferences} label="Community references → audience tribe, emotional promise" />
                    <SignalGroup signals={decoded.aspirationDrivers} label="Aspiration drivers → Barthes myth, cultural tension" />
                    <SignalGroup signals={decoded.audienceLanguage} label="Audience language → Stuart Hall decoding, Goffman gap" />
                  </div>
                )}

                <Note kind="context">
                  Keywords, themes and decoded signals are stored as semantic artifacts at the time of
                  analysis. Comparing them across brands and creators over time is what reveals which
                  shared symbols and vocabulary drive successful partnerships.
                </Note>
              </div>
            </div>
          )}
        </div>
      </Section>

      {/* ══ 3 TRUST ══════════════════════════════════════════════════════ */}
      <Section n={3} title="Trust" blurb="how far to believe it, and why" icon={Shield}>
        {diagnostics.isLoading ? (
          <p className={T_DETAIL}>Loading run diagnostics…</p>
        ) : !d ? (
          <div className="space-y-4">
            <p className={`${T_DETAIL} italic`}>No run diagnostics available for this observation.</p>
            <div className={`grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4 p-4 ${BOX}`}>
              <TrustLine label="Review status" tone={CHIP_NEUTRAL}
                value={String(profile.reviewStatus ?? "unknown")}
                detail={reviewDetail(profile)} />
              <TrustLine label="Confidence" tone={CONFIDENCE_TONE[String(profile.dataConfidenceLevel)] ?? CHIP_NEUTRAL}
                value={String(profile.dataConfidenceLevel ?? "unknown")}
                detail="Stored on the observation at extract time." />
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className={`grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4 p-4 ${BOX}`}>
              <TrustLine label="Review status" tone={CHIP_NEUTRAL}
                value={String(profile.reviewStatus ?? "unknown")}
                detail={reviewDetail(profile)} />
              <TrustLine label="Confidence"
                tone={CONFIDENCE_TONE[String(profile.dataConfidenceLevel)] ?? CHIP_NEUTRAL}
                value={String(profile.dataConfidenceLevel ?? "unknown")}
                detail="Stored on the observation at extract time." />
              <TrustLine label="Capture health" tone={HEALTH_TONE[d.captureHealth.status] ?? CHIP_NEUTRAL}
                value={d.captureHealth.status}
                detail={d.captureHealth.failedPathMethods.length > 0
                  ? `failed paths: ${d.captureHealth.failedPathMethods.join(", ")}`
                  : "no path failures recorded"} />
              <TrustLine label="Evidence reaching the model" tone={CHIP_NEUTRAL}
                value={`${d.fields.counts.contentItems} content item${d.fields.counts.contentItems === 1 ? "" : "s"}`}
                detail={`${d.fields.counts.keywords} keywords · ${d.fields.counts.contentThemes} themes · ${d.fields.counts.decodedSignals} decoded signals`} />
              {/*
                WHICH LISTING THE REVIEWS CAME FROM. Google Places resolves a
                chain query to A location, not necessarily THE location, and the
                same brand has recorded 247, 248, 40, 0 and 248 reviews across
                runs with no way to tell which listing answered. Printing the
                place beside the count does not fix resolution — it makes a
                wrong resolution visible, which is the whole of this line's job.
              */}
              {(() => {
                const g = (profile.reviewResolution as { google?: {
                  placeName?: string | null; address?: string | null;
                  reviewCount?: number | null; rating?: number | null; ingested?: number;
                } | null } | null)?.google;
                if (!g) return null;
                const counted = g.reviewCount != null
                  ? `${g.ingested ?? 0} of ${g.reviewCount.toLocaleString()} reviews read`
                  : `${g.ingested ?? 0} reviews read`;
                return (
                  <TrustLine label="Reviews resolved to" tone={CHIP_NEUTRAL}
                    value={g.placeName || "an unnamed Google listing"}
                    detail={[g.address, counted, g.rating != null ? `${g.rating}★ listed` : null]
                      .filter(Boolean).join(" · ")} />
                );
              })()}
            </div>

            {(d.scrapes.consequences.length > 0 || d.llm.failed > 0 || !d.exactRunLinkage
              || d.enrichments.failed.length > 0) && (
              <div className="space-y-2.5">
                {d.scrapes.consequences.map((c: string, i: number) => (
                  <Note key={i} kind="warning">{c}</Note>
                ))}
                {d.llm.failed > 0 && (
                  <Note kind="warning">
                    {d.llm.failed} of {d.llm.calls} model call{d.llm.calls === 1 ? "" : "s"} failed —{" "}
                    {d.llm.failures.map((f: any) => `${f.purpose}: ${f.errorMessage}`).join("; ")}
                  </Note>
                )}
                {d.enrichments.failed.length > 0 && (
                  <Note kind="warning">
                    {d.enrichments.failed.length} persistence component
                    {d.enrichments.failed.length === 1 ? "" : "s"} failed —{" "}
                    {d.enrichments.failed.map((f: any) => `${f.component}${f.reason ? ` (${f.reason})` : ""}`).join("; ")}
                  </Note>
                )}
                {!d.exactRunLinkage && (
                  <Note kind="warning">
                    This observation predates run tagging — scrape and model figures are linked by
                    observation id and may be incomplete.
                  </Note>
                )}
                {/* The caveat has to name what is actually left. Allbirds has
                    neither reviews nor mentions, so "rests on mentions" would
                    be false there; Glossier has reviews but no mentions. */}
                {(profile.totalReviews ?? 0) === 0 && (
                  <Note kind="caveat">
                    No customer reviews were captured, so every audience-facing reading
                    (Stuart Hall decoding, audience tribe, Goffman gap) rests on{" "}
                    {(profile.mentionTotalCount ?? 0) > 0
                      ? `the brand's own words and ${profile.mentionTotalCount} TikTok mentions.`
                      : "the brand's own words alone — no audience evidence of any kind reached the model."}
                  </Note>
                )}
              </div>
            )}

            {/*
              ─── WHY THERE IS NO PER-FIELD PROVENANCE BLOCK HERE ──────────────
              MEASURED, not assumed. getRunDiagnostics resolves field presence
              and provenance from `creator_observations`, which is empty for a
              brand. On Patagonia it therefore reports archetype, barthesMyth
              and aiSummary as MISSING while all three are populated on
              `brand_observations` ("The Explorer", the myth sentence, the
              summary paragraph), and names a 27-field creator vocabulary
              (followerCount, parasocialBondStrength, remixRate…) identical for
              every brand. Its confidence rationale is creator-shaped too —
              Glossier's reads "0 transcripts (>= 6) → high".

              Rendering that here would report populated fields as missing. The
              parts of the same reader that ARE subject-agnostic — capture
              health, scrapes, model calls, persistence components, the evidence
              counts above — are read from run and observation tables and are
              rendered. The rest is stated as absent rather than invented.
            */}
            <Note kind="context">
              Per-field provenance is not available for brands — the provenance map is derived from
              the creator observation table and does not describe brand fields. Field-level evidence
              for this brand is in §4, and the run account is in §5.
            </Note>

            <Disclosure label="Capture detail"
              summary={`${d.scrapes.total} scrapes · ${d.scrapes.failed} failed · ${d.llm.calls} model calls`}>
              <div className="space-y-3">
                {d.scrapes.byPlatform.map((p: any) => (
                  <div key={p.platform}>
                    <div className="flex items-baseline gap-2">
                      <span className={T_MICRO}>{p.platform}</span>
                      <span className={`${T_DETAIL} tabular-nums`}>
                        {p.succeeded} succeeded · {p.failed} failed of {p.attempts}
                      </span>
                    </div>
                    <div className="mt-1 space-y-0.5">
                      {p.events.map((e: any, i: number) => (
                        <div key={i} className={`${T_DETAIL} flex items-baseline gap-2`}>
                          <span className="font-mono text-muted-foreground/60 w-40 flex-shrink-0 truncate" title={e.method}>{e.method}</span>
                          <span className={e.failureReason ? "text-amber-400/80" : "text-foreground/60"}>
                            {e.failureReason ?? "ok"}{e.httpStatus ? ` · HTTP ${e.httpStatus}` : ""}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                <div>
                  <div className={`${T_MICRO} mb-1`}>Model calls by purpose</div>
                  <div className={`${T_DETAIL} tabular-nums`}>
                    {Object.entries(d.llm.byPurpose as Record<string, number>)
                      .map(([p, n]) => `${n}× ${p}`).join(" · ") || "none recorded"}
                  </div>
                </div>
              </div>
            </Disclosure>

            <Disclosure label="Persistence components"
              summary={`${d.enrichments.succeeded.length} succeeded · ${d.enrichments.failed.length} failed · ${d.enrichments.skippedNoData.length} no data · ${d.enrichments.skippedNotAttempted.length} not attempted`}>
              <div className="space-y-2">
                <ComponentList label="Succeeded" items={d.enrichments.succeeded.map((c: string) => ({ component: c, reason: null }))} />
                <ComponentList label="Failed" items={d.enrichments.failed} />
                <ComponentList label="Skipped — no data" items={d.enrichments.skippedNoData} />
                <ComponentList label="Skipped — not attempted" items={d.enrichments.skippedNotAttempted} />
              </div>
            </Disclosure>

            <Disclosure label="Record"
              summary="ids and timestamps for this observation">
              <div className="space-y-1 font-mono text-xs text-muted-foreground/70">
                <div>subject &nbsp;{profile.id}</div>
                <div>observation &nbsp;{profile.observationId}</div>
                <div>run &nbsp;{profile.runId ?? "not recorded"}</div>
                <div>observed &nbsp;{profile.observedAt ? new Date(profile.observedAt).toISOString() : "unknown"}</div>
                <div>created &nbsp;{profile.createdAt ? new Date(profile.createdAt).toISOString() : "unknown"}</div>
                <div>updated &nbsp;{profile.updatedAt ? new Date(profile.updatedAt).toISOString() : "unknown"}</div>
              </div>
            </Disclosure>
          </div>
        )}
      </Section>

      {/* ══ 4 SUPPORT ════════════════════════════════════════════════════ */}
      <Section n={4} title="Support" blurb="the evidence underneath the findings" icon={Film}>
        <div className="space-y-2">
          {/*
            AUDIENCE PERCEPTION — the RECEIVED half of the evidence, and the
            sharpest instance of the colour defect on this page: it was an amber
            panel, which read as a warning about the very evidence that makes a
            profile trustworthy. Structure replaces the hue; it opens by default
            when reviews exist, because received evidence is the scarcer half.
          */}
          <Disclosure label="Audience perception"
            summary={hasYelp || hasGoogle
              ? `${(profile.totalReviews ?? 0).toLocaleString()} reviews · ${hasYelp && hasGoogle ? "Yelp + Google Maps" : hasYelp ? "Yelp" : "Google Maps"}`
              : "no review sources captured"}
            defaultOpen={hasYelp || hasGoogle}>
            {!hasYelp && !hasGoogle ? (
              <p className={`${T_DETAIL} italic`}>
                No Yelp or Google Maps rating was captured for this brand.
              </p>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <RatingTile label="Overall" rating={profile.overallRating} count={profile.totalReviews} />
                  <RatingTile label="Yelp" rating={profile.yelpRating} count={profile.yelpReviewCount} />
                  <RatingTile label="Google Maps" rating={profile.googleRating} count={profile.googleReviewCount} />
                </div>

                {allReviews.length > 0 && (
                  <div className="space-y-2">
                    <div className={T_MICRO}>What customers say ({allReviews.length} excerpts)</div>
                    {allReviews.slice(0, 5).map((review, i) => (
                      <div key={i} className={`p-3 ${BOX}`}>
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="text-xs font-medium text-foreground/70">{review.author}</span>
                          {review.rating > 0 && <StarRating rating={review.rating} />}
                        </div>
                        <p className="text-xs text-muted-foreground leading-relaxed italic">
                          "{review.text.slice(0, 280)}{review.text.length > 280 ? "…" : ""}"
                        </p>
                      </div>
                    ))}
                  </div>
                )}

                <Note kind="context">
                  Stuart Hall decoding note — review language is how the audience actually decodes this
                  brand, distinct from its self-presentation. Patterns here directly inform the Barthes
                  myth, audience tribe and Goffman stage-gap fields in §2.
                </Note>
              </div>
            )}
          </Disclosure>

          {/* TikTok mentions — the other received half. */}
          <Disclosure label="TikTok audience intelligence"
            summary={(profile.mentionTotalCount ?? 0) > 0
              ? `${profile.mentionTotalCount} mentions${profile.mentionUniqueAuthors ? ` from ${profile.mentionUniqueAuthors} creators` : ""}`
              : "no mentions captured"}>
            {(profile.mentionTotalCount ?? 0) === 0 && !profile.mentionAudienceSummary ? (
              <p className={`${T_DETAIL} italic`}>No TikTok mentions were captured for this brand.</p>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  {profile.mentionSentiment && profile.mentionSentiment !== "insufficient_data" && (
                    <Pill tone={SENTIMENT_TONE[String(profile.mentionSentiment)] ?? CHIP_NEUTRAL}>
                      {String(profile.mentionSentiment)} sentiment
                    </Pill>
                  )}
                  {profile.mentionSentiment === "insufficient_data" && (
                    <Pill tone={CHIP_NEUTRAL}>sentiment — insufficient data</Pill>
                  )}
                  {profile.mentionSentimentConfidence && (
                    <Pill tone={CONFIDENCE_TONE[String(profile.mentionSentimentConfidence)] ?? CHIP_NEUTRAL}>
                      {String(profile.mentionSentimentConfidence)} confidence
                    </Pill>
                  )}
                </div>

                {profile.mentionAudienceSummary && (
                  <div>
                    <div className={`${T_MICRO} mb-1`}>Audience intelligence</div>
                    <p className={T_BODY}>{profile.mentionAudienceSummary}</p>
                  </div>
                )}

                {musicSignals.length > 0 && (
                  <div>
                    <div className={`${T_MICRO} mb-1.5 flex items-center gap-1.5`}>
                      <Music className="w-3 h-3" /> Music signals in mentions
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {musicSignals.map((title, i) => (
                        <span key={i} className="px-2 py-0.5 rounded-md text-xs border border-border/50 bg-secondary/50 text-foreground/75">
                          {title}{musicArtists[i] ? ` — ${musicArtists[i]}` : ""}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {hashtagCloud.length > 0 && (
                  <div>
                    <div className={`${T_MICRO} mb-1.5 flex items-center gap-1.5`}>
                      <Hash className="w-3 h-3" /> Hashtag signals ({hashtagCloud.length})
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {hashtagCloud.map((tag, i) => (
                        <span key={i} className="px-1.5 py-0.5 rounded text-[10px] border border-border/40 bg-secondary/40 text-muted-foreground/70">
                          #{tag}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {mentionKeywords.length > 0 && (
                  <div>
                    <div className={`${T_MICRO} mb-1.5`}>Mention keywords ({mentionKeywords.length})</div>
                    <div className="flex flex-wrap gap-1">
                      {mentionKeywords.map((k, i) => (
                        <span key={i} className="px-1.5 py-0.5 rounded text-[10px] border border-border/40 bg-secondary/40 text-muted-foreground/70">
                          {k}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </Disclosure>

          {/* Brand's own channels — the PROJECTED half. */}
          <Disclosure label="Brand channel posts"
            summary={transcripts.length > 0
              ? `${tiktokCaptions.length} TikTok · ${igPosts.length} Instagram`
              : "no channel posts captured"}>
            {transcripts.length === 0 ? (
              <p className={`${T_DETAIL} italic`}>No brand channel posts were captured for this run.</p>
            ) : (
              <div className="space-y-3">
                {transcripts.map((t, i) => (
                  <div key={i} className={`p-3 ${BOX}`}>
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                      <span className="text-xs font-mono text-muted-foreground/60">
                        {t.videoId?.startsWith("ig-post-") ? "Instagram" : "TikTok"} · {t.videoId}
                      </span>
                      {t.postedDate && (
                        <span className={T_DETAIL}>{new Date(t.postedDate).toLocaleDateString()}</span>
                      )}
                    </div>
                    <p className="text-sm text-foreground/80 leading-relaxed">{t.caption}</p>
                  </div>
                ))}
                <Note kind="context">
                  Captions are what the brand writes when posting — intentional messaging that signals
                  voice, values and cultural positioning. They feed the symbolic vocabulary and decoded
                  symbols in §2.
                </Note>
              </div>
            )}
          </Disclosure>

          <Disclosure label="Website evidence"
            summary={`${(profile.semanticWordCount ?? 0).toLocaleString()} words · ${profile.crawledPagesCount ?? 0} pages`}>
            <div className="space-y-2">
              <div className={`${T_DETAIL} tabular-nums`}>
                {profile.brandUrl
                  ? <>Crawled from <a href={String(profile.brandUrl)} target="_blank" rel="noreferrer" className="underline decoration-border underline-offset-2 hover:text-foreground">{String(profile.brandUrl)}</a></>
                  : "No brand URL recorded."}
              </div>
              <div className={`${T_DETAIL} tabular-nums`}>
                {(profile.semanticWordCount ?? 0).toLocaleString()} words of brand-authored copy across{" "}
                {profile.crawledPagesCount ?? 0} page{profile.crawledPagesCount === 1 ? "" : "s"} reached the model.
              </div>
              {brandKeywords.length > 0 && (
                <div>
                  <div className={`${T_MICRO} mb-1.5 mt-2`}>
                    Raw keywords ({brandKeywords.length}) — stored for trend analysis
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {brandKeywords.map((k, i) => (
                      <span key={i} className="px-1.5 py-0.5 rounded text-[10px] border border-border/40 bg-secondary/40 text-muted-foreground/70">
                        {k}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Disclosure>

          <Disclosure label="TikTok channel metadata"
            summary={profile.tiktokChannelUrl
              ? `${profile.tiktokAudienceSize ? formatNum(Number(profile.tiktokAudienceSize)) : "size unknown"} · raw capture`
              : "no TikTok channel linked"}>
            {!profile.tiktokChannelUrl && !profile.tiktokMetadata ? (
              <p className={`${T_DETAIL} italic`}>No TikTok channel was linked to this brand.</p>
            ) : (
              <div className="space-y-2">
                <div className={`${T_DETAIL} tabular-nums`}>
                  audience {profile.tiktokAudienceSize != null ? Number(profile.tiktokAudienceSize).toLocaleString() : "unknown"} ·
                  engagement {profile.tiktokEngagementRate != null ? `${Number(profile.tiktokEngagementRate).toFixed(1)}%` : "unknown"}
                </div>
                {profile.tiktokMetadata && (
                  <pre className="text-[10px] font-mono text-muted-foreground/60 leading-relaxed overflow-x-auto max-h-64 overflow-y-auto">
                    {JSON.stringify(profile.tiktokMetadata, null, 2)}
                  </pre>
                )}
              </div>
            )}
          </Disclosure>
        </div>
      </Section>

      {/* ══ 5 COST AND PROCESS ═══════════════════════════════════════════ */}
      <Section n={5} title="Cost and process" blurb="how this report was produced" icon={Receipt}>
        {/*
          THE SIX PHASES. A brand campaign runs capture / augment / transcribe /
          channel_instagram / derive / extract_commit, and until the read change
          in this session runId never reached the client, so this account was
          unreachable from the brand page entirely.
        */}
        <RunCostAndProcess runId={profile.runId} observationId={profile.observationId} />
      </Section>
    </div>
  );
}

// ─── Small parts ─────────────────────────────────────────────────────────────

/**
 * "accepted" and "not yet reviewed" are both true of every brand in the corpus
 * and read as a contradiction if printed that way.
 *
 * MEASURED: all 15 brands carry review_status = accepted with review_at and
 * reviewed_by NULL — brand runs are accepted at persistence, and no analyst has
 * ever reviewed one. The status is not a human judgement, so the line says so
 * rather than implying someone signed it off.
 */
function reviewDetail(profile: Brand): string {
  if (profile.reviewedAt) {
    const when = new Date(profile.reviewedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    return `${profile.reviewedBy ? `${profile.reviewedBy} · ` : ""}${when}`;
  }
  if (profile.reviewStatus === "accepted") {
    return "accepted at persistence — no analyst review recorded";
  }
  return "not yet reviewed";
}

function Metric({
  icon: Icon, label, value, suffix,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string; value: unknown; suffix?: string;
}) {
  const n = value == null ? null : Number(value);
  const shown = n == null || Number.isNaN(n)
    ? null
    : suffix === "%" ? `${n.toFixed(1)}%` : formatNum(n);
  return (
    <div>
      <div className={`flex items-center gap-1.5 ${T_MICRO}`}>
        <Icon className="w-3 h-3" />
        <span>{label}</span>
      </div>
      <div className={`${T_FIGURE_SM} mt-1`}>
        {shown ?? <span className="text-muted-foreground/35 italic font-normal text-sm">unknown</span>}
      </div>
    </div>
  );
}

function RatingTile({ label, rating, count }: { label: string; rating: unknown; count: unknown }) {
  const r = rating == null ? null : Number(rating);
  return (
    <div className={`p-3 ${BOX}`}>
      <div className={`${T_MICRO} mb-1.5`}>{label}</div>
      {r == null || Number.isNaN(r)
        ? <span className={`${T_DETAIL} italic`}>not captured</span>
        : <StarRating rating={r} />}
      {count != null && (
        <div className={`${T_DETAIL} mt-1 tabular-nums`}>{Number(count).toLocaleString()} reviews</div>
      )}
    </div>
  );
}

function ComponentList({ label, items }: { label: string; items: Array<{ component: string; reason: string | null }> }) {
  return (
    <div>
      <div className={`${T_MICRO} mb-1`}>{label} ({items.length})</div>
      {items.length === 0
        ? <p className={`${T_DETAIL} italic`}>none</p>
        : (
          <div className="space-y-0.5">
            {items.map((it, i) => (
              <div key={i} className={`${T_DETAIL} flex items-baseline gap-2`}>
                <span className="font-mono text-muted-foreground/60 w-44 flex-shrink-0 truncate">{it.component}</span>
                {it.reason && <span className="text-foreground/60">{it.reason}</span>}
              </div>
            ))}
          </div>
        )}
    </div>
  );
}
