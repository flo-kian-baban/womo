/**
 * CULTURAL MATCH SCORE — the calculation view (M3).
 *
 * This page keeps only what is unique to CALCULATING: the pair selector, the
 * loading state, the persist-outcome banner, the export, and the link to the
 * persisted record. The result itself renders through the shared five-section
 * MatchReportBody — the same body the record view uses, so the two surfaces
 * cannot present a score differently by construction. (Before M3 this page
 * had its own PARR rendering, its own 5-of-7 warning legend, score rings with
 * per-dimension hues, gold gradients and status emoji — none of which the
 * record view shared.)
 */
import { useState } from "react";
import { toast } from "sonner";
import { BarChart3, Loader2, Sparkles, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { Link } from "wouter";
import {
  MatchReportBody, type MatchBodyData, type MatchLlmAccount,
} from "@/components/MatchReportBody";
import { T_DETAIL } from "@/lib/reportType";

type CreatorProfile = Record<string, any> & { id: string };
type BrandProfile = Record<string, any> & { id: string };

type MatchResult = {
  creator: CreatorProfile;
  brand: BrandProfile;
  result: Record<string, any>;
  narrative: {
    narrativeSummary: string;
    alignmentNotes: Record<string, string>;
  };
  performanceSignals?: Record<string, { score: number; confidence: "Verified" | "Estimated" | "Insufficient Data"; reasoning: string }>;
  matchId?: string | null;
  persist?: { ok: true } | { ok: false; error: string };
  scoreDegradation?: { degraded: boolean; reasons: string[] };
  synergyNarrative?: string | null;
  contentDirections?: Array<{ title: string; rationale: string; exampleAngle: string }>;
  culturalBorrowingSummary?: string | null;
  llm?: MatchLlmAccount | null;
};

const num = (v: unknown): number | null => (v == null || Number.isNaN(Number(v)) ? null : Number(v));

/** The transient calculation result, mapped into the canonical body shape. */
function bodyFromResult(mr: MatchResult): MatchBodyData {
  const r = mr.result;
  const ps = mr.performanceSignals;
  const pb = (r.parrSignalBreakdown ?? null) as Record<string, number> | null;
  const sig = (key: string, name: string, question: string) => {
    const s = ps?.[key];
    return {
      name,
      score: s ? num(s.score) : null,
      confidence: (s?.confidence ?? "Insufficient Data") as never,
      reasoning: s?.reasoning || question,
    };
  };
  return {
    caiScore: Number(r.caiScore), caiStatus: String(r.caiStatus),
    alignment: num(r.alignmentScoreRaw), pulse: num(r.pulseScoreRaw), stability: num(r.stabilityScoreRaw),
    weightAlpha: num(r.weightAlpha), weightBeta: num(r.weightBeta), weightGamma: num(r.weightGamma),
    weightPriority: r.weightPriority ?? null,
    archetypeMatchScore: num(r.archetypeMatchScore), mythAlignmentScore: num(r.mythAlignmentScore),
    tribMatchScore: num(r.tribMatchScore), decodingModifier: num(r.decodingModifier),
    rogersBaseScore: num(r.rogersBaseScore), liminalAdjustment: num(r.liminalAdjustment),
    goffmanScore: num(r.goffmanScore), driftScore: num(r.driftScore),
    parrScore: num(r.parrScore), parrLabel: r.parrLabel ?? null,
    parrBreakdown: pb ? {
      tribeOverlap: num(pb.tribeOverlap), decodingAcceptance: num(pb.decodingAcceptance),
      archetypeResonance: num(pb.archetypeResonance),
      symbolicOverlap: num(pb.symbolicVocabularyOverlap ?? pb.symbolicOverlap),
      personaConsistency: num(pb.personaConsistency),
    } : null,
    qovScore: num(r.qovScore), symbolicOverlapScore: num(r.symbolicOverlapScore),
    mentionSentimentPenalty: num(r.mentionSentimentPenalty), mentionVocabBoost: num(r.mentionVocabBoost),
    culturalVelocity: r.culturalVelocity ?? null, dataConfidenceLevel: r.dataConfidenceLevel ?? null,
    scoreDegraded: mr.scoreDegradation?.degraded ?? false,
    degradationReasons: mr.scoreDegradation?.reasons ?? [],
    radarWarnings: (r.radarWarnings as string[]) ?? [],
    sharedKeywords: (r.sharedKeywords as string[]) ?? [],
    sharedThemes: (r.sharedThemes as string[]) ?? [],
    musicOverlap: r.musicOverlap ?? null,
    narrativeSummary: mr.narrative?.narrativeSummary ?? null,
    synergyNarrative: mr.synergyNarrative ?? null,
    alignmentNarrative: r.alignmentNarrative ?? null,
    culturalBorrowingSummary: mr.culturalBorrowingSummary ?? null,
    alignmentNotes: mr.narrative?.alignmentNotes ?? null,
    contentDirections: mr.contentDirections ?? [],
    performanceSignals: [
      sig("creativeIntegrity", "Identity Fit", "Does the creator's cultural identity genuinely align with this brand's world?"),
      sig("performanceConsistency", "Performance Fit", "Does this creator have the engagement track record to deliver for this brand?"),
      sig("communityQuality", "Audience Fit", "Are the creator's followers the people this brand actually needs to reach?"),
      sig("audienceReceptivity", "Receptivity Fit", "Will this creator's audience accept a brand message from them?"),
      sig("brandTrust", "Brand Safety Fit", "Is this creator a stable, low-risk reputational partner for this brand?"),
    ],
    createdAt: null, // not persisted from this view's perspective — §5 span shows "—"
    creatorObservationId: mr.creator?.observationId ?? null,
    brandObservationId: mr.brand?.observationId ?? null,
  };
}

export default function FITScore() {
  const [creatorId, setCreatorId] = useState<string>("");
  const [brandId, setBrandId] = useState<string>("");
  const [matchResult, setMatchResult] = useState<MatchResult | null>(null);

  // Matching eligibility (womo_0006): only ACCEPTED creator profiles are offered.
  const { data: creators } = trpc.creator.list.useQuery({ search: undefined, matchableOnly: true });
  const { data: brands } = trpc.brand.list.useQuery({ search: undefined });
  // M1 item 8: the default list exists ONLY to make the empty state truthful.
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
    calculateMutation.mutate({ creatorProfileId: creatorId, brandProfileId: brandId });
  };

  const handleExportJSON = () => {
    if (!matchResult) return;
    const data = {
      generatedAt: new Date().toISOString(),
      creator: matchResult.creator,
      brand: matchResult.brand,
      scores: matchResult.result,
      narrative: matchResult.narrative,
      matchId: matchResult.matchId ?? null,
      persisted: matchResult.persist?.ok ?? false,
      scoreDegradation: matchResult.scoreDegradation ?? null,
      llm: matchResult.llm ?? null,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `connex-fit-${matchResult.creator.handle}-x-${matchResult.brand.brandName}-${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("JSON report downloaded");
  };

  return (
    <div className="min-h-full px-6 py-8 lg:px-10 lg:py-10 max-w-5xl mx-auto">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="mb-8">
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

      {/* ── Selector ───────────────────────────────────────────────────────── */}
      <div className="fit-card rounded-xl p-6 mb-8">
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

          {/* Indigo is the single accent — the gold gradient is gone (M3). */}
          <Button
            onClick={handleCalculate}
            disabled={!canCalculate}
            className="bg-primary text-primary-foreground font-semibold hover:opacity-90 transition-opacity"
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

      {/* ── Loading ────────────────────────────────────────────────────────── */}
      {calculateMutation.isPending && (
        <div className="fit-card rounded-xl p-10 flex flex-col items-center justify-center text-center">
          <Loader2 className="w-8 h-8 text-primary animate-spin mb-4" />
          <p className="text-foreground font-medium mb-1">Running Cultural Match Score Engine</p>
          <p className="text-sm text-muted-foreground">
            Calculating Alignment, Pulse, and Stability scores...
          </p>
        </div>
      )}

      {/* ── Result — the shared five-section body ──────────────────────────── */}
      {matchResult && (
        <div className="space-y-6">
          {/* M1 item 5: a computed-but-unsaved result must say so. */}
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

          <MatchReportBody
            d={bodyFromResult(matchResult)}
            creator={matchResult.creator}
            brand={matchResult.brand}
            provenance="calculation"
            llm={matchResult.llm ?? null}
            view="calculation"
          />

          {/* Calculation-view actions */}
          <div className="flex gap-3 items-center pt-2 border-t border-border/40">
            <Button variant="outline" className="border-border hover:bg-secondary" onClick={handleExportJSON}>
              Export JSON
            </Button>
            {/* M1 item 4: linked by the RETURNED id — this button navigated to
                /report/undefined for as long as the page existed. */}
            {matchResult.matchId && (
              <Link href={`/report/${matchResult.matchId}`}>
                <Button variant="outline" className="border-primary/30 text-primary hover:bg-primary/10">
                  View Full Report
                </Button>
              </Link>
            )}
            {matchResult.persist?.ok && (
              <span className={T_DETAIL}>saved as a match record — the full report is the permanent copy</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
