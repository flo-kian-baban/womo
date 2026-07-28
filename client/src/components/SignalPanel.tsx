import React from "react";
import { MetricTooltip } from "@/components/MetricTooltip";
import { Pill, TONE_NEUTRAL } from "@/components/report/ReportPrimitives";
import { T_DETAIL, T_MICRO, T_SUB, BOX } from "@/lib/reportType";

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
  /**
   * M3: the CMS header card this panel used to render duplicated §1's verdict
   * (and did it in light-theme colours on a dark app). The verdict lives in
   * the report body's §1 now; these props remain accepted for compatibility
   * and render nothing.
   */
  caiScore?: number;
  caiStatus?: string;
}

/**
 * Score level is ORDINAL — quiet end neutral, decision end coloured (M3).
 * The old thresholds (≥75 / ≥50) are kept; only the palette moved from
 * light-theme -600 utilities to the report vocabulary's tones.
 */
const scoreTextTone = (score: number) =>
  score >= 75 ? "text-foreground/85" : score >= 50 ? "text-amber-400" : "text-red-400";
const scoreBarTone = (score: number) =>
  score >= 75 ? "bg-foreground/45" : score >= 50 ? "bg-amber-400/70" : "bg-red-400/70";

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

export const SignalPanel: React.FC<SignalPanelProps> = ({ signals }) => {
  const performanceSignals = signals.filter((s) => s.category === "Performance");
  const culturalSignals = signals.filter((s) => s.category === "Cultural");

  const SignalCard = ({ signal }: { signal: Signal }) => {
    const def = SIGNAL_DEFINITIONS[signal.name];
    return (
      <div className={`p-3 ${BOX}`}>
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <h4 className="text-[13px] font-medium text-foreground/90 truncate">{signal.name}</h4>
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
          {/* Provenance is ONE muted treatment — the WORD carries the meaning
              (Verified · Estimated · Derived · Insufficient Data). No stamp on
              a value that does not exist. */}
          {signal.score != null && <Pill tone={TONE_NEUTRAL}>{signal.confidence}</Pill>}
        </div>

        {signal.score != null ? (
          <div className="flex items-center gap-3">
            <div className="flex-1 h-1.5 rounded-full bg-secondary/60 border border-border/40 overflow-hidden">
              <div className={`h-full ${scoreBarTone(signal.score)}`} style={{ width: `${signal.score}%` }} />
            </div>
            <span className={`text-sm font-semibold font-mono tabular-nums ${scoreTextTone(signal.score)}`}>
              {signal.score.toFixed(2)}
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <div className="flex-1 h-1.5 rounded-full bg-secondary/40 border border-border/30" />
            <span className={`${T_DETAIL} italic`}>not computed</span>
          </div>
        )}

        <p className={`${T_DETAIL} mt-2`}>
          {signal.score != null
            ? signal.reasoning
            : "This signal was not computed for this match — it predates the signal, or its inputs were unavailable. No number is substituted."}
        </p>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {performanceSignals.length > 0 && (
        <div>
          <h3 className={`${T_SUB} mb-2`}>Performance signals</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            {performanceSignals.map((signal, idx) => <SignalCard key={idx} signal={signal} />)}
          </div>
        </div>
      )}
      {culturalSignals.length > 0 && (
        <div>
          <div className="flex items-baseline gap-2 mb-2">
            <h3 className={T_SUB}>Cultural signals</h3>
            <span className={T_MICRO}>derived — the three sub-scores ×10, not independent measurements</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
            {culturalSignals.map((signal, idx) => <SignalCard key={idx} signal={signal} />)}
          </div>
        </div>
      )}
    </div>
  );
};
