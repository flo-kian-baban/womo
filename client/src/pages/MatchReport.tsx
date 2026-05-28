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
import { SignalPanel } from "@/components/SignalPanel";
import { LocalResonanceSection } from "@/components/LocalResonanceSection";

// ─── Sub-components ──────────────────────────────────────────────────────────

function RadarWarningBadge({ warning }: { warning: string }) {
  const configs: Record<string, { icon: typeof AlertTriangle; color: string; desc: string }> = {
    "Low Alignment": { icon: AlertTriangle, color: "text-red-400 bg-red-400/10 border-red-400/30", desc: "Alignment score below 6.0 — creator and brand do not share symbolic language" },
    "Archetype Tension": { icon: XCircle, color: "text-orange-400 bg-orange-400/10 border-orange-400/30", desc: "Creator archetype appears in brand's 'Clashes With' list" },
    "Identity Instability": { icon: AlertCircle, color: "text-yellow-400 bg-yellow-400/10 border-yellow-400/30", desc: "Full Pivot drift signal or Significant Gap in Goffman stage consistency" },
    "Low Pulse": { icon: AlertTriangle, color: "text-orange-400 bg-orange-400/10 border-orange-400/30", desc: "Niche pulse score below 4.0 — cultural momentum is weak or window is closing" },
    "Trajectory Divergence": { icon: AlertCircle, color: "text-yellow-400 bg-yellow-400/10 border-yellow-400/30", desc: "Creator is behind the niche's current adoption position" },
    "Low Social Engagement": { icon: TrendingDown, color: "text-orange-400 bg-orange-400/10 border-orange-400/30", desc: "Brand TikTok engagement rate is below 0.5% — limited social proof" },
    "Negative Audience Sentiment": { icon: ShieldAlert, color: "text-red-400 bg-red-400/10 border-red-400/30", desc: "Audience mentions of this brand skew negative — partnership may inherit reputational risk" },
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
          <MetricTooltip
            title="PARR — Predicted Audience Receptivity Rate"
            explanation="PARR calculates what percentage of the creator's audience is structurally guaranteed to receive the brand message as authentic and culturally legitimate, rather than forced or inauthentic."
            formula="(Archetype Alignment × 0.35) + (Symbolic Overlap × 0.30) + (Decoding Mode × 0.20) + (Tribe Match × 0.15)"
            whyItMatters="A high PARR means the audience will accept the brand message without cognitive dissonance. A low PARR means the audience will perceive the partnership as a paid placement, reducing trust and conversion."
            dataPoints={["Archetype compatibility", "Shared symbolic vocabulary", "Stuart Hall decoding mode", "Audience tribe alignment"]}
            side="top"
          />
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
      framework: "Connex Cultural Match Score",
      creator: data.creator,
      brand: data.brand,
      match: {
        caiScore: data.match.caiScore,
        caiStatus: data.match.caiStatus,
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

  const caiStatusColor = match.caiStatus === "Green Light"
    ? "text-green-400"
    : match.caiStatus === "Proceed with Caution"
    ? "text-yellow-400"
    : "text-red-400";

  // Phase 6: Music Overlap + Cultural Exchange
  const musicOverlap = (match as Record<string, unknown>).musicOverlap as {
    sharedTitles: string[];
    sharedArtists: string[];
    overlapStrength: "strong" | "moderate" | "none";
  } | null;
  const culturalBorrowingSummary = (match as Record<string, unknown>).culturalBorrowingSummary as string | null;
  const mentionSentiment = brand?.mentionSentiment as string | null;
  const mentionHashtagCloud = (brand?.mentionHashtagCloud as string[] | null) ?? [];
  const mentionMusicSignals = (brand?.mentionMusicSignals as string[] | null) ?? [];
  const mentionTotalCount = brand?.mentionTotalCount ?? 0;

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

      {/* ─── Hero: Cultural Match Score + Verified F.I.T. Impressions Score ─────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6 animate-fade-in-up animate-stagger-1">
        {/* Cultural Match Score */}
        <div className="fit-card rounded-xl p-8 connex-glow">
          <div className="flex items-center gap-1.5 mb-4">
            <div className="text-[10px] font-semibold tracking-[0.15em] uppercase text-muted-foreground">
              Cultural Match Score
            </div>
            <MetricTooltip
              title="Cultural Match Score"
              explanation="The Cultural Match Score measures the structural alignment between a Brand and a Creator. It analyzes archetypes, values, and cultural trajectory to ensure that the two identities are fundamentally compatible before a partnership begins."
              formula="(Alignment × α) + (Pulse × β) + (Stability × γ) / 10"
              dataPoints={["Creator archetype & values", "Brand archetype & values", "Audience compatibility", "Cultural momentum", "Identity consistency"]}
            />
          </div>
          <div className="flex items-center gap-3 mb-5">
            <div className="text-5xl font-serif gold-text">{Number(match.caiScore).toFixed(2)}</div>
            <div>
              <div className="text-xs text-muted-foreground">/ 10</div>
              <div className={`text-sm font-semibold mt-0.5 ${caiStatusColor}`}>
                {match.caiStatus === "Green Light" && "🟢 "}
                {match.caiStatus === "Proceed with Caution" && "🟡 "}
                {match.caiStatus === "Do Not Proceed" && "🔴 "}
                {match.caiStatus}
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
                      <MetricTooltip
                        title="QoV — Quality of View"
                        explanation="Quality of View quantifies the cultural resonance of each impression this partnership generates. It combines the entity-level cultural fit (Cultural Match Score) with the audience-level receptivity (PARR) to produce a single impression quality score."
                        formula="(Cultural Match Score ÷ 10) × PARR"
                        whyItMatters="Raw impression counts are meaningless without quality context. A QoV of 60% means 60% of every view is converting into genuine brand equity — not just passive exposure."
                        dataPoints={["Cultural Match Score", "PARR (Predicted Audience Receptivity Rate)"]}
                        side="top"
                      />
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

      {/* ─── Five Fit Signals ──────────────────────────────────────────────── */}
      {(match.creativeIntegritySignal != null ||
        match.performanceConsistencySignal != null ||
        match.communityQualitySignal != null ||
        match.audienceReceptivitySignal != null ||
        match.brandTrustSignal != null) && (
        <div className="mb-6 animate-fade-in-up animate-stagger-2">
          <SignalPanel
            signals={[
              {
                name: "Identity Fit",
                score: match.creativeIntegritySignal != null ? Number(match.creativeIntegritySignal) : 50,
                confidence: (match.creativeIntegrityConfidence as "Verified" | "Estimated" | "Insufficient Data") ?? "Estimated",
                reasoning: "Does the creator's cultural identity genuinely align with this brand's world?",
                category: "Performance",
              },
              {
                name: "Performance Fit",
                score: match.performanceConsistencySignal != null ? Number(match.performanceConsistencySignal) : 50,
                confidence: (match.performanceConsistencyConfidence as "Verified" | "Estimated" | "Insufficient Data") ?? "Estimated",
                reasoning: "Does this creator have the engagement track record to deliver for this brand?",
                category: "Performance",
              },
              {
                name: "Audience Fit",
                score: match.communityQualitySignal != null ? Number(match.communityQualitySignal) : 50,
                confidence: (match.communityQualityConfidence as "Verified" | "Estimated" | "Insufficient Data") ?? "Estimated",
                reasoning: "Are the creator's followers the people this brand actually needs to reach?",
                category: "Performance",
              },
              {
                name: "Receptivity Fit",
                score: match.audienceReceptivitySignal != null ? Number(match.audienceReceptivitySignal) : 50,
                confidence: (match.audienceReceptivityConfidence as "Verified" | "Estimated" | "Insufficient Data") ?? "Estimated",
                reasoning: "Will this creator's audience accept a brand message from them?",
                category: "Performance",
              },
              {
                name: "Brand Safety Fit",
                score: match.brandTrustSignal != null ? Number(match.brandTrustSignal) : 50,
                confidence: (match.brandTrustConfidence as "Verified" | "Estimated" | "Insufficient Data") ?? "Estimated",
                reasoning: "Is this creator a stable, low-risk reputational partner for this brand?",
                category: "Performance",
              },
              {
                name: "Cultural Identity",
                score: match.alignmentScoreRaw != null ? Number(match.alignmentScoreRaw) * 10 : 50,
                confidence: "Verified",
                reasoning: "Archetype + myth alignment + tribe match (Alignment component).",
                category: "Cultural",
              },
              {
                name: "Cultural Momentum",
                score: match.pulseScoreRaw != null ? Number(match.pulseScoreRaw) * 10 : 50,
                confidence: "Verified",
                reasoning: "Rogers adoption stage + liminal adjustment (Pulse component).",
                category: "Cultural",
              },
              {
                name: "Partnership Stability",
                score: match.stabilityScoreRaw != null ? Number(match.stabilityScoreRaw) * 10 : 50,
                confidence: "Verified",
                reasoning: "Goffman stage consistency + drift signal (Stability component).",
                category: "Cultural",
              },
            ]}
            caiScore={Number(match.caiScore)}
            caiStatus={match.caiStatus as "Green Light" | "Proceed with Caution" | "Do Not Proceed"}
          />
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
            matchStrength={match.caiScore ? Math.min(100, Math.round(match.caiScore * 10)) : 50}
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
              const cmStatus = cm.caiStatus === "Green Light" ? "text-green-400" :
                cm.caiStatus === "Proceed with Caution" ? "text-yellow-400" : "text-red-400";
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
                        <div className="text-lg font-serif gold-text">{Number(cm.caiScore).toFixed(2)}</div>
                        <div className={`text-[10px] font-semibold ${cmStatus}`}>{cm.caiStatus}</div>
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


      {/* ─── Cultural Exchange Report ─────────────────────────────────────────── */}
      <div className="fit-card rounded-xl p-6 mb-6 animate-fade-in-up animate-stagger-5">
        <div className="flex items-center gap-2 mb-1">
          <Sparkles className="w-4 h-4 text-primary/70" />
          <div className="text-[10px] font-semibold tracking-[0.12em] uppercase text-muted-foreground">Cultural Exchange Report</div>
        </div>
        <p className="text-xs text-muted-foreground mb-5 leading-relaxed">
          What the brand is culturally borrowing from this creator — and what the creator brings to the collaboration.
        </p>

        {/* Side-by-side trait comparison table */}
        <div className="overflow-x-auto mb-6">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr>
                <th className="text-left text-[10px] font-semibold tracking-[0.12em] uppercase text-muted-foreground py-2 pr-4 w-1/4">Trait</th>
                <th className="text-left py-2 px-3 w-[37.5%]">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-blue-400" />
                    <span className="text-xs font-semibold text-blue-400">@{creator?.handle}</span>
                    <span className="text-[10px] text-muted-foreground">(Creator)</span>
                  </div>
                </th>
                <th className="text-left py-2 px-3 w-[37.5%]">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-emerald-400" />
                    <span className="text-xs font-semibold text-emerald-400">{brand?.brandName}</span>
                    <span className="text-[10px] text-muted-foreground">(Brand)</span>
                  </div>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {(([
                {
                  trait: "Archetype",
                  tooltip: "Jungian archetype — the personality type each entity projects",
                  creatorVal: creator?.archetype ?? "—",
                  brandVal: brand?.archetype ?? "—",
                  type: "badge" as const,
                },
                {
                  trait: "Audience",
                  tooltip: "Who they speak to and how they relate to them",
                  creatorVal: creator?.audienceRelationshipType
                    ? `${creator.audienceRelationshipType} relationship${creator.followerCount ? ` · ${creator.followerCount >= 1000000 ? (creator.followerCount / 1000000).toFixed(1) + "M" : (creator.followerCount / 1000).toFixed(0) + "K"} followers` : ""}`
                    : creator?.followerCount ? `${(creator.followerCount / 1000).toFixed(0)}K followers` : "—",
                  brandVal: brand?.audienceTribe ?? "—",
                  type: "text" as const,
                },
                {
                  trait: "Tone",
                  tooltip: "The register and voice each entity uses to communicate",
                  creatorVal: creator?.toneRegister ?? "—",
                  brandVal: brand?.brandTone ?? "—",
                  type: "text" as const,
                },
                {
                  trait: "Myth",
                  tooltip: "The Barthes myth — the belief each entity normalizes for its audience",
                  creatorVal: creator?.barthesMyth ?? "—",
                  brandVal: brand?.barthesMyth ?? "—",
                  type: "quote" as const,
                },
                {
                  trait: "Musical Leanings",
                  tooltip: "Music and sound signals from content — a proxy for cultural taste and community",
                  creatorVal: (() => {
                    const transcripts = (creator as unknown as Record<string, unknown>)?.transcripts as Array<Record<string, unknown>> | null;
                    const sounds = (transcripts ?? []).map((t: Record<string, unknown>) => (t.musicMetadata as Record<string, unknown> | undefined)?.soundName as string | undefined).filter(Boolean) as string[];
                    return sounds.length > 0 ? sounds.slice(0, 3).join(", ") : "—";
                  })(),
                  brandVal: mentionMusicSignals.length > 0 ? mentionMusicSignals.slice(0, 3).join(", ") : "—",
                  type: "text" as const,
                },
                {
                  trait: "Style",
                  tooltip: "Visual language and aesthetic signals",
                  creatorVal: (() => { const t = (creator?.recurringThemes as string[] | null) ?? []; return t.length > 0 ? t.slice(0, 3).join(", ") : "—"; })(),
                  brandVal: (() => { const vl = (brand?.visualLanguage as string[] | null) ?? []; return vl.length > 0 ? vl.join(", ") : "—"; })(),
                  type: "text" as const,
                },
                {
                  trait: "Reach",
                  tooltip: "Platform presence and social footprint",
                  creatorVal: creator?.followerCount
                    ? `${creator.followerCount >= 1000000 ? (creator.followerCount / 1000000).toFixed(1) + "M" : (creator.followerCount / 1000).toFixed(0) + "K"} followers`
                    : "—",
                  brandVal: brand?.tiktokAudienceSize
                    ? `${brand.tiktokAudienceSize >= 1000000 ? (brand.tiktokAudienceSize / 1000000).toFixed(1) + "M" : (brand.tiktokAudienceSize / 1000).toFixed(0) + "K"} TikTok followers`
                    : mentionTotalCount > 0 ? `${mentionTotalCount} audience mentions found` : "—",
                  type: "text" as const,
                },
                {
                  trait: "Engagement",
                  tooltip: "How actively audiences interact with their content",
                  creatorVal: creator?.engagementRate != null
                    ? `${Number(creator.engagementRate).toFixed(1)}% engagement rate`
                    : creator?.engagementQualityScore != null
                    ? `${Math.round(Number(creator.engagementQualityScore) * 100)}% engagement quality`
                    : "—",
                  brandVal: brand?.tiktokEngagementRate != null
                    ? `${Number(brand.tiktokEngagementRate).toFixed(1)}% TikTok engagement`
                    : brand?.overallRating != null
                    ? `${Number(brand.overallRating).toFixed(1)}★ avg rating (${brand.totalReviews ?? 0} reviews)`
                    : "—",
                  type: "text" as const,
                },
                {
                  trait: "Audience Trust",
                  tooltip: "How much the audience trusts and believes this entity",
                  creatorVal: creator?.parasocialBondStrength != null
                    ? `${Number(creator.parasocialBondStrength).toFixed(1)}/5 parasocial bond`
                    : "—",
                  brandVal: (() => {
                    const s = mentionSentiment;
                    const r = brand?.overallRating;
                    if (s && s !== "insufficient_data") {
                      const sl = s === "positive" ? "Positive" : s === "mixed" ? "Mixed" : "Negative";
                      return r != null ? `${sl} audience sentiment · ${Number(r).toFixed(1)}★` : `${sl} audience sentiment`;
                    }
                    return r != null ? `${Number(r).toFixed(1)}★ avg rating` : "—";
                  })(),
                  type: "text" as const,
                },
              ] as Array<{ trait: string; tooltip: string; creatorVal: string; brandVal: string; type: "badge" | "text" | "quote" }>)).map(({ trait, tooltip, creatorVal, brandVal, type }) => (
                <tr key={trait} className="group hover:bg-muted/10 transition-colors">
                  <td className="py-3 pr-4 align-top">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="flex items-center gap-1 cursor-help">
                          <span className="text-[10px] font-semibold tracking-[0.08em] uppercase text-muted-foreground">{trait}</span>
                          <Info className="w-3 h-3 text-muted-foreground/40" />
                        </div>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs text-xs">{tooltip}</TooltipContent>
                    </Tooltip>
                  </td>
                  <td className="py-3 px-3 align-top">
                    {type === "badge" ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-400/10 text-blue-400 border border-blue-400/20">{creatorVal || "—"}</span>
                    ) : type === "quote" ? (
                      <p className="text-xs text-foreground/70 leading-relaxed italic">{creatorVal || "—"}</p>
                    ) : (
                      <p className="text-xs text-foreground/80 leading-relaxed">{creatorVal || "—"}</p>
                    )}
                  </td>
                  <td className="py-3 px-3 align-top">
                    {type === "badge" ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-400/10 text-emerald-400 border border-emerald-400/20">{brandVal || "—"}</span>
                    ) : type === "quote" ? (
                      <p className="text-xs text-foreground/70 leading-relaxed italic">{brandVal || "—"}</p>
                    ) : (
                      <p className="text-xs text-foreground/80 leading-relaxed">{brandVal || "—"}</p>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Music Overlap Signal */}
        {musicOverlap && musicOverlap.overlapStrength !== "none" && (
          <div className="mb-5 p-4 rounded-xl border border-primary/20 bg-primary/5">
            <div className="flex items-center gap-2 mb-2">
              <div className="text-[10px] font-semibold tracking-[0.12em] uppercase text-primary/70">Shared Sound Signal</div>
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                musicOverlap.overlapStrength === "strong"
                  ? "text-green-400 bg-green-400/10 border-green-400/20"
                  : "text-yellow-400 bg-yellow-400/10 border-yellow-400/20"
              }`}>{musicOverlap.overlapStrength === "strong" ? "Strong Overlap" : "Moderate Overlap"}</span>
            </div>
            <p className="text-xs text-muted-foreground mb-2">The creator and brand audience share musical taste — a non-scoring signal that suggests cultural resonance.</p>
            {musicOverlap.sharedArtists.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-1">
                {musicOverlap.sharedArtists.map((a: string) => (
                  <span key={a} className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary/80 border border-primary/20">{a}</span>
                ))}
              </div>
            )}
            {musicOverlap.sharedTitles.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {musicOverlap.sharedTitles.map((t: string) => (
                  <span key={t} className="text-[10px] px-2 py-0.5 rounded-full bg-muted/30 text-muted-foreground border border-border/50">{t}</span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Audience Mention Hashtag Cloud */}
        {mentionHashtagCloud.length > 0 && (
          <div className="mb-5">
            <div className="flex items-center gap-1.5 mb-2">
              <Hash className="w-3.5 h-3.5 text-muted-foreground/60" />
              <div className="text-[10px] font-semibold tracking-[0.12em] uppercase text-muted-foreground">How Audiences Talk About {brand?.brandName}</div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {mentionHashtagCloud.slice(0, 20).map((tag: string) => (
                <span key={tag} className="text-[10px] px-2 py-0.5 rounded-full bg-muted/20 text-muted-foreground border border-border/40">#{tag.replace(/^#/, "")}</span>
              ))}
            </div>
          </div>
        )}

        {/* Cultural Borrowing Summary */}
        {culturalBorrowingSummary ? (
          <div className="p-4 rounded-xl border border-primary/20 bg-primary/5">
            <div className="text-[10px] font-semibold tracking-[0.12em] uppercase text-primary/70 mb-2">What the Brand is Borrowing</div>
            <p className="text-sm text-foreground/80 leading-relaxed italic">"{culturalBorrowingSummary}"</p>
          </div>
        ) : (
          <div className="p-4 rounded-xl border border-border/30 bg-muted/5">
            <div className="text-[10px] font-semibold tracking-[0.12em] uppercase text-muted-foreground mb-2">What the Brand is Borrowing</div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              By partnering with @{creator?.handle}, {brand?.brandName} borrows the creator's {creator?.archetype?.toLowerCase() ?? "distinct"} archetype and their audience's trust — two things the brand cannot self-generate. The creator's {creator?.audienceRelationshipType?.toLowerCase() ?? "authentic"} relationship with their community becomes the brand's cultural bridge.
            </p>
          </div>
        )}
      </div>

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
