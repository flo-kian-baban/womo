import React from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MetricTooltip } from "@/components/MetricTooltip";

export interface Signal {
  name: string;
  /**
   * 0-100, or NULL when this match never computed the signal (older persisted
   * rows). M2: a missing measurement renders as missing — the previous
   * `?? 50` fallbacks put a mid-range number on screen that was
   * indistinguishable from a real score.
   */
  score: number | null;
  /**
   * Measurement provenance. "Derived" (M2) marks a value that is a rescaling
   * of another number on the same page (the three Cultural signals are the
   * CMS sub-scores ×10) — previously stamped "Verified", which claimed an
   * independent verification that never happened.
   */
  confidence: "Verified" | "Estimated" | "Insufficient Data" | "Derived";
  reasoning: string;
  category: "Performance" | "Cultural";
}

interface SignalPanelProps {
  signals: Signal[];
  caiScore: number;
  caiStatus: "Green Light" | "Proceed with Caution" | "Do Not Proceed";
}

const getScoreColor = (score: number) => {
  if (score >= 75) return "text-green-600";
  if (score >= 50) return "text-yellow-600";
  return "text-red-600";
};

const getConfidenceBadgeVariant = (confidence: string) => {
  switch (confidence) {
    case "Verified":
      return "default";
    case "Estimated":
      return "secondary";
    case "Derived":
      return "outline";
    case "Insufficient Data":
      return "outline";
    default:
      return "secondary";
  }
};

const getStatusColor = (status: string) => {
  switch (status) {
    case "Green Light":
      return "bg-green-50 border-green-200";
    case "Proceed with Caution":
      return "bg-yellow-50 border-yellow-200";
    case "Do Not Proceed":
      return "bg-red-50 border-red-200";
    default:
      return "bg-gray-50 border-gray-200";
  }
};

const getStatusTextColor = (status: string) => {
  switch (status) {
    case "Green Light":
      return "text-green-700";
    case "Proceed with Caution":
      return "text-yellow-700";
    case "Do Not Proceed":
      return "text-red-700";
    default:
      return "text-gray-700";
  }
};

// ─── Signal Definitions ────────────────────────────────────────────────────────
/*
  M2: every formula below is transcribed from the CODE, with its source cited.
  The previous set described weightings, tier values and inputs that exist
  nowhere in the engine (e.g. "Identity Fit = Goffman×0.4 + …", Rogers tiers
  of 80/95/100). Sources: server/performanceSignals.ts (five Performance
  signals) and server/fitEngine.ts (the three Cultural rescalings). If a
  formula here disagrees with those files, THIS FILE is the one that is wrong.
*/
const SIGNAL_DEFINITIONS: Record<string, { explanation: string; formula: string; whyItMatters: string; dataPoints: string[] }> = {
  "Identity Fit": {
    // source: performanceSignals.ts — calculateCreativeIntegritySignal
    explanation: "A point-based heuristic of whether creator and brand each show up as a consistent, genuine identity. Additive points, baseline 20, clamped 0–100.",
    formula: "20 baseline + creator Goffman (Consistent 10 · Minor Gap 5 · Significant Gap 0) ×2 + cultural capital (Produce +10 · Relay +5) + tone register present +10 + brand audience sentiment with ≥5 mentions (positive +15 · mixed +5 · negative −15; insufficient data +3) + brand Goffman (10/5/0) − 20 if a Produce-type creator meets a brand tone containing “prescriptive”",
    whyItMatters: "It grades identity consistency on both sides at once — but it is a heuristic point sum, not a measurement; treat the level, not decimal differences, as meaningful.",
    dataPoints: ["Creator Goffman stage + cultural capital + tone register (extracted framework fields)", "Brand mention sentiment + mention count", "Brand Goffman consistency", "Brand tone text"],
  },
  "Performance Fit": {
    // source: performanceSignals.ts — calculatePerformanceConsistencySignal
    explanation: "A point-based heuristic of delivery reliability. No baseline — the score is earned from whichever inputs exist. Clamped 0–100.",
    formula: "creator engagement rate (≥6% +20 · ≥3% +15 · ≥1% +10 · <1% +5) + lifecycle (Growth/Maturity +15 · Emergence +10 · Decline −10) − 10 if brand-saturated + brand archetype present +10 + brand Goffman (10/5/0) + brand drift (Zero 10 · Minor 7 · Significant 3 · Full Pivot 0) + brand TikTok engagement (≥3% +10 · ≥1% +5) + brand rating (≥4.0 +10 · ≥3.0 +5)",
    whyItMatters: "Sums the engagement and stability facts available for the pair. Inputs that were never captured contribute zero — a low score can mean weak performance OR missing data; the confidence badge says which.",
    dataPoints: ["Creator engagement rate + lifecycle phase + brand-saturation flag", "Brand archetype, Goffman, drift", "Brand TikTok engagement rate (null for most brands in the corpus)", "Brand star rating"],
  },
  "Audience Fit": {
    // source: performanceSignals.ts — calculateCommunityQualitySignal
    explanation: "PARR re-used as the base, plus small additive bonuses. Clamped 0–100.",
    formula: "PARR (0–100; 50 fallback if absent) + creator decoding (Dominant +15 · Negotiated +5 · Oppositional −15) + creator region present +5 + audience-relationship present +5 + mention-hashtag/creator-keyword overlap (ratio >0.3 +10 · >0.1 +5)",
    whyItMatters: "Mostly PARR wearing a different name — the bonuses shift it by at most 35 points. Read it together with Receptivity Fit, which also builds on PARR; they are not independent evidence.",
    dataPoints: ["PARR (see its tooltip)", "Stuart Hall decoding (creator-side)", "Brand mention hashtags vs creator keywords"],
  },
  "Receptivity Fit": {
    // source: performanceSignals.ts — calculateAudienceReceptivitySignal
    explanation: "A blend of PARR and QoV with small modifiers. Clamped 0–100.",
    formula: "PARR × 0.6 (50 baseline if PARR absent) + QoV × 0.2 + creator decoding (Dominant +10 · Oppositional −10) + 10 if BOTH myth sentences contain the word “success”",
    whyItMatters: "Because it is built from PARR and QoV (which is itself CMS × PARR), this signal overlaps heavily with the other receptivity numbers on this page — it is a re-blend, not new evidence. The literal “success” keyword bonus is a real behavior of the code.",
    dataPoints: ["PARR", "QoV", "Stuart Hall decoding (creator-side)", "The two Barthes-myth sentences (substring check)"],
  },
  "Brand Safety Fit": {
    // source: performanceSignals.ts — calculateBrandTrustSignal
    explanation: "A point-based heuristic of mutual reputational risk. Baseline 20, clamped 0–100.",
    formula: "20 baseline + creator Goffman (Consistent +15 · Minor Gap +8 · Significant Gap −10) + creator drift (Zero +10 · Minor +7 · Significant +3 · Full Pivot −15) − 10 if brand-saturated + brand sentiment with ≥5 mentions (positive +20 · mixed +10 · negative −10) + brand rating (≥4.5 +15 · ≥4.0 +10 · ≥3.5 +5 · <3.0 −5) + brand archetype present +5 + brand Goffman (10/5/0) + data confidence (high +5 · low −5)",
    whyItMatters: "Aggregates the stability and reputation facts that exist for the pair. Like the other point sums: missing inputs contribute nothing, so compare levels, not decimals.",
    dataPoints: ["Creator Goffman + drift + saturation flag", "Brand mention sentiment + count", "Brand star rating", "Run data-confidence level"],
  },
  "Cultural Identity": {
    // source: fitEngine.ts — alignmentScoreRaw, rescaled in the page
    explanation: "This is the Alignment sub-score × 10 — the same number already shown in the hero, rescaled to 0–100. It is not an independent measurement.",
    formula: "Alignment × 10, where Alignment = mean(archetype match, myth alignment, tribe match) + Stuart Hall modifier + audience-vocab boost (see the Alignment tooltip)",
    whyItMatters: "Shown here so the eight-signal grid covers the cultural dimensions — but do not count it as separate evidence: it moves exactly when Alignment moves.",
    dataPoints: ["Identical to Alignment (α)"],
  },
  "Cultural Momentum": {
    // source: fitEngine.ts — pulseScoreRaw, rescaled in the page
    explanation: "This is the Pulse sub-score × 10 — the hero's Pulse rescaled to 0–100. Not an independent measurement.",
    formula: "Pulse × 10, where Pulse = Rogers base + liminal adjustment (+ TikTok boosts, brand blend — see the Pulse tooltip)",
    whyItMatters: "Moves exactly when Pulse moves; separate evidence it is not.",
    dataPoints: ["Identical to Pulse (β)"],
  },
  "Partnership Stability": {
    // source: fitEngine.ts — stabilityScoreRaw, rescaled in the page
    explanation: "This is the Stability sub-score × 10 — the hero's Stability rescaled to 0–100. Not an independent measurement.",
    formula: "Stability × 10, where Stability = (Goffman + Drift) ÷ 2 (+ TikTok boosts, brand blend, sentiment modifier — see the Stability tooltip)",
    whyItMatters: "Moves exactly when Stability moves; separate evidence it is not.",
    dataPoints: ["Identical to Stability (γ)"],
  },
};

export const SignalPanel: React.FC<SignalPanelProps> = ({
  signals,
  caiScore,
  caiStatus,
}) => {
  const performanceSignals = signals.filter((s) => s.category === "Performance");
  const culturalSignals = signals.filter((s) => s.category === "Cultural");

  return (
    <div className="space-y-6">
      {/* Cultural Match Score Header */}
      <Card className={`p-6 border-2 ${getStatusColor(caiStatus)}`}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              Cultural Match Score
            </h2>
            <p className="text-sm text-gray-600 mt-1">{caiStatus}</p>
          </div>
          <div className="text-right">
            <div className={`text-5xl font-bold ${getStatusTextColor(caiStatus)}`}>
              {caiScore.toFixed(2)}
            </div>
            <p className="text-xs text-gray-600 mt-1">/ 10</p>
          </div>
        </div>
      </Card>

      {/* Performance Signals */}
      {performanceSignals.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-white">
            Performance Signals
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {performanceSignals.map((signal, idx) => {
              const def = SIGNAL_DEFINITIONS[signal.name];
              return (
                <Card key={idx} className="p-4 hover:shadow-md transition-shadow bg-gray-900 border-gray-700">
                  <div className="space-y-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-1.5">
                        <h4 className="font-medium text-white">{signal.name}</h4>
                        {def && (
                          <MetricTooltip
                            title={signal.name}
                            explanation={def.explanation}
                            formula={def.formula}
                            whyItMatters={def.whyItMatters}
                            dataPoints={def.dataPoints}
                            side="top"
                          />
                        )}
                      </div>
                      {/* M2: no provenance stamp on a value that does not exist. */}
                      {signal.score != null && (
                        <Badge variant={getConfidenceBadgeVariant(signal.confidence)}>
                          {signal.confidence}
                        </Badge>
                      )}
                    </div>

                    {/* M2: absence renders as absence. These used to be fed
                        `?? 50` fallbacks — a missing measurement drew a
                        mid-range bar indistinguishable from a real score. */}
                    {signal.score != null ? (
                      <div className="flex items-center gap-3">
                        <div className="flex-1 bg-gray-700 rounded-full h-2">
                          <div
                            className={`h-full rounded-full transition-all ${getScoreColor(signal.score).replace("text-", "bg-")}`}
                            style={{ width: `${signal.score}%` }}
                          />
                        </div>
                        <span className={`text-lg font-bold ${getScoreColor(signal.score)}`}>
                          {signal.score.toFixed(2)}
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3">
                        <div className="flex-1 bg-gray-800 rounded-full h-2" />
                        <span className="text-sm italic text-gray-500">not computed</span>
                      </div>
                    )}

                    <p className="text-sm text-gray-300">
                      {signal.score != null
                        ? signal.reasoning
                        : "This signal was not computed for this match — it predates the signal, or its inputs were unavailable. No number is substituted."}
                    </p>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* Cultural Signals */}
      {culturalSignals.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-white">
            Cultural Signals
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {culturalSignals.map((signal, idx) => {
              const def = SIGNAL_DEFINITIONS[signal.name];
              return (
                <Card key={idx} className="p-4 hover:shadow-md transition-shadow bg-gray-900 border-gray-700">
                  <div className="space-y-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-1.5">
                        <h4 className="font-medium text-white">{signal.name}</h4>
                        {def && (
                          <MetricTooltip
                            title={signal.name}
                            explanation={def.explanation}
                            formula={def.formula}
                            whyItMatters={def.whyItMatters}
                            dataPoints={def.dataPoints}
                            side="top"
                          />
                        )}
                      </div>
                      {/* M2: no provenance stamp on a value that does not exist. */}
                      {signal.score != null && (
                        <Badge variant={getConfidenceBadgeVariant(signal.confidence)}>
                          {signal.confidence}
                        </Badge>
                      )}
                    </div>

                    {/* M2: absence renders as absence. These used to be fed
                        `?? 50` fallbacks — a missing measurement drew a
                        mid-range bar indistinguishable from a real score. */}
                    {signal.score != null ? (
                      <div className="flex items-center gap-3">
                        <div className="flex-1 bg-gray-700 rounded-full h-2">
                          <div
                            className={`h-full rounded-full transition-all ${getScoreColor(signal.score).replace("text-", "bg-")}`}
                            style={{ width: `${signal.score}%` }}
                          />
                        </div>
                        <span className={`text-lg font-bold ${getScoreColor(signal.score)}`}>
                          {signal.score.toFixed(2)}
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3">
                        <div className="flex-1 bg-gray-800 rounded-full h-2" />
                        <span className="text-sm italic text-gray-500">not computed</span>
                      </div>
                    )}

                    <p className="text-sm text-gray-300">
                      {signal.score != null
                        ? signal.reasoning
                        : "This signal was not computed for this match — it predates the signal, or its inputs were unavailable. No number is substituted."}
                    </p>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
