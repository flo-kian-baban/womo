import { useState, useMemo, useCallback, useEffect } from "react";
import { Link, useLocation } from "wouter";
import {
  BookOpen, Users, Building2, BarChart3, Search, Trash2,
  ExternalLink, FileJson, ChevronDown, Filter,
  X, Zap, Star, FileText, Clock, Activity,
  AlertTriangle, Eye, TrendingUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { ReviewGatePanel } from "@/components/ReviewGate";
import { PlatformMark } from "@/components/PlatformMark";
import { Archive } from "lucide-react";

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * B1 COLOUR DISCIPLINE — categorical renders neutral, ordinal carries colour.
 *
 * The twelve-hue archetype map is gone: an archetype is a framework VALUE, and
 * twelve colours for twelve words conveyed nothing but "these are different
 * words" while spending the entire warning palette on decoration (Hero was
 * destructive-red; Jester was caution-yellow). Meaning lives in the label. One
 * quiet chip for every categorical value; colour is reserved for evidence
 * quality and attention, so a healthy profile renders almost entirely neutral.
 */
const CHIP_NEUTRAL = { text: "text-foreground/70", bg: "bg-secondary/50", border: "border-border/60" };

/** Ordinal, but quiet until warning-worthy: drift only colours when it is big. */
const DRIFT_COLORS: Record<string, string> = {
  "Zero Change": `${CHIP_NEUTRAL.text} ${CHIP_NEUTRAL.bg} ${CHIP_NEUTRAL.border}`,
  "Minor Drift": `${CHIP_NEUTRAL.text} ${CHIP_NEUTRAL.bg} ${CHIP_NEUTRAL.border}`,
  "Significant Drift": "text-amber-400 bg-amber-400/10 border-amber-400/30",
  "Full Pivot": "text-red-400 bg-red-400/10 border-red-400/30",
};

/** Cultural velocity is a framework reading — CATEGORICAL, so neutral. */
const VELOCITY_COLORS: Record<string, string> = {
  Focusing: `${CHIP_NEUTRAL.text} ${CHIP_NEUTRAL.bg} ${CHIP_NEUTRAL.border}`,
  Drifting: `${CHIP_NEUTRAL.text} ${CHIP_NEUTRAL.bg} ${CHIP_NEUTRAL.border}`,
  "Insufficient Data": "text-muted-foreground/60 bg-muted/30 border-border/50",
};

/** Consistency is ordinal — but consistent is the EXPECTED state, so neutral. */
const GOFFMAN_COLORS: Record<string, string> = {
  Consistent: `${CHIP_NEUTRAL.text} ${CHIP_NEUTRAL.bg} ${CHIP_NEUTRAL.border}`,
  "Minor Gap": `${CHIP_NEUTRAL.text} ${CHIP_NEUTRAL.bg} ${CHIP_NEUTRAL.border}`,
  "Significant Gap": "text-amber-400 bg-amber-400/10 border-amber-400/30",
};

/**
 * Platform chips are NEUTRAL — the glyph inside carries the identity, in the
 * platform's own muted brand tint (approved ruling: recognition kept, tinted
 * chip dropped).
 */
const PLATFORM_COLORS: Record<string, string> = {
  tiktok: `${CHIP_NEUTRAL.text} ${CHIP_NEUTRAL.bg} ${CHIP_NEUTRAL.border}`,
  instagram: `${CHIP_NEUTRAL.text} ${CHIP_NEUTRAL.bg} ${CHIP_NEUTRAL.border}`,
  youtube: `${CHIP_NEUTRAL.text} ${CHIP_NEUTRAL.bg} ${CHIP_NEUTRAL.border}`,
};

const PLATFORM_LABELS: Record<string, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  youtube: "YouTube",
};

/**
 * One platform-glyph source of truth: PlatformMark (approved ruling — the glyph
 * keeps its muted brand tint; the CHIP around it went neutral). This inline
 * copy predated PlatformMark and had begun to drift from it.
 */
function PlatformIcon({ platform, className = "w-3.5 h-3.5" }: { platform: string; className?: string }) {
  return <PlatformMark platform={platform} className={className} />;
}

const ARCHETYPES = ["Hero", "Sage", "Outlaw", "Everyman", "Explorer", "Magician", "Lover", "Jester", "Caregiver", "Ruler", "Creator", "Innocent"];
const CONFIDENCE_LEVELS = ["high", "medium", "low"];

type TabKey = "creators" | "brands" | "matches";

// ═══════════════════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

function abbr(n: number | null | undefined): string {
  if (n == null || n === 0) return "—";
  const num = Number(n);
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return String(num);
}

function relativeDate(d: string | Date): string {
  const now = new Date();
  const date = new Date(d);
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
  return `${Math.floor(diffDays / 365)}y ago`;
}

function formatDate(d: string | Date): string {
  const date = new Date(d);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function getArchStyle(_a: string | null | undefined) {
  // Every archetype, known or novel, gets the same quiet chip — the label is
  // the information.
  return CHIP_NEUTRAL;
}

function matchesSearch(query: string, ...fields: (string | null | undefined | string[])[]): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return fields.some(f => {
    if (!f) return false;
    if (Array.isArray(f)) return f.some(v => v?.toLowerCase().includes(q));
    return f.toLowerCase().includes(q);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// MICRO COMPONENTS — Clean, consistent, reusable
// ═══════════════════════════════════════════════════════════════════════════════

function Badge({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border whitespace-nowrap ${className}`}>{children}</span>;
}

function Tag({ children }: { children: React.ReactNode }) {
  return <span className="px-1.5 py-0.5 rounded text-[10px] border border-border/30 bg-secondary/50 text-muted-foreground/70">{children}</span>;
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="text-center min-w-[52px]">
      <div className="text-sm font-semibold font-mono text-foreground leading-tight">{value}</div>
      <div className="text-[9px] text-muted-foreground/40 uppercase tracking-wide">{label}</div>
    </div>
  );
}

function ConfidenceDot({ level }: { level: string | null | undefined }) {
  if (!level) return null;
  // Ordinal, and disciplined: high confidence is the expected state and renders
  // neutral; colour marks the profiles whose evidence needs a second look. No
  // glow — glows are the marketing surface.
  const c = level === "high" ? "bg-foreground/40" : level === "medium" ? "bg-amber-400" : "bg-red-400";
  return <span className={`w-2 h-2 rounded-full ${c}`} title={`${level} confidence`} />;
}

function ArchBadge({ archetype }: { archetype: string | null | undefined }) {
  if (!archetype) return null;
  const s = getArchStyle(archetype);
  return <Badge className={`${s.text} ${s.bg} ${s.border} text-[11px] px-2.5`}>{archetype}</Badge>;
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`px-2.5 py-1 rounded-full text-[10px] font-medium border transition-all duration-150 ${
      active ? "border-primary/60 bg-primary/15 text-primary" : "border-border/40 bg-transparent text-muted-foreground/60 hover:border-border hover:text-muted-foreground"
    }`}>
      {label}
    </button>
  );
}

function ActiveFilterChips({ filters, onRemove }: { filters: { key: string; value: string }[]; onRemove: (key: string) => void }) {
  if (filters.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mb-3">
      {filters.map(f => (
        <span key={`${f.key}-${f.value}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border border-primary/40 bg-primary/10 text-primary">
          {f.key}: {f.value}
          <button onClick={() => onRemove(f.key)} className="hover:text-foreground transition-colors"><X className="w-2.5 h-2.5" /></button>
        </span>
      ))}
    </div>
  );
}

/** Mini horizontal bar for sub-scores */
function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  return (
    <div className="flex items-center gap-1.5 flex-1">
      <div className="flex-1 h-[3px] rounded-full bg-border/40 overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${(value / max) * 100}%`, background: color }} />
      </div>
      <span className="text-[10px] font-mono w-6 text-right" style={{ color }}>{value.toFixed(1)}</span>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// CREATOR ROW — Two-tier: Identity + Metrics headline, Badge strip below
// ═══════════════════════════════════════════════════════════════════════════════

function CreatorRow({ creator, onDelete, onExport }: {
  creator: Record<string, any>;
  onDelete: () => void;
  onExport: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const platform = creator.platform?.toLowerCase() ?? "";
  const platColor = PLATFORM_COLORS[platform] ?? "text-muted-foreground bg-muted/30 border-border/40";
  const platLabel = PLATFORM_LABELS[platform] ?? creator.platform ?? "—";
  // Review gate (womo_0006): pending must be unmistakable — amber left stripe
  // + bold badge, not a subtle hint.
  const isPending = creator.reviewStatus === "pending";

  return (
    /* data-card: flat, no gradient, no hover lift — rows must not shimmer as
       the analyst mouses across twenty of them. Pending keeps the amber stripe
       and chip (review status is ordinal/attention) but loses the background
       wash: section-level tinting is out, the stripe and the word carry it. */
    <div className={`data-card rounded-xl group ${
      isPending ? "border-l-2 border-l-amber-400" : ""
    }`}>
      <div className="px-5 py-4 cursor-pointer" onClick={() => setExpanded(!expanded)}>

        {/* ──── TIER 1: Identity + Metrics ──────────────────────────────────── */}
        <div className="flex items-center gap-4">

          {/* Confidence indicator */}
          <ConfidenceDot level={creator.dataConfidenceLevel} />

          {/* Name + Meta */}
          <div className="min-w-0 w-[200px] flex-shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-medium text-foreground truncate">{creator.displayName ?? creator.handle}</span>
              {isPending && (
                <span
                  className="inline-flex items-center flex-shrink-0 text-amber-400"
                  title="Pending review — this observation has not been accepted yet"
                  aria-label="Pending review"
                >
                  <Clock className="w-3 h-3" />
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <PlatformIcon platform={creator.platform} />
              <span className="text-[11px] text-muted-foreground/50">@{creator.handle}</span>
            </div>
          </div>

          {/* Archetype — anchor visual */}
          <div className="flex-shrink-0">
            <ArchBadge archetype={creator.archetype} />
          </div>

          {/* ── Stat cluster ── */}
          <div className="flex items-center gap-5 ml-auto flex-shrink-0">
            <Stat value={abbr(creator.followerCount)} label="Followers" />
            <Stat
              value={creator.engagementRate != null && Number(creator.engagementRate) > 0 ? `${Number(creator.engagementRate).toFixed(1)}%` : "—"}
              label="Eng Rate"
            />
            <Stat value={abbr(creator.totalViews)} label="Views" />
            {creator.transcriptCount != null && (
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground/50 ml-3">
                <FileText className="w-3 h-3" />
                <span>{creator.transcriptCount}</span>
              </div>
            )}
          </div>

          {/* Actions (always-on) */}
          <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity ml-6">
            <Link href={`/creator/${creator.id}`} onClick={(e: React.MouseEvent) => e.stopPropagation()}>
              <span className="p-1.5 rounded-md hover:bg-primary/10 text-muted-foreground/40 hover:text-primary transition-colors inline-flex" title="View Profile">
                <ExternalLink className="w-3.5 h-3.5" />
              </span>
            </Link>
            <Link href="/fit-score" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
              <span className="p-1.5 rounded-md hover:bg-primary/10 text-muted-foreground/40 hover:text-primary transition-colors inline-flex" title="Run Match">
                <Zap className="w-3.5 h-3.5" />
              </span>
            </Link>
            <button className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground/40 hover:text-foreground transition-colors" onClick={(e) => { e.stopPropagation(); onExport(); }} title="Export JSON">
              <FileJson className="w-3.5 h-3.5" />
            </button>
            {confirmingDelete ? (
              <button
                className="px-2 py-1 rounded-md bg-destructive/15 text-destructive text-[10px] font-semibold hover:bg-destructive/25 transition-colors"
                onClick={(e) => { e.stopPropagation(); onDelete(); setConfirmingDelete(false); }}
                onBlur={() => setConfirmingDelete(false)}
              >
                Confirm
              </button>
            ) : (
              <button className="p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground/40 hover:text-destructive transition-colors" onClick={(e) => { e.stopPropagation(); setConfirmingDelete(true); }} title="Delete">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Date + Expand chevron */}
          <span className="text-[10px] text-muted-foreground/30 flex-shrink-0 ml-2">{formatDate(creator.createdAt)}</span>
          <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground/30 flex-shrink-0 transition-transform duration-150 ${expanded ? "rotate-180" : ""}`} />
        </div>

      </div>

      {/* ──── EXPANDED: AI Summary + Badge strip ─────────────────────────────── */}
      <div className={`overflow-hidden transition-all duration-150 ease-in-out ${expanded ? "max-h-96" : "max-h-0"}`}>
        <div className="px-5 pb-4 pt-0 border-t border-border/15">
          {creator.aiSummary && (
            <p className="text-xs text-muted-foreground/60 leading-relaxed mt-3">{creator.aiSummary}</p>
          )}
          {/* Badge strip — now inside dropdown below description */}
          <div className="flex items-center gap-1.5 mt-3 flex-wrap">
            {creator.toneRegister && (
              <Tag>{creator.toneRegister}</Tag>
            )}
            {creator.goffmanStageConsistency && (
              <Badge className={GOFFMAN_COLORS[creator.goffmanStageConsistency] ?? "text-muted-foreground bg-muted/30 border-border/50"}>
                Goffman: {creator.goffmanStageConsistency}
              </Badge>
            )}
            {creator.driftSignal && (
              <Badge className={DRIFT_COLORS[creator.driftSignal] ?? "text-muted-foreground bg-muted/30 border-border/50"}>
                {creator.driftSignal}
              </Badge>
            )}
            {/* Rogers, Turner, lifecycle: framework values — the label is the
                information, the chip is the same quiet chip. Turner losing its
                amber matters doubly: it was competing with genuine warnings. */}
            {creator.rogersAdopterStage && (
              <Badge className={`${CHIP_NEUTRAL.text} ${CHIP_NEUTRAL.bg} ${CHIP_NEUTRAL.border}`}>{creator.rogersAdopterStage}</Badge>
            )}
            {creator.turnerLiminalPhase && (
              <Badge className={`${CHIP_NEUTRAL.text} ${CHIP_NEUTRAL.bg} ${CHIP_NEUTRAL.border}`}>{creator.turnerLiminalPhase}</Badge>
            )}
            {creator.lifecyclePhase && (
              <Badge className={`${CHIP_NEUTRAL.text} ${CHIP_NEUTRAL.bg} ${CHIP_NEUTRAL.border}`}>{creator.lifecyclePhase}</Badge>
            )}
            {creator.culturalVelocity && (
              <Badge className={VELOCITY_COLORS[creator.culturalVelocity] ?? "text-muted-foreground bg-muted/30 border-border/50"}>
                {creator.culturalVelocity}
              </Badge>
            )}
            {(creator.undergroundDensity || creator.mainstreamBleed) && (
              <Badge className={`${CHIP_NEUTRAL.text} ${CHIP_NEUTRAL.bg} ${CHIP_NEUTRAL.border}`}>
                {creator.undergroundDensity && !creator.mainstreamBleed ? "Underground" : !creator.undergroundDensity && creator.mainstreamBleed ? "Mainstream" : "Underground + Mainstream"}
              </Badge>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// ARCHIVED RUN ROW — declined analysis runs (womo_0006): retained with full
// provenance for scraper-failure analysis, hidden from the default view.
// ═══════════════════════════════════════════════════════════════════════════════

function ArchivedRunRow({ run }: { run: Record<string, any> }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="data-card rounded-xl border-l-2 border-l-red-400/50">
      <div className="px-5 py-3.5 cursor-pointer flex items-center gap-4" onClick={() => setExpanded(!expanded)}>
        <Archive className="w-3.5 h-3.5 text-muted-foreground/50 flex-shrink-0" />
        <div className="min-w-0 w-[220px] flex-shrink-0">
          <span className="text-[13px] font-medium text-foreground/80 truncate block">{run.displayName ?? run.handle ?? "—"}</span>
          <div className="flex items-center gap-1.5 mt-0.5">
            <PlatformIcon platform={run.platform ?? ""} />
            <span className="text-[11px] text-muted-foreground/50">@{run.handle ?? "?"}</span>
          </div>
        </div>
        <span className="inline-flex items-center px-2 py-0.5 rounded border border-red-400/40 text-red-400 text-[9px] font-semibold uppercase tracking-wider flex-shrink-0">
          Declined
        </span>
        <div className="text-[11px] text-muted-foreground/60 ml-auto flex items-center gap-4 flex-shrink-0">
          <span>run {formatDate(run.observedAt)}</span>
          {run.reviewedAt && <span>declined {formatDate(run.reviewedAt)}{run.reviewedBy ? ` by ${run.reviewedBy}` : ""}</span>}
        </div>
        <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground/30 flex-shrink-0 transition-transform duration-150 ${expanded ? "rotate-180" : ""}`} />
      </div>
      {expanded && (
        <div className="px-5 pb-4 border-t border-border/15 pt-3">
          <ReviewGatePanel
            observationId={run.observationId}
            reviewStatus="declined"
            reviewedAt={run.reviewedAt}
            reviewedBy={run.reviewedBy}
          />
        </div>
      )}
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// BRAND ROW — Two-tier: Brand identity + Key metrics, Badge strip below
// ═══════════════════════════════════════════════════════════════════════════════

function BrandRow({ brand, onDelete, onExport }: {
  brand: Record<string, any>;
  onDelete: () => void;
  onExport: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  return (
    <div className="data-card rounded-xl group">
      <div className="px-5 py-4 cursor-pointer" onClick={() => setExpanded(!expanded)}>

        {/* ──── TIER 1: Identity + Metrics ──────────────────────────────────── */}
        <div className="flex items-center gap-4">

          {/* Confidence indicator */}
          <ConfidenceDot level={brand.dataConfidenceLevel} />

          {/* Name + Meta */}
          <div className="min-w-0 w-[220px] flex-shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-medium text-foreground truncate">{brand.brandName}</span>
            </div>
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              {brand.brandType && <Badge className="text-muted-foreground bg-muted/30 border-border/40 text-[9px] py-0">{brand.brandType}</Badge>}
              {brand.campaignType && <Badge className={`${CHIP_NEUTRAL.text} ${CHIP_NEUTRAL.bg} ${CHIP_NEUTRAL.border} text-[9px] py-0`}>{brand.campaignType}</Badge>}
            </div>
            {brand.brandUrl && (
              <div className="flex items-center gap-1 mt-0.5">
                <span className="text-[10px] text-muted-foreground/30 truncate max-w-[160px]">{brand.brandUrl.replace(/^https?:\/\//, "")}</span>
              </div>
            )}
          </div>

          {/* Archetype — anchor visual */}
          <div className="flex-shrink-0">
            <ArchBadge archetype={brand.archetype} />
          </div>

          {/* ── Metric cluster ── */}
          <div className="flex items-center gap-4 ml-auto flex-shrink-0">
            {/* Rating */}
            {brand.overallRating != null && (
              <div className="flex items-center gap-1">
                <Star className="w-3.5 h-3.5 text-muted-foreground/50 fill-muted-foreground/30" />
                <span className="text-sm font-semibold font-mono tabular-nums text-foreground/80">{Number(brand.overallRating).toFixed(1)}</span>
                {brand.totalReviews != null && <span className="text-[9px] text-muted-foreground/40">({brand.totalReviews})</span>}
              </div>
            )}

            {/* Sentiment */}
            {brand.mentionSentiment && brand.mentionSentiment !== "insufficient_data" && (
              <Badge className={
                brand.mentionSentiment === "positive" ? `${CHIP_NEUTRAL.text} ${CHIP_NEUTRAL.bg} ${CHIP_NEUTRAL.border}` :
                brand.mentionSentiment === "mixed" ? "text-amber-400 bg-amber-400/10 border-amber-400/30" :
                "text-red-400 bg-red-400/10 border-red-400/30"
              }>
                {brand.mentionTotalCount ? `${brand.mentionTotalCount} ` : ""}{brand.mentionSentiment}
              </Badge>
            )}

            {/* TikTok */}
            {brand.tiktokFollowerCount != null && Number(brand.tiktokFollowerCount) > 0 && (
              <div className="text-[10px] text-muted-foreground/50">
                TT {abbr(brand.tiktokFollowerCount)}
              </div>
            )}

            {/* Weight priority */}
            {brand.weightPriority && (
              <Badge className={`${CHIP_NEUTRAL.text} ${CHIP_NEUTRAL.bg} ${CHIP_NEUTRAL.border} text-[9px]`}>{brand.weightPriority}</Badge>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
            <Link href={`/brand/${brand.id}`} onClick={(e: React.MouseEvent) => e.stopPropagation()}>
              <span className="p-1.5 rounded-md hover:bg-primary/10 text-muted-foreground/40 hover:text-primary transition-colors inline-flex" title="View Profile">
                <ExternalLink className="w-3.5 h-3.5" />
              </span>
            </Link>
            <Link href="/fit-score" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
              <span className="p-1.5 rounded-md hover:bg-primary/10 text-muted-foreground/40 hover:text-primary transition-colors inline-flex" title="Run Match">
                <Zap className="w-3.5 h-3.5" />
              </span>
            </Link>
            <button className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground/40 hover:text-foreground transition-colors" onClick={(e) => { e.stopPropagation(); onExport(); }} title="Export JSON">
              <FileJson className="w-3.5 h-3.5" />
            </button>
            {confirmingDelete ? (
              <button
                className="px-2 py-1 rounded-md bg-destructive/15 text-destructive text-[10px] font-semibold hover:bg-destructive/25 transition-colors"
                onClick={(e) => { e.stopPropagation(); onDelete(); setConfirmingDelete(false); }}
                onBlur={() => setConfirmingDelete(false)}
              >
                Confirm
              </button>
            ) : (
              <button className="p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground/40 hover:text-destructive transition-colors" onClick={(e) => { e.stopPropagation(); setConfirmingDelete(true); }} title="Delete">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <span className="text-[10px] text-muted-foreground/30 flex-shrink-0 ml-2">{formatDate(brand.createdAt)}</span>
          <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground/30 flex-shrink-0 transition-transform duration-150 ${expanded ? "rotate-180" : ""}`} />
        </div>

        {/* ──── TIER 2: Badge strip ─────────────────────────────────────────── */}
        <div className="flex items-center gap-1.5 mt-2.5 ml-14 flex-wrap">
          {brand.brandTone && <Tag>{brand.brandTone}</Tag>}
          {brand.brandCulturalCapital && (
            <Badge className={`${CHIP_NEUTRAL.text} ${CHIP_NEUTRAL.bg} ${CHIP_NEUTRAL.border}`}>
              {brand.brandCulturalCapital === "Produce" ? "Producer" : "Relay"} (Bourdieu)
            </Badge>
          )}
          {brand.brandGoffmanConsistency && (
            <Badge className={GOFFMAN_COLORS[brand.brandGoffmanConsistency] ?? "text-muted-foreground bg-muted/30 border-border/50"}>
              Presentation: {brand.brandGoffmanConsistency}
            </Badge>
          )}
          {brand.brandDriftSignal && (
            <Badge className={DRIFT_COLORS[brand.brandDriftSignal] ?? "text-muted-foreground bg-muted/30 border-border/50"}>
              {brand.brandDriftSignal}
            </Badge>
          )}
          {brand.category && <Tag>{brand.category}</Tag>}
          {(brand.googleRating != null || brand.yelpRating != null) && (
            <span className="text-[10px] text-muted-foreground/40 ml-1">
              {brand.googleRating != null && `G: ${Number(brand.googleRating).toFixed(1)}★`}
              {brand.googleRating != null && brand.yelpRating != null && " · "}
              {brand.yelpRating != null && `Y: ${Number(brand.yelpRating).toFixed(1)}★`}
            </span>
          )}
        </div>
      </div>

      {/* ──── EXPANDED: AI Summary ──────────────────────────────────────────── */}
      <div className={`overflow-hidden transition-all duration-150 ease-in-out ${expanded ? "max-h-48" : "max-h-0"}`}>
        {brand.aiSummary && (
          <div className="px-5 pb-4 pt-0 border-t border-border/15">
            <p className="text-xs text-muted-foreground/60 leading-relaxed mt-3">{brand.aiSummary}</p>
          </div>
        )}
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// MATCH ROW — VS-style with rich context on both sides
// ═══════════════════════════════════════════════════════════════════════════════

function MatchRow({ match, onDelete }: {
  match: Record<string, any>;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const score = Number(match.caiScore);
  const warnings = (match.radarWarnings as string[]) ?? [];

  // The verdict is ordinal — it keeps its colour. The emoji is gone: the word
  // and the hue already carry it, and the design system sanctions exactly one
  // emoji (the footer's).
  const statusConfig = match.caiStatus === "Green Light"
    ? { color: "text-green-400", bg: "bg-green-400/10", border: "border-green-400/30" }
    : match.caiStatus === "Proceed with Caution"
    ? { color: "text-amber-400", bg: "bg-amber-400/10", border: "border-amber-400/30" }
    : { color: "text-red-400", bg: "bg-red-400/10", border: "border-red-400/30" };

  return (
    <div className="data-card rounded-xl group">
      <div className="px-5 py-4 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center gap-0">

          {/* ── LEFT: Creator ──────────────────────────────────────────────── */}
          <div className="flex-1 min-w-0 pr-5">
            <div className="flex items-center gap-3">
              {/* Creator avatar */}
              <div className="w-9 h-9 rounded-lg bg-secondary/60 border border-border/60 flex items-center justify-center flex-shrink-0">
                <span className="text-xs text-foreground/60">
                  {(match.creatorDisplayName ?? match.creatorHandle ?? "C")?.[0]?.toUpperCase()}
                </span>
              </div>
              <div className="min-w-0">
                <div className="text-[13px] font-medium text-foreground truncate">
                  {match.creatorDisplayName ?? match.creatorHandle ?? "Creator"}
                </div>
                <div className="text-[11px] text-muted-foreground/50">
                  {match.creatorHandle ? `@${match.creatorHandle}` : ""}
                </div>
              </div>
              {(match as any).creatorArchetype && (
                <ArchBadge archetype={(match as any).creatorArchetype} />
              )}
            </div>
          </div>

          {/* ── CENTER: Score hub ───────────────────────────────────────────── */}
          <div className="w-[240px] flex-shrink-0 flex items-center gap-4 px-5 border-l border-r border-border/15">
            {/* Score */}
            <div className="text-center flex-shrink-0">
              <div className="text-2xl font-semibold tabular-nums text-foreground leading-none">{score.toFixed(2)}</div>
              <Badge className={`${statusConfig.color} ${statusConfig.bg} ${statusConfig.border} text-[9px] mt-1`}>
                {match.caiStatus}
              </Badge>
            </div>

            {/* Sub-scores + PARR */}
            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex items-center gap-1">
                <span className="text-[9px] text-muted-foreground/40 font-mono w-3">α</span>
                <MiniBar value={Number(match.alignmentScoreRaw)} max={10} color="oklch(0.65 0.15 240)" />
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[9px] text-muted-foreground/40 font-mono w-3">β</span>
                <MiniBar value={Number(match.pulseScoreRaw)} max={10} color="oklch(0.65 0.15 145)" />
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[9px] text-muted-foreground/40 font-mono w-3">γ</span>
                <MiniBar value={Number(match.stabilityScoreRaw)} max={10} color="oklch(0.78 0.12 75)" />
              </div>
              <div className="flex items-center justify-between pt-0.5">
                {match.parrScore != null && (
                  <span className="text-[10px] font-mono tabular-nums text-muted-foreground/70">PARR {Number(match.parrScore)}%</span>
                )}
                {warnings.length > 0 && (
                  <span className="flex items-center gap-0.5 text-[10px] text-red-400">
                    <AlertTriangle className="w-2.5 h-2.5" />{warnings.length}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* ── RIGHT: Brand ───────────────────────────────────────────────── */}
          <div className="flex-1 min-w-0 pl-5">
            <div className="flex items-center gap-3 justify-end">
              {(match as any).brandArchetype && (
                <ArchBadge archetype={(match as any).brandArchetype} />
              )}
              <div className="min-w-0 text-right">
                <div className="text-[13px] font-medium text-foreground truncate">
                  {(match as any).brandName ?? "Brand"}
                </div>
              </div>
              {/* Brand avatar */}
              <div className="w-9 h-9 rounded-lg bg-secondary/60 border border-border/60 flex items-center justify-center flex-shrink-0">
                <span className="text-xs text-foreground/60">
                  {((match as any).brandName ?? "B")?.[0]?.toUpperCase()}
                </span>
              </div>
            </div>
          </div>

          {/* ── Date + Actions ──────────────────────────────────────────────── */}
          <div className="w-[100px] flex-shrink-0 flex items-center justify-end gap-1 pl-3">
            <span className="text-[10px] text-muted-foreground/30 mr-1">{relativeDate(match.createdAt)}</span>
            <Link href={`/report/${match.id}`} onClick={(e: React.MouseEvent) => e.stopPropagation()}>
              <span className="p-1.5 rounded-md hover:bg-primary/10 text-muted-foreground/40 hover:text-primary transition-colors inline-flex opacity-0 group-hover:opacity-100 transition-opacity" title="View Report">
                <ExternalLink className="w-3.5 h-3.5" />
              </span>
            </Link>
            <button className="p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground/40 hover:text-destructive transition-colors opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={(e) => {
                e.stopPropagation();
                if (confirmingDelete) {
                  onDelete();
                  setConfirmingDelete(false);
                } else {
                  setConfirmingDelete(true);
                }
              }}
              onBlur={() => setConfirmingDelete(false)}
              title={confirmingDelete ? "Click again to confirm" : "Delete"}
            >
              {confirmingDelete ? (
                <span className="text-[10px] font-semibold text-destructive px-0.5">Confirm</span>
              ) : (
                <Trash2 className="w-3.5 h-3.5" />
              )}
            </button>
            <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground/30 flex-shrink-0 transition-transform duration-150 ${expanded ? "rotate-180" : ""}`} />
          </div>
        </div>
      </div>

      {/* ──── EXPANDED ──────────────────────────────────────────────────────── */}
      <div className={`overflow-hidden transition-all duration-150 ease-in-out ${expanded ? "max-h-60" : "max-h-0"}`}>
        <div className="px-5 pb-4 border-t border-border/15">
          <div className="mt-3 flex items-start justify-between">
            {/* Warnings */}
            {warnings.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {warnings.map(w => (
                  <Badge key={w} className="text-red-400 bg-red-400/8 border-red-400/25">{w}</Badge>
                ))}
              </div>
            )}
            <Link href={`/report/${match.id}`}>
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 border border-primary/20 transition-colors ml-auto">
                <Eye className="w-3 h-3" />
                Full Match Report
              </span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// MAIN LIBRARY COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export default function Library() {
  const [, setLocation] = useLocation();
  const urlParams = new URLSearchParams(window.location.search);
  const initialTab = (urlParams.get("tab") as TabKey) || "creators";
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab);

  const switchTab = useCallback((tab: TabKey) => {
    setActiveTab(tab);
    window.history.replaceState(null, "", `/library?tab=${tab}`);
  }, []);

  useEffect(() => {
    const handler = () => {
      const params = new URLSearchParams(window.location.search);
      const t = params.get("tab") as TabKey;
      if (t && t !== activeTab) setActiveTab(t);
    };
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, [activeTab]);

  // ─── Search & Filters ──────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [creatorFilters, setCreatorFilters] = useState<{ platform?: string; archetype?: string; confidence?: string; lifecycle?: string }>({});
  const [brandFilters, setBrandFilters] = useState<{ brandType?: string; archetype?: string; confidence?: string; sentiment?: string }>({});
  const [matchFilters, setMatchFilters] = useState<{ status?: string; confidence?: string }>({});

  // ─── Data ──────────────────────────────────────────────────────────
  const utils = trpc.useUtils();
  const { data: creators, isLoading: loadingCreators } = trpc.creator.list.useQuery({});
  const { data: brands, isLoading: loadingBrands } = trpc.brand.list.useQuery({});
  const { data: matches, isLoading: loadingMatches } = trpc.fit.list.useQuery();
  // Archived (declined) creator runs — womo_0006; loaded only when viewing
  const [showArchived, setShowArchived] = useState(false);
  const { data: archivedRuns, isLoading: loadingArchived } = trpc.creator.listArchived.useQuery(
    undefined,
    { enabled: showArchived },
  );

  const deleteCreator = trpc.creator.delete.useMutation({
    onSuccess: () => { utils.creator.list.invalidate(); toast.success("Creator deleted"); },
    onError: () => toast.error("Failed to delete"),
  });
  const deleteBrand = trpc.brand.delete.useMutation({
    onSuccess: () => { utils.brand.list.invalidate(); toast.success("Brand deleted"); },
    onError: () => toast.error("Failed to delete"),
  });
  const deleteMatch = trpc.fit.delete.useMutation({
    onSuccess: () => { utils.fit.list.invalidate(); toast.success("Match deleted"); },
    onError: () => toast.error("Failed to delete"),
  });

  const handleExportCreator = useCallback((creator: NonNullable<typeof creators>[0]) => {
    const blob = new Blob([JSON.stringify(creator, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = `connex-creator-${creator.handle}-${new Date().toISOString().split("T")[0]}.json`;
    a.click(); URL.revokeObjectURL(url); toast.success("Exported");
  }, []);

  const handleExportBrand = useCallback((brand: NonNullable<typeof brands>[0]) => {
    const blob = new Blob([JSON.stringify(brand, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = `connex-brand-${brand.brandName}-${new Date().toISOString().split("T")[0]}.json`;
    a.click(); URL.revokeObjectURL(url); toast.success("Exported");
  }, []);

  // ─── Filtered data ─────────────────────────────────────────────────
  const filteredCreators = useMemo(() => {
    if (!creators) return [];
    return creators.filter(c => {
      if (!matchesSearch(searchQuery, c.displayName, c.handle, c.archetype, c.nicheTopicNode, c.toneRegister, c.aiSummary, c.primaryRegion)) return false;
      if (creatorFilters.platform && c.platform?.toLowerCase() !== creatorFilters.platform.toLowerCase()) return false;
      if (creatorFilters.archetype && c.archetype !== creatorFilters.archetype) return false;
      if (creatorFilters.confidence && c.dataConfidenceLevel !== creatorFilters.confidence) return false;
      if (creatorFilters.lifecycle && c.lifecyclePhase !== creatorFilters.lifecycle) return false;
      return true;
    });
  }, [creators, searchQuery, creatorFilters]);

  const filteredBrands = useMemo(() => {
    if (!brands) return [];
    return brands.filter(b => {
      if (!matchesSearch(searchQuery, b.brandName, b.category, b.brandType, b.archetype, b.emotionalPromise, b.audienceTribe, b.brandTone, b.campaignType, b.aiSummary)) return false;
      if (brandFilters.brandType && b.brandType !== brandFilters.brandType) return false;
      if (brandFilters.archetype && b.archetype !== brandFilters.archetype) return false;
      if (brandFilters.confidence && b.dataConfidenceLevel !== brandFilters.confidence) return false;
      if (brandFilters.sentiment && b.mentionSentiment !== brandFilters.sentiment) return false;
      return true;
    });
  }, [brands, searchQuery, brandFilters]);

  const filteredMatches = useMemo(() => {
    if (!matches) return [];
    return matches.filter(m => {
      if (!matchesSearch(searchQuery, m.creatorHandle, m.creatorDisplayName, (m as any).brandName, m.caiStatus)) return false;
      if (matchFilters.status && m.caiStatus !== matchFilters.status) return false;
      return true;
    });
  }, [matches, searchQuery, matchFilters]);

  const totalCreators = creators?.length ?? 0;
  const totalBrands = brands?.length ?? 0;
  const totalMatches = matches?.length ?? 0;

  const activeFilterList = useMemo(() => {
    const chips: { key: string; value: string }[] = [];
    if (activeTab === "creators") {
      if (creatorFilters.platform) chips.push({ key: "platform", value: creatorFilters.platform });
      if (creatorFilters.archetype) chips.push({ key: "archetype", value: creatorFilters.archetype });
      if (creatorFilters.confidence) chips.push({ key: "confidence", value: creatorFilters.confidence });
      if (creatorFilters.lifecycle) chips.push({ key: "lifecycle", value: creatorFilters.lifecycle });
    } else if (activeTab === "brands") {
      if (brandFilters.brandType) chips.push({ key: "brandType", value: brandFilters.brandType });
      if (brandFilters.archetype) chips.push({ key: "archetype", value: brandFilters.archetype });
      if (brandFilters.confidence) chips.push({ key: "confidence", value: brandFilters.confidence });
      if (brandFilters.sentiment) chips.push({ key: "sentiment", value: brandFilters.sentiment });
    } else {
      if (matchFilters.status) chips.push({ key: "status", value: matchFilters.status });
    }
    return chips;
  }, [activeTab, creatorFilters, brandFilters, matchFilters]);

  const removeFilter = useCallback((key: string) => {
    if (activeTab === "creators") setCreatorFilters(f => ({ ...f, [key]: undefined }));
    else if (activeTab === "brands") setBrandFilters(f => ({ ...f, [key]: undefined }));
    else setMatchFilters(f => ({ ...f, [key]: undefined }));
  }, [activeTab]);

  const availableBrandTypes = useMemo(() => {
    if (!brands) return [];
    return Array.from(new Set(brands.map(b => b.brandType).filter(Boolean) as string[]));
  }, [brands]);

  const showing = activeTab === "creators" ? filteredCreators.length : activeTab === "brands" ? filteredBrands.length : filteredMatches.length;
  const total = activeTab === "creators" ? totalCreators : activeTab === "brands" ? totalBrands : totalMatches;
  const hasFilter = searchQuery || activeFilterList.length > 0;
  const isLoading = activeTab === "creators" ? loadingCreators : activeTab === "brands" ? loadingBrands : loadingMatches;

  return (
    <div className="min-h-full px-6 py-8 lg:px-10 lg:py-10">
      {/* Header */}
      <div className="mb-6 animate-fade-in-up">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-secondary/60 border border-border/60 flex items-center justify-center">
            <BookOpen className="w-5 h-5 text-muted-foreground/70" />
          </div>
          <div>
            <h1 className="text-2xl font-serif">Profile Library</h1>
            <p className="text-sm text-muted-foreground">Browse and manage all saved profiles and match records</p>
          </div>
        </div>
      </div>

      {/* ─── Tabs ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-0 mb-5 border-b border-border/30 animate-fade-in-up animate-stagger-1">
        {([
          { key: "creators" as TabKey, icon: Users, label: "Creators", count: totalCreators },
          { key: "brands" as TabKey, icon: Building2, label: "Brands", count: totalBrands },
          { key: "matches" as TabKey, icon: BarChart3, label: "Matches", count: totalMatches },
        ] as const).map(tab => (
          <button
            key={tab.key}
            onClick={() => switchTab(tab.key)}
            className={`flex items-center gap-2 px-5 py-3 text-sm font-medium transition-all duration-150 border-b-2 -mb-[1px] ${
              activeTab === tab.key ? "border-primary text-foreground" : "border-transparent text-muted-foreground/60 hover:text-muted-foreground"
            }`}
          >
            <tab.icon className="w-3.5 h-3.5" />
            {tab.label}
            <span className={`text-xs ml-0.5 ${activeTab === tab.key ? "text-primary" : "text-muted-foreground/40"}`}>({tab.count})</span>
          </button>
        ))}
      </div>

      {/* ─── Search + Filter + Action ─────────────────────────────────────── */}
      <div className="flex items-center gap-3 mb-3 animate-fade-in-up animate-stagger-2">
        <div className="relative flex-1 max-w-lg">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/40" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={activeTab === "creators" ? "Search creators..." : activeTab === "brands" ? "Search brands..." : "Search matches..."}
            className="pl-9 bg-secondary border-border text-sm"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-foreground transition-colors">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border transition-all duration-150 ${
            showFilters || activeFilterList.length > 0 ? "border-primary/40 bg-primary/10 text-primary" : "border-border/40 bg-secondary text-muted-foreground hover:text-foreground"
          }`}
        >
          <Filter className="w-3 h-3" />
          Filters
          {activeFilterList.length > 0 && (
            <span className="ml-1 w-4 h-4 rounded-full bg-primary/20 text-primary text-[10px] flex items-center justify-center">{activeFilterList.length}</span>
          )}
        </button>
        {activeTab === "creators" && (
          <button
            onClick={() => setShowArchived(v => !v)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border transition-all duration-150 ${
              showArchived ? "border-red-400/50 bg-red-400/10 text-red-400" : "border-border/40 bg-secondary text-muted-foreground hover:text-foreground"
            }`}
            title="Declined runs are archived — retained with full provenance, hidden from the default view"
          >
            <Archive className="w-3 h-3" />
            Archived
            {showArchived && archivedRuns && (
              <span className="ml-1 w-4 h-4 rounded-full bg-red-400/20 text-red-400 text-[10px] tabular-nums flex items-center justify-center">{archivedRuns.length}</span>
            )}
          </button>
        )}
        <div className="text-xs text-muted-foreground/50 ml-auto">
          {hasFilter ? `Showing ${showing} of ${total}` : `${total} ${activeTab}`}
        </div>
        <Link href={activeTab === "creators" ? "/analyze/creator" : activeTab === "brands" ? "/analyze/brand" : "/fit-score"}>
          <Button size="sm" className="bg-primary hover:bg-primary-hover text-primary-foreground font-semibold">
            + {activeTab === "creators" ? "Analyze Creator" : activeTab === "brands" ? "Analyze Brand" : "New Match"}
          </Button>
        </Link>
      </div>

      {/* ─── Filters Panel ────────────────────────────────────────────────── */}
      <div className={`overflow-hidden transition-all duration-150 ease-in-out ${showFilters ? "max-h-80 opacity-100 mb-3" : "max-h-0 opacity-0"}`}>
        <div className="data-card rounded-xl p-4">
          {activeTab === "creators" && (
            <div className="space-y-3">
              <div>
                <div className="text-[10px] font-semibold uppercase text-muted-foreground/40 mb-1.5">Platform</div>
                <div className="flex flex-wrap gap-1.5">
                  <FilterChip label="All" active={!creatorFilters.platform} onClick={() => setCreatorFilters(f => ({ ...f, platform: undefined }))} />
                  {/* Supported platforms only — YouTube is disabled. The label,
                      colour and icon for "youtube" are deliberately KEPT below
                      so legacy YouTube rows still render correctly in the list;
                      they just can no longer be filtered for or re-analysed. */}
                  {["tiktok", "instagram"].map(p => (
                    <FilterChip key={p} label={PLATFORM_LABELS[p] ?? p} active={creatorFilters.platform === p} onClick={() => setCreatorFilters(f => ({ ...f, platform: f.platform === p ? undefined : p }))} />
                  ))}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-semibold uppercase text-muted-foreground/40 mb-1.5">Archetype</div>
                <div className="flex flex-wrap gap-1.5">
                  <FilterChip label="All" active={!creatorFilters.archetype} onClick={() => setCreatorFilters(f => ({ ...f, archetype: undefined }))} />
                  {ARCHETYPES.map(a => (
                    <FilterChip key={a} label={a} active={creatorFilters.archetype === a} onClick={() => setCreatorFilters(f => ({ ...f, archetype: f.archetype === a ? undefined : a }))} />
                  ))}
                </div>
              </div>
              <div className="flex gap-6">
                <div>
                  <div className="text-[10px] font-semibold uppercase text-muted-foreground/40 mb-1.5">Confidence</div>
                  <div className="flex flex-wrap gap-1.5">
                    <FilterChip label="All" active={!creatorFilters.confidence} onClick={() => setCreatorFilters(f => ({ ...f, confidence: undefined }))} />
                    {CONFIDENCE_LEVELS.map(c => (
                      <FilterChip key={c} label={c.charAt(0).toUpperCase() + c.slice(1)} active={creatorFilters.confidence === c} onClick={() => setCreatorFilters(f => ({ ...f, confidence: f.confidence === c ? undefined : c }))} />
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-semibold uppercase text-muted-foreground/40 mb-1.5">Lifecycle</div>
                  <div className="flex flex-wrap gap-1.5">
                    <FilterChip label="All" active={!creatorFilters.lifecycle} onClick={() => setCreatorFilters(f => ({ ...f, lifecycle: undefined }))} />
                    {["Emergence", "Growth", "Maturity", "Decline"].map(l => (
                      <FilterChip key={l} label={l} active={creatorFilters.lifecycle === l} onClick={() => setCreatorFilters(f => ({ ...f, lifecycle: f.lifecycle === l ? undefined : l }))} />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
          {activeTab === "brands" && (
            <div className="space-y-3">
              {availableBrandTypes.length > 0 && (
                <div>
                  <div className="text-[10px] font-semibold uppercase text-muted-foreground/40 mb-1.5">Brand Type</div>
                  <div className="flex flex-wrap gap-1.5">
                    <FilterChip label="All" active={!brandFilters.brandType} onClick={() => setBrandFilters(f => ({ ...f, brandType: undefined }))} />
                    {availableBrandTypes.map(t => (
                      <FilterChip key={t} label={t} active={brandFilters.brandType === t} onClick={() => setBrandFilters(f => ({ ...f, brandType: f.brandType === t ? undefined : t }))} />
                    ))}
                  </div>
                </div>
              )}
              <div>
                <div className="text-[10px] font-semibold uppercase text-muted-foreground/40 mb-1.5">Archetype</div>
                <div className="flex flex-wrap gap-1.5">
                  <FilterChip label="All" active={!brandFilters.archetype} onClick={() => setBrandFilters(f => ({ ...f, archetype: undefined }))} />
                  {ARCHETYPES.map(a => (
                    <FilterChip key={a} label={a} active={brandFilters.archetype === a} onClick={() => setBrandFilters(f => ({ ...f, archetype: f.archetype === a ? undefined : a }))} />
                  ))}
                </div>
              </div>
              <div className="flex gap-6">
                <div>
                  <div className="text-[10px] font-semibold uppercase text-muted-foreground/40 mb-1.5">Confidence</div>
                  <div className="flex flex-wrap gap-1.5">
                    <FilterChip label="All" active={!brandFilters.confidence} onClick={() => setBrandFilters(f => ({ ...f, confidence: undefined }))} />
                    {CONFIDENCE_LEVELS.map(c => (
                      <FilterChip key={c} label={c.charAt(0).toUpperCase() + c.slice(1)} active={brandFilters.confidence === c} onClick={() => setBrandFilters(f => ({ ...f, confidence: f.confidence === c ? undefined : c }))} />
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-semibold uppercase text-muted-foreground/40 mb-1.5">Sentiment</div>
                  <div className="flex flex-wrap gap-1.5">
                    <FilterChip label="All" active={!brandFilters.sentiment} onClick={() => setBrandFilters(f => ({ ...f, sentiment: undefined }))} />
                    {["positive", "mixed", "negative"].map(s => (
                      <FilterChip key={s} label={s.charAt(0).toUpperCase() + s.slice(1)} active={brandFilters.sentiment === s} onClick={() => setBrandFilters(f => ({ ...f, sentiment: f.sentiment === s ? undefined : s }))} />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
          {activeTab === "matches" && (
            <div className="space-y-3">
              <div>
                <div className="text-[10px] font-semibold uppercase text-muted-foreground/40 mb-1.5">Status</div>
                <div className="flex flex-wrap gap-1.5">
                  <FilterChip label="All" active={!matchFilters.status} onClick={() => setMatchFilters(f => ({ ...f, status: undefined }))} />
                  {["Green Light", "Proceed with Caution", "Do Not Proceed"].map(s => (
                    <FilterChip key={s} label={s} active={matchFilters.status === s} onClick={() => setMatchFilters(f => ({ ...f, status: f.status === s ? undefined : s }))} />
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <ActiveFilterChips filters={activeFilterList} onRemove={removeFilter} />

      {/* ─── Content ──────────────────────────────────────────────────────── */}
      {isLoading ? (
        <div className="space-y-2 animate-fade-in-up">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="data-card rounded-xl px-5 py-4">
              <div className="flex items-center gap-4">
                <div className="w-2 h-2 rounded-full bg-muted-foreground/10 animate-pulse" />
                <div className="space-y-1.5 flex-1">
                  <div className="h-3.5 w-36 rounded bg-muted-foreground/10 animate-pulse" />
                  <div className="h-2.5 w-24 rounded bg-muted-foreground/5 animate-pulse" />
                </div>
                <div className="h-5 w-16 rounded-full bg-muted-foreground/8 animate-pulse" />
                <div className="flex gap-5 ml-auto">
                  <div className="space-y-1 text-center">
                    <div className="h-3.5 w-10 rounded bg-muted-foreground/10 animate-pulse mx-auto" />
                    <div className="h-2 w-8 rounded bg-muted-foreground/5 animate-pulse mx-auto" />
                  </div>
                  <div className="space-y-1 text-center">
                    <div className="h-3.5 w-10 rounded bg-muted-foreground/10 animate-pulse mx-auto" />
                    <div className="h-2 w-8 rounded bg-muted-foreground/5 animate-pulse mx-auto" />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-2 animate-fade-in-up animate-stagger-3">
          {activeTab === "creators" && showArchived && (
            <>
              <div className="text-[11px] text-muted-foreground/60 px-1 pb-1">
                Archived (declined) analysis runs — retained with full provenance for scraper-failure analysis. Never deleted.
              </div>
              {loadingArchived ? (
                <div className="text-center py-10 text-muted-foreground text-sm animate-pulse">Loading archived runs…</div>
              ) : !archivedRuns || archivedRuns.length === 0 ? (
                <div className="data-card rounded-xl p-10 text-center text-muted-foreground text-sm">No declined runs.</div>
              ) : archivedRuns.map(run => (
                <ArchivedRunRow key={run.observationId} run={run} />
              ))}
            </>
          )}

          {activeTab === "creators" && !showArchived && (
            filteredCreators.length === 0 ? (
              <div className="data-card rounded-xl p-16 flex flex-col items-center justify-center text-center">
                <Users className="w-10 h-10 text-muted-foreground/20 mb-4" />
                <p className="text-muted-foreground">{searchQuery ? "No creators match your search" : "No creator profiles yet"}</p>
                {!searchQuery && <Link href="/analyze/creator"><Button size="sm" variant="outline" className="mt-4 border-primary/30 text-primary">Analyze your first creator</Button></Link>}
              </div>
            ) : filteredCreators.map(c => (
              <CreatorRow key={c.id} creator={c} onDelete={() => deleteCreator.mutate({ id: c.id })} onExport={() => handleExportCreator(c)} />
            ))
          )}

          {activeTab === "brands" && (
            filteredBrands.length === 0 ? (
              <div className="data-card rounded-xl p-16 flex flex-col items-center justify-center text-center">
                <Building2 className="w-10 h-10 text-muted-foreground/20 mb-4" />
                <p className="text-muted-foreground">{searchQuery ? "No brands match your search" : "No brand profiles yet"}</p>
                {!searchQuery && <Link href="/analyze/brand"><Button size="sm" variant="outline" className="mt-4 border-primary/30 text-primary">Analyze your first brand</Button></Link>}
              </div>
            ) : filteredBrands.map(b => (
              <BrandRow key={b.id} brand={b} onDelete={() => deleteBrand.mutate({ id: b.id })} onExport={() => handleExportBrand(b)} />
            ))
          )}

          {activeTab === "matches" && (
            filteredMatches.length === 0 ? (
              <div className="data-card rounded-xl p-16 flex flex-col items-center justify-center text-center">
                <BarChart3 className="w-10 h-10 text-muted-foreground/20 mb-4" />
                <p className="text-muted-foreground">{searchQuery ? "No matches found" : "No F.I.T. reports yet"}</p>
                {!searchQuery && <Link href="/fit-score"><Button size="sm" variant="outline" className="mt-4 border-primary/30 text-primary">Calculate your first Cultural Match Score</Button></Link>}
              </div>
            ) : filteredMatches.map(m => (
              <MatchRow key={m.id} match={m} onDelete={() => deleteMatch.mutate({ id: m.id })} />
            ))
          )}
        </div>
      )}
    </div>
  );
}
