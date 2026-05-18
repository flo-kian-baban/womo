import { useParams, Link } from "wouter";
import { ArrowLeft, Download, FileJson, AlertTriangle, CheckCircle2, XCircle, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import CreatorProfileCard from "@/components/CreatorProfileCard";
import BrandProfileCard from "@/components/BrandProfileCard";

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

export default function MatchReport() {
  const params = useParams<{ id: string }>();
  const id = parseInt(params.id ?? "0");

  const { data, isLoading, error } = trpc.fit.get.useQuery({ id }, { enabled: !!id });

  const handleExportJSON = () => {
    if (!data) return;
    const exportData = {
      generatedAt: new Date().toISOString(),
      reportVersion: "2.0",
      framework: "Connex F.I.T. Score",
      creator: data.creator,
      brand: data.brand,
      match: {
        fitScore: data.match.fitScore,
        fitStatus: data.match.fitStatus,
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

  const fitStatusColor = match.fitStatus === "Green Light"
    ? "text-green-400"
    : match.fitStatus === "Proceed with Caution"
    ? "text-yellow-400"
    : "text-red-400";

  return (
    <div className="min-h-full px-6 py-8 lg:px-10 lg:py-10">
      {/* Header */}
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

      {/* ─── Score Summary ─────────────────────────────────────────────────── */}
      <div className="fit-card rounded-xl p-8 mb-6 connex-glow animate-fade-in-up animate-stagger-1">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-8 items-start">
          <div>
            <div className="flex items-center gap-3 mb-4">
              <div className="text-5xl font-serif gold-text">{Number(match.fitScore).toFixed(1)}</div>
              <div>
                <div className="text-xs text-muted-foreground">F.I.T. Score / 10</div>
                <div className={`text-sm font-semibold mt-0.5 ${fitStatusColor}`}>
                  {match.fitStatus === "Green Light" && "🟢 "}
                  {match.fitStatus === "Proceed with Caution" && "🟡 "}
                  {match.fitStatus === "Do Not Proceed" && "🔴 "}
                  {match.fitStatus}
                </div>
              </div>
            </div>

            {/* Sub-score bars */}
            <div className="space-y-3">
              {[
                { label: "Alignment (α)", value: Number(match.alignmentScoreRaw), color: "oklch(0.65 0.15 240)", weight: Number(match.weightAlpha) },
                { label: "Pulse (β)", value: Number(match.pulseScoreRaw), color: "oklch(0.65 0.15 145)", weight: Number(match.weightBeta) },
                { label: "Stability (γ)", value: Number(match.stabilityScoreRaw), color: "oklch(0.78 0.12 75)", weight: Number(match.weightGamma) },
              ].map((sub) => (
                <div key={sub.label} className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground w-28 flex-shrink-0">{sub.label}</span>
                  <div className="flex-1 h-2 rounded-full bg-border overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-1000"
                      style={{ width: `${(sub.value / 10) * 100}%`, background: sub.color }}
                    />
                  </div>
                  <span className="text-xs font-mono w-8 text-right" style={{ color: sub.color }}>
                    {sub.value.toFixed(1)}
                  </span>
                  <span className="text-xs text-muted-foreground/50 w-12">w:{sub.weight.toFixed(1)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Archetype pair */}
          <div className="flex flex-col items-center gap-2 p-4 rounded-xl bg-muted/20 border border-border/50">
            <div className="text-[10px] font-semibold tracking-[0.1em] uppercase text-muted-foreground mb-1">Archetype Pair</div>
            <div className="text-sm font-medium text-blue-400">{creator?.archetype}</div>
            <div className="text-muted-foreground/40 text-xs">×</div>
            <div className="text-sm font-medium text-green-400">{brand?.archetype}</div>
          </div>
        </div>
      </div>

      {/* ─── Narrative Summary ─────────────────────────────────────────────── */}
      {match.narrativeSummary && (
        <div className="fit-card rounded-xl p-6 mb-6 animate-fade-in-up animate-stagger-2">
          <div className="text-[10px] font-semibold tracking-[0.12em] uppercase text-muted-foreground mb-3">
            Cultural Analyst Summary
          </div>
          <p className="text-sm text-foreground/80 leading-relaxed">{match.narrativeSummary}</p>
        </div>
      )}

      {/* ─── Alignment Notes ───────────────────────────────────────────────── */}
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

      {/* ─── Radar Warnings ────────────────────────────────────────────────── */}
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

      {/* ─── Profile Cards ─────────────────────────────────────────────────── */}
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
