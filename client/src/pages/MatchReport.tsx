/**
 * THE MATCH REPORT — the persisted record view (M3).
 *
 * This page is now a THIN FEED: it fetches the record, maps it into the
 * canonical MatchBodyData, and renders the shared five-section
 * MatchReportBody — the same body CAIScore renders for a fresh calculation,
 * so the two surfaces cannot disagree about how a score is presented.
 * Everything this file used to render inline (two hero cards, its own PARR
 * meter, its own warning legend, the word cloud, the exchange table, the
 * glowing chrome) lives in the body or its primitives now, once.
 *
 * Record-only divergences kept here: the fetch, Export JSON, comparable
 * partnerships (passed into §4), and the not-found state.
 */
import { useParams, Link } from "wouter";
import { ArrowLeft, FileJson } from "lucide-react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  MatchReportBody, type MatchBodyData, type MatchLlmAccount,
} from "@/components/MatchReportBody";
import { T_TITLE, T_DETAIL, T_MICRO } from "@/lib/reportType";

const num = (v: unknown): number | null => (v == null || Number.isNaN(Number(v)) ? null : Number(v));

export default function MatchReport() {
  const params = useParams<{ id: string }>();
  const id = params.id ?? "";

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
    const { match } = data;
    const exportData = {
      generatedAt: new Date().toISOString(),
      reportVersion: "4.0",
      framework: "Connex Cultural Match Score",
      creator: data.creator,
      brand: data.brand,
      profileProvenance: (data as Record<string, unknown>).profileProvenance ?? null,
      llm: (data as Record<string, unknown>).llm ?? null,
      match: {
        caiScore: match.caiScore,
        caiStatus: match.caiStatus,
        scoreDegraded: (match as Record<string, unknown>).scoreDegraded ?? false,
        degradationReasons: (match as Record<string, unknown>).degradationReasons ?? null,
        parrScore: match.parrScore,
        parrLabel: match.parrLabel,
        symbolicOverlapScore: match.symbolicOverlapScore,
        sharedKeywords: match.sharedKeywords,
        sharedThemes: match.sharedThemes,
        alignmentScoreRaw: match.alignmentScoreRaw,
        pulseScoreRaw: match.pulseScoreRaw,
        stabilityScoreRaw: match.stabilityScoreRaw,
        archetypeMatchScore: match.archetypeMatchScore,
        mythAlignmentScore: match.mythAlignmentScore,
        tribMatchScore: match.tribMatchScore,
        decodingModifier: match.decodingModifier,
        rogersBaseScore: match.rogersBaseScore,
        liminalAdjustment: match.liminalAdjustment,
        goffmanScore: match.goffmanScore,
        driftScore: match.driftScore,
        weightAlpha: match.weightAlpha,
        weightBeta: match.weightBeta,
        weightGamma: match.weightGamma,
        radarWarnings: match.radarWarnings,
        synergyNarrative: match.synergyNarrative,
        contentDirections: match.contentDirections,
        narrativeSummary: match.narrativeSummary,
        alignmentNotes: match.alignmentNotes,
        calculatedAt: match.createdAt,
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
  const m = match as Record<string, any>;
  const pb = (m.parrSignalBreakdown ?? null) as Record<string, number | null> | null;

  /** The record row, mapped into the canonical body shape. */
  const bodyData: MatchBodyData = {
    caiScore: Number(m.caiScore),
    caiStatus: String(m.caiStatus ?? ""),
    alignment: num(m.alignmentScoreRaw), pulse: num(m.pulseScoreRaw), stability: num(m.stabilityScoreRaw),
    weightAlpha: num(m.weightAlpha), weightBeta: num(m.weightBeta), weightGamma: num(m.weightGamma),
    weightPriority: null, // not persisted on the match row — §2 names the table instead
    archetypeMatchScore: num(m.archetypeMatchScore), mythAlignmentScore: num(m.mythAlignmentScore),
    tribMatchScore: num(m.tribMatchScore), decodingModifier: num(m.decodingModifier),
    rogersBaseScore: num(m.rogersBaseScore), liminalAdjustment: num(m.liminalAdjustment),
    goffmanScore: num(m.goffmanScore), driftScore: num(m.driftScore),
    parrScore: num(m.parrScore), parrLabel: m.parrLabel ?? null,
    parrBreakdown: pb ? {
      tribeOverlap: num(pb.tribeOverlap), decodingAcceptance: num(pb.decodingAcceptance),
      archetypeResonance: num(pb.archetypeResonance),
      // the record reader ships the shorter key; the transient result the longer
      symbolicOverlap: num(pb.symbolicOverlap ?? pb.symbolicVocabularyOverlap),
      personaConsistency: num(pb.personaConsistency),
    } : null,
    qovScore: num(m.qovScore), symbolicOverlapScore: num(m.symbolicOverlapScore),
    mentionSentimentPenalty: num(m.mentionSentimentPenalty), mentionVocabBoost: num(m.mentionVocabBoost),
    culturalVelocity: m.culturalVelocity ?? null,
    dataConfidenceLevel: m.dataConfidenceLevel ?? null,
    scoreDegraded: Boolean(m.scoreDegraded),
    degradationReasons: (m.degradationReasons as string[] | null) ?? [],
    radarWarnings: (m.radarWarnings as string[]) ?? [],
    sharedKeywords: (m.sharedKeywords as string[]) ?? [],
    sharedThemes: (m.sharedThemes as string[]) ?? [],
    musicOverlap: m.musicOverlap ?? null,
    narrativeSummary: m.narrativeSummary ?? null,
    synergyNarrative: m.synergyNarrative ?? null,
    alignmentNarrative: m.alignmentNarrative ?? null,
    culturalBorrowingSummary: m.culturalBorrowingSummary ?? null,
    alignmentNotes: (m.alignmentNotes as Record<string, string | null> | null) ?? null,
    contentDirections: (m.contentDirections as MatchBodyData["contentDirections"]) ?? [],
    // Persisted rows store score + confidence; the descriptions are the five
    // standing questions. score null → the body renders absence (M2).
    performanceSignals: [
      { name: "Identity Fit", score: num(m.creativeIntegritySignal), confidence: (m.creativeIntegrityConfidence ?? "Insufficient Data") as never, reasoning: "Does the creator's cultural identity genuinely align with this brand's world?" },
      { name: "Performance Fit", score: num(m.performanceConsistencySignal), confidence: (m.performanceConsistencyConfidence ?? "Insufficient Data") as never, reasoning: "Does this creator have the engagement track record to deliver for this brand?" },
      { name: "Audience Fit", score: num(m.communityQualitySignal), confidence: (m.communityQualityConfidence ?? "Insufficient Data") as never, reasoning: "Are the creator's followers the people this brand actually needs to reach?" },
      { name: "Receptivity Fit", score: num(m.audienceReceptivitySignal), confidence: (m.audienceReceptivityConfidence ?? "Insufficient Data") as never, reasoning: "Will this creator's audience accept a brand message from them?" },
      { name: "Brand Safety Fit", score: num(m.brandTrustSignal), confidence: (m.brandTrustConfidence ?? "Insufficient Data") as never, reasoning: "Is this creator a stable, low-risk reputational partner for this brand?" },
    ],
    createdAt: m.createdAt ?? null,
    creatorObservationId: m.creatorObservationId ?? null,
    brandObservationId: m.brandObservationId ?? null,
  };

  const provenance = ((data as Record<string, unknown>).profileProvenance ?? { creator: "latest-fallback", brand: "latest-fallback" }) as { creator: string; brand: string };
  const llm = ((data as Record<string, unknown>).llm ?? null) as MatchLlmAccount | null;

  return (
    <div className="min-h-full px-6 py-8 lg:px-10 lg:py-10 max-w-5xl mx-auto">
      {/* ── Header — record identity + export ─────────────────────────────── */}
      <div className="flex items-start justify-between mb-8 gap-4 flex-wrap">
        <div>
          <Link href="/library">
            <button className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-4 transition-colors">
              <ArrowLeft className="w-3 h-3" /> Back to Library
            </button>
          </Link>
          <div className={`${T_MICRO} mb-1.5`}>Match report</div>
          <h1 className={T_TITLE}>@{creator?.handle} × {brand?.brandName}</h1>
          <p className={`${T_DETAIL} mt-1`}>
            scored {new Date(m.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
          </p>
        </div>
        <Button variant="outline" size="sm" className="border-border" onClick={handleExportJSON}>
          <FileJson className="w-3.5 h-3.5 mr-1.5" /> Export JSON
        </Button>
      </div>

      <MatchReportBody
        d={bodyData}
        creator={creator}
        brand={brand}
        provenance={provenance}
        llm={llm}
        view="record"
        comparables={comparableQuery.data ?? []}
      />
    </div>
  );
}
