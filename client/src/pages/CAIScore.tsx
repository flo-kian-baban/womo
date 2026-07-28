import { useState, useMemo } from "react";
import { toast } from "sonner";
import { BarChart3, Loader2, Sparkles, AlertTriangle, CheckCircle2, AlertCircle, XCircle, ChevronDown, Lightbulb, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { trpc } from "@/lib/trpc";
import { Link } from "wouter";
// Local types matching the flattened V2 return shapes from db.ts
type CreatorProfile = Record<string, any> & { id: string };
type BrandProfile = Record<string, any> & { id: string };
import { SignalPanel } from "@/components/SignalPanel";
import { MetricTooltip } from "@/components/MetricTooltip";

// ─── Score Ring SVG ───────────────────────────────────────────────────────────
function ScoreRing({
  score,
  label,
  sublabel,
  color,
  size = 120,
}: {
  score: number;
  label: string;
  sublabel?: string;
  color: string;
  size?: number;
}) {
  const radius = (size - 16) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 10) * circumference;
  const cx = size / 2;

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="rotate-[-90deg]">
          <circle
            cx={cx}
            cy={cx}
            r={radius}
            fill="none"
            stroke="oklch(0.22 0.010 260)"
            strokeWidth={6}
          />
          <circle
            cx={cx}
            cy={cx}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={6}
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            className="score-ring transition-all duration-1000"
            style={{ filter: `drop-shadow(0 0 6px ${color}60)` }}
          />
        </svg>
        {/* Text overlaid in the centre of the ring */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div className="text-xl font-serif leading-none" style={{ color }}>{score.toFixed(1)}</div>
        </div>
      </div>
      {/* Label sits below the ring, never overlapping */}
      <div className="text-center">
        <div className="text-xs text-muted-foreground">{label}</div>
        {sublabel && <div className="text-[10px] text-muted-foreground/50">{sublabel}</div>}
      </div>
    </div>
  );
}

// ─── Radar Warning Badge ──────────────────────────────────────────────────────
function RadarWarningBadge({ warning }: { warning: string }) {
  const configs: Record<string, { icon: typeof AlertTriangle; color: string; desc: string }> = {
    "Low Alignment": {
      icon: AlertTriangle,
      color: "text-red-400 bg-red-400/10 border-red-400/30",
      desc: "Alignment score below 6.0 — creator and brand do not share symbolic language",
    },
    "Archetype Tension": {
      icon: XCircle,
      color: "text-orange-400 bg-orange-400/10 border-orange-400/30",
      desc: "Creator archetype appears in brand's 'Clashes With' list",
    },
    "Identity Instability": {
      icon: AlertCircle,
      color: "text-yellow-400 bg-yellow-400/10 border-yellow-400/30",
      desc: "Full Pivot drift signal or Significant Gap in Goffman stage consistency",
    },
    "Low Pulse": {
      icon: AlertTriangle,
      color: "text-orange-400 bg-orange-400/10 border-orange-400/30",
      desc: "Niche pulse score below 4.0 — cultural momentum is weak or window is closing",
    },
    "Trajectory Divergence": {
      icon: AlertCircle,
      color: "text-yellow-400 bg-yellow-400/10 border-yellow-400/30",
      desc: "Creator is behind the niche's current adoption position",
    },
    // M2: the legend covered 5 of the 7 warning types the engine can emit —
    // the two below fell through to a blank default badge.
    "Low Social Engagement": {
      icon: AlertTriangle,
      color: "text-orange-400 bg-orange-400/10 border-orange-400/30",
      desc: "Brand TikTok engagement rate is below 0.5% — limited social proof",
    },
    "Negative Audience Sentiment": {
      icon: AlertTriangle,
      color: "text-red-400 bg-red-400/10 border-red-400/30",
      desc: "Audience mentions of this brand skew negative (at medium/high confidence) — partnership may inherit reputational risk",
    },
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

// ─── FIT Status Badge ─────────────────────────────────────────────────────────
function FITStatusBadge({ status }: { status: string }) {
  if (status === "Green Light") {
    return (
      <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border status-green font-semibold text-sm">
        <CheckCircle2 className="w-4 h-4" />
        🟢 Green Light
      </div>
    );
  }
  if (status === "Proceed with Caution") {
    return (
      <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border status-caution font-semibold text-sm">
        <AlertTriangle className="w-4 h-4" />
        🟡 Proceed with Caution
      </div>
    );
  }
  return (
    <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border status-red font-semibold text-sm">
      <XCircle className="w-4 h-4" />
      🔴 Do Not Proceed
    </div>
  );
}

type MatchResult = {
  creator: CreatorProfile;
  brand: BrandProfile;
  result: {
    archetypeMatchScore: number;
    mythAlignmentScore: number;
    tribMatchScore: number;
    decodingModifier: number;
    alignmentScoreRaw: number;
    pulseScoreRaw: number;
    stabilityScoreRaw: number;
    goffmanScore: number;
    driftScore: number;
    rogersBaseScore: number;
    liminalAdjustment: number;
    weightAlpha: number;
    weightBeta: number;
    weightGamma: number;
    weightPriority: string;
    caiScore: number;
    caiStatus: string;
    radarWarnings: string[];
    // Verified F.I.T. Impressions Score
    parrScore?: number;
    parrLabel?: string;
    parrSignalBreakdown?: Record<string, number>;
    symbolicOverlapScore?: number;
    sharedKeywords?: string[];
    sharedThemes?: string[];
    qovScore?: number;
    dataConfidenceLevel?: string;
  };
  narrative: {
    narrativeSummary: string;
    alignmentNotes: {
      archetypeAnalysis: string;
      mythAlignment: string;
      audienceOverlap: string;
      culturalMomentum: string;
      identityStability: string;
      recommendation: string;
    };
  };
  // Synergy narrative and content directions
  synergyNarrative?: string;
  contentDirections?: Array<{ title: string; rationale: string; exampleAngle: string }>;
  // Computed performance signals
  performanceSignals?: {
    creativeIntegrity: { score: number; confidence: "Verified" | "Estimated" | "Insufficient Data"; reasoning: string };
    performanceConsistency: { score: number; confidence: "Verified" | "Estimated" | "Insufficient Data"; reasoning: string };
    communityQuality: { score: number; confidence: "Verified" | "Estimated" | "Insufficient Data"; reasoning: string };
    audienceReceptivity: { score: number; confidence: "Verified" | "Estimated" | "Insufficient Data"; reasoning: string };
    brandTrust: { score: number; confidence: "Verified" | "Estimated" | "Insufficient Data"; reasoning: string };
  };
  // M1: the persisted record's id (null when persist failed) + the outcome.
  matchId?: string | null;
  persist?: { ok: true } | { ok: false; error: string };
  // M1 item 3: fallback-vs-computed marker — server has returned it since
  // Session 5; the client dropped it on the floor.
  scoreDegradation?: { degraded: boolean; reasons: string[] };
};

export default function FITScore() {
  const [creatorId, setCreatorId] = useState<string>("");
  const [brandId, setBrandId] = useState<string>("");
  const [matchResult, setMatchResult] = useState<MatchResult | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  // Matching eligibility (womo_0006): only ACCEPTED creator profiles are offered.
  const { data: creators } = trpc.creator.list.useQuery({ search: undefined, matchableOnly: true });
  const { data: brands } = trpc.brand.list.useQuery({ search: undefined });
  // M1 item 8: the default list (accepted + pending) exists ONLY to make the
  // empty state truthful. "No profiles yet" while twenty sit pending review
  // told the analyst to go analyse creators they already had.
  const { data: allCreators } = trpc.creator.list.useQuery({ search: undefined });
  const pendingCreatorCount = (allCreators ?? []).filter(c => c.reviewStatus === "pending").length;

  const calculateMutation = trpc.fit.calculate.useMutation({
    onSuccess: (data) => {
      setMatchResult(data as unknown as MatchResult);
      toast.success("Cultural Match Score calculated");
    },
    onError: (err) => {
      toast.error(`Calculation failed: ${err.message}`);
    },
  });

  const canCalculate = creatorId && brandId && !calculateMutation.isPending;

  const handleCalculate = () => {
    if (!creatorId || !brandId) return;
    setMatchResult(null);
    calculateMutation.mutate({
      creatorProfileId: creatorId,
      brandProfileId: brandId,
    });
  };

  return (
    <div className="min-h-full px-6 py-8 lg:px-10 lg:py-10">
      {/* Header */}
      <div className="mb-8 animate-fade-in-up">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
            <BarChart3 className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-serif">Cultural Match Score</h1>
            <p className="text-sm text-muted-foreground">Calculate cultural alignment between a creator and brand</p>
          </div>
        </div>
      </div>

      {/* ─── Selector ────────────────────────────────────────────────────────── */}
      <div className="fit-card rounded-xl p-6 mb-8 animate-fade-in-up animate-stagger-1">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr_auto] gap-4 items-end">
          <div className="space-y-2">
            <label className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">
              Creator Profile
            </label>
            <Select value={creatorId} onValueChange={setCreatorId}>
              <SelectTrigger className="bg-secondary border-border">
                <SelectValue placeholder="Select creator..." />
              </SelectTrigger>
              <SelectContent>
                {creators?.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    @{c.handle} · {c.platform}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {(!creators || creators.length === 0) && (
              pendingCreatorCount > 0 ? (
                <p className="text-xs text-muted-foreground/60">
                  {pendingCreatorCount} profile{pendingCreatorCount === 1 ? " is" : "s are"} pending review —
                  matching requires an accepted run.{" "}
                  <Link href="/library" className="text-primary underline">Review in Library</Link>
                </p>
              ) : (
                <p className="text-xs text-muted-foreground/60">
                  No profiles yet. <Link href="/analyze/creator" className="text-primary underline">Analyze a creator</Link>
                </p>
              )
            )}
          </div>

          <div className="text-muted-foreground/40 text-xl font-serif pb-2 text-center">×</div>

          <div className="space-y-2">
            <label className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">
              Brand Profile
            </label>
            <Select value={brandId} onValueChange={setBrandId}>
              <SelectTrigger className="bg-secondary border-border">
                <SelectValue placeholder="Select brand..." />
              </SelectTrigger>
              <SelectContent>
                {brands?.map((b) => (
                  <SelectItem key={b.id} value={String(b.id)}>
                    {b.brandName} · {b.category}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {(!brands || brands.length === 0) && (
              <p className="text-xs text-muted-foreground/60">
                No profiles yet. <Link href="/analyze/brand" className="text-primary underline">Analyze a brand</Link>
              </p>
            )}
          </div>

          <Button
            onClick={handleCalculate}
            disabled={!canCalculate}
            className="gold-gradient text-background font-semibold hover:opacity-90 transition-opacity"
          >
            {calculateMutation.isPending ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Calculating...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 mr-2" />
                Calculate F.I.T.
              </>
            )}
          </Button>
        </div>
      </div>

      {/* ─── Loading ─────────────────────────────────────────────────────────── */}
      {calculateMutation.isPending && (
        <div className="fit-card rounded-xl p-10 flex flex-col items-center justify-center text-center animate-fade-in-up">
          <Loader2 className="w-8 h-8 text-primary animate-spin mb-4" />
          <p className="text-foreground font-medium mb-1">Running Cultural Match Score Engine</p>
          <p className="text-sm text-muted-foreground">
            Calculating Alignment, Pulse, and Stability scores...
          </p>
        </div>
      )}

      {/* ─── Report Card ─────────────────────────────────────────────────────── */}
      {matchResult && (
        <div className="space-y-6 animate-fade-in-up">
          {/* M1 item 5: a computed-but-unsaved result must say so. Before this,
              a persist failure was a console.error and nothing else — the
              analyst saw a complete report and assumed a record existed. */}
          {matchResult.persist && !matchResult.persist.ok && (
            <div className="flex items-start gap-3 p-4 rounded-xl border border-red-400/40 bg-red-400/5">
              <XCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
              <div>
                <div className="text-sm font-semibold text-red-400">This result was NOT saved</div>
                <p className="text-xs text-red-400/80 mt-0.5 leading-relaxed">
                  The calculation completed, but persisting the match record failed — it will not appear
                  in the library and there is no full report. Error: {matchResult.persist.error}
                </p>
              </div>
            </div>
          )}

          {/* M1 item 3: fallback-vs-computed, stated where the score is. The
              server has marked degraded results since Session 5; this page
              never read the marker, so a match scored on fallback 3.0s
              rendered identically to a computed one. */}
          {matchResult.scoreDegradation?.reasons && matchResult.scoreDegradation.reasons.length > 0 && (
            <div className="flex items-start gap-3 p-4 rounded-xl border border-yellow-400/40 bg-yellow-400/5">
              <AlertTriangle className="w-4 h-4 text-yellow-400 flex-shrink-0 mt-0.5" />
              <div>
                <div className="text-sm font-semibold text-yellow-400">
                  {matchResult.scoreDegradation.degraded
                    ? "Score degraded — parts of this number are fallbacks, not computations"
                    : "Calculation note"}
                </div>
                <ul className="text-xs text-yellow-400/80 mt-1 space-y-0.5 leading-relaxed list-disc pl-4">
                  {matchResult.scoreDegradation.reasons.map((r, i) => <li key={i}>{r}</li>)}
                </ul>
              </div>
            </div>
          )}

          {/* Main Score Card */}
          <div className="fit-card rounded-xl p-8 connex-glow">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-start justify-between gap-6 mb-8 pb-6 border-b border-border">
              <div>
                <div className="text-[10px] font-semibold tracking-[0.15em] uppercase text-muted-foreground mb-2">
                  F.I.T. Analysis Report
                </div>
                <h2 className="text-xl font-serif mb-1">
                  @{matchResult.creator.handle} × {matchResult.brand.brandName}
                </h2>
                <div className="flex flex-wrap gap-2 mt-2">
                  <span className="text-xs px-2 py-0.5 rounded-full border border-border bg-secondary text-muted-foreground">
                    {matchResult.creator.archetype}
                  </span>
                  <span className="text-xs text-muted-foreground">×</span>
                  <span className="text-xs px-2 py-0.5 rounded-full border border-border bg-secondary text-muted-foreground">
                    {matchResult.brand.archetype}
                  </span>
                </div>
              </div>
              <div className="flex flex-col items-center gap-3">
                <div className="text-5xl font-serif gold-text">{matchResult.result.caiScore.toFixed(2)}</div>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-muted-foreground">Cultural Match Score / 10</span>
                  {/* M2: transcribed from fitEngine.ts — calculateFITScore
                      (weighted sum + 7.5/6.0 thresholds + alignment cap) and
                      runFullFITCalculation (mention-modifier recompute). */}
                  <MetricTooltip
                    title="Cultural Match Score"
                    explanation="The weighted sum of the three sub-scores, each 0–10. The displayed value includes the audience-mention modifiers (sentiment on Stability, vocabulary boost on Alignment)."
                    formula="CMS = Alignment×α + Pulse×β + Stability×γ | Range 0–10 | Status: ≥7.5 Green Light · ≥6.0 Proceed with Caution · <6.0 Do Not Proceed. A Green Light is capped to Caution when Alignment < 6.0."
                    whyItMatters="It is the engine's single composite verdict. The weights α/β/γ come from the brand-type table and sum to 1.0 — so which sub-score dominates depends on the brand's type, not on the creator."
                    dataPoints={["Alignment (archetype + myth + tribe + decoding modifier + vocab boost)", "Pulse (Rogers base + liminal adjustment + TikTok boosts)", "Stability (Goffman + drift, sentiment-adjusted)", "α/β/γ from the brand-type weight table"]}
                    side="top"
                  />
                </div>
                <FITStatusBadge status={matchResult.result.caiStatus} />
                {/* Data Confidence Badge — P1-3 */}
                {(() => {
                  const dcl = matchResult.result.dataConfidenceLevel ?? (matchResult.creator as Record<string, unknown>).dataConfidenceLevel as string ?? "low";
                  return (
                    <div className={`flex items-center gap-1.5 mt-1.5 text-[10px] font-medium ${
                      dcl === "high" ? "text-green-400" :
                      dcl === "medium" ? "text-yellow-400" :
                      "text-red-400"
                    }`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${
                        dcl === "high" ? "bg-green-400" :
                        dcl === "medium" ? "bg-yellow-400" :
                        "bg-red-400"
                      }`} />
                      {dcl === "high" ? "High Confidence" :
                       dcl === "medium" ? "Medium Confidence" :
                       "Low Confidence — interpret with caution"}
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* Sub-scores */}
            <div className="grid grid-cols-3 gap-6 mb-8">
              <div className="flex flex-col items-center gap-3">
                <ScoreRing
                  score={matchResult.result.alignmentScoreRaw}
                  label="Alignment (α)"
                  sublabel={`weight: ${matchResult.result.weightAlpha}`}
                  color="oklch(0.65 0.15 240)"
                  size={110}
                />
                {/* M2: transcribed from fitEngine.ts — calculateAlignmentScore
                    (unweighted mean + modifier), ARCHETYPE tiers 10/7/2.5,
                    DECODING_MODIFIERS, blendDecodingSignals, vocab boost. */}
                <MetricTooltip
                  title="Alignment (α)"
                  explanation="The unweighted mean of three 0–10 components, plus a Stuart Hall decoding modifier, plus an audience-vocabulary boost. There is no 0.4/0.35/0.25 weighting — the three components count equally."
                  formula="Alignment = mean(Archetype, Myth, Tribe) + decoding modifier (Dominant +0.5 · Negotiated 0 · Oppositional −1.0), clamped 0–10, then + vocab boost up to +1.5 when brand-mention hashtags/keywords overlap the creator's vocabulary. Archetype: Resonant 10 · Complementary 7 · Clashing 2.5."
                  whyItMatters="Myth and Tribe are LLM-judged from the two Barthes-myth sentences; when either sentence is missing or the call fails, both fall back to 3.0 and the match is flagged degraded. When the brand carries its own decoding, creator and brand decoding are blended (any Oppositional → Oppositional)."
                  dataPoints={["12-archetype compatibility matrix (pairs/clashes)", "Myth + tribe scores: one LLM call over both barthesMyth sentences (fallback 3.0)", "Stuart Hall decoding — extracted framework field, bilaterally blended when brand-side exists", "Brand mention hashtags/keywords vs creator vocabulary"]}
                  side="bottom"
                />
              </div>
              <div className="flex flex-col items-center gap-3">
                <ScoreRing
                  score={matchResult.result.pulseScoreRaw}
                  label="Pulse (β)"
                  sublabel={`weight: ${matchResult.result.weightBeta}`}
                  color="oklch(0.65 0.15 145)"
                  size={110}
                />
                {/* M2: transcribed from fitEngine.ts — calculatePulseScore,
                    ROGERS_BASE_SCORES, LIMINAL_ADJUSTMENTS, 60/40 brand blend. */}
                <MetricTooltip
                  title="Pulse (β)"
                  explanation="A Rogers-stage base plus a small liminal adjustment, on a 0–10 scale. The liminal phases are Pre-Liminal / Liminal / Post-Liminal — not ascending/peak/descending."
                  formula="Pulse = Rogers base (Innovators 5 · Early Adopters 6 · Early Majority 7 · Late Majority 4 · Laggards 2) + liminal (Pre-Liminal 0 · Liminal +0.5 · Post-Liminal +0.5). TikTok boost only when brand engagement rate AND post frequency are both known: rate÷10 capped +1.5, plus +0.5 daily / +0.3 for 3–5×week. When the brand has its own Rogers+Turner, Pulse = 60% creator + 40% brand."
                  whyItMatters="Early Majority is the highest base (7) — the engine favors creators at the adoption peak. The TikTok boost has never fired on the current corpus: no brand has post-frequency data recorded."
                  dataPoints={["Creator Rogers adopter stage (extracted framework field)", "Creator Turner liminal phase", "Brand Rogers + Turner (when present — blended 60/40)", "Brand TikTok engagement + post frequency (currently absent corpus-wide)"]}
                  side="bottom"
                />
              </div>
              <div className="flex flex-col items-center gap-3">
                <ScoreRing
                  score={matchResult.result.stabilityScoreRaw}
                  label="Stability (γ)"
                  sublabel={`weight: ${matchResult.result.weightGamma}`}
                  color="oklch(0.78 0.12 75)"
                  size={110}
                />
                {/* M2: transcribed from fitEngine.ts — calculateStabilityScore,
                    GOFFMAN_SCORES, DRIFT_SCORES, 50/50 brand blend, sentiment
                    modifier in runFullFITCalculation. */}
                <MetricTooltip
                  title="Stability (γ)"
                  explanation="The average of two 0–10 tier scores — Goffman consistency and drift — with brand-side blending and an audience-sentiment adjustment. The tiers are 3- and 4-valued; there is no 'Moderate' or 'Major' drift tier."
                  formula="Stability = (Goffman [Consistent 10 · Minor Gap 5 · Significant Gap 0] + Drift [Zero Change 9.5 · Minor 7 · Significant 3 · Full Pivot 0]) ÷ 2. Brand TikTok boost when followers known: log10(followers)÷6 capped +1.5, + engagement÷20 capped +0.5. When the brand has its own Goffman+Drift, blended 50/50. Then the mention-sentiment modifier: negative −3 · mixed −1 · positive +0.5, scaled by confidence (high ×1.0 · medium ×0.6 · low ×0.3)."
                  whyItMatters="Identity Instability warns only at the extremes (Full Pivot or Significant Gap). The sentiment adjustment means a brand's own audience reception moves this sub-score — it is not purely about the creator."
                  dataPoints={["Creator Goffman stage + drift signal (extracted framework fields)", "Brand Goffman + drift (when present — blended 50/50)", "Brand TikTok follower count + engagement rate", "Brand mention sentiment + confidence"]}
                  side="bottom"
                />
              </div>
            </div>

            {/* Weight priority */}
            <div className="text-center mb-8 pb-8 border-b border-border">
              <span className="text-xs text-muted-foreground">
                Weight priority for <strong className="text-foreground/70">{matchResult.brand.brandType}</strong>:{" "}
                <span className="text-primary">{matchResult.result.weightPriority}</span>
              </span>
            </div>

            {/* Eight-Signal Display (Default View) */}
            {/* M2: no fabricated values. The old inputs defaulted to `?? 50`
                with an invented confidence — a missing measurement rendered as
                a mid-range score. Now: real value or null, and the Cultural
                trio is stamped DERIVED (it is the sub-scores ×10, not an
                independently verified signal). */}
            <SignalPanel
              signals={[
                {
                  name: "Identity Fit",
                  score: matchResult.performanceSignals?.creativeIntegrity.score ?? null,
                  confidence: matchResult.performanceSignals?.creativeIntegrity.confidence ?? "Insufficient Data",
                  reasoning: matchResult.performanceSignals?.creativeIntegrity.reasoning ?? "",
                  category: "Performance",
                },
                {
                  name: "Performance Fit",
                  score: matchResult.performanceSignals?.performanceConsistency.score ?? null,
                  confidence: matchResult.performanceSignals?.performanceConsistency.confidence ?? "Insufficient Data",
                  reasoning: matchResult.performanceSignals?.performanceConsistency.reasoning ?? "",
                  category: "Performance",
                },
                {
                  name: "Audience Fit",
                  score: matchResult.performanceSignals?.communityQuality.score ?? null,
                  confidence: matchResult.performanceSignals?.communityQuality.confidence ?? "Insufficient Data",
                  reasoning: matchResult.performanceSignals?.communityQuality.reasoning ?? "",
                  category: "Performance",
                },
                {
                  name: "Receptivity Fit",
                  score: matchResult.performanceSignals?.audienceReceptivity.score ?? null,
                  confidence: matchResult.performanceSignals?.audienceReceptivity.confidence ?? "Insufficient Data",
                  reasoning: matchResult.performanceSignals?.audienceReceptivity.reasoning ?? "",
                  category: "Performance",
                },
                {
                  name: "Brand Safety Fit",
                  score: matchResult.performanceSignals?.brandTrust.score ?? null,
                  confidence: matchResult.performanceSignals?.brandTrust.confidence ?? "Insufficient Data",
                  reasoning: matchResult.performanceSignals?.brandTrust.reasoning ?? "",
                  category: "Performance",
                },
                {
                  name: "Cultural Identity",
                  score: (matchResult.result.alignmentScoreRaw * 10),
                  confidence: "Derived",
                  reasoning: "The Alignment sub-score ×10 — the hero's α rescaled, not an independent measurement.",
                  category: "Cultural",
                },
                {
                  name: "Cultural Momentum",
                  score: (matchResult.result.pulseScoreRaw * 10),
                  confidence: "Derived",
                  reasoning: "The Pulse sub-score ×10 — the hero's β rescaled, not an independent measurement.",
                  category: "Cultural",
                },
                {
                  name: "Partnership Stability",
                  score: (matchResult.result.stabilityScoreRaw * 10),
                  confidence: "Derived",
                  reasoning: "The Stability sub-score ×10 — the hero's γ rescaled, not an independent measurement.",
                  category: "Cultural",
                },
              ]}
              caiScore={matchResult.result.caiScore}
              caiStatus={matchResult.result.caiStatus as "Green Light" | "Proceed with Caution" | "Do Not Proceed"}
            />
          </div>

          {/* Existing Report Content (Below Signal Panel) */}
          <div className="fit-card rounded-xl p-8 space-y-6">

            {/* PARR — Predicted Audience Receptivity Rate */}
            {matchResult.result.parrScore != null && (
              <div className="p-5 rounded-xl border mb-6" style={{
                borderColor: matchResult.result.parrScore >= 80 ? 'oklch(0.65 0.15 145 / 0.3)' :
                  matchResult.result.parrScore >= 60 ? 'oklch(0.78 0.12 75 / 0.3)' :
                  matchResult.result.parrScore >= 40 ? 'oklch(0.72 0.15 50 / 0.3)' : 'oklch(0.60 0.18 25 / 0.3)',
                background: matchResult.result.parrScore >= 80 ? 'oklch(0.65 0.15 145 / 0.05)' :
                  matchResult.result.parrScore >= 60 ? 'oklch(0.78 0.12 75 / 0.05)' :
                  matchResult.result.parrScore >= 40 ? 'oklch(0.72 0.15 50 / 0.05)' : 'oklch(0.60 0.18 25 / 0.05)',
              }}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-1.5">
                    <div className="text-[10px] font-semibold tracking-[0.12em] uppercase text-muted-foreground">
                      PARR
                    </div>
                    {/* M2: transcribed from fitEngine.ts — calculatePARR.
                        Engagement rate and comment sentiment are NOT inputs. */}
                    <MetricTooltip
                      title="PARR — Predicted Audience Receptivity Rate"
                      explanation="A weighted 0–100 index of five structural signals — not a measured share of the audience, and not built from engagement or comment data."
                      formula="PARR = (Tribe match ×0.30 + Decoding ×0.25 + Archetype match ×0.20 + Vocabulary overlap ×0.15 + Persona consistency ×0.10) × 10. Decoding: Dominant 10 · Negotiated 5 · Oppositional 0. Persona (Goffman): Consistent 10 · Minor Gap 5 · Significant Gap 1. Labels: ≥80 High Cultural Legitimacy · ≥60 Moderate · ≥40 Mixed Signal · <40 Low."
                      whyItMatters="Its heaviest input, tribe match, is LLM-judged (fallback 3.0 when myths are missing — flagged as degradation). It uses the creator's own decoding and Goffman, not the bilateral blend Alignment uses."
                      dataPoints={["Tribe match score (LLM, same call as myth)", "Stuart Hall decoding (creator-side)", "Archetype compatibility (10/7/2.5)", "Symbolic vocabulary overlap (Jaccard ×33.3, capped 10)", "Goffman persona consistency"]}
                      side="top"
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-2xl font-serif" style={{
                      color: matchResult.result.parrScore >= 80 ? 'oklch(0.65 0.15 145)' :
                        matchResult.result.parrScore >= 60 ? 'oklch(0.78 0.12 75)' :
                        matchResult.result.parrScore >= 40 ? 'oklch(0.72 0.15 50)' : 'oklch(0.60 0.18 25)',
                    }}>{matchResult.result.parrScore}%</span>
                  </div>
                </div>
                <div className="text-xs font-semibold mb-2" style={{
                  color: matchResult.result.parrScore >= 80 ? 'oklch(0.65 0.15 145)' :
                    matchResult.result.parrScore >= 60 ? 'oklch(0.78 0.12 75)' :
                    matchResult.result.parrScore >= 40 ? 'oklch(0.72 0.15 50)' : 'oklch(0.60 0.18 25)',
                }}>{matchResult.result.parrLabel}</div>
                <div className="h-1.5 rounded-full bg-border overflow-hidden mb-3">
                  <div className="h-full rounded-full transition-all duration-1000" style={{
                    width: `${matchResult.result.parrScore}%`,
                    background: matchResult.result.parrScore >= 80 ? 'oklch(0.65 0.15 145)' :
                      matchResult.result.parrScore >= 60 ? 'oklch(0.78 0.12 75)' :
                      matchResult.result.parrScore >= 40 ? 'oklch(0.72 0.15 50)' : 'oklch(0.60 0.18 25)',
                  }} />
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Predicted Audience Receptivity Rate — a 0–100 index of structural receptivity built from
                  five weighted signals. It predicts nothing about individual audience members and
                  guarantees nothing; see the tooltip for exactly what it counts.
                </p>
                {/* Shared symbolic evidence */}
                {(matchResult.result.sharedThemes?.length ?? 0) > 0 && (
                  <div className="mt-3 pt-3 border-t border-border/30">
                    <div className="text-[10px] font-semibold tracking-[0.08em] uppercase text-muted-foreground mb-2">Shared Cultural Themes</div>
                    <div className="flex flex-wrap gap-1.5">
                      {matchResult.result.sharedThemes!.map((t) => (
                        <span key={t} className="px-2 py-0.5 rounded-full text-xs bg-primary/10 text-primary border border-primary/20 capitalize">{t}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* QoV — Quality of View */}
            {matchResult.result.qovScore != null && (
              <div className="p-5 rounded-xl border border-border/60 bg-muted/10 mb-6">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-1.5">
                    <div className="text-[10px] font-semibold tracking-[0.12em] uppercase text-muted-foreground">
                      QoV
                    </div>
                    {/* M2: transcribed from fitEngine.ts — the qovScore line.
                        There is no tribe/category/hashtag formula; QoV is a
                        product of two numbers already on this page. */}
                    <MetricTooltip
                      title="QoV — Quality of View"
                      explanation="The product of the Cultural Match Score and PARR, expressed as a percentage. It contains no information beyond those two numbers."
                      formula="QoV = (CMS ÷ 10) × (PARR ÷ 100) × 100. Note: the engine computes it from the CMS before the audience-mention modifiers are applied, so when modifiers are non-zero QoV will not exactly equal the displayed CMS × PARR."
                      whyItMatters="Treat it as a convenience composite, not independent evidence — it rises and falls exactly with CMS and PARR."
                      dataPoints={["Cultural Match Score (pre-modifier)", "PARR"]}
                      side="top"
                    />
                  </div>
                  <span className="text-2xl font-serif text-foreground/90">{matchResult.result.qovScore}%</span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Quality of View — the cultural resonance multiplier for each impression this partnership generates.
                </p>
              </div>
            )}

            {/* Synergy Brief */}
            {matchResult.synergyNarrative && (
              <div className="p-5 rounded-xl bg-muted/20 border border-border/50 mb-6">
                <div className="flex items-center gap-2 mb-3">
                  <Sparkles className="w-3.5 h-3.5 text-primary/70" />
                  <div className="text-[10px] font-semibold tracking-[0.12em] uppercase text-muted-foreground">
                    Cultural Synergy Brief
                  </div>
                </div>
                <p className="text-sm text-foreground/85 leading-relaxed">{matchResult.synergyNarrative}</p>
              </div>
            )}

            {/* Narrative Summary */}
            {matchResult.narrative.narrativeSummary && (
              <div className="p-5 rounded-xl bg-muted/20 border border-border/50 mb-6">
                <div className="text-[10px] font-semibold tracking-[0.12em] uppercase text-muted-foreground mb-3">
                  Cultural Analyst Summary
                </div>
                <p className="text-sm text-foreground/80 leading-relaxed">
                  {matchResult.narrative.narrativeSummary}
                </p>
              </div>
            )}

            {/* Content Directions */}
            {(matchResult.contentDirections?.length ?? 0) > 0 && (
              <div className="p-5 rounded-xl bg-muted/20 border border-border/50 mb-6">
                <div className="flex items-center gap-2 mb-3">
                  <Lightbulb className="w-3.5 h-3.5 text-primary/70" />
                  <div className="text-[10px] font-semibold tracking-[0.12em] uppercase text-muted-foreground">
                    Content Directions
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {matchResult.contentDirections!.map((dir, i) => (
                    <div key={i} className="p-3 rounded-xl border border-border/50 bg-muted/10">
                      <div className="text-xs font-semibold text-foreground mb-1">{dir.title}</div>
                      <p className="text-xs text-muted-foreground leading-relaxed">{dir.rationale}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Radar Warnings */}
            {matchResult.result.radarWarnings && matchResult.result.radarWarnings.length > 0 && (
              <div className="mb-6">
                <div className="text-[10px] font-semibold tracking-[0.12em] uppercase text-muted-foreground mb-3">
                  Radar Warnings
                </div>
                <div className="space-y-2">
                  {(matchResult.result.radarWarnings as string[]).map((w) => (
                    <RadarWarningBadge key={w} warning={w} />
                  ))}
                </div>
              </div>
            )}

            {matchResult.result.radarWarnings?.length === 0 && (
              <div className="flex items-center gap-2 p-3 rounded-lg border border-green-400/30 bg-green-400/5 mb-6">
                <CheckCircle2 className="w-4 h-4 text-green-400" />
                <span className="text-sm text-green-400">No radar warnings — clean match</span>
              </div>
            )}

            {/* Toggle detailed breakdown */}
            <button
              className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setShowDetails(!showDetails)}
            >
              <ChevronDown className={`w-3 h-3 transition-transform ${showDetails ? "rotate-180" : ""}`} />
              {showDetails ? "Hide" : "Show"} score breakdown & alignment notes
            </button>
          </div>

          {/* ─── Detailed Breakdown ─────────────────────────────────────────── */}
          {showDetails && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-fade-in-up">
              {/* Score Components */}
              <div className="fit-card rounded-xl p-6">
                <h3 className="text-xs font-semibold tracking-[0.1em] uppercase text-muted-foreground mb-4">
                  Score Components
                </h3>
                <div className="space-y-3">
                  {[
                    { label: "Archetype Match Score", value: matchResult.result.archetypeMatchScore, max: 10 },
                    { label: "Myth Alignment Score", value: matchResult.result.mythAlignmentScore, max: 10 },
                    { label: "Tribe Match Score", value: matchResult.result.tribMatchScore, max: 10 },
                    { label: "Decoding Modifier", value: matchResult.result.decodingModifier, max: 1, signed: true },
                    { label: "Rogers Base Score", value: matchResult.result.rogersBaseScore, max: 10 },
                    { label: "Liminal Adjustment", value: matchResult.result.liminalAdjustment, max: 1 },
                    { label: "Goffman Stage Score", value: matchResult.result.goffmanScore, max: 10 },
                    { label: "Drift Score", value: matchResult.result.driftScore, max: 10 },
                  ].map((item) => (
                    <div key={item.label} className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground w-44 flex-shrink-0">{item.label}</span>
                      <div className="flex-1 h-1.5 rounded-full bg-border overflow-hidden">
                        <div
                          className="h-full rounded-full bg-primary/60"
                          style={{ width: `${Math.max(0, (item.value / item.max) * 100)}%` }}
                        />
                      </div>
                      <span className="text-xs font-mono text-primary w-10 text-right">
                        {item.signed && item.value > 0 ? "+" : ""}{item.value.toFixed(1)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Alignment Notes */}
              <div className="fit-card rounded-xl p-6">
                <h3 className="text-xs font-semibold tracking-[0.1em] uppercase text-muted-foreground mb-4">
                  Alignment Notes
                </h3>
                <div className="space-y-4">
                  {Object.entries(matchResult.narrative.alignmentNotes).map(([key, value]) => {
                    const labels: Record<string, string> = {
                      archetypeAnalysis: "Archetype Analysis",
                      mythAlignment: "Myth Alignment",
                      audienceOverlap: "Audience Overlap",
                      culturalMomentum: "Cultural Momentum",
                      identityStability: "Identity Stability",
                      recommendation: "Recommendation",
                    };
                    return (
                      <div key={key} className="border-b border-border/30 pb-3 last:border-0 last:pb-0">
                        <div className="text-[10px] font-semibold tracking-[0.1em] uppercase text-muted-foreground mb-1">
                          {labels[key] ?? key}
                        </div>
                        <p className="text-xs text-foreground/70 leading-relaxed">{value as string}</p>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Side-by-side comparison */}
              <div className="md:col-span-2 fit-card rounded-xl p-6">
                <h3 className="text-xs font-semibold tracking-[0.1em] uppercase text-muted-foreground mb-4">
                  Side-by-Side Comparison
                </h3>
                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <div className="text-[10px] font-semibold tracking-[0.1em] uppercase text-blue-400/70 mb-3">
                      Creator: @{matchResult.creator.handle}
                    </div>
                    <div className="space-y-2">
                      {[
                        { label: "Archetype", value: matchResult.creator.archetype },
                        { label: "Niche", value: matchResult.creator.nicheTopicNode },
                        { label: "Tone", value: matchResult.creator.toneRegister },
                        { label: "Audience Type", value: matchResult.creator.audienceRelationshipType },
                        { label: "Cultural Capital", value: matchResult.creator.culturalCapital },
                        { label: "Goffman", value: matchResult.creator.goffmanStageConsistency },
                        { label: "Drift", value: matchResult.creator.driftSignal },
                        { label: "Decoding", value: matchResult.creator.stuartHallDecoding },
                      ].map((f) => (
                        <div key={f.label} className="flex justify-between text-xs py-1 border-b border-border/20">
                          <span className="text-muted-foreground">{f.label}</span>
                          <span className="text-foreground/80 font-medium">{f.value ?? "—"}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-semibold tracking-[0.1em] uppercase text-green-400/70 mb-3">
                      Brand: {matchResult.brand.brandName}
                    </div>
                    <div className="space-y-2">
                      {[
                        { label: "Archetype", value: matchResult.brand.archetype },
                        { label: "Category", value: matchResult.brand.category },
                        { label: "Brand Type", value: matchResult.brand.brandType },
                        { label: "Campaign Type", value: matchResult.brand.campaignType },
                        { label: "α Weight", value: matchResult.result.weightAlpha?.toFixed(1) },
                        { label: "β Weight", value: matchResult.result.weightBeta?.toFixed(1) },
                        { label: "γ Weight", value: matchResult.result.weightGamma?.toFixed(1) },
                        { label: "Priority", value: matchResult.result.weightPriority },
                      ].map((f) => (
                        <div key={f.label} className="flex justify-between text-xs py-1 border-b border-border/20">
                          <span className="text-muted-foreground">{f.label}</span>
                          <span className="text-foreground/80 font-medium">{f.value ?? "—"}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Export actions */}
          <div className="flex gap-3">
            <Button
              variant="outline"
              className="border-border hover:bg-secondary"
              onClick={() => {
                const data = {
                  generatedAt: new Date().toISOString(),
                  creator: matchResult.creator,
                  brand: matchResult.brand,
                  scores: matchResult.result,
                  narrative: matchResult.narrative,
                  // M1: the persisted record id + outcome — `match` used to
                  // embed a field the mutation never returned (undefined).
                  matchId: matchResult.matchId ?? null,
                  persisted: matchResult.persist?.ok ?? false,
                  scoreDegradation: matchResult.scoreDegradation ?? null,
                };
                const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `connex-fit-${matchResult.creator.handle}-x-${matchResult.brand.brandName}-${new Date().toISOString().split("T")[0]}.json`;
                a.click();
                URL.revokeObjectURL(url);
                toast.success("JSON report downloaded");
              }}
            >
              Export JSON
            </Button>
            {/* M1 item 4: linked by the RETURNED id. `matchResult.match?.id`
                was undefined for as long as this page existed — the button
                navigated to /report/undefined every single time. */}
            {matchResult.matchId && (
              <Link href={`/report/${matchResult.matchId}`}>
                <Button variant="outline" className="border-primary/30 text-primary hover:bg-primary/10">
                  View Full Report
                </Button>
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
