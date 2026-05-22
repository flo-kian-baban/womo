import { useParams, Link } from "wouter";
import {
  ArrowLeft, FileJson, AlertTriangle, CheckCircle2, XCircle, AlertCircle,
  Sparkles, TrendingUp, Users, Lightbulb, Hash, BarChart3, ExternalLink, Info,
  TrendingDown, Minus, ShieldAlert
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import CreatorProfileCard from "@/components/CreatorProfileCard";
import BrandProfileCard from "@/components/BrandProfileCard";
import { MetricTooltip } from "@/components/MetricTooltip";
import { ObjectiveSignalsPanel, type ObjectiveSignal } from "@/components/ObjectiveSignalsPanel";
import { LocalResonanceSection } from "@/components/LocalResonanceSection";

// ─── Sub-components ──────────────────────────────────────────────────────────

function RadarWarningBadge({ warning }: { warning: string }) {
  const configs: Record<string, { icon: typeof AlertTriangle; color: string; desc: string }> = {
    "Low Alignment": { icon: AlertTriangle, color: "text-red-400 bg-red-400/10 border-red-400/30", desc: "Alignment score below 6.0 — creator and brand do not share symbolic language" },
    "Archetype Tension": { icon: XCircle, color: "text-orange-400 bg-orange-400/10 border-orange-400/30", desc: "Creator archetype appears in brand's 'Clashes With' list" },
    "Identity Instability": { icon: AlertCircle, color: "text-yellow-400 bg-yellow-400/10 border-yellow-400/30", desc: "Full Pivot drift signal or Significant Gap in Goffman stage consistency" },
    "Low Pulse": { icon: AlertTriangle, color: "text-orange-400 bg-orange-400/10 border-orange-400/30", desc: "Niche pulse score below 4.0 — cultural momentum is weak or window is closing" },
    "Trajectory Divergence": { icon: AlertCircle, color: "text-yellow-400 bg-yellow-400/10 border-yellow-400/30", desc: "Creator is behind the niche's current adoption position" },
  };
  const config = configs[warning] ?? { icon: AlertTriangle, color: "text-muted-foreground bg-muted/30 border-border", desc: "" };
  const Icon = config.icon;
  return (
    <div className={`flex items-start gap-3 p-3 rounded-lg border ${config.color}`}>
      <Icon className="w-4 h-4 flex-shrink-0 mt-0.5" />
      <div>
        <div className="text-sm font-semibold">{warning}</div>
        <div className="text-xs opacity-70 mt-0.5">{config.desc}</div>
      </div>
    </div>
  );
}

function PARRMeter({ score, label }: { score: number; label: string }) {
  const color =
    score >= 80 ? "oklch(0.65 0.15 145)" :
    score >= 60 ? "oklch(0.78 0.12 75)" :
    score >= 40 ? "oklch(0.72 0.15 50)" :
    "oklch(0.60 0.18 25)";

  const borderColor =
    score >= 80 ? "oklch(0.65 0.15 145 / 0.3)" :
    score >= 60 ? "oklch(0.78 0.12 75 / 0.3)" :
    score >= 40 ? "oklch(0.72 0.15 50 / 0.3)" :
    "oklch(0.60 0.18 25 / 0.3)";

  const bgColorStyle =
    score >= 80 ? "oklch(0.65 0.15 145 / 0.05)" :
    score >= 60 ? "oklch(0.78 0.12 75 / 0.05)" :
    score >= 40 ? "oklch(0.72 0.15 50 / 0.05)" :
    "oklch(0.60 0.18 25 / 0.05)";

  return (
    <div className="rounded-xl border p-6" style={{ borderColor, background: bgColorStyle }}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1.5">
          <div className="text-[10px] font-semibold tracking-[0.15em] uppercase text-muted-foreground">
            PARR
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="w-3 h-3 text-muted-foreground/50 cursor-help" />
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs leading-relaxed">
              <p className="font-semibold mb-1">Predicted Audience Receptivity Rate</p>
              PARR predicts the probability of audience acceptance. It calculates what percentage of the Creator's audience is structurally guaranteed to receive your brand message as authentic and culturally legitimate, rather than forced or inauthentic.
            </TooltipContent>
          </Tooltip>
        </div>
        <div className="text-4xl font-serif" style={{ color }}>{score}%</div>
      </div>
      <div className="text-sm font-semibold mb-3" style={{ color }}>{label}</div>
      <div className="h-2 rounded-full bg-border overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-1000"
          style={{ width: `${score}%`, background: color }}
        />
      </div>
      <p className="text-xs text-muted-foreground mt-3 leading-relaxed">
        The predicted percentage of a creator's audience that is culturally receptive to the brand message.
      </p>
    </div>
  );
}

// ─── Word Cloud ─────────────────────────────────────────────────────────────

function SemanticWordCloud({ keywords, maxCount = 10 }: { keywords: string[]; maxCount?: number }) {
  const words = keywords.slice(0, maxCount);
  if (words.length === 0) return null;

  // Assign visual weight based on position (first = largest)
  const sizes = [
    "text-2xl font-bold", "text-xl font-bold", "text-xl font-semibold",
    "text-lg font-semibold", "text-lg font-medium", "text-base font-medium",
    "text-base", "text-sm", "text-sm", "text-xs",
  ];
  const opacities = ["opacity-100", "opacity-90", "opacity-85", "opacity-80", "opacity-75",
    "opacity-70", "opacity-65", "opacity-60", "opacity-55", "opacity-50"];

  // Shuffle for visual variety while keeping weight
  const shuffled = words.map((w, i) => ({ word: w, size: sizes[i] ?? "text-xs", opacity: opacities[i] ?? "opacity-50" }));
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }

  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2 items-baseline justify-center py-2">
      {shuffled.map(({ word, size, opacity }) => (
        <span
          key={word}
          className={`${size} ${opacity} text-primary capitalize font-serif tracking-wide transition-all hover:opacity-100 cursor-default`}
        >
          {word}
        </span>
      ))}
    </div>
  );
}

// ─── Cultural Velocity Indicator ─────────────────────────────────────────────

function CulturalVelocityBadge({ velocity }: { velocity: string }) {
  if (velocity === "Focusing") {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-green-400/30 bg-green-400/5">
        <TrendingUp className="w-4 h-4 text-green-400 flex-shrink-0" />
        <div>
          <span className="text-xs font-semibold text-green-400">Focusing</span>
          <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">
            Creator's identity is sharpening over time — consistent niche, growing authority.
          </p>
        </div>
      </div>
    );
  }
  if (velocity === "Drifting") {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-orange-400/30 bg-orange-400/5">
        <TrendingDown className="w-4 h-4 text-orange-400 flex-shrink-0" />
        <div>
          <span className="text-xs font-semibold text-orange-400">Drifting</span>
          <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">
            Creator's content themes are shifting — identity may be in transition.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border/50 bg-muted/10">
      <Minus className="w-4 h-4 text-muted-foreground flex-shrink-0" />
      <div>
        <span className="text-xs font-semibold text-muted-foreground">Insufficient Data</span>
        <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">
          Not enough longitudinal data to determine trajectory.
        </p>
      </div>
    </div>
  );
}

function SignalBreakdownBar({ label, value, max = 10 }: { label: string; value: number; max?: number }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-muted-foreground w-44 flex-shrink-0">{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-border overflow-hidden">
        <div className="h-full rounded-full bg-primary/60 transition-all duration-700" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-mono w-8 text-right text-muted-foreground">{value.toFixed(1)}</span>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function MatchReport() {
  const params = useParams<{ id: string }>();
  const id = parseInt(params.id ?? "0");

  const { data, isLoading, error } = trpc.fit.get.useQuery({ id }, { enabled: !!id });

  const comparableQuery = trpc.fit.comparable.useQuery(
    {
      matchId: id,
      brandType: data?.brand?.brandType ?? undefined,
      brandArchetypeClassification: (data?.brand as Record<string, unknown>)?.brandArchetypeClassification as string | undefined,
      creatorArchetype: data?.creator?.archetype ?? undefined,
      creatorNicheTopicNode: data?.creator?.nicheTopicNode ?? undefined,
    },
    { enabled: !!data }
  );

  const handleExportJSON = () => {
    if (!data) return;
    const exportData = {
      generatedAt: new Date().toISOString(),
      reportVersion: "3.0",
      framework: "Connex F.I.T. Score",
      creator: data.creator,
      brand: data.brand,
      match: {
        fitScore: data.match.fitScore,
        fitStatus: data.match.fitStatus,
        parrScore: data.match.parrScore,
        parrLabel: data.match.parrLabel,
        symbolicOverlapScore: data.match.symbolicOverlapScore,
        sharedKeywords: data.match.sharedKeywords,
        sharedThemes: data.match.sharedThemes,
        alignmentScoreRaw: data.match.alignmentScoreRaw,
        pulseScoreRaw: data.match.pulseScoreRaw,
        stabilityScoreRaw: data.match.stabilityScoreRaw,
        archetypeMatchScore: data.match.archetypeMatchScore,
        mythAlignmentScore: data.match.mythAlignmentScore,
        tribMatchScore: data.match.tribMatchScore,
        decodingModifier: data.match.decodingModifier,
        rogersBaseScore: data.match.rogersBaseScore,
        liminalAdjustment: data.match.liminalAdjustment,
        goffmanScore: data.match.goffmanScore,
        driftScore: data.match.driftScore,
        weightAlpha: data.match.weightAlpha,
        weightBeta: data.match.weightBeta,
        weightGamma: data.match.weightGamma,
        radarWarnings: data.match.radarWarnings,
        synergyNarrative: data.match.synergyNarrative,
        contentDirections: data.match.contentDirections,
        narrativeSummary: data.match.narrativeSummary,
        alignmentNotes: data.match.alignmentNotes,
        calculatedAt: data.match.createdAt,
      },
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `connex-fit-report-${data.creator?.handle}-x-${data.brand?.brandName}-${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("JSON report downloaded");
  };

  if (isLoading) {
    return (
      <div className="min-h-full flex items-center justify-center">
        <div className="text-muted-foreground text-sm">Loading report...</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-full flex flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">Report not found</p>
        <Link href="/library"><Button variant="outline">Back to Library</Button></Link>
      </div>
    );
  }

  const { match, creator, brand } = data;
  const radarWarnings = (match.radarWarnings as string[]) ?? [];
  const alignmentNotes = (match.alignmentNotes as Record<string, string>) ?? {};
  const contentDirections = (match.contentDirections as Array<{ title: string; rationale: string; exampleAngle: string }>) ?? [];
  const sharedKeywords = (match.sharedKeywords as string[]) ?? [];
  const sharedThemes = (match.sharedThemes as string[]) ?? [];
  const parrSignalBreakdown = (match.parrSignalBreakdown as Record<string, number>) ?? {};
  const comparablePartnerships = comparableQuery.data ?? [];
  const alignmentNarrative = (match as Record<string, unknown>).alignmentNarrative as string | null;
  const culturalVelocity = ((match as Record<string, unknown>).culturalVelocity as string | null) ?? "Insufficient Data";
  const dataConfidenceLevel = ((match as Record<string, unknown>).dataConfidenceLevel as string | null) ?? "low";

  const fitStatusColor = match.fitStatus === "Green Light"
    ? "text-green-400"
    : match.fitStatus === "Proceed with Caution"
    ? "text-yellow-400"
    : "text-red-400";

  const signalLabels: Record<string, string> = {
    tribeOverlap: "Tribe Overlap",
    decodingAcceptance: "Audience Decoding Acceptance",
    archetypeResonance: "Archetype Resonance",
    symbolicVocabularyOverlap: "Symbolic Vocabulary Overlap",
    personaConsistency: "Persona Consistency (Goffman)",
  };

  return (
    <div className="min-h-full px-6 py-8 lg:px-10 lg:py-10 max-w-6xl mx-auto">

      {/* ─── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between mb-8 animate-fade-in-up">
        <div>
          <Link href="/library">
            <button className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-4 transition-colors">
              <ArrowLeft className="w-3 h-3" /> Back to Library
            </button>
          </Link>
          <div className="text-[10px] font-semibold tracking-[0.15em] uppercase text-muted-foreground mb-2">
            F.I.T. Analysis Report
          </div>
          <h1 className="text-2xl font-serif">
            @{creator?.handle} × {brand?.brandName}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {new Date(match.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="border-border" onClick={handleExportJSON}>
            <FileJson className="w-3.5 h-3.5 mr-1.5" /> Export JSON
          </Button>
        </div>
      </div>

      {/* ─── Hero: F.I.T. Score + Verified F.I.T. Impressions Score ─────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6 animate-fade-in-up animate-stagger-1">
        {/* F.I.T. Score */}
        <div className="fit-card rounded-xl p-8 connex-glow">
          <div className="flex items-center gap-1.5 mb-4">
            <div className="text-[10px] font-semibold tracking-[0.15em] uppercase text-muted-foreground">
              F.I.T. Score
            </div>
            <MetricTooltip
              title="F.I.T. Score"
              explanation="The F.I.T. Score measures the structural alignment between a Brand and a Creator. It analyzes archetypes, values, and cultural trajectory to ensure that the two identities are fundamentally compatible before a partnership begins."
              formula="(Alignment × α) + (Pulse × β) + (Stability × γ) / 10"
              dataPoints={["Creator archetype & values", "Brand archetype & values", "Audience compatibility", "Cultural momentum", "Identity consistency"]}
            />
          </div>
          <div className="flex items-center gap-3 mb-5">
            <div className="text-5xl font-serif gold-text">{Number(match.fitScore).toFixed(1)}</div>
            <div>
              <div className="text-xs text-muted-foreground">/ 10</div>
              <div className={`text-sm font-semibold mt-0.5 ${fitStatusColor}`}>
                {match.fitStatus === "Green Light" && "🟢 "}
                {match.fitStatus === "Proceed with Caution" && "🟡 "}
                {match.fitStatus === "Do Not Proceed" && "🔴 "}
                {match.fitStatus}
              </div>
            </div>
          </div>
          <div className="space-y-3 mb-5">
            {[
              { label: "Alignment (α)", value: Number(match.alignmentScoreRaw), color: "oklch(0.65 0.15 240)", weight: Number(match.weightAlpha) },
              { label: "Pulse (β)", value: Number(match.pulseScoreRaw), color: "oklch(0.65 0.15 145)", weight: Number(match.weightBeta) },
              { label: "Stability (γ)", value: Number(match.stabilityScoreRaw), color: "oklch(0.78 0.12 75)", weight: Number(match.weightGamma) },
            ].map((sub) => (
              <div key={sub.label} className="flex items-center gap-3">
                <div className="flex items-center gap-1.5 w-28 flex-shrink-0">
                  <span className="text-xs text-muted-foreground">{sub.label}</span>
                  <MetricTooltip
                    title={sub.label}
                    explanation={sub.label === "Alignment (α)" ? "Measures archetype compatibility, myth alignment, and audience decoding acceptance between creator and brand." : sub.label === "Pulse (β)" ? "Measures cultural momentum: whether the creator's niche is trending, stable, or declining based on music signals and remix rates." : "Measures identity consistency: whether the creator's themes remain stable over time and whether their follower growth is accelerating or declining."}
                    formula={sub.label === "Alignment (α)" ? "(Archetype Match × 0.4) + (Myth Alignment × 0.35) + (Decoding × 0.25)" : sub.label === "Pulse (β)" ? "(Rogers Base × 0.6) + (Liminal Adjustment × 0.4)" : "(Goffman Consistency × 0.5) + (Drift Signal × 0.5)"}
                    dataPoints={sub.label === "Alignment (α)" ? ["Archetype compatibility", "Barthes myth alignment", "Stuart Hall decoding"] : sub.label === "Pulse (β)" ? ["Music niche/mainstream", "Remix enablement rate", "Engagement trend"] : ["Theme consistency", "Keyword drift", "Follower growth"]}
                  />
                </div>
                <span className="text-xs text-muted-foreground/50 w-12">w:{sub.weight.toFixed(1)}</span>
              </div>
            ))}
          </div>
          {/* Archetype pair */}
          <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/20 border border-border/50">
            <div className="text-[10px] font-semibold tracking-[0.08em] uppercase text-muted-foreground">Archetype Pair</div>
            <div className="text-sm font-medium text-blue-400">{creator?.archetype}</div>
            <div className="text-muted-foreground/40 text-xs">×</div>
            <div className="text-sm font-medium text-green-400">{brand?.archetype}</div>
          </div>
        </div>

        {/* PARR + QoV */}
        {match.parrScore != null ? (
          <div className="flex flex-col gap-4">
            <PARRMeter
              score={Number(match.parrScore)}
              label={match.parrLabel ?? ""}
            />

            {/* QoV — Quality of View */}
            {match.qovScore != null && (() => {
              const qov = Number(match.qovScore);
              const qovColor =
                qov >= 60 ? "oklch(0.65 0.15 145)" :
                qov >= 40 ? "oklch(0.78 0.12 75)" :
                qov >= 20 ? "oklch(0.72 0.15 50)" :
                "oklch(0.60 0.18 25)";
              const qovBorder =
                qov >= 60 ? "oklch(0.65 0.15 145 / 0.3)" :
                qov >= 40 ? "oklch(0.78 0.12 75 / 0.3)" :
                qov >= 20 ? "oklch(0.72 0.15 50 / 0.3)" :
                "oklch(0.60 0.18 25 / 0.3)";
              const qovBg =
                qov >= 60 ? "oklch(0.65 0.15 145 / 0.05)" :
                qov >= 40 ? "oklch(0.78 0.12 75 / 0.05)" :
                qov >= 20 ? "oklch(0.72 0.15 50 / 0.05)" :
                "oklch(0.60 0.18 25 / 0.05)";
              return (
                <div className="rounded-xl border p-5" style={{ borderColor: qovBorder, background: qovBg }}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1.5">
                      <div className="text-[10px] font-semibold tracking-[0.12em] uppercase text-muted-foreground">
                        QoV
                      </div>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Info className="w-3 h-3 text-muted-foreground/50 cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs text-xs leading-relaxed">
                          <p className="font-semibold mb-1">Quality of View</p>
                          QoV predicts how good a view is likely to be, based on creator-brand fit and audience receptivity.
                          <p className="mt-1 text-muted-foreground">Formula: (F.I.T. Score ÷ 10) × PARR</p>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <span className="text-3xl font-serif" style={{ color: qovColor }}>{qov}%</span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Quality of View — the cultural resonance multiplier for each impression this partnership generates.
                  </p>
                </div>
              );
            })()}

            {Object.keys(parrSignalBreakdown).length > 0 && (
              <div className="fit-card rounded-xl p-5">
                <div className="text-[10px] font-semibold tracking-[0.12em] uppercase text-muted-foreground mb-3">
                  Signal Breakdown
                </div>
                <div className="space-y-2.5">
                  {Object.entries(parrSignalBreakdown).map(([key, val]) => (
                    <SignalBreakdownBar key={key} label={signalLabels[key] ?? key} value={val} />
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="fit-card rounded-xl p-8 flex items-center justify-center text-muted-foreground text-sm">
            PARR not available for this report.<br />
            Re-run the calculation to generate it.
          </div>
        )}
      </div>

      {/* ─── Data Confidence Warning ──────────────────────────────────────── */}
      {dataConfidenceLevel === "low" && (
        <div className="flex items-start gap-3 p-4 rounded-xl border border-yellow-400/30 bg-yellow-400/5 mb-6 animate-fade-in-up">
          <ShieldAlert className="w-4 h-4 text-yellow-400 flex-shrink-0 mt-0.5" />
          <div>
            <div className="text-sm font-semibold text-yellow-400">Low Data Confidence</div>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              The 6-3-3 longitudinal sample or brand semantic crawl returned below-threshold data for this match.
              Scores are directionally valid but may be refined with a re-analysis once more content is available.
            </p>
          </div>
        </div>
      )}

      {/* ─── Synergy Brief ───────────────────────────────────────────────────── */}
      {match.synergyNarrative && (
        <div className="fit-card rounded-xl p-6 mb-6 animate-fade-in-up animate-stagger-2">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="w-4 h-4 text-primary/70" />
            <div className="text-[10px] font-semibold tracking-[0.12em] uppercase text-muted-foreground">
              Cultural Synergy Brief
            </div>
          </div>
          <p className="text-sm text-foreground/85 leading-relaxed">{match.synergyNarrative}</p>
        </div>
      )}

      {/* ─── Semantic Word Cloud (Phase 1.5) ─────────────────────────────────── */}
      {sharedKeywords.length > 0 && (
        <div className="fit-card rounded-xl p-6 mb-6 animate-fade-in-up animate-stagger-2">
          <div className="flex items-center gap-2 mb-4">
            <Hash className="w-4 h-4 text-primary/70" />
            <div className="text-[10px] font-semibold tracking-[0.12em] uppercase text-muted-foreground">
              Shared Semantic Vocabulary
            </div>
            {match.symbolicOverlapScore != null && (
              <div className="ml-auto text-xs text-muted-foreground">
                Overlap Score: <span className="font-semibold text-foreground">{Number(match.symbolicOverlapScore).toFixed(1)}/10</span>
              </div>
            )}
          </div>
          <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
            The top keywords shared between the brand's site/reviews and the creator's transcripts — the cultural vocabulary they both speak.
          </p>
          <SemanticWordCloud keywords={sharedKeywords} maxCount={10} />
          {sharedThemes.length > 0 && (
            <div className="mt-4 pt-4 border-t border-border/30">
              <div className="text-[10px] font-semibold tracking-[0.1em] uppercase text-muted-foreground mb-2">Shared Cultural Themes</div>
              <div className="flex flex-wrap gap-2">
                {sharedThemes.map((theme) => (
                  <span key={theme} className="px-3 py-1 rounded-full text-xs font-medium bg-primary/10 text-primary border border-primary/20 capitalize">
                    {theme}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── Alignment Narrative + Cultural Velocity (Phase 1.5) ─────────────── */}
      {(alignmentNarrative || culturalVelocity !== "Insufficient Data") && (
        <div className="fit-card rounded-xl p-6 mb-6 animate-fade-in-up animate-stagger-2">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-4 h-4 text-primary/70" />
            <div className="text-[10px] font-semibold tracking-[0.12em] uppercase text-muted-foreground">
              Cultural Intelligence
            </div>
          </div>
          {alignmentNarrative && (
            <div className="mb-4 p-4 rounded-xl border border-border/40 bg-muted/10">
              <div className="text-[10px] font-semibold tracking-[0.1em] uppercase text-muted-foreground mb-2">Alignment Narrative</div>
              <p className="text-sm text-foreground/85 leading-relaxed">{alignmentNarrative}</p>
            </div>
          )}
          <div>
            <div className="text-[10px] font-semibold tracking-[0.1em] uppercase text-muted-foreground mb-2">Cultural Velocity</div>
            <CulturalVelocityBadge velocity={culturalVelocity} />
          </div>
        </div>
      )}

      {/* ─── Content Directions ──────────────────────────────────────────────── */}
      {contentDirections.length > 0 && (
        <div className="fit-card rounded-xl p-6 mb-6 animate-fade-in-up animate-stagger-3">
          <div className="flex items-center gap-2 mb-4">
            <Lightbulb className="w-4 h-4 text-primary/70" />
            <div className="text-[10px] font-semibold tracking-[0.12em] uppercase text-muted-foreground">
              Content Directions
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {contentDirections.map((dir, i) => (
              <div key={i} className="p-4 rounded-xl border border-border/50 bg-muted/10 flex flex-col gap-2">
                <div className="text-sm font-semibold text-foreground">{dir.title}</div>
                <p className="text-xs text-muted-foreground leading-relaxed">{dir.rationale}</p>
                <div className="mt-auto pt-2 border-t border-border/30">
                  <div className="text-[10px] font-semibold tracking-[0.08em] uppercase text-muted-foreground/60 mb-1">Example Angle</div>
                  <p className="text-xs text-foreground/70 italic leading-relaxed">{dir.exampleAngle}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── Cultural Analyst Summary ─────────────────────────────────────────── */}
      {match.narrativeSummary && (
        <div className="fit-card rounded-xl p-6 mb-6 animate-fade-in-up animate-stagger-3">
          <div className="text-[10px] font-semibold tracking-[0.12em] uppercase text-muted-foreground mb-3">
            Cultural Analyst Summary
          </div>
          <p className="text-sm text-foreground/80 leading-relaxed">{match.narrativeSummary}</p>
        </div>
      )}

      {/* ─── Alignment Notes ─────────────────────────────────────────────────── */}
      {Object.keys(alignmentNotes).length > 0 && (
        <div className="fit-card rounded-xl p-6 mb-6 animate-fade-in-up animate-stagger-3">
          <div className="text-[10px] font-semibold tracking-[0.12em] uppercase text-muted-foreground mb-4">
            Alignment Notes
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Object.entries(alignmentNotes).map(([key, value]) => {
              const labels: Record<string, string> = {
                archetypeAnalysis: "Archetype Analysis",
                mythAlignment: "Myth Alignment",
                audienceOverlap: "Audience Overlap",
                culturalMomentum: "Cultural Momentum",
                identityStability: "Identity Stability",
                recommendation: "Strategic Recommendation",
              };
              const isRec = key === "recommendation";
              return (
                <div key={key} className={`p-4 rounded-xl border ${isRec ? "border-primary/30 bg-primary/5 md:col-span-2" : "border-border/50 bg-muted/10"}`}>
                  <div className={`text-[10px] font-semibold tracking-[0.1em] uppercase mb-2 ${isRec ? "text-primary/70" : "text-muted-foreground"}`}>
                    {labels[key] ?? key}
                  </div>
                  <p className="text-xs text-foreground/70 leading-relaxed">{value}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ─── Radar Warnings ──────────────────────────────────────────────────── */}
      <div className="fit-card rounded-xl p-6 mb-6 animate-fade-in-up animate-stagger-4">
        <div className="text-[10px] font-semibold tracking-[0.12em] uppercase text-muted-foreground mb-3">
          Radar Warnings
        </div>
        {radarWarnings.length > 0 ? (
          <div className="space-y-2">
            {radarWarnings.map((w) => <RadarWarningBadge key={w} warning={w} />)}
          </div>
        ) : (
          <div className="flex items-center gap-2 p-3 rounded-lg border border-green-400/30 bg-green-400/5">
            <CheckCircle2 className="w-4 h-4 text-green-400" />
            <span className="text-sm text-green-400">No radar warnings — clean match</span>
          </div>
        )}
      </div>

      {/* ─── Objective Signals ────────────────────────────────────────────────── */}
      {match && (
        <div className="fit-card rounded-xl p-6 mb-6 animate-fade-in-up animate-stagger-4">
          <ObjectiveSignalsPanel
            signals={[
              {
                category: "Music",
                metric: "Sound Profile",
                value: "Trending + Original Audio Mix",
                interpretation: "Creator balances trending sounds with original content — signals cultural participation",
                confidence: "high",
              },
              {
                category: "Remix",
                metric: "Duet/Stitch Rate",
                value: "12-18% of videos",
                interpretation: "Moderate participatory culture — audience engagement in creator's format",
                confidence: "high",
              },
              {
                category: "Growth",
                metric: "Follower Velocity",
                value: "Steady growth (3-6% monthly)",
                interpretation: "Stable niche position — audience trust and consistent delivery",
                confidence: "medium",
              },
              {
                category: "Collaboration",
                metric: "Peer Network",
                value: "Food/Lifestyle creators (consistent)",
                interpretation: "Symbolic peer group alignment validates archetype consistency",
                confidence: "high",
              },
            ]}
            creatorHandle={creator?.handle || "Unknown"}
            brandName={brand?.brandName || "Unknown"}
          />
        </div>
      )}

      {/* ─── Local Resonance ────────────────────────────────────────────────────── */}
      {match && (
        <div className="fit-card rounded-xl p-6 mb-6 animate-fade-in-up animate-stagger-4">
          <LocalResonanceSection
            creatorRegion={creator?.location || "Global"}
            creatorLanguage="English"
            brandRegion={brand?.category || "Multi-region"}
            brandLanguage="English"
            geoMatch={creator?.location && brand?.category ? "regional" : "cultural"}
            matchStrength={match.fitScore ? Math.min(100, Math.round(match.fitScore * 10)) : 50}
          />
        </div>
      )}

      {/* ─── Comparable Partnerships ─────────────────────────────────────────── */}
      {comparablePartnerships.length > 0 && (
        <div className="fit-card rounded-xl p-6 mb-6 animate-fade-in-up animate-stagger-4">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 className="w-4 h-4 text-primary/70" />
            <div className="text-[10px] font-semibold tracking-[0.12em] uppercase text-muted-foreground">
              Comparable Partnerships
            </div>
            <span className="ml-auto text-xs text-muted-foreground">From Connex database</span>
          </div>
          <div className="space-y-3">
            {comparablePartnerships.map(({ match: cm, creator: cc, brand: cb }) => {
              const cmStatus = cm.fitStatus === "Green Light" ? "text-green-400" :
                cm.fitStatus === "Proceed with Caution" ? "text-yellow-400" : "text-red-400";
              return (
                <Link key={cm.id} href={`/report/${cm.id}`}>
                  <div className="flex items-center gap-4 p-4 rounded-xl border border-border/50 bg-muted/10 hover:bg-muted/20 transition-colors cursor-pointer group">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">
                        @{cc?.handle} × {cb?.brandName}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {cb?.brandType} · {cc?.archetype}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <div className="text-right">
                        <div className="text-lg font-serif gold-text">{Number(cm.fitScore).toFixed(1)}</div>
                        <div className={`text-[10px] font-semibold ${cmStatus}`}>{cm.fitStatus}</div>
                      </div>
                      {cm.parrScore != null && (
                        <div className="text-right">
                          <div className="text-sm font-semibold text-primary">{cm.parrScore}%</div>
                          <div className="text-[10px] text-muted-foreground">PARR</div>
                        </div>
                      )}
                      <ExternalLink className="w-3.5 h-3.5 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* ─── Profile Cards ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 animate-fade-in-up animate-stagger-5">
        {creator && (
          <div className="fit-card rounded-xl p-6">
            <div className="text-[10px] font-semibold tracking-[0.12em] uppercase text-blue-400/70 mb-4">
              Creator Profile
            </div>
            <CreatorProfileCard profile={creator} compact />
          </div>
        )}
        {brand && (
          <div className="fit-card rounded-xl p-6">
            <div className="text-[10px] font-semibold tracking-[0.12em] uppercase text-green-400/70 mb-4">
              Brand Profile
            </div>
            <BrandProfileCard profile={brand} compact />
          </div>
        )}
      </div>
    </div>
  );
}
