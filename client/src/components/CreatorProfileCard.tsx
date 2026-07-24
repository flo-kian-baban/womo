import { MapPin, Users, Heart, Play, TrendingUp, Video, Hash, Tag, Film, Mic, Plus, ExternalLink, AlertTriangle, CheckCircle2, Loader2, AlertCircle, Clock, Shield, ChevronDown, ChevronUp, Activity, Cpu, Globe, Gauge, Timer, Zap, Database, DollarSign } from "lucide-react";
import { MetricTooltip } from "@/components/MetricTooltip";
import TranscriptPanel from "./TranscriptPanel";
import FieldExplainer, { EXPLAINED_FIELD_KEYS } from "./FieldExplainer";
import { trpc } from "../lib/trpc";
import { toast } from "sonner";
import { useState } from "react";
import { MODEL_PRICING } from "@shared/llmPricing";
import { PendingReviewBanner, ReviewStatusBadge } from "./ReviewGate";

// Flattened creator profile as returned by getCreatorProfileById in db.ts.
// Uses Record<string, any> base so field access with `as` casts works
// regardless of which fields the V2 schema exposes directly.
type CreatorProfile = Record<string, any> & { id: string };

interface CreatorProfileCardProps {
  profile: CreatorProfile;
  compact?: boolean;
  onReanalyze?: () => void;
  isReanalyzing?: boolean;
  pipelineMetrics?: {
    totalDurationMs: number;
    steps: Array<{ step: string; durationMs: number }>;
    tokens: { inputTokens: number; outputTokens: number; totalTokens: number; llmCalls: number; model: string };
    transcriptCount: number;
    videosScraped: number;
  };
}

const FIELD_SECTIONS = [
  {
    title: "Field Note Two: Creator Snapshot",
    subtitle: "Jungian Archetype & Cultural Identity",
    fields: [
      { key: "archetype", label: "Archetype [Jung]", type: "badge" },
      { key: "recurringThemes", label: "Recurring Themes", type: "tags" },
      { key: "toneRegister", label: "Tone & Register", type: "text" },
      { key: "parasocialBondStrength", label: "Parasocial Bond Strength", type: "score-5" },
      { key: "audienceRelationshipType", label: "Audience Relationship Type", type: "badge" },
      { key: "barthesMyth", label: "Myth Question [Barthes]", type: "quote" },
      { key: "culturalCapital", label: "Cultural Capital [Bourdieu]", type: "badge" },
      { key: "goffmanStageConsistency", label: "Stage Test [Goffman]", type: "status" },
      { key: "driftSignal", label: "Drift Signal (6-Month)", type: "status" },
      { key: "stuartHallDecoding", label: "Decoding Audit [Stuart Hall]", type: "status" },
    ],
  },
  {
    title: "Field Note Three: Cultural Snapshot",
    subtitle: "Niche Positioning & Lifecycle Analysis",
    fields: [
      { key: "nicheTopicNode", label: "Topic Node", type: "text" },
      { key: "rogersAdopterStage", label: "Rogers Adopter Stage", type: "badge" },
      { key: "creatorNichePosition", label: "Creator's Niche Position", type: "status" },
      { key: "lifecyclePhase", label: "Lifecycle Phase [PAE]", type: "badge" },
      { key: "turnerLiminalPhase", label: "Liminal Phase Check [Turner]", type: "badge" },
      { key: "culturalVelocity", label: "Cultural Velocity", type: "status" },
      { key: "barthesNicheMeaning", label: "Meaning Check [Barthes]", type: "quote" },
    ],
  },
];

const BOOLEAN_FIELDS = [
  { key: "undergroundDensity", label: "Underground Density" },
  { key: "mainstreamBleed", label: "Mainstream Bleed" },
  { key: "remixRate", label: "Remix Rate" },
  { key: "brandSaturation", label: "Brand Saturation" },
];

function getStatusColor(key: string, value: string) {
  if (key === "goffmanStageConsistency") {
    if (value === "Consistent") return "text-green-400 bg-green-400/10 border-green-400/30";
    if (value === "Minor Gap") return "text-yellow-400 bg-yellow-400/10 border-yellow-400/30";
    return "text-red-400 bg-red-400/10 border-red-400/30";
  }
  if (key === "driftSignal") {
    if (value === "Zero Change") return "text-green-400 bg-green-400/10 border-green-400/30";
    if (value === "Minor Drift") return "text-yellow-400 bg-yellow-400/10 border-yellow-400/30";
    if (value === "Significant Drift") return "text-orange-400 bg-orange-400/10 border-orange-400/30";
    return "text-red-400 bg-red-400/10 border-red-400/30";
  }
  if (key === "culturalVelocity") {
    if (value === "Focusing") return "text-green-400 bg-green-400/10 border-green-400/30";
    if (value === "Drifting") return "text-orange-400 bg-orange-400/10 border-orange-400/30";
    return "text-muted-foreground bg-muted/20 border-border/50";
  }
  if (key === "stuartHallDecoding") {
    if (value === "Dominant") return "text-green-400 bg-green-400/10 border-green-400/30";
    if (value === "Negotiated") return "text-yellow-400 bg-yellow-400/10 border-yellow-400/30";
    return "text-red-400 bg-red-400/10 border-red-400/30";
  }
  if (key === "creatorNichePosition") {
    if (value === "Ahead") return "text-green-400 bg-green-400/10 border-green-400/30";
    if (value === "Consistent") return "text-blue-400 bg-blue-400/10 border-blue-400/30";
    return "text-red-400 bg-red-400/10 border-red-400/30";
  }
  return "text-primary bg-primary/10 border-primary/30";
}

function formatNum(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function FieldValue({ fieldKey, value, type }: { fieldKey: string; value: unknown; type: string }) {
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

  if (type === "score-5") {
    const score = Number(value);
    return (
      <div className="flex items-center gap-2">
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className={`w-2.5 h-2.5 rounded-full transition-colors ${
                i <= Math.round(score) ? "bg-primary" : "bg-border"
              }`}
            />
          ))}
        </div>
        <span className="text-sm text-muted-foreground">{score.toFixed(1)}/5</span>
      </div>
    );
  }

  if (type === "status") {
    const colorClass = getStatusColor(fieldKey, String(value));
    return (
      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${colorClass}`}>
        {String(value)}
      </span>
    );
  }

  return <span className="text-sm text-foreground">{String(value)}</span>;
}

// ─── Supplemental Video Panel ────────────────────────────────────────────────
function SupplementalVideoPanel({ profile }: { profile: CreatorProfile }) {
  const utils = trpc.useUtils();
  const [ingestingId, setIngestingId] = useState<string | null>(null);
  const [ingestedIds, setIngestedIds] = useState<Set<string>>(new Set());

  const pool = (profile.discoveredVideoPoolJson as Array<{ id: string; url: string; caption: string; createTime: number; alreadySampled?: boolean }> | null) ?? [];
  // Show all videos — both already-sampled and new ones
  const displayPool = pool.filter(v => !ingestedIds.has(v.id));

  const ingestMutation = trpc.creator.ingestSupplementalVideo.useMutation({
    onSuccess: (data) => {
      setIngestedIds(prev => new Set(Array.from(prev).concat(data.videoId)));
      setIngestingId(null);
      if (data.noCaptions) {
        toast.warning(`No captions available for this video — it has been removed from the queue.`);
      } else {
        toast.success(`Transcript added — ${data.transcriptWordCount} words ingested. Data confidence: ${data.newDataConfidence}.`);
      }
      utils.creator.get.invalidate({ id: profile.id });
      utils.creator.list.invalidate();
    },
    onError: (err) => {
      setIngestingId(null);
      toast.error(`Could not fetch transcript: ${err.message}`);
    },
  });

  if (displayPool.length === 0) return null;

  const transcriptCount = profile.transcriptCount ?? 0;
  const isBelowTarget = transcriptCount < 12;
  const newVideos = displayPool.filter(v => !v.alreadySampled);
  const sampledVideos = displayPool.filter(v => v.alreadySampled);

  return (
    <div className="p-4 rounded-xl border border-amber-500/30 bg-amber-500/5 space-y-3">
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-xs font-semibold text-amber-400">
            {isBelowTarget ? `Sample Shortfall — ${transcriptCount}/12 transcripts ingested` : "Video Pool"}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {displayPool.length} confirmed video{displayPool.length !== 1 ? "s" : ""} found
            {newVideos.length > 0 && ` · ${newVideos.length} new`}
            {sampledVideos.length > 0 && ` · ${sampledVideos.length} already sampled`}.
            Click <strong>Add</strong> to pull additional transcript language into this profile.
          </p>
        </div>
      </div>
      <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
        {displayPool.map((video) => {
          const isLoading = ingestingId === video.id;
          const date = video.createTime ? new Date(video.createTime * 1000).toLocaleDateString("en-US", { month: "short", year: "numeric" }) : "";
          return (
            <div key={video.id} className={`flex items-center gap-2 p-2 rounded-lg border group ${
              video.alreadySampled
                ? "bg-secondary/30 border-border/30"
                : "bg-secondary/50 border-border/50"
            }`}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <p className="text-xs text-foreground/80 truncate leading-snug flex-1 min-w-0">
                    {video.caption || "(no caption)"}
                  </p>
                  {video.alreadySampled && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-blue-500/15 text-blue-400 border border-blue-500/20 flex-shrink-0">
                      Sampled
                    </span>
                  )}
                </div>
                {date && <p className="text-[10px] text-muted-foreground/60 mt-0.5">{date}</p>}
              </div>
              <a
                href={video.url}
                target="_blank"
                rel="noopener noreferrer"
                className="p-1 rounded text-muted-foreground/50 hover:text-muted-foreground transition-colors flex-shrink-0"
                title="Open on TikTok"
                onClick={(e) => e.stopPropagation()}
              >
                <ExternalLink className="w-3 h-3" />
              </a>
              <button
                onClick={() => {
                  setIngestingId(video.id);
                  ingestMutation.mutate({
                    creatorProfileId: profile.id,
                    videoUrl: video.url,
                    videoId: video.id,
                    caption: video.caption,
                  });
                }}
                disabled={isLoading || ingestingId !== null}
                className="flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 border border-amber-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
              >
                {isLoading ? (
                  <><Loader2 className="w-3 h-3 animate-spin" /> Fetching...</>
                ) : (
                  <><Plus className="w-3 h-3" /> Add</>
                )}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function humanScrapeMethod(m: string | null): string {
  const map: Record<string, string> = {
    tiktok_desktop_http: "Direct HTTP",
    tiktok_mobile_http: "Mobile HTTP",
    tiktok_playwright: "Playwright browser",
    tiktok_google_cache: "Google Cache",
    tiktok_search_xhr: "XHR Search",
    tiktok_search_html: "HTML Search",
    instagram_playwright: "Playwright browser",
    instagram_picuki: "Picuki proxy",
    instagram_oembed: "oEmbed",
    youtube_api: "YouTube API",
    youtube_html: "YouTube HTML",
    google_maps_api: "Google Maps API",
    google_search: "Google Search",
    website_crawl: "Website Crawl",
    whisper_transcription: "Whisper",
    manual_entry: "Manual",
  };
  return m ? (map[m] ?? m) : "Unknown";
}

function humanPurpose(p: string): string {
  const map: Record<string, string> = {
    creator_extraction: "Cultural Extraction",
    symbol_decode: "Symbol Decode",
    brand_symbol_decode: "Brand Symbol Decode",
    narrative: "Narrative Generation",
    brand_extraction: "Brand Extraction",
    fit_calculation: "F.I.T. Calculation",
    fit_narrative: "F.I.T. Narrative",
    brand_tiktok_analysis: "Brand TikTok Analysis",
    niche_classification: "Niche Classification",
    engagement_quality: "Engagement Quality",
    cultural_velocity: "Cultural Velocity",
  };
  return map[p] ?? p;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function relativeDate(date: Date | string | null): string {
  if (!date) return "Unknown";
  const d = typeof date === "string" ? new Date(date) : date;
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)}MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)}KB`;
  return `${bytes}B`;
}

// ─── Data Health Bar ──────────────────────────────────────────────────────────

function DataHealthBar({ profile }: { profile: CreatorProfile }) {
  const confidence = profile.dataConfidenceLevel as string | null;
  const transcriptCount = profile.transcriptCount ?? 0;
  const contentItemCount = Array.isArray(profile.discoveredVideoPoolJson) ? (profile.discoveredVideoPoolJson as unknown[]).length : 0;
  const observedAt = profile.observedAt ?? profile.createdAt;

  const confColors: Record<string, string> = {
    high: "text-emerald-400 bg-emerald-400/10 border-emerald-400/30",
    medium: "text-yellow-400 bg-yellow-400/10 border-yellow-400/30",
    low: "text-red-400 bg-red-400/10 border-red-400/30",
  };
  const confLabels: Record<string, string> = {
    high: "High", medium: "Medium", low: "Low",
  };
  const confKey = confidence ?? "low";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Confidence badge */}
      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wide border ${confColors[confKey] ?? confColors.low}`}>
        <Shield className="w-3 h-3" />
        {confLabels[confKey] ?? "Low"} Confidence
      </span>

      {/* Transcript count */}
      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-medium border ${
        transcriptCount > 0 ? "text-emerald-400 bg-emerald-400/10 border-emerald-400/30" : "text-muted-foreground bg-secondary/50 border-border/50"
      }`}>
        <Mic className="w-2.5 h-2.5" />
        {transcriptCount} transcript{transcriptCount !== 1 ? "s" : ""}
      </span>

      {/* Videos captured */}
      {contentItemCount > 0 && (
        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-medium text-muted-foreground bg-secondary/50 border border-border/50">
          <Video className="w-2.5 h-2.5" />
          {contentItemCount} video{contentItemCount !== 1 ? "s" : ""} captured
        </span>
      )}

      {/* Analysis date */}
      {observedAt && (
        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-medium text-muted-foreground bg-secondary/50 border border-border/50">
          <Clock className="w-2.5 h-2.5" />
          Analyzed {relativeDate(observedAt)}
        </span>
      )}
    </div>
  );
}

// ─── Video Evidence Table ─────────────────────────────────────────────────────

function VideoEvidenceTable({ profile }: { profile: CreatorProfile }) {
  const [expanded, setExpanded] = useState(false);
  const { data: contentItems, isLoading } = trpc.creator.getContentItems.useQuery(
    { subjectId: profile.id },
    { enabled: expanded },
  );

  const videoCount = contentItems?.length ?? (Array.isArray(profile.discoveredVideoPoolJson) ? (profile.discoveredVideoPoolJson as unknown[]).length : 0);
  if (videoCount === 0 && !expanded) return null;

  return (
    <div className="rounded-xl border border-border/50 bg-secondary/20 overflow-hidden">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-secondary/30 transition-colors"
      >
        <Film className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
        <span className="text-[10px] font-semibold tracking-[0.12em] uppercase text-muted-foreground flex-1">
          Video Evidence — {videoCount} video{videoCount !== 1 ? "s" : ""} captured
        </span>
        {expanded
          ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground/50" />
          : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/50" />
        }
      </button>

      {expanded && (
        <div className="border-t border-border/30">
          {isLoading ? (
            <div className="flex items-center justify-center py-6 text-muted-foreground/50">
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
              <span className="text-xs">Loading video data…</span>
            </div>
          ) : contentItems && contentItems.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/30 text-muted-foreground/60">
                    <th className="text-left px-3 py-2 font-medium">Caption</th>
                    <th className="text-left px-3 py-2 font-medium">Date</th>
                    <th className="text-right px-3 py-2 font-medium">Views</th>
                    <th className="text-right px-3 py-2 font-medium">Likes</th>
                    <th className="text-right px-3 py-2 font-medium">Comments</th>
                    <th className="text-center px-3 py-2 font-medium">Duration</th>
                    <th className="text-left px-3 py-2 font-medium">Audio</th>
                    <th className="text-center px-3 py-2 font-medium">Transcript</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/20">
                  {[...contentItems].sort((a, b) => {
                    const tA = a.createTime ? new Date(a.createTime).getTime() : 0;
                    const tB = b.createTime ? new Date(b.createTime).getTime() : 0;
                    return tB - tA;
                  }).map((ci) => (
                    <tr key={ci.id} className={`hover:bg-secondary/30 transition-colors ${ci.transcriptText ? "border-l-2 border-l-emerald-500/40" : ""}`}>
                      <td className="px-3 py-2 max-w-[200px]">
                        <span className="text-foreground/80 truncate block" title={ci.caption ?? ""}>
                          {ci.caption ? (ci.caption.length > 60 ? ci.caption.slice(0, 60) + "…" : ci.caption) : "—"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                        {ci.createTime ? new Date(ci.createTime).toLocaleDateString("en-US", { month: "short", year: "numeric" }) : "—"}
                      </td>
                      <td className="px-3 py-2 text-right text-foreground/80">{ci.viewCount ? formatNum(ci.viewCount) : "—"}</td>
                      <td className="px-3 py-2 text-right text-foreground/80">{ci.likeCount ? formatNum(ci.likeCount) : "—"}</td>
                      <td className="px-3 py-2 text-right text-foreground/80">{ci.commentCount ? formatNum(ci.commentCount) : "—"}</td>
                      <td className="px-3 py-2 text-center text-muted-foreground">
                        {ci.videoDuration ? formatDuration(ci.videoDuration) : "—"}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap max-w-[120px]">
                        {ci.isOriginalAudio
                          ? <span className="text-emerald-400">🎵 Original</span>
                          : ci.musicTitle
                            ? <span className="truncate block" title={ci.musicTitle}>🎵 {ci.musicTitle.length > 15 ? ci.musicTitle.slice(0, 15) + "…" : ci.musicTitle}</span>
                            : "—"
                        }
                      </td>
                      <td className="px-3 py-2 text-center">
                        {ci.transcriptText ? <span className="text-emerald-400">✅</span> : <span className="text-muted-foreground/40">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="px-4 py-6 text-center text-xs text-muted-foreground/50">
              No video data captured for this creator
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Pipeline Metrics Section (self-fetching for library view) ────────────────

function PipelineMetricsSection({ profile, propMetrics }: {
  profile: CreatorProfile;
  propMetrics?: CreatorProfileCardProps["pipelineMetrics"];
}) {
  // If we have prop metrics (from analyze mutation), use them directly
  if (propMetrics) return <PipelinePerformance metrics={propMetrics} />;

  // Otherwise, fetch from DB for library view
  const rawObservedAt = profile.observedAt;
  const observedAt = rawObservedAt instanceof Date
    ? rawObservedAt.toISOString()
    : typeof rawObservedAt === "string" ? rawObservedAt : undefined;

  const { data: tokenData } = trpc.creator.getPipelineMetrics.useQuery(
    { subjectId: profile.id, observedAt },
    { enabled: !!profile.id },
  );

  if (!tokenData || tokenData.llmCalls === 0) return null;

  // Build a partial metrics object — no step timings available from DB,
  // but we can show tokens/cost which is the key info
  const metricsFromDb: NonNullable<CreatorProfileCardProps["pipelineMetrics"]> = {
    totalDurationMs: 0,
    steps: [],
    tokens: tokenData,
    transcriptCount: (profile.transcriptCount as number) ?? 0,
    videosScraped: 0,
  };

  return <PipelinePerformance metrics={metricsFromDb} />;
}

// ─── Pipeline Performance ─────────────────────────────────────────────────────

function PipelinePerformance({ metrics }: { metrics: NonNullable<CreatorProfileCardProps["pipelineMetrics"]> }) {
  const [expanded, setExpanded] = useState(false);

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const formatTokens = (n: number) => {
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return String(n);
  };

  // Cost calculation per model (USD per 1M tokens) — shared table so server
  // diagnostics and this card always agree (shared/llmPricing.ts).

  const modelKey = metrics.tokens.model || "unknown";
  const pricing = MODEL_PRICING[modelKey] ?? { input: 0, output: 0, label: modelKey };
  const inputCost = (metrics.tokens.inputTokens / 1_000_000) * pricing.input;
  const outputCost = (metrics.tokens.outputTokens / 1_000_000) * pricing.output;
  const totalCost = inputCost + outputCost;

  const formatCost = (c: number) => {
    if (c < 0.001) return "<$0.001";
    if (c < 0.01) return `$${c.toFixed(4)}`;
    return `$${c.toFixed(3)}`;
  };

  const maxStepMs = Math.max(...metrics.steps.map(s => s.durationMs), 1);

  return (
    <div className="mt-6 pt-5 border-t border-border/40">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between group hover:opacity-80 transition-opacity"
      >
        <div className="flex items-center gap-2">
          <Timer className="w-4 h-4 text-violet-400" />
          <span className="text-sm font-semibold text-foreground/80">Pipeline Performance</span>
          {metrics.totalDurationMs > 0 && (
            <span className="text-xs text-muted-foreground/60 font-mono">
              {formatDuration(metrics.totalDurationMs)}
            </span>
          )}
          {metrics.tokens.totalTokens > 0 && (
            <span className="text-xs text-emerald-400/70 font-mono">
              · {formatCost(totalCost)}
            </span>
          )}
        </div>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-muted-foreground/50" />
        ) : (
          <ChevronDown className="w-4 h-4 text-muted-foreground/50" />
        )}
      </button>

      {expanded && (
        <div className="mt-4 space-y-4 animate-fade-in-up">
          {/* Summary cards */}
          <div className={`grid gap-2.5 ${metrics.totalDurationMs > 0 ? 'grid-cols-5' : 'grid-cols-4'}`}>
            {metrics.totalDurationMs > 0 && (
            <div className="rounded-lg bg-violet-500/5 border border-violet-500/10 p-3 text-center">
              <Timer className="w-3.5 h-3.5 text-violet-400 mx-auto mb-1" />
              <div className="text-base font-bold text-violet-300 font-mono">{formatDuration(metrics.totalDurationMs)}</div>
              <div className="text-[10px] text-muted-foreground/60 uppercase tracking-wider mt-0.5">Total Time</div>
            </div>
            )}
            <div className="rounded-lg bg-amber-500/5 border border-amber-500/10 p-3 text-center">
              <Zap className="w-3.5 h-3.5 text-amber-400 mx-auto mb-1" />
              <div className="text-base font-bold text-amber-300 font-mono">{formatTokens(metrics.tokens.totalTokens)}</div>
              <div className="text-[10px] text-muted-foreground/60 uppercase tracking-wider mt-0.5">Tokens Used</div>
            </div>
            <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/10 p-3 text-center">
              <DollarSign className="w-3.5 h-3.5 text-emerald-400 mx-auto mb-1" />
              <div className="text-base font-bold text-emerald-300 font-mono">{formatCost(totalCost)}</div>
              <div className="text-[10px] text-muted-foreground/60 uppercase tracking-wider mt-0.5">Est. Cost</div>
            </div>
            <div className="rounded-lg bg-blue-500/5 border border-blue-500/10 p-3 text-center">
              <Cpu className="w-3.5 h-3.5 text-blue-400 mx-auto mb-1" />
              <div className="text-base font-bold text-blue-300 font-mono">{metrics.tokens.llmCalls}</div>
              <div className="text-[10px] text-muted-foreground/60 uppercase tracking-wider mt-0.5">LLM Calls</div>
            </div>
            <div className="rounded-lg bg-rose-500/5 border border-rose-500/10 p-3 text-center">
              <Database className="w-3.5 h-3.5 text-rose-400 mx-auto mb-1" />
              <div className="text-base font-bold text-rose-300 font-mono">{metrics.transcriptCount}</div>
              <div className="text-[10px] text-muted-foreground/60 uppercase tracking-wider mt-0.5">Transcripts</div>
            </div>
          </div>

          {/* Step timeline (only when steps are available — analyze page only) */}
          {metrics.steps.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">Step Breakdown</h4>
            {metrics.steps.map((step, i) => {
              const pct = Math.max((step.durationMs / maxStepMs) * 100, 3);
              const stepColors = [
                { bar: "bg-violet-500/40", text: "text-violet-400" },
                { bar: "bg-amber-500/40", text: "text-amber-400" },
                { bar: "bg-emerald-500/40", text: "text-emerald-400" },
              ];
              const color = stepColors[i % stepColors.length];
              return (
                <div key={step.step} className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground w-40 shrink-0 truncate">{step.step}</span>
                  <div className="flex-1 h-5 rounded-md bg-card/50 overflow-hidden relative">
                    <div
                      className={`h-full rounded-md ${color.bar} transition-all duration-500`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className={`text-xs font-mono font-medium w-14 text-right ${color.text}`}>
                    {formatDuration(step.durationMs)}
                  </span>
                </div>
              );
            })}
          </div>
          )}

          {/* Token + cost detail */}
          {metrics.tokens.totalTokens > 0 && (
            <div className="pt-3 border-t border-border/20 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-semibold">Model</span>
                <span className="text-xs font-mono px-2 py-0.5 rounded-md bg-blue-500/10 border border-blue-500/15 text-blue-300">
                  {pricing.label}
                </span>
              </div>
              <div className="flex items-center gap-4 text-xs font-mono">
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground/40">Input:</span>
                  <span className="text-blue-400">{formatTokens(metrics.tokens.inputTokens)}</span>
                  <span className="text-muted-foreground/30">×</span>
                  <span className="text-muted-foreground/50">${pricing.input}/1M</span>
                  <span className="text-muted-foreground/30">=</span>
                  <span className="text-blue-300">{formatCost(inputCost)}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-muted-foreground/40">Output:</span>
                  <span className="text-amber-400">{formatTokens(metrics.tokens.outputTokens)}</span>
                  <span className="text-muted-foreground/30">×</span>
                  <span className="text-muted-foreground/50">${pricing.output}/1M</span>
                  <span className="text-muted-foreground/30">=</span>
                  <span className="text-amber-300">{formatCost(outputCost)}</span>
                </div>
              </div>
              {metrics.videosScraped > 0 && (
                <div className="text-xs text-muted-foreground/40">
                  {metrics.videosScraped} videos scraped
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Provenance Footer ────────────────────────────────────────────────────────

function ProvenanceFooter({ profile }: { profile: CreatorProfile }) {
  const [expanded, setExpanded] = useState(false);
  const observationId = profile.observationId as string | undefined;
  const { data: provenance, isLoading } = trpc.creator.getProvenance.useQuery(
    { observationId: observationId ?? "" },
    { enabled: expanded && !!observationId },
  );

  if (!observationId) return null;

  return (
    <div className="rounded-xl border border-border/30 bg-muted/10 overflow-hidden">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-secondary/20 transition-colors"
      >
        <Cpu className="w-3 h-3 text-muted-foreground/50 flex-shrink-0" />
        <span className="text-[10px] font-semibold tracking-[0.12em] uppercase text-muted-foreground/50 flex-1">
          Analysis Provenance
        </span>
        {expanded
          ? <ChevronUp className="w-3 h-3 text-muted-foreground/30" />
          : <ChevronDown className="w-3 h-3 text-muted-foreground/30" />
        }
      </button>

      {expanded && (
        <div className="border-t border-border/20 px-4 py-3 space-y-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-4 text-muted-foreground/50">
              <Loader2 className="w-3 h-3 animate-spin mr-2" />
              <span className="text-[10px]">Loading provenance…</span>
            </div>
          ) : provenance ? (
            <>
              {/* Analysis date */}
              {provenance.analyzedAt && (
                <div className="text-[10px] text-muted-foreground/60">
                  Analysis run: {new Date(provenance.analyzedAt).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}
                </div>
              )}

              {/* LLM Calls */}
              {provenance.llmCalls.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5">
                    <Activity className="w-3 h-3 text-violet-400/60" />
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-violet-400/60">
                      LLM Calls ({provenance.llmCalls.length})
                    </span>
                    <span className="text-[10px] text-muted-foreground/40 ml-auto">
                      {formatNum(provenance.llmCalls.reduce((s, c) => s + (c.inputTokens ?? 0) + (c.outputTokens ?? 0), 0))} tokens total
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {provenance.llmCalls.map((call, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded text-[9px] font-medium bg-violet-500/10 text-violet-300 border border-violet-500/20"
                        title={`${call.purpose} • ${call.model} • ${(call.inputTokens ?? 0) + (call.outputTokens ?? 0)} tokens • ${call.durationMs ?? 0}ms`}
                      >
                        {humanPurpose(call.purpose)}
                        <span className="text-violet-400/50">·</span>
                        <span className="text-violet-400/60">{call.model?.split("/").pop()?.split("-").slice(0, 2).join("-") ?? call.model}</span>
                        <span className="text-violet-400/50">·</span>
                        <span className="text-violet-400/60">{call.durationMs ? `${(call.durationMs / 1000).toFixed(1)}s` : "—"}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Scrape Events */}
              {provenance.scrapeEvents.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5">
                    <Globe className="w-3 h-3 text-sky-400/60" />
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-sky-400/60">
                      Scrape Events ({provenance.scrapeEvents.length})
                    </span>
                    <span className="text-[10px] text-muted-foreground/40 ml-auto">
                      {(provenance.scrapeEvents.reduce((s, e) => s + (e.durationMs ?? 0), 0) / 1000).toFixed(1)}s total
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {provenance.scrapeEvents.map((evt, i) => {
                      const failed = evt.silentFailureDetected || (evt.httpStatus !== null && evt.httpStatus >= 400);
                      return (
                        <span
                          key={i}
                          className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[9px] font-medium border ${
                            failed
                              ? "bg-red-500/10 text-red-300 border-red-500/20"
                              : "bg-sky-500/10 text-sky-300 border-sky-500/20"
                          }`}
                          title={evt.urlRequested ?? ""}
                        >
                          {failed ? "❌" : "✅"}
                          {humanScrapeMethod(evt.scrapeMethod)}
                          <span className="opacity-50">·</span>
                          <span className="opacity-60">{evt.httpStatus ?? "—"}</span>
                          <span className="opacity-50">·</span>
                          <span className="opacity-60">{evt.durationMs ? `${evt.durationMs}ms` : "—"}</span>
                          {evt.responseSizeBytes ? (
                            <>
                              <span className="opacity-50">·</span>
                              <span className="opacity-60">{formatBytes(evt.responseSizeBytes)}</span>
                            </>
                          ) : null}
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="text-[10px] text-muted-foreground/40 text-center py-2">No provenance data available</div>
          )}
        </div>
      )}
    </div>
  );
}

export default function CreatorProfileCard({ profile, compact = false, onReanalyze, isReanalyzing = false, pipelineMetrics }: CreatorProfileCardProps) {
  const themes = (profile.contentThemeLabels as string[] | null) ?? [];
  const hashtags = (profile.topHashtags as string[] | null) ?? [];
  const keywords = (profile.rawKeywords as string[] | null) ?? [];
  const videoTitles = (profile.recentVideoTitles as string[] | null) ?? [];

  const hasStats = (profile.followerCount ?? 0) > 0 || (profile.totalViews ?? 0) > 0 || (profile.videoCount ?? 0) > 0;
  const hasKeywordData = themes.length > 0 || hashtags.length > 0 || keywords.length > 0;
  const transcriptCount = profile.transcriptCount ?? 0;

  // Data confidence from DB (use stored value, not client-computed)
  const dataConfidence = (profile.dataConfidenceLevel as string | null) ?? (transcriptCount >= 3 ? 'high' : videoTitles.length >= 3 ? 'medium' : 'low');

  return (
    <div className="space-y-6">
      {/* ── Review gate (womo_0006): pending must be unmistakable wherever a
             profile renders ─────────────────────────────────────────────── */}
      {profile.reviewStatus === "pending" && <PendingReviewBanner />}
      {profile.reviewStatus === "declined" && (
        <div className="flex items-center gap-3 rounded-lg border-2 border-red-400/50 bg-red-400/10 px-4 py-3">
          <span className="text-[13px] font-bold text-red-300 uppercase tracking-wide">Archived (declined)</span>
          <span className="text-[11px] text-red-200/70">This run was declined by an analyst — retained for failure analysis, excluded from the corpus.</span>
        </div>
      )}

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4 flex-1 min-w-0">
          <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
            <span className="text-lg font-serif text-primary">
              {(profile.displayName ?? profile.handle)?.[0]?.toUpperCase() ?? "?"}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <h3 className="font-semibold text-lg text-foreground truncate">{profile.displayName ?? profile.handle}</h3>
              <ReviewStatusBadge status={profile.reviewStatus} />
            </div>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className="text-sm text-muted-foreground">@{profile.handle}</span>
              <span className="text-muted-foreground/30">·</span>
              <span className="text-xs px-2 py-0.5 rounded-full border border-border bg-secondary text-muted-foreground">
                {profile.platform}
              </span>
              {profile.location && (
                <>
                  <span className="text-muted-foreground/30">·</span>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <MapPin className="w-3 h-3" />
                    {profile.location}
                  </span>
                </>
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

      {/* ── Data Health Bar ───────────────────────────────────────────────── */}
      {!compact && <DataHealthBar profile={profile} />}

      {/* ── Transcript Badge ─────────────────────────────────────────────── */}
      {dataConfidence === 'high' && transcriptCount > 0 && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10">
          <Mic className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
          <span className="text-xs font-medium text-emerald-400">
            ✅ High confidence — analyzed from {transcriptCount} video transcript{transcriptCount !== 1 ? 's' : ''}
          </span>
        </div>
      )}
      {dataConfidence === 'medium' && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10">
          <Film className="w-3.5 h-3.5 text-yellow-400 flex-shrink-0" />
          <span className="text-xs font-medium text-yellow-400">
            ⚠️ Medium confidence — {transcriptCount > 0 ? `${transcriptCount} transcript${transcriptCount !== 1 ? 's' : ''}, ` : ''}{videoTitles.length} video{videoTitles.length !== 1 ? 's' : ''} analyzed
          </span>
        </div>
      )}
      {dataConfidence === 'low' && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-red-500/30 bg-red-500/10">
          <AlertCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
          <span className="text-xs font-medium text-red-400">
            ⚠️ Low confidence — limited transcript data available
          </span>
        </div>
      )}

      {/* ── Stats Bar ───────────────────────────────────────────────────────── */}
      {hasStats && (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
          {(profile.followerCount ?? 0) > 0 && (
            <div className="p-3 rounded-lg bg-secondary/60 border border-amber-500/30 text-center relative">
              <div className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
                <Users className="w-3 h-3" />
                <span className="text-[10px] uppercase tracking-wide font-medium">Followers</span>
                <MetricTooltip
                  title="Followers — Unverified"
                  explanation="TikTok restricts direct profile stat access from server-side requests. This number is sourced from TikTok's HTML response, which returns placeholder data (typically a very small number) rather than the real follower count."
                  whyItMatters="Don't use this for reach. Total Views / Avg Views are computed from the captured per-video data — a SAMPLE of the channel (see coverage in Run diagnostics) — so treat them as scrape-derived, not independently verified."
                  dataPoints={["TikTok HTML page response (bot-restricted)", "Real value requires TikTok Official API access"]}
                  side="top"
                />
              </div>
              <div className="text-base font-semibold text-amber-400">{formatNum(profile.followerCount!)}</div>
              <div className="text-[9px] text-amber-500/80 mt-0.5">Unverified</div>
            </div>
          )}
          {(profile.totalLikes ?? 0) > 0 && (
            <div className="p-3 rounded-lg bg-secondary/60 border border-amber-500/30 text-center">
              <div className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
                <Heart className="w-3 h-3" />
                <span className="text-[10px] uppercase tracking-wide font-medium">Total Likes</span>
                <MetricTooltip
                  title="Total Likes — Unverified"
                  explanation="TikTok restricts direct profile stat access from server-side requests. This number is sourced from TikTok's HTML response, which returns placeholder data rather than the real total likes count."
                  whyItMatters="Don't use this for engagement. The Engagement Rate is computed from the captured per-video data — as reliable as the scrape, over a sample of the channel, and not independently verified."
                  dataPoints={["TikTok HTML page response (bot-restricted)", "Real value requires TikTok Official API access"]}
                  side="top"
                />
              </div>
              <div className="text-base font-semibold text-amber-400">{formatNum(profile.totalLikes!)}</div>
              <div className="text-[9px] text-amber-500/80 mt-0.5">Unverified</div>
            </div>
          )}
          {(profile.totalViews ?? 0) > 0 && (
            <div className="p-3 rounded-lg bg-secondary/60 border border-sky-500/20 text-center">
              <div className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
                <Play className="w-3 h-3" />
                <span className="text-[10px] uppercase tracking-wide font-medium">Total Views</span>
                <MetricTooltip
                  title="Total Views — Derived"
                  explanation="Summed from the per-video view counts we captured — a SAMPLE of the channel (see coverage in Run diagnostics), not an independently verified channel total."
                  whyItMatters="As reliable as the scrape it came from, and it reflects the captured subset of videos, not the whole channel."
                  dataPoints={["Sum of scraped per-video view counts", "Captured subset only — not the full channel"]}
                  side="top"
                />
              </div>
              <div className="text-base font-semibold text-foreground">{formatNum(profile.totalViews!)}</div>
              <div className="text-[9px] text-sky-500/70 mt-0.5">Derived</div>
            </div>
          )}
          {(profile.avgViews ?? 0) > 0 && (
            <div className="p-3 rounded-lg bg-secondary/60 border border-sky-500/20 text-center">
              <div className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
                <TrendingUp className="w-3 h-3" />
                <span className="text-[10px] uppercase tracking-wide font-medium">Avg Views</span>
                <MetricTooltip
                  title="Avg Views — Derived"
                  explanation="Average of the per-video view counts we captured. Computed over the captured SUBSET of videos (often a small % of the channel), so a few viral clips can skew it."
                  whyItMatters="As reliable as the scrape it came from, and biased toward whichever videos were captured — not a channel-wide average."
                  dataPoints={["Mean of scraped per-video view counts", "Captured subset only — see coverage"]}
                  side="top"
                />
              </div>
              <div className="text-base font-semibold text-foreground">{formatNum(profile.avgViews!)}</div>
              <div className="text-[9px] text-sky-500/70 mt-0.5">Derived</div>
            </div>
          )}
          {(profile.videoCount ?? 0) > 0 && (
            <div className="p-3 rounded-lg bg-secondary/60 border border-amber-500/30 text-center">
              <div className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
                <Video className="w-3 h-3" />
                <span className="text-[10px] uppercase tracking-wide font-medium">Videos</span>
                <MetricTooltip
                  title="Video Count — Unverified"
                  explanation="TikTok restricts direct profile stat access from server-side requests. This number is sourced from TikTok's HTML response, which returns placeholder data rather than the real video count."
                  whyItMatters="The actual number of videos analyzed is shown in the transcript badge below. Use that count for data confidence assessment."
                  dataPoints={["TikTok HTML page response (bot-restricted)", "Real value requires TikTok Official API access"]}
                  side="top"
                />
              </div>
              <div className="text-base font-semibold text-amber-400">{formatNum(profile.videoCount!)}</div>
              <div className="text-[9px] text-amber-500/80 mt-0.5">Unverified</div>
            </div>
          )}
          {(profile.engagementRate ?? 0) > 0 && (
            <div className="p-3 rounded-lg bg-secondary/60 border border-sky-500/20 text-center">
              <div className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
                <TrendingUp className="w-3 h-3" />
                <span className="text-[10px] uppercase tracking-wide font-medium">Engagement</span>
                <MetricTooltip
                  title="Engagement Rate — Derived"
                  explanation="Computed from the per-video like/comment counts we captured (likes+comments ÷ plays, averaged over the captured videos). It is derived from scraped, bot-restricted data over a sample of the channel."
                  whyItMatters="As reliable as the scrape it came from, and computed over the captured subset — not independently verified and not a channel-wide figure."
                  dataPoints={["Averaged from scraped per-video like/comment/play counts", "Captured subset only — see coverage"]}
                  side="top"
                />
              </div>
              <div className="text-base font-semibold text-foreground">{profile.engagementRate!.toFixed(1)}%</div>
              <div className="text-[9px] text-sky-500/70 mt-0.5">Derived</div>
            </div>
          )}
        </div>
      )}

      {/* ── Content Themes ──────────────────────────────────────────────────── */}
      {themes.length > 0 && (
        <div className="p-4 rounded-xl bg-muted/20 border border-border/50 space-y-3">
          <div className="flex items-center gap-2">
            <Tag className="w-3.5 h-3.5 text-primary" />
            <span className="text-[10px] font-semibold tracking-[0.12em] uppercase text-muted-foreground">
              Content Themes
            </span>
            <span className="text-[10px] text-muted-foreground/50 ml-auto">AI-translated from actual content</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {themes.map((theme, i) => (
              <span
                key={i}
                className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium border border-primary/40 bg-primary/10 text-primary"
              >
                {theme}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Hashtags & Keywords ─────────────────────────────────────────────── */}
      {hasKeywordData && !compact && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {hashtags.length > 0 && (
            <div className="p-4 rounded-xl bg-secondary/40 border border-border/50 space-y-2">
              <div className="flex items-center gap-2">
                <Hash className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-[10px] font-semibold tracking-[0.12em] uppercase text-muted-foreground">
                  Top Hashtags
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {hashtags.slice(0, 15).map((tag, i) => (
                  <span key={i} className="text-xs text-muted-foreground bg-secondary px-2 py-0.5 rounded border border-border">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}
          {keywords.length > 0 && (
            <div className="p-4 rounded-xl bg-secondary/40 border border-border/50 space-y-2">
              <div className="flex items-center gap-2">
                <Tag className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-[10px] font-semibold tracking-[0.12em] uppercase text-muted-foreground">
                  Key Words
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {keywords.slice(0, 20).map((kw, i) => (
                  <span key={i} className="text-xs text-muted-foreground bg-secondary px-2 py-0.5 rounded border border-border">
                    {kw}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Transcript Excerpts ─────────────────────────────────────────────── */}
      {!compact && profile.transcriptExcerpts && (
        <TranscriptPanel profile={profile} />
      )}

      {/* ── Recent Video Titles ─────────────────────────────────────────────── */}
      {videoTitles.length > 0 && !compact && (
        <div className="p-4 rounded-xl bg-secondary/40 border border-border/50 space-y-3">
          <div className="flex items-center gap-2">
            <Film className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-[10px] font-semibold tracking-[0.12em] uppercase text-muted-foreground">
              Sampled Content ({videoTitles.length} posts)
            </span>
          </div>
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {videoTitles.slice(0, 15).map((title, i) => (
              <div key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                <span className="text-muted-foreground/40 flex-shrink-0 w-4 text-right">{i + 1}.</span>
                <span className="leading-relaxed">{title}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Video Evidence Table ──────────────────────────────────────────── */}
      {!compact && <VideoEvidenceTable profile={profile} />}

      {/* ── AI Summary ──────────────────────────────────────────────────────── */}
      {profile.aiSummary && (
        <div className="p-4 rounded-xl bg-muted/30 border border-border/50">
          <div className="text-[10px] font-semibold tracking-[0.12em] uppercase text-muted-foreground mb-2">
            Cultural Analyst Summary
          </div>
          <p className="text-sm text-foreground/80 leading-relaxed">{profile.aiSummary}</p>
        </div>
      )}

      {/* ── Field Notes ─────────────────────────────────────────────────────── */}
      {compact ? null : (
        <>
          {FIELD_SECTIONS.map((section) => (
            <div key={section.title}>
              <div className="mb-4">
                <h4 className="text-xs font-semibold tracking-[0.1em] uppercase text-muted-foreground">{section.title}</h4>
                <p className="text-xs text-muted-foreground/60 mt-0.5">{section.subtitle}</p>
              </div>
              <div className="space-y-3">
                {section.fields.map((field) => {
                  const value = profile[field.key as keyof CreatorProfile];
                  const hasExplainer = EXPLAINED_FIELD_KEYS.has(field.key);
                  return (
                    <div key={field.key} className="py-2 border-b border-border/30 last:border-0">
                      <div className="grid grid-cols-[1fr_1.5fr] gap-4 items-start">
                        <span className="text-xs text-muted-foreground pt-0.5">{field.label}</span>
                        <FieldValue fieldKey={field.key} value={value} type={field.type} />
                      </div>
                      {hasExplainer && (
                        <div className="mt-1 pl-0">
                          <FieldExplainer fieldKey={field.key} value={value !== null && value !== undefined ? String(value) : null} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Boolean niche signals */}
              {section.title.includes("Three") && (
                <div className="mt-4 grid grid-cols-2 gap-2">
                  {BOOLEAN_FIELDS.map((bf) => {
                    const val = profile[bf.key as keyof CreatorProfile] as boolean | null;
                    return (
                      <div key={bf.key} className="flex items-center gap-2 p-2 rounded-lg bg-secondary/50">
                        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${val ? "bg-green-400" : "bg-muted-foreground/30"}`} />
                        <span className="text-xs text-muted-foreground">{bf.label}</span>
                        <span className={`ml-auto text-xs font-medium ${val ? "text-green-400" : "text-muted-foreground/50"}`}>
                          {val ? "Yes" : "No"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </>
      )}

      {/* ── Pipeline Performance ──────────────────────────────────────────── */}
      {!compact && <PipelineMetricsSection profile={profile} propMetrics={pipelineMetrics} />}

      {/* ── Provenance Footer ──────────────────────────────────────────────── */}
      {!compact && <ProvenanceFooter profile={profile} />}
    </div>
  );
}
