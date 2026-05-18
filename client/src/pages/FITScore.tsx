import { useState, useMemo } from "react";
import { toast } from "sonner";
import { BarChart3, Loader2, Sparkles, AlertTriangle, CheckCircle2, AlertCircle, XCircle, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { Link } from "wouter";
import type { CreatorProfile, BrandProfile, MatchRecord } from "../../../drizzle/schema";

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
    <div className="flex flex-col items-center gap-2">
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
      <div className="text-center -mt-1" style={{ marginTop: `-${size / 2 + 8}px`, position: "relative", zIndex: 1 }}>
        <div className="text-2xl font-serif" style={{ color }}>{score.toFixed(1)}</div>
        <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
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
  match: MatchRecord;
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
    fitScore: number;
    fitStatus: string;
    radarWarnings: string[];
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
};

export default function FITScore() {
  const [creatorId, setCreatorId] = useState<string>("");
  const [brandId, setBrandId] = useState<string>("");
  const [matchResult, setMatchResult] = useState<MatchResult | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  const { data: creators } = trpc.creator.list.useQuery({ search: undefined });
  const { data: brands } = trpc.brand.list.useQuery({ search: undefined });

  const calculateMutation = trpc.fit.calculate.useMutation({
    onSuccess: (data) => {
      setMatchResult(data as unknown as MatchResult);
      toast.success("F.I.T. Score calculated");
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
      creatorProfileId: parseInt(creatorId),
      brandProfileId: parseInt(brandId),
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
            <h1 className="text-2xl font-serif">F.I.T. Score</h1>
            <p className="text-sm text-muted-foreground">Calculate cultural alignment between a creator and brand</p>
          </div>
        </div>
      </div>

      {/* ─── Selector ────────────────────────────────────────────────────────── */}
      <div className="fit-card rounded-xl p-6 mb-8 animate-fade-in-up animate-stagger-1">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr_auto] gap-4 items-end">
          <div className="space-y-2">
            <label className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">
              Influencer Profile
            </label>
            <Select value={creatorId} onValueChange={setCreatorId}>
              <SelectTrigger className="bg-secondary border-border">
                <SelectValue placeholder="Select influencer..." />
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
              <p className="text-xs text-muted-foreground/60">
                No profiles yet. <Link href="/analyze/influencer" className="text-primary underline">Analyze an influencer</Link>
              </p>
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
          <p className="text-foreground font-medium mb-1">Running F.I.T. Score Engine</p>
          <p className="text-sm text-muted-foreground">
            Calculating Alignment, Pulse, and Stability scores...
          </p>
        </div>
      )}

      {/* ─── Report Card ─────────────────────────────────────────────────────── */}
      {matchResult && (
        <div className="space-y-6 animate-fade-in-up">
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
                <div className="text-5xl font-serif gold-text">{matchResult.result.fitScore.toFixed(1)}</div>
                <div className="text-xs text-muted-foreground">F.I.T. Score / 10</div>
                <FITStatusBadge status={matchResult.result.fitStatus} />
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
              </div>
              <div className="flex flex-col items-center gap-3">
                <ScoreRing
                  score={matchResult.result.pulseScoreRaw}
                  label="Pulse (β)"
                  sublabel={`weight: ${matchResult.result.weightBeta}`}
                  color="oklch(0.65 0.15 145)"
                  size={110}
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
              </div>
            </div>

            {/* Weight priority */}
            <div className="text-center mb-6">
              <span className="text-xs text-muted-foreground">
                Weight priority for <strong className="text-foreground/70">{matchResult.brand.brandType}</strong>:{" "}
                <span className="text-primary">{matchResult.result.weightPriority}</span>
              </span>
            </div>

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
                  match: matchResult.match,
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
            <Link href={`/report/${matchResult.match?.id}`}>
              <Button variant="outline" className="border-primary/30 text-primary hover:bg-primary/10">
                View Full Report
              </Button>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
