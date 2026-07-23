import { useState, useMemo, useCallback, useEffect } from "react";
import { Link, useLocation } from "wouter";
import {
  BookOpen, Users, Building2, BarChart3, Search, Trash2,
  ExternalLink, FileJson, ChevronDown, Filter,
  X, Zap, Star, MapPin, FileText, Clock, Activity,
  AlertTriangle, Eye, TrendingUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════

const ARCHETYPE_COLORS: Record<string, { text: string; bg: string; border: string }> = {
  Hero:             { text: "text-red-400",    bg: "bg-red-400/10",    border: "border-red-400/30" },
  Sage:             { text: "text-blue-400",   bg: "bg-blue-400/10",   border: "border-blue-400/30" },
  Explorer:         { text: "text-teal-400",   bg: "bg-teal-400/10",   border: "border-teal-400/30" },
  Outlaw:           { text: "text-orange-400", bg: "bg-orange-400/10", border: "border-orange-400/30" },
  Magician:         { text: "text-purple-400", bg: "bg-purple-400/10", border: "border-purple-400/30" },
  "Regular Person": { text: "text-slate-400",  bg: "bg-slate-400/10",  border: "border-slate-400/30" },
  Everyman:         { text: "text-slate-400",  bg: "bg-slate-400/10",  border: "border-slate-400/30" },
  Lover:            { text: "text-pink-400",   bg: "bg-pink-400/10",   border: "border-pink-400/30" },
  Jester:           { text: "text-yellow-400", bg: "bg-yellow-400/10", border: "border-yellow-400/30" },
  Caregiver:        { text: "text-green-400",  bg: "bg-green-400/10",  border: "border-green-400/30" },
  Ruler:            { text: "text-indigo-400", bg: "bg-indigo-400/10", border: "border-indigo-400/30" },
  Creator:          { text: "text-violet-400", bg: "bg-violet-400/10", border: "border-violet-400/30" },
  Innocent:         { text: "text-sky-400",    bg: "bg-sky-400/10",    border: "border-sky-400/30" },
};

const DRIFT_COLORS: Record<string, string> = {
  "Zero Change": "text-green-400 bg-green-400/10 border-green-400/30",
  "Minor Drift": "text-yellow-400 bg-yellow-400/10 border-yellow-400/30",
  "Significant Drift": "text-orange-400 bg-orange-400/10 border-orange-400/30",
  "Full Pivot": "text-red-400 bg-red-400/10 border-red-400/30",
};

const VELOCITY_COLORS: Record<string, string> = {
  Focusing: "text-green-400 bg-green-400/10 border-green-400/30",
  Drifting: "text-orange-400 bg-orange-400/10 border-orange-400/30",
  "Insufficient Data": "text-muted-foreground bg-muted/30 border-border/50",
};

const GOFFMAN_COLORS: Record<string, string> = {
  Consistent: "text-green-400 bg-green-400/10 border-green-400/30",
  "Minor Gap": "text-yellow-400 bg-yellow-400/10 border-yellow-400/30",
  "Significant Gap": "text-red-400 bg-red-400/10 border-red-400/30",
};

const PLATFORM_COLORS: Record<string, string> = {
  tiktok: "text-cyan-400 bg-cyan-400/8 border-cyan-400/25",
  instagram: "text-pink-400 bg-pink-400/8 border-pink-400/25",
  youtube: "text-red-400 bg-red-400/8 border-red-400/25",
};

const PLATFORM_LABELS: Record<string, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  youtube: "YouTube",
};

function PlatformIcon({ platform, className = "w-3.5 h-3.5" }: { platform: string; className?: string }) {
  const p = platform?.toLowerCase();
  if (p === "tiktok") return (
    <svg className={`${className} text-cyan-400`} viewBox="0 0 24 24" fill="currentColor">
      <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.27 6.27 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.75a8.18 8.18 0 004.77 1.52V6.84a4.84 4.84 0 01-1-.15z" />
    </svg>
  );
  if (p === "instagram") return (
    <svg className={`${className} text-pink-400`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="17.5" cy="6.5" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
  if (p === "youtube") return (
    <svg className={`${className} text-red-400`} viewBox="0 0 24 24" fill="currentColor">
      <path d="M23.5 6.19a3.02 3.02 0 00-2.12-2.14C19.54 3.5 12 3.5 12 3.5s-7.54 0-9.38.55A3.02 3.02 0 00.5 6.19 31.6 31.6 0 000 12a31.6 31.6 0 00.5 5.81 3.02 3.02 0 002.12 2.14c1.84.55 9.38.55 9.38.55s7.54 0 9.38-.55a3.02 3.02 0 002.12-2.14A31.6 31.6 0 0024 12a31.6 31.6 0 00-.5-5.81zM9.55 15.57V8.43L15.82 12l-6.27 3.57z" />
    </svg>
  );
  return null;
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

function getArchStyle(a: string | null | undefined) {
  if (!a) return { text: "text-muted-foreground", bg: "bg-muted/30", border: "border-border/50" };
  return ARCHETYPE_COLORS[a] ?? { text: "text-primary", bg: "bg-primary/10", border: "border-primary/30" };
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
  const c = level === "high" ? "bg-green-400 shadow-green-400/40" : level === "medium" ? "bg-yellow-400 shadow-yellow-400/40" : "bg-red-400 shadow-red-400/40";
  return <span className={`w-2 h-2 rounded-full ${c} shadow-sm`} title={`${level} confidence`} />;
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
    <div className={`fit-card rounded-xl transition-all duration-150 group ${
      isPending
        ? "border-l-4 border-l-amber-400 border-amber-400/40 bg-amber-400/[0.04] hover:border-amber-400/60"
        : "hover:border-primary/20"
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
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-amber-400/60 bg-amber-400/15 text-amber-300 text-[9px] font-bold uppercase tracking-wider flex-shrink-0">
                  <Clock className="w-2.5 h-2.5" />
                  Pending Review
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <PlatformIcon platform={creator.platform} />
              <span className="text-[11px] text-muted-foreground/50">@{creator.handle}</span>
            </div>
            {creator.primaryRegion && (
              <div className="flex items-center gap-0.5 text-[10px] text-muted-foreground/40 mt-0.5">
                <MapPin className="w-2.5 h-2.5" />{creator.primaryRegion}
              </div>
            )}
          </div>

          {/* Archetype — anchor visual */}
          <div className="flex-shrink-0">
            <ArchBadge archetype={creator.archetype} />
          </div>

          {/* Niche */}
          {creator.nicheTopicNode && (
            <div className="hidden xl:block flex-shrink-0 max-w-[220px]">
              <div className="text-[10px] text-muted-foreground/60 truncate">{creator.nicheTopicNode}</div>
            </div>
          )}

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
              <span className="p-1.5 rounded-md hover:bg-cyan-400/10 text-muted-foreground/40 hover:text-cyan-400 transition-colors inline-flex" title="Run Match">
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
            {creator.rogersAdopterStage && (
              <Badge className="text-cyan-400 bg-cyan-400/8 border-cyan-400/25">{creator.rogersAdopterStage}</Badge>
            )}
            {creator.turnerLiminalPhase && (
              <Badge className="text-amber-400 bg-amber-400/8 border-amber-400/25">{creator.turnerLiminalPhase}</Badge>
            )}
            {creator.lifecyclePhase && (
              <Badge className="text-violet-400 bg-violet-400/8 border-violet-400/25">{creator.lifecyclePhase}</Badge>
            )}
            {creator.culturalVelocity && (
              <Badge className={VELOCITY_COLORS[creator.culturalVelocity] ?? "text-muted-foreground bg-muted/30 border-border/50"}>
                {creator.culturalVelocity}
              </Badge>
            )}
            {(creator.undergroundDensity || creator.mainstreamBleed) && (
              <Badge className={
                creator.undergroundDensity && !creator.mainstreamBleed ? "text-purple-400 bg-purple-400/8 border-purple-400/25"
                : !creator.undergroundDensity && creator.mainstreamBleed ? "text-sky-400 bg-sky-400/8 border-sky-400/25"
                : "text-muted-foreground bg-muted/30 border-border/50"
              }>
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
    <div className="fit-card rounded-xl hover:border-primary/20 transition-all duration-150 group">
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
              {brand.campaignType && <Badge className="text-purple-400/70 bg-purple-400/8 border-purple-400/20 text-[9px] py-0">{brand.campaignType}</Badge>}
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

          {/* Promise / Tone compact */}
          <div className="hidden xl:block flex-shrink-0 max-w-[200px]">
            {brand.emotionalPromise && (
              <div className="text-[10px] text-muted-foreground/50 truncate">{brand.emotionalPromise}</div>
            )}
            {brand.audienceTribe && (
              <div className="text-[10px] text-muted-foreground/40 truncate">{brand.audienceTribe}</div>
            )}
          </div>

          {/* ── Metric cluster ── */}
          <div className="flex items-center gap-4 ml-auto flex-shrink-0">
            {/* Rating */}
            {brand.overallRating != null && (
              <div className="flex items-center gap-1">
                <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
                <span className="text-sm font-semibold font-mono text-amber-400">{Number(brand.overallRating).toFixed(1)}</span>
                {brand.totalReviews != null && <span className="text-[9px] text-muted-foreground/40">({brand.totalReviews})</span>}
              </div>
            )}

            {/* Sentiment */}
            {brand.mentionSentiment && brand.mentionSentiment !== "insufficient_data" && (
              <Badge className={
                brand.mentionSentiment === "positive" ? "text-green-400 bg-green-400/10 border-green-400/30" :
                brand.mentionSentiment === "mixed" ? "text-yellow-400 bg-yellow-400/10 border-yellow-400/30" :
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
              <Badge className="text-primary/70 bg-primary/8 border-primary/25 text-[9px]">{brand.weightPriority}</Badge>
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
              <span className="p-1.5 rounded-md hover:bg-cyan-400/10 text-muted-foreground/40 hover:text-cyan-400 transition-colors inline-flex" title="Run Match">
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
            <Badge className="text-amber-400 bg-amber-400/8 border-amber-400/25">
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

  const statusConfig = match.caiStatus === "Green Light"
    ? { color: "text-green-400", bg: "bg-green-400/10", border: "border-green-400/30", icon: "🟢" }
    : match.caiStatus === "Proceed with Caution"
    ? { color: "text-yellow-400", bg: "bg-yellow-400/10", border: "border-yellow-400/30", icon: "🟡" }
    : { color: "text-red-400", bg: "bg-red-400/10", border: "border-red-400/30", icon: "🔴" };

  return (
    <div className="fit-card rounded-xl hover:border-primary/20 transition-all duration-150 group">
      <div className="px-5 py-4 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center gap-0">

          {/* ── LEFT: Creator ──────────────────────────────────────────────── */}
          <div className="flex-1 min-w-0 pr-5">
            <div className="flex items-center gap-3">
              {/* Creator avatar */}
              <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-400/20 to-blue-400/5 border border-blue-400/15 flex items-center justify-center flex-shrink-0">
                <span className="text-xs font-serif text-blue-400/80">
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
              <div className="text-2xl font-serif gold-text leading-none">{score.toFixed(2)}</div>
              <Badge className={`${statusConfig.color} ${statusConfig.bg} ${statusConfig.border} text-[9px] mt-1`}>
                {statusConfig.icon} {match.caiStatus}
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
                  <span className="text-[10px] font-mono text-cyan-400">PARR {Number(match.parrScore)}%</span>
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
              <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-green-400/20 to-green-400/5 border border-green-400/15 flex items-center justify-center flex-shrink-0">
                <span className="text-xs font-serif text-green-400/80">
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
          <div className="w-10 h-10 rounded-xl bg-purple-400/10 border border-purple-400/20 flex items-center justify-center">
            <BookOpen className="w-5 h-5 text-purple-400" />
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
        <div className="text-xs text-muted-foreground/50 ml-auto">
          {hasFilter ? `Showing ${showing} of ${total}` : `${total} ${activeTab}`}
        </div>
        <Link href={activeTab === "creators" ? "/analyze/creator" : activeTab === "brands" ? "/analyze/brand" : "/fit-score"}>
          <Button size="sm" className="gold-gradient text-background font-semibold">
            + {activeTab === "creators" ? "Analyze Creator" : activeTab === "brands" ? "Analyze Brand" : "New Match"}
          </Button>
        </Link>
      </div>

      {/* ─── Filters Panel ────────────────────────────────────────────────── */}
      <div className={`overflow-hidden transition-all duration-150 ease-in-out ${showFilters ? "max-h-80 opacity-100 mb-3" : "max-h-0 opacity-0"}`}>
        <div className="fit-card rounded-xl p-4">
          {activeTab === "creators" && (
            <div className="space-y-3">
              <div>
                <div className="text-[10px] font-semibold uppercase text-muted-foreground/40 mb-1.5">Platform</div>
                <div className="flex flex-wrap gap-1.5">
                  <FilterChip label="All" active={!creatorFilters.platform} onClick={() => setCreatorFilters(f => ({ ...f, platform: undefined }))} />
                  {["tiktok", "instagram", "youtube"].map(p => (
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
            <div key={i} className="fit-card rounded-xl px-5 py-4">
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
          {activeTab === "creators" && (
            filteredCreators.length === 0 ? (
              <div className="fit-card rounded-xl p-16 flex flex-col items-center justify-center text-center">
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
              <div className="fit-card rounded-xl p-16 flex flex-col items-center justify-center text-center">
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
              <div className="fit-card rounded-xl p-16 flex flex-col items-center justify-center text-center">
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
