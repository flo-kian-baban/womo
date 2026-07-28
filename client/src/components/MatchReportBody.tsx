/**
 * THE MATCH REPORT BODY — the five sections, shared by both surfaces (M3).
 *
 * ─── One body, two feeds ────────────────────────────────────────────────────
 * CAIScore (the calculation view) maps the transient fit.calculate result into
 * MatchBodyData; MatchReport (the persisted record) maps the fit.get row. The
 * two surfaces previously carried two RadarWarningBadge copies and two
 * DIFFERENT renderings of PARR — the same defect shape as PROVENANCE_STYLES.
 * One imported body means they cannot disagree by construction.
 *
 * ─── §2's arithmetic is the point ───────────────────────────────────────────
 * The score's working renders ON THE PAGE with this match's numbers: the CMS
 * weighted sum, each sub-score's chain, PARR's five weighted signals, and the
 * modifiers that fired. Where every term is persisted the chain is recomputed
 * and checked against the stored value; where the engine's intermediates are
 * not persisted (pulse/stability blends and boosts), the steps are LISTED with
 * their inputs and the stored result stands — stated, not reconstructed.
 * Fallback inputs (myth/tribe 3.0) are marked amber inline, so a degraded
 * score shows exactly WHICH terms were never computed.
 *
 * ─── NOTHING IS REMOVED ─────────────────────────────────────────────────────
 * Every item from the pre-M3 surfaces is here — surfaced or one disclosure
 * down. Colour: verdict, confidence, warnings, degradation and score-level
 * tones stay (ordinal); archetype pairs, exchange identities, section chrome
 * are neutral (categorical).
 */
import { useState } from "react";
import {
  Layers, FileText, Shield, Film, Receipt, AlertTriangle, CheckCircle2,
  Hash, Music, Lightbulb, ExternalLink,
} from "lucide-react";
import { Link } from "wouter";
import CreatorProfileCard from "@/components/CreatorProfileCard";
import BrandProfileCard from "@/components/BrandProfileCard";
import { SignalPanel, type Signal } from "@/components/SignalPanel";
import { MetricTooltip } from "@/components/MetricTooltip";
import { CHIP_NEUTRAL } from "@/components/CreatorProfileCard";
import {
  Section, Disclosure, Note, Pill,
  TONE_NEUTRAL, TONE_AMBER, TONE_RED, CONFIDENCE_TONE, VERDICT_TONE,
} from "@/components/report/ReportPrimitives";
import { MODEL_PRICING, PRICING_AS_OF } from "@shared/llmPricing";
import {
  T_SUB, T_BODY, T_LABEL, T_DETAIL, T_MICRO, BOX,
} from "@/lib/reportType";

// ─── The canonical data shape both surfaces map into ─────────────────────────

export interface MatchLlmAccount {
  linked: boolean;
  calls: Array<{
    purpose: string; model: string;
    inputTokens: number | null; outputTokens: number | null;
    durationMs: number | null; status: string; createdAt: string | Date;
    costUsd: number | null;
  }>;
  totals: { calls: number; inputTokens: number; outputTokens: number; costUsd: number } | null;
}

export interface MatchBodyData {
  caiScore: number; caiStatus: string;
  alignment: number | null; pulse: number | null; stability: number | null;
  weightAlpha: number | null; weightBeta: number | null; weightGamma: number | null;
  weightPriority: string | null;
  archetypeMatchScore: number | null; mythAlignmentScore: number | null; tribMatchScore: number | null;
  decodingModifier: number | null; rogersBaseScore: number | null; liminalAdjustment: number | null;
  goffmanScore: number | null; driftScore: number | null;
  parrScore: number | null; parrLabel: string | null;
  parrBreakdown: {
    tribeOverlap: number | null; decodingAcceptance: number | null;
    archetypeResonance: number | null; symbolicOverlap: number | null;
    personaConsistency: number | null;
  } | null;
  qovScore: number | null; symbolicOverlapScore: number | null;
  mentionSentimentPenalty: number | null; mentionVocabBoost: number | null;
  culturalVelocity: string | null; dataConfidenceLevel: string | null;
  scoreDegraded: boolean; degradationReasons: string[];
  radarWarnings: string[];
  sharedKeywords: string[]; sharedThemes: string[];
  musicOverlap: { sharedTitles: string[]; sharedArtists: string[]; overlapStrength: string } | null;
  narrativeSummary: string | null; synergyNarrative: string | null;
  alignmentNarrative: string | null; culturalBorrowingSummary: string | null;
  alignmentNotes: Record<string, string | null> | null;
  contentDirections: Array<{ title: string; rationale: string; exampleAngle: string }>;
  performanceSignals: Array<{ name: string; score: number | null; confidence: Signal["confidence"]; reasoning: string }>;
  createdAt: string | Date | null;
  creatorObservationId: string | null; brandObservationId: string | null;
}

type Profile = Record<string, any> | null;
export type ProfileProvenance = { creator: string; brand: string } | "calculation";

// ─── Small helpers ───────────────────────────────────────────────────────────

const fmt = (n: number | null | undefined, d = 2): string =>
  n == null || Number.isNaN(Number(n)) ? "—" : Number(n).toFixed(d);

/** Score-level tone (ordinal): quiet end neutral, decision end coloured. */
const levelTone = (score: number | null, hi: number, mid: number): string =>
  score == null ? "text-muted-foreground/40"
  : score >= hi ? "text-foreground/85"
  : score >= mid ? "text-amber-400"
  : "text-red-400";

const PARR_TONE = (parr: number | null): string =>
  parr == null ? TONE_NEUTRAL : parr >= 60 ? TONE_NEUTRAL : parr >= 40 ? TONE_AMBER : TONE_RED;

/** The single warning legend — previously two divergent copies. */
const WARNING_META: Record<string, { tone: "red" | "amber"; desc: string }> = {
  "Low Alignment": { tone: "red", desc: "Alignment score below 6.0 — creator and brand do not share symbolic language" },
  "Archetype Tension": { tone: "amber", desc: "Creator archetype appears in brand's 'Clashes With' list" },
  "Identity Instability": { tone: "amber", desc: "Full Pivot drift signal or Significant Gap in Goffman stage consistency" },
  "Low Pulse": { tone: "amber", desc: "Pulse score below 4.0 — cultural momentum is weak or window is closing" },
  "Trajectory Divergence": { tone: "amber", desc: "Creator is behind the niche's current adoption position" },
  "Low Social Engagement": { tone: "amber", desc: "Brand TikTok engagement rate is below 0.5% — limited social proof" },
  "Negative Audience Sentiment": { tone: "red", desc: "Audience mentions of this brand skew negative (at medium/high confidence) — partnership may inherit reputational risk" },
};

function WarningRow({ warning }: { warning: string }) {
  const meta = WARNING_META[warning] ?? { tone: "amber" as const, desc: "" };
  const red = meta.tone === "red";
  return (
    <div className={`flex items-start gap-2.5 pl-3 border-l-2 ${red ? "border-red-400/60" : "border-amber-400/60"}`}>
      <AlertTriangle className={`w-3.5 h-3.5 flex-shrink-0 mt-0.5 ${red ? "text-red-400/90" : "text-amber-400/90"}`} />
      <div>
        <span className={`text-xs font-semibold ${red ? "text-red-400" : "text-amber-400"}`}>{warning}</span>
        {meta.desc && <p className="text-xs text-foreground/60 leading-relaxed">{meta.desc}</p>}
      </div>
    </div>
  );
}

// ─── §2 · THE ARITHMETIC ─────────────────────────────────────────────────────

/** A mono figure with an optional amber FALLBACK mark — the degraded terms. */
function Term({ label, value, fallback = false, d = 2 }: { label: string; value: number | null; fallback?: boolean; d?: number }) {
  return (
    <span className="inline-flex items-baseline gap-1 whitespace-nowrap">
      <span className={T_DETAIL}>{label}</span>
      <span className={`font-mono tabular-nums text-xs ${fallback ? "text-amber-400" : "text-foreground/85"}`}>{fmt(value, d)}</span>
      {fallback && <span className="text-[9px] uppercase tracking-wide text-amber-400/90 font-semibold">fallback</span>}
    </span>
  );
}

function ChainRow({ title, tooltipNote, children }: { title: string; tooltipNote?: string; children: React.ReactNode }) {
  return (
    <div className="py-2.5 border-b border-border/25 last:border-0">
      <div className="flex items-baseline gap-2 mb-1.5">
        <span className={T_SUB}>{title}</span>
        {tooltipNote && <span className={T_DETAIL}>{tooltipNote}</span>}
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

/**
 * The working, on the page. Every line uses THIS match's stored numbers.
 * Chains whose every term is persisted are recomputed and checked against the
 * stored value (✓ / stated difference); chains with unpersisted intermediates
 * (pulse/stability boosts and blends) list the steps and their inputs and let
 * the stored result stand.
 */
function ScoreArithmetic({ d, creator, brand }: { d: MatchBodyData; creator: Profile; brand: Profile }) {
  const mythFallback = d.degradationReasons.some(r =>
    r.includes("mythAlignmentScore") || r.includes("myth/tribe"));

  const A = d.alignment, P = d.pulse, S = d.stability;
  const wa = d.weightAlpha, wb = d.weightBeta, wg = d.weightGamma;
  const haveCms = A != null && P != null && S != null && wa != null && wb != null && wg != null;
  const cmsSum = haveCms ? A! * wa! + P! * wb! + S! * wg! : null;
  const cmsMatches = cmsSum != null && Math.abs(cmsSum - d.caiScore) < 0.01;

  // Alignment: every term persisted → exact reconstruction.
  const haveAlign = d.archetypeMatchScore != null && d.mythAlignmentScore != null
    && d.tribMatchScore != null && d.decodingModifier != null;
  const alignMean = haveAlign
    ? (d.archetypeMatchScore! + d.mythAlignmentScore! + d.tribMatchScore!) / 3 : null;
  const vocabBoost = d.mentionVocabBoost ?? 0;
  const alignRecon = alignMean != null
    ? Math.min(10, Math.min(10, Math.max(0, alignMean + d.decodingModifier!)) + vocabBoost)
    : null;
  const alignMatches = alignRecon != null && A != null && Math.abs(alignRecon - A) < 0.01;

  // Pulse: creator side persisted; blend/boost intermediates are not.
  const pulseCreatorSide = d.rogersBaseScore != null && d.liminalAdjustment != null
    ? d.rogersBaseScore + d.liminalAdjustment : null;
  const brandHasPulseSide = Boolean(brand?.brandRogersAdopterStage && brand?.brandTurnerLiminalPhase);
  const pulseExact = pulseCreatorSide != null && P != null && Math.abs(pulseCreatorSide - P) < 0.01;

  // Stability: base + stored sentiment modifier; boost/blend intermediates not persisted.
  const stabBase = d.goffmanScore != null && d.driftScore != null
    ? (d.goffmanScore + d.driftScore) / 2 : null;
  const sentPenalty = d.mentionSentimentPenalty ?? 0;
  const brandHasStabSide = Boolean(brand?.brandGoffmanStageConsistency && brand?.brandDriftSignal);
  const brandHasFollowers = brand?.tiktokAudienceSize != null;

  // PARR: all five terms persisted → exact reconstruction.
  const pb = d.parrBreakdown;
  const havePb = pb && pb.tribeOverlap != null && pb.decodingAcceptance != null
    && pb.archetypeResonance != null && pb.symbolicOverlap != null && pb.personaConsistency != null;
  const parrRecon = havePb
    ? Math.round((pb!.tribeOverlap! * 0.30 + pb!.decodingAcceptance! * 0.25 + pb!.archetypeResonance! * 0.20
      + pb!.symbolicOverlap! * 0.15 + pb!.personaConsistency! * 0.10) * 10)
    : null;
  const parrMatches = parrRecon != null && d.parrScore != null && parrRecon === Math.round(d.parrScore);

  const capTriggered = A != null && A < 6.0 && cmsSum != null && cmsSum >= 7.5 && d.caiStatus === "Proceed with Caution";

  return (
    <div className={`p-4 ${BOX}`}>
      <div className="flex items-baseline gap-2 mb-2">
        <h3 className={T_SUB}>The arithmetic</h3>
        <span className={T_DETAIL}>this score's working, from its stored values — nothing here is a tooltip</span>
      </div>

      {!haveCms ? (
        <Note kind="caveat">
          The score components were not persisted on this match (it predates component storage) —
          the chain cannot be shown. The stored score is {fmt(d.caiScore)}.
        </Note>
      ) : (
        <div className="space-y-0">
          {/* ── CMS ── */}
          <ChainRow title="Cultural Match Score" tooltipNote="CMS = A×α + P×β + S×γ">
            <div className="font-mono tabular-nums text-xs text-foreground/85 leading-relaxed">
              <div>Alignment {fmt(A)} × α {fmt(wa)} = {fmt(A! * wa!)}</div>
              <div>Pulse&nbsp;&nbsp;&nbsp;&nbsp; {fmt(P)} × β {fmt(wb)} = {fmt(P! * wb!)}</div>
              <div>Stability {fmt(S)} × γ {fmt(wg)} = {fmt(S! * wg!)}</div>
              <div className="border-t border-border/40 mt-1 pt-1">
                sum = {fmt(cmsSum)} · stored {fmt(d.caiScore)} {cmsMatches
                  ? <span className="text-foreground/60">✓ exact</span>
                  : <span className="text-amber-400">differs by {fmt(Math.abs((cmsSum ?? 0) - d.caiScore))} — rounding at persist; the stored value is authoritative</span>}
              </div>
            </div>
            <p className={`${T_DETAIL} mt-1`}>
              {d.caiStatus === "Green Light" && <>verdict: {fmt(d.caiScore)} ≥ 7.5 → Green Light · alignment cap not triggered ({fmt(A)} ≥ 6.0)</>}
              {d.caiStatus === "Proceed with Caution" && (capTriggered
                ? <>verdict: sum {fmt(cmsSum)} ≥ 7.5 but Alignment {fmt(A)} &lt; 6.0 → <span className="text-amber-400">capped to Proceed with Caution</span></>
                : <>verdict: 6.0 ≤ {fmt(d.caiScore)} &lt; 7.5 → Proceed with Caution</>)}
              {d.caiStatus === "Do Not Proceed" && <>verdict: {fmt(d.caiScore)} &lt; 6.0 → Do Not Proceed</>}
              {" "}· weights: brand-type table{d.weightPriority ? ` · priority “${d.weightPriority}”` : ""}
            </p>
          </ChainRow>

          {/* ── Alignment ── */}
          <ChainRow title="Alignment" tooltipNote="mean(archetype, myth, tribe) + decoding modifier + vocab boost">
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <Term label="archetype" value={d.archetypeMatchScore} />
              <Term label="myth" value={d.mythAlignmentScore} fallback={mythFallback} />
              <Term label="tribe" value={d.tribMatchScore} fallback={mythFallback} />
            </div>
            <div className="font-mono tabular-nums text-xs text-foreground/85">
              mean = {fmt(alignMean)} → + decoding {d.decodingModifier != null && d.decodingModifier >= 0 ? "+" : ""}{fmt(d.decodingModifier)} → + vocab boost +{fmt(vocabBoost)} → {fmt(alignRecon)}
              {" "}· stored {fmt(A)} {alignMatches
                ? <span className="text-foreground/60">✓ exact</span>
                : <span className="text-amber-400">differs — a clamp applied between steps</span>}
            </div>
            {mythFallback && (
              <p className="text-xs text-amber-400/90">
                myth and tribe were never computed — the 3.0s are fallbacks (see Trust), so two of
                Alignment's three terms carry no information about this pair.
              </p>
            )}
          </ChainRow>

          {/* ── Pulse ── */}
          <ChainRow title="Pulse" tooltipNote="Rogers base + liminal, then brand blend when brand fields exist">
            <div className="font-mono tabular-nums text-xs text-foreground/85">
              creator side: Rogers {fmt(d.rogersBaseScore)} + liminal +{fmt(d.liminalAdjustment)} = {fmt(pulseCreatorSide)}
              {" "}· stored {fmt(P)} {pulseExact && (
                /* Equality proves the value didn't move — NOT that no step ran.
                   When the brand carries its own Rogers+Turner the blend fired;
                   say so instead of inferring absence from equality. */
                brandHasPulseSide
                  ? <span className="text-foreground/60">✓ equals the creator side — the 60/40 brand blend applied ({String(brand?.brandRogersAdopterStage)} + {String(brand?.brandTurnerLiminalPhase)}) and left the value unchanged</span>
                  : <span className="text-foreground/60">✓ exact — no blend or boost applied</span>
              )}
            </div>
            {!pulseExact && (
              <p className={T_DETAIL}>
                the difference is{" "}
                {brandHasPulseSide
                  ? <>the 60/40 brand blend (brand: {String(brand?.brandRogersAdopterStage)} + {String(brand?.brandTurnerLiminalPhase)})</>
                  : <>a step whose inputs are no longer visible</>}
                {" "}— the blend's intermediate value is not persisted; the stored result is authoritative.
                The TikTok boost requires brand post frequency, which is not captured, so it cannot have fired.
              </p>
            )}
          </ChainRow>

          {/* ── Stability ── */}
          <ChainRow title="Stability" tooltipNote="(Goffman + drift) ÷ 2, then boosts, blend, sentiment">
            <div className="font-mono tabular-nums text-xs text-foreground/85">
              (Goffman {fmt(d.goffmanScore)} + drift {fmt(d.driftScore)}) ÷ 2 = {fmt(stabBase)}
              {sentPenalty !== 0 && <> · sentiment {sentPenalty > 0 ? "+" : ""}{fmt(sentPenalty)}</>}
              {" "}· stored {fmt(S)}{S === 10 && <span className="text-foreground/60"> (ceiling 10)</span>}
            </div>
            <p className={T_DETAIL}>
              steps between base and stored result:{" "}
              {[
                brandHasFollowers && "TikTok follower boost (value not persisted)",
                brandHasStabSide && `50/50 brand blend (brand: ${String(brand?.brandGoffmanStageConsistency)} + ${String(brand?.brandDriftSignal)})`,
                sentPenalty !== 0 && `sentiment modifier ${sentPenalty > 0 ? "+" : ""}${fmt(sentPenalty)} (stored)`,
              ].filter(Boolean).join(" · ") || "none — base is the result"}
            </p>
          </ChainRow>

          {/* ── PARR ── */}
          {d.parrScore != null && (
            <ChainRow title="PARR" tooltipNote="five weighted signals × 10">
              {havePb ? (
                <div className="font-mono tabular-nums text-xs text-foreground/85 leading-relaxed">
                  <span className={mythFallback ? "text-amber-400" : ""}>tribe {fmt(pb!.tribeOverlap)}×0.30</span>
                  {" + "}decoding {fmt(pb!.decodingAcceptance)}×0.25
                  {" + "}archetype {fmt(pb!.archetypeResonance)}×0.20
                  {" + "}vocab {fmt(pb!.symbolicOverlap)}×0.15
                  {" + "}persona {fmt(pb!.personaConsistency)}×0.10
                  {" = "}{fmt((parrRecon ?? 0) / 10, 2)} → ×10 = {parrRecon}
                  {" "}· stored {Math.round(d.parrScore)} {parrMatches
                    ? <span className="text-foreground/60">✓ exact</span>
                    : <span className="text-amber-400">differs — see stored value</span>}
                </div>
              ) : (
                <p className={T_DETAIL}>PARR breakdown not persisted on this match — stored PARR {Math.round(d.parrScore)}.</p>
              )}
            </ChainRow>
          )}

          {/* ── QoV + modifiers ── */}
          <ChainRow title="QoV & modifiers">
            <p className={`${T_DETAIL}`}>
              QoV {d.qovScore != null ? `${fmt(d.qovScore, 1)}%` : "—"} = (pre-modifier CMS ÷ 10) × PARR — the
              pre-modifier CMS is not persisted (recorded engine behavior), so this line is not
              recomputable from stored values.
            </p>
            <p className={T_DETAIL}>
              {(d.mentionSentimentPenalty ?? 0) !== 0 || (d.mentionVocabBoost ?? 0) !== 0
                ? <>modifiers fired: sentiment {fmt(d.mentionSentimentPenalty)} → Stability · vocabulary +{fmt(d.mentionVocabBoost)} → Alignment</>
                : <>no mention modifiers fired (sentiment 0.00 · vocabulary 0.00)</>}
            </p>
          </ChainRow>
        </div>
      )}
    </div>
  );
}

// ─── §3 · TRUST — the input account ──────────────────────────────────────────

function InputRow({ name, value, status, tone = TONE_NEUTRAL }: {
  name: string; value: string; status: string; tone?: string;
}) {
  return (
    <div className="grid grid-cols-[minmax(140px,190px)_1fr_auto] gap-3 items-baseline py-1.5 border-b border-border/25 last:border-0">
      <span className={T_LABEL}>{name}</span>
      <span className="text-xs text-foreground/80">{value}</span>
      <Pill tone={tone}>{status}</Pill>
    </div>
  );
}

function InputAccount({ d, creator, brand }: { d: MatchBodyData; creator: Profile; brand: Profile }) {
  const mythFallback = d.degradationReasons.some(r =>
    r.includes("mythAlignmentScore") || r.includes("myth/tribe"));
  const c = creator ?? {};
  const b = brand ?? {};
  const field = (v: unknown, dflt: string): [string, string, string] =>
    v != null && v !== "" ? [String(v), "extracted", TONE_NEUTRAL] : [`(default: ${dflt})`, "defaulted", TONE_AMBER];

  const rows: Array<{ name: string; value: string; status: string; tone: string }> = [];
  const push = (name: string, [value, status, tone]: [string, string, string]) => rows.push({ name, value, status, tone });

  push("Creator archetype", field(c.archetype, "The Everyman"));
  push("Creator Goffman", field(c.goffmanStageConsistency, "Consistent"));
  push("Creator drift", field(c.driftSignal, "Zero Change"));
  push("Creator decoding", field(c.stuartHallDecoding, "Dominant"));
  push("Creator Rogers", field(c.rogersAdopterStage, "Early Majority"));
  push("Creator Turner", field(c.turnerLiminalPhase, "Pre-Liminal"));
  push("Creator niche position", field(c.creatorNichePosition, "Consistent"));
  push("Creator cultural capital", field(c.culturalCapital, "—, prompt context only"));
  rows.push({
    name: "Creator myth sentence",
    value: c.barthesMyth ? "present" : "missing",
    status: c.barthesMyth ? "input to LLM" : "missing → fallback path",
    tone: c.barthesMyth ? TONE_NEUTRAL : TONE_AMBER,
  });
  rows.push({
    name: "Myth + tribe scores",
    value: mythFallback ? "3.0 / 3.0" : `${fmt(d.mythAlignmentScore)} / ${fmt(d.tribMatchScore)}`,
    status: mythFallback ? "FALLBACK — not computed" : "LLM-judged",
    tone: mythFallback ? TONE_AMBER : TONE_NEUTRAL,
  });
  push("Brand archetype", field(b.archetype, "The Everyman"));
  push("Brand type (weights)", field(b.brandType, "Retail — Local Boutique"));
  rows.push({
    name: "Brand framework fields",
    value: b.brandGoffmanStageConsistency
      ? `${b.brandGoffmanStageConsistency} · ${b.brandDriftSignal ?? "—"} · ${b.brandStuartHallDecoding ?? "—"} · ${b.brandRogersAdopterStage ?? "—"} · ${b.brandTurnerLiminalPhase ?? "—"}`
      : "absent",
    status: b.brandGoffmanStageConsistency ? "bilateral blends active" : "creator-only scoring",
    tone: TONE_NEUTRAL,
  });
  rows.push({
    name: "Brand TikTok metrics",
    value: b.tiktokAudienceSize != null || b.tiktokEngagementRate != null
      ? `${b.tiktokAudienceSize != null ? Number(b.tiktokAudienceSize).toLocaleString() + " followers" : "followers unknown"} · ${b.tiktokEngagementRate != null ? Number(b.tiktokEngagementRate).toFixed(1) + "%" : "rate unknown"}`
      : "not captured",
    status: b.tiktokAudienceSize != null ? "stability boost active" : "boosts inactive",
    tone: TONE_NEUTRAL,
  });
  rows.push({
    name: "Brand mention data",
    value: b.mentionSentiment
      ? `${b.mentionSentiment} sentiment (${b.mentionSentimentConfidence ?? "?"} confidence) · ${b.mentionTotalCount ?? 0} mentions`
      : "not captured",
    status: b.mentionSentiment ? "modifiers active" : "modifiers inactive",
    tone: TONE_NEUTRAL,
  });

  return (
    <div className="space-y-0">
      {rows.map(r => <InputRow key={r.name} name={r.name} value={r.value} status={r.status} tone={r.tone} />)}
      <p className={`${T_DETAIL} pt-2`}>
        “defaulted” means the engine received its optimistic default because the scored observation
        carries no value — the score moved without evidence. Values read from the scored
        observations themselves, not from today's profiles.
      </p>
    </div>
  );
}

// ─── §4 · the exchange table (neutralised) ───────────────────────────────────

function ExchangeTable({ creator, brand }: { creator: Profile; brand: Profile }) {
  const c = creator ?? {}; const b = brand ?? {};
  const creatorMusic = (() => {
    const ts = (c.transcripts as Array<Record<string, any>> | null) ?? [];
    const sounds = ts.map(t => t.musicMetadata?.soundName).filter(Boolean) as string[];
    return sounds.length ? sounds.slice(0, 3).join(", ") : "—";
  })();
  const brandMusic = (() => {
    const m = b.mentionMusicSignals;
    const arr = Array.isArray(m) ? m : (typeof m === "string" && m ? [m] : []);
    return arr.length ? arr.slice(0, 3).join(", ") : "—";
  })();
  const num = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : `${(n / 1000).toFixed(0)}K`;

  const rows: Array<[string, string, string]> = [
    ["Archetype", c.archetype ?? "—", b.archetype ?? "—"],
    ["Audience", c.audienceRelationshipType
      ? `${c.audienceRelationshipType} relationship${c.followerCount ? ` · ${num(c.followerCount)} followers` : ""}`
      : c.followerCount ? `${num(c.followerCount)} followers` : "—",
      b.audienceTribe ?? "—"],
    ["Tone", c.toneRegister ?? "—", b.brandTone ?? "—"],
    ["Myth", c.barthesMyth ?? "—", b.barthesMyth ?? "—"],
    ["Musical leanings", creatorMusic, brandMusic],
    ["Style", (() => { const r = c.recurringThemes; const t = Array.isArray(r) ? r : (typeof r === "string" && r ? [r] : []); return t.length ? t.slice(0, 3).join(", ") : "—"; })(),
      (() => { const r = b.visualLanguage; const v = Array.isArray(r) ? r : (typeof r === "string" && r ? [r] : []); return v.length ? v.join(", ") : "—"; })()],
    ["Reach", c.followerCount ? `${num(c.followerCount)} followers` : "—",
      b.tiktokAudienceSize ? `${num(Number(b.tiktokAudienceSize))} TikTok followers`
        : (b.mentionTotalCount ?? 0) > 0 ? `${b.mentionTotalCount} audience mentions found` : "—"],
    ["Engagement", c.engagementRate != null ? `${Number(c.engagementRate).toFixed(1)}% engagement rate`
      : c.engagementQualityScore != null ? `${Math.round(Number(c.engagementQualityScore) * 100)}% engagement quality` : "—",
      b.tiktokEngagementRate != null ? `${Number(b.tiktokEngagementRate).toFixed(1)}% TikTok engagement`
        : b.overallRating != null ? `${Number(b.overallRating).toFixed(1)}★ avg rating (${b.totalReviews ?? 0} reviews)` : "—"],
    ["Audience trust", c.parasocialBondStrength != null ? `${Number(c.parasocialBondStrength).toFixed(1)}/5 parasocial bond` : "—",
      (() => {
        const s = b.mentionSentiment; const r = b.overallRating;
        if (s && s !== "insufficient_data") {
          const sl = s === "positive" ? "Positive" : s === "mixed" ? "Mixed" : "Negative";
          return r != null ? `${sl} audience sentiment · ${Number(r).toFixed(1)}★` : `${sl} audience sentiment`;
        }
        return r != null ? `${Number(r).toFixed(1)}★ avg rating` : "—";
      })()],
  ];

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr>
            <th className={`text-left ${T_MICRO} py-2 pr-4 w-1/4 font-semibold`}>Trait</th>
            {/* Identity headers are CATEGORICAL — which side of the match —
                so they are neutral; the old blue/emerald dots said nothing
                the names don't. */}
            <th className={`text-left ${T_MICRO} py-2 px-3 w-[37.5%] font-semibold normal-case tracking-normal`}>@{c.handle ?? "creator"} (creator)</th>
            <th className={`text-left ${T_MICRO} py-2 px-3 w-[37.5%] font-semibold normal-case tracking-normal`}>{b.brandName ?? "brand"} (brand)</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/30">
          {rows.map(([trait, cv, bv]) => (
            <tr key={trait}>
              <td className={`py-2.5 pr-4 align-top ${T_MICRO}`}>{trait}</td>
              <td className="py-2.5 px-3 align-top text-xs text-foreground/80 leading-relaxed">
                {trait === "Archetype" && cv !== "—"
                  ? <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium border ${CHIP_NEUTRAL}`}>{cv}</span>
                  : trait === "Myth" && cv !== "—" ? <span className="italic text-foreground/70">{cv}</span> : cv}
              </td>
              <td className="py-2.5 px-3 align-top text-xs text-foreground/80 leading-relaxed">
                {trait === "Archetype" && bv !== "—"
                  ? <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium border ${CHIP_NEUTRAL}`}>{bv}</span>
                  : trait === "Myth" && bv !== "—" ? <span className="italic text-foreground/70">{bv}</span> : bv}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── §5 · cost and process ───────────────────────────────────────────────────

function secs(ms: number | null): string {
  if (ms == null) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}
function usd(n: number): string {
  return n < 0.01 ? `~$${n.toFixed(4)}` : `~$${n.toFixed(2)}`;
}

function CostSection({ llm, createdAt }: { llm: MatchLlmAccount | null; createdAt: string | Date | null }) {
  if (!llm) {
    return (
      <Note kind="caveat">
        No cost account exists — this result was not persisted, so its LLM calls were never linked.
      </Note>
    );
  }
  if (!llm.linked || !llm.totals) {
    return (
      <Note kind="caveat">
        Cost unavailable — LLM calls not linked (pre-M1). The linkage was wired forward-only;
        matches persisted before it, and calls whose matches were later deleted, cannot be
        attributed. This is absence of linkage, not zero cost.
      </Note>
    );
  }

  // Wall-clock: the RECORDED SPAN — first call start (createdAt − duration) to
  // the match row's persist time. Deliberately NOT "time to compute": queue
  // wait and inter-call gaps are inside it.
  const starts = llm.calls
    .map(c => new Date(c.createdAt).getTime() - (c.durationMs ?? 0));
  const spanMs = createdAt && starts.length
    ? Math.max(0, new Date(createdAt).getTime() - Math.min(...starts))
    : null;

  return (
    <div className="space-y-3">
      <div className={`grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3 p-4 ${BOX}`}>
        <div>
          <div className={T_MICRO}>Model calls</div>
          <div className="text-lg font-semibold tabular-nums text-foreground/85 mt-0.5">{llm.totals.calls}</div>
        </div>
        <div>
          <div className={T_MICRO}>Tokens in / out</div>
          <div className="text-lg font-semibold tabular-nums text-foreground/85 mt-0.5">
            {llm.totals.inputTokens.toLocaleString()} / {llm.totals.outputTokens.toLocaleString()}
          </div>
        </div>
        <div>
          <div className={T_MICRO}>Est. cost</div>
          <div className="text-lg font-semibold tabular-nums text-foreground/85 mt-0.5">{usd(llm.totals.costUsd)}</div>
        </div>
        <div>
          <div className={T_MICRO}>Recorded span</div>
          <div className="text-lg font-semibold tabular-nums text-foreground/85 mt-0.5">{spanMs != null ? secs(spanMs) : "—"}</div>
        </div>
      </div>

      <div className="space-y-1">
        {llm.calls.map((c, i) => (
          <div key={i} className={`grid grid-cols-[1fr_auto_auto_auto] gap-3 items-baseline py-1.5 border-b border-border/25 last:border-0`}>
            <span className="text-xs font-mono text-foreground/75 truncate">{c.purpose}</span>
            <span className={`${T_DETAIL} tabular-nums`}>{c.model}</span>
            <span className={`${T_DETAIL} tabular-nums`}>{(c.inputTokens ?? 0).toLocaleString()} in · {(c.outputTokens ?? 0).toLocaleString()} out · {secs(c.durationMs)}</span>
            <span className={`${T_DETAIL} tabular-nums`}>{c.costUsd != null ? usd(c.costUsd) : "—"}</span>
          </div>
        ))}
      </div>

      <Note kind="context">
        The dollar figure is computed from token counts at published rates as of{" "}
        <span className="font-mono">{PRICING_AS_OF}</span> ({Object.values(MODEL_PRICING).map(m => m.label).join(", ")}) —
        an estimate, not a recorded charge. “Recorded span” runs from the first call's start to the
        match's persist time — it is not time-to-compute; queue wait and inter-call gaps are inside
        it. Failed calls are not linked; the degradation record in Trust names them.
      </Note>
    </div>
  );
}

// ─── The body ────────────────────────────────────────────────────────────────

export function MatchReportBody({
  d, creator, brand, provenance, llm, view, comparables,
}: {
  d: MatchBodyData;
  creator: Profile;
  brand: Profile;
  provenance: ProfileProvenance;
  llm: MatchLlmAccount | null;
  view: "calculation" | "record";
  comparables?: Array<{ match: Record<string, any>; creator: Record<string, any> | null; brand: Record<string, any> | null }>;
}) {
  // The eight signals, built ONCE for both surfaces (M2 rules intact:
  // null renders as absence; the cultural trio is Derived).
  const signals: Signal[] = [
    ...d.performanceSignals.map(s => ({ ...s, category: "Performance" as const })),
    {
      name: "Cultural Identity", score: d.alignment != null ? d.alignment * 10 : null,
      confidence: "Derived" as const, category: "Cultural" as const,
      reasoning: "The Alignment sub-score ×10 — the score above rescaled, not an independent measurement.",
    },
    {
      name: "Cultural Momentum", score: d.pulse != null ? d.pulse * 10 : null,
      confidence: "Derived" as const, category: "Cultural" as const,
      reasoning: "The Pulse sub-score ×10 — the score above rescaled, not an independent measurement.",
    },
    {
      name: "Partnership Stability", score: d.stability != null ? d.stability * 10 : null,
      confidence: "Derived" as const, category: "Cultural" as const,
      reasoning: "The Stability sub-score ×10 — the score above rescaled, not an independent measurement.",
    },
  ];
  const anySignal = signals.some(s => s.score != null);

  const notes = d.alignmentNotes ?? {};
  const noteLabels: Record<string, string> = {
    archetypeAnalysis: "Archetype analysis", mythAlignment: "Myth alignment",
    audienceOverlap: "Audience overlap", culturalMomentum: "Cultural momentum",
    identityStability: "Identity stability", recommendation: "Recommendation",
  };
  const noteEntries = Object.entries(notes).filter(([, v]) => v);

  return (
    <div className="space-y-0">
      {/* ══ 1 EXECUTIVE ═══════════════════════════════════════════════════ */}
      <Section n={1} title="Executive summary" blurb="the verdict, scannable in seconds" icon={Layers}>
        <div className="space-y-4">
          {/* Degradation reads WITHOUT opening anything. */}
          {(d.scoreDegraded || d.degradationReasons.length > 0) && (
            <div className="space-y-1.5">
              <Note kind="warning">
                {d.scoreDegraded
                  ? "Score degraded — parts of this number are fallbacks, not computations. The arithmetic below marks which."
                  : "Calculation note — see the reasons below."}
              </Note>
              {d.degradationReasons.map((r, i) => <Note key={i} kind="caveat">{r}</Note>)}
            </div>
          )}

          <div className="flex items-end gap-4 flex-wrap">
            <div>
              <div className={T_MICRO}>Cultural Match Score</div>
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-semibold tabular-nums text-foreground">{fmt(d.caiScore)}</span>
                <span className={T_DETAIL}>/ 10</span>
              </div>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap pb-1">
              <Pill tone={VERDICT_TONE[d.caiStatus] ?? TONE_NEUTRAL}>{d.caiStatus}</Pill>
              {d.dataConfidenceLevel && (
                <Pill tone={CONFIDENCE_TONE[d.dataConfidenceLevel] ?? TONE_NEUTRAL}>
                  {d.dataConfidenceLevel} confidence
                </Pill>
              )}
              {d.scoreDegraded && <Pill tone={TONE_AMBER}>degraded</Pill>}
            </div>
          </div>

          {/* The three sub-scores + weights; the working lives in §2. */}
          <div className={`grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-3 p-4 ${BOX}`}>
            {[
              { label: "Alignment (α)", v: d.alignment, w: d.weightAlpha },
              { label: "Pulse (β)", v: d.pulse, w: d.weightBeta },
              { label: "Stability (γ)", v: d.stability, w: d.weightGamma },
            ].map(s => (
              <div key={s.label}>
                <div className={T_MICRO}>{s.label}</div>
                <div className="flex items-baseline gap-2 mt-0.5">
                  <span className="text-xl font-semibold tabular-nums text-foreground/90">{fmt(s.v, 1)}</span>
                  <span className={`${T_DETAIL} tabular-nums`}>× weight {fmt(s.w, 1)}</span>
                </div>
              </div>
            ))}
          </div>

          {/* PARR + QoV headline; detail and arithmetic in §2. */}
          <div className="flex items-center gap-2 flex-wrap">
            {d.parrScore != null ? (
              <Pill tone={PARR_TONE(d.parrScore)} title="Predicted Audience Receptivity Rate — a structural index, §2 has the working">
                PARR {Math.round(d.parrScore)} · {d.parrLabel ?? ""}
              </Pill>
            ) : (
              <Pill tone={TONE_NEUTRAL}>PARR not computed on this match</Pill>
            )}
            {d.qovScore != null && (
              <Pill tone={TONE_NEUTRAL} title="CMS × PARR — a convenience composite">QoV {fmt(d.qovScore, 1)}%</Pill>
            )}
            <span className="ml-auto flex items-center gap-2 flex-wrap">
              {creator?.archetype && (
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] ${CHIP_NEUTRAL}`}>{creator.archetype}</span>
              )}
              <span className="text-muted-foreground/40 text-xs">×</span>
              {brand?.archetype && (
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] ${CHIP_NEUTRAL}`}>{brand.archetype}</span>
              )}
            </span>
          </div>
        </div>
      </Section>

      {/* ══ 2 DETAILED ANALYSIS ═══════════════════════════════════════════ */}
      <Section n={2} title="Detailed analysis" blurb="the arithmetic, the signals, the findings" icon={FileText}>
        <div className="space-y-5">
          <ScoreArithmetic d={d} creator={creator} brand={brand} />

          {/* Warnings — one legend, both surfaces. */}
          {d.radarWarnings.length > 0 ? (
            <div className="space-y-2">
              <h3 className={T_SUB}>Radar warnings ({d.radarWarnings.length})</h3>
              {d.radarWarnings.map(w => <WarningRow key={w} warning={w} />)}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-muted-foreground/50" />
              <span className={T_DETAIL}>No radar warnings — none of the seven conditions fired.</span>
            </div>
          )}

          {/* The eight signals. Part 4: absence is visible even when ALL are null. */}
          {anySignal ? (
            <SignalPanel signals={signals} />
          ) : (
            <Note kind="caveat">
              None of the eight signals were computed for this match — it predates signal
              computation. No numbers are substituted.
            </Note>
          )}

          {/* Shared vocabulary — rank order, no shuffle, neutral chips. */}
          <div>
            <div className="flex items-baseline gap-2 mb-1.5">
              <h3 className={T_SUB}>Shared vocabulary</h3>
              <span className={`${T_DETAIL} tabular-nums`}>
                {d.symbolicOverlapScore != null ? `overlap ${fmt(d.symbolicOverlapScore, 1)}/10 (Jaccard ×33.3, capped)` : "overlap not persisted"}
              </span>
            </div>
            {d.sharedKeywords.length > 0 || d.sharedThemes.length > 0 ? (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-1">
                  {d.sharedKeywords.map(k => (
                    <span key={k} className={`px-2 py-0.5 rounded-md text-xs border ${CHIP_NEUTRAL}`}>{k}</span>
                  ))}
                </div>
                {d.sharedThemes.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {d.sharedThemes.map(t => (
                      <span key={t} className={`px-2 py-0.5 rounded-full text-[11px] border ${CHIP_NEUTRAL}`}>theme · {t}</span>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <p className={`${T_DETAIL} italic`}>No shared keywords or themes were found between the two vocabularies.</p>
            )}
          </div>

          {/* Narratives */}
          {d.narrativeSummary && (
            <div>
              <h3 className={`${T_SUB} mb-1.5`}>Analyst summary</h3>
              <p className={`${T_BODY} max-w-3xl`}>{d.narrativeSummary}</p>
            </div>
          )}
          {d.synergyNarrative && (
            <div>
              <h3 className={`${T_SUB} mb-1.5`}>Synergy brief</h3>
              <p className={`${T_BODY} max-w-3xl`}>{d.synergyNarrative}</p>
            </div>
          )}
          {(d.alignmentNarrative || (d.culturalVelocity && d.culturalVelocity !== "Insufficient Data")) && (
            <div className="space-y-2">
              {d.alignmentNarrative && (
                <div>
                  <h3 className={`${T_SUB} mb-1.5`}>Alignment narrative</h3>
                  <p className={`${T_BODY} max-w-3xl`}>{d.alignmentNarrative}</p>
                  <div className="mt-1.5">
                    <Note kind="caveat">
                      Known defect J-1: this narrative's opening strength phrase compares a 0–10
                      score against 80/60 thresholds and therefore always reads “weak” — disregard
                      that word; the archetype arithmetic above is the real reading.
                    </Note>
                  </div>
                </div>
              )}
              {d.culturalVelocity && (
                d.culturalVelocity === "Drifting"
                  ? <Note kind="warning">Cultural velocity: Drifting — the creator's themes are shifting; identity may be in transition.</Note>
                  : <Note kind="context">Cultural velocity: {d.culturalVelocity}{d.culturalVelocity === "Focusing" ? " — identity sharpening over time." : ""}</Note>
              )}
            </div>
          )}

          {/* Content directions — full detail incl. example angle. */}
          {d.contentDirections.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <Lightbulb className="w-3.5 h-3.5 text-muted-foreground/50" />
                <h3 className={T_SUB}>Content directions ({d.contentDirections.length})</h3>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {d.contentDirections.map((dir, i) => (
                  <div key={i} className={`p-3 ${BOX} flex flex-col gap-1.5`}>
                    <div className="text-sm font-semibold text-foreground/90">{dir.title}</div>
                    <p className={T_DETAIL}>{dir.rationale}</p>
                    {dir.exampleAngle && (
                      <div className="mt-auto pt-1.5 border-t border-border/30">
                        <div className={`${T_MICRO} mb-0.5`}>Example angle</div>
                        <p className={`${T_DETAIL} italic`}>{dir.exampleAngle}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Alignment notes */}
          {noteEntries.length > 0 && (
            <Disclosure label="Alignment notes" summary={`${noteEntries.length} analyst notes, incl. recommendation`}>
              <div className="space-y-3">
                {noteEntries.map(([key, value]) => (
                  <div key={key}>
                    <div className={`${T_MICRO} mb-0.5`}>{noteLabels[key] ?? key}</div>
                    <p className={`${T_DETAIL} text-foreground/75`}>{value}</p>
                  </div>
                ))}
              </div>
            </Disclosure>
          )}
        </div>
      </Section>

      {/* ══ 3 TRUST ═══════════════════════════════════════════════════════ */}
      <Section n={3} title="Trust" blurb="how far to believe this number, and why" icon={Shield}>
        <div className="space-y-4">
          <div className="space-y-1.5">
            {d.scoreDegraded || d.degradationReasons.length > 0 ? (
              d.degradationReasons.map((r, i) => <Note key={i} kind="warning">{r}</Note>)
            ) : (
              <Note kind="context">No degradation recorded — every score component was computed, none fell back.</Note>
            )}
          </div>

          <Disclosure label="Input account" summary="every engine input — extracted, defaulted, or fallback" defaultOpen={d.scoreDegraded}>
            <InputAccount d={d} creator={creator} brand={brand} />
          </Disclosure>

          <Disclosure label="Evidence identity" summary={
            provenance === "calculation"
              ? "scored against the profiles loaded for this calculation"
              : `creator ${provenance.creator} · brand ${provenance.brand}`
          }
            /* Anything other than fully-scored is a warning-class fact — the
               evidence on this page may not be what the score saw. It opens. */
            defaultOpen={provenance !== "calculation" && (provenance.creator !== "scored" || provenance.brand !== "scored")}>
            <div className="space-y-2">
              {provenance === "calculation" ? (
                <p className={T_DETAIL}>
                  This is the calculation view — the score was just computed against the exact
                  profiles shown in §4. Once persisted, the record pins to these observations.
                </p>
              ) : (
                <>
                  {provenance.creator === "scored" && provenance.brand === "scored" ? (
                    <p className={T_DETAIL}>
                      The profiles in §4 are the exact observations this score was computed from —
                      re-analysis cannot silently swap the evidence under this number.
                    </p>
                  ) : (
                    <Note kind="warning">
                      {[
                        provenance.creator === "latest-fallback" && "The creator side predates observation tagging — §4 shows the LATEST creator data, which may differ from what was scored.",
                        provenance.creator === "missing" && "The scored creator observation no longer exists; its evidence cannot be shown and the latest is deliberately not substituted.",
                        provenance.brand === "latest-fallback" && "The brand side predates observation tagging — §4 shows the LATEST brand data, which may differ from what was scored.",
                        provenance.brand === "missing" && "The scored brand observation no longer exists; its evidence cannot be shown and the latest is deliberately not substituted.",
                      ].filter(Boolean).join(" ")}
                    </Note>
                  )}
                  <div className="font-mono text-xs text-muted-foreground/70 space-y-0.5">
                    <div>creator observation &nbsp;{d.creatorObservationId ?? "not recorded (pre-tagging)"}</div>
                    <div>brand observation &nbsp;&nbsp;&nbsp;{d.brandObservationId ?? "not recorded (pre-tagging)"}</div>
                    <div>scored &nbsp;{d.createdAt ? new Date(d.createdAt).toISOString() : "—"}</div>
                  </div>
                </>
              )}
            </div>
          </Disclosure>

          <Note kind="context">
            Data confidence “{d.dataConfidenceLevel ?? "unknown"}” is the creator run's confidence at
            scoring time, carried onto the match — not a judgement of this pairing.
          </Note>
          <Note kind="context">
            Known defect J-3: the brand profile's stored α/β/γ include the campaign-type modifier;
            scoring reads the brand-type table without it. The weights in §2's arithmetic are the
            ones actually used.
          </Note>
        </div>
      </Section>

      {/* ══ 4 SUPPORT ═════════════════════════════════════════════════════ */}
      <Section n={4} title="Support" blurb="the evidence underneath the score" icon={Film}>
        <div className="space-y-2">
          <Disclosure label="Side-by-side traits" summary="9 traits — archetype, audience, tone, myth, music, style, reach, engagement, trust" defaultOpen>
            <ExchangeTable creator={creator} brand={brand} />
          </Disclosure>

          <Disclosure label="Music overlap"
            summary={d.musicOverlap && d.musicOverlap.overlapStrength !== "none"
              ? `${d.musicOverlap.overlapStrength} · ${d.musicOverlap.sharedTitles.length} shared title${d.musicOverlap.sharedTitles.length === 1 ? "" : "s"} · ${d.musicOverlap.sharedArtists.length} artist${d.musicOverlap.sharedArtists.length === 1 ? "" : "s"}`
              : "none found"}>
            {d.musicOverlap && d.musicOverlap.overlapStrength !== "none" ? (
              <div className="space-y-2">
                <p className={T_DETAIL}>
                  Creator and brand-audience music taste overlap — a non-scoring signal.
                </p>
                <div className="flex flex-wrap gap-1">
                  {d.musicOverlap.sharedTitles.map(t => (
                    <span key={t} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs border ${CHIP_NEUTRAL}`}>
                      <Music className="w-3 h-3" />{t}
                    </span>
                  ))}
                  {d.musicOverlap.sharedArtists.map(a => (
                    <span key={a} className={`px-2 py-0.5 rounded-md text-xs border ${CHIP_NEUTRAL}`}>{a}</span>
                  ))}
                </div>
              </div>
            ) : (
              <p className={`${T_DETAIL} italic`}>No shared music titles or artists between creator content and brand mentions.</p>
            )}
          </Disclosure>

          {(() => {
            const raw = brand?.mentionHashtagCloud;
            const tags: string[] = Array.isArray(raw) ? raw : (typeof raw === "string" && raw ? [raw] : []);
            return (
              <Disclosure label="How audiences talk about the brand" summary={`${tags.length} mention hashtags`}>
                {tags.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {tags.slice(0, 20).map(tag => (
                      <span key={tag} className="px-1.5 py-0.5 rounded text-[10px] border border-border/40 bg-secondary/40 text-muted-foreground/70">
                        <Hash className="w-2.5 h-2.5 inline mr-0.5" />{String(tag).replace(/^#/, "")}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className={`${T_DETAIL} italic`}>No mention hashtags captured for this brand.</p>
                )}
              </Disclosure>
            );
          })()}

          <Disclosure label="What the brand is borrowing" summary={d.culturalBorrowingSummary ? "model-written summary" : "auto-assembled from profile fields"}>
            {d.culturalBorrowingSummary ? (
              <p className={`${T_BODY} italic`}>“{d.culturalBorrowingSummary}”</p>
            ) : (
              <div className="space-y-1.5">
                <p className={T_DETAIL}>
                  By partnering with @{creator?.handle}, {brand?.brandName} borrows the creator's{" "}
                  {creator?.archetype?.toLowerCase() ?? "distinct"} archetype and their audience's trust —
                  two things the brand cannot self-generate.
                </p>
                <Note kind="context">
                  Auto-assembled from profile fields — no model-written borrowing summary was stored
                  for this match.
                </Note>
              </div>
            )}
          </Disclosure>

          <Disclosure label="Creator profile" summary={`@${creator?.handle ?? "unknown"} · ${creator?.archetype ?? "—"} · ${provenance === "calculation" ? "as loaded for this calculation" : provenance.creator === "scored" ? "the scored observation" : "latest (see Trust)"}`}>
            {creator
              ? <CreatorProfileCard profile={creator as any} compact />
              : <p className={`${T_DETAIL} italic`}>The scored creator observation is unavailable (see Trust).</p>}
          </Disclosure>

          <Disclosure label="Brand profile" summary={`${brand?.brandName ?? "unknown"} · ${brand?.archetype ?? "—"} · ${provenance === "calculation" ? "as loaded for this calculation" : provenance.brand === "scored" ? "the scored observation" : "latest (see Trust)"}`}>
            {brand
              ? <BrandProfileCard profile={brand as any} compact />
              : <p className={`${T_DETAIL} italic`}>The scored brand observation is unavailable (see Trust).</p>}
          </Disclosure>

          {view === "record" && comparables && comparables.length > 0 && (
            <Disclosure label="Comparable partnerships" summary={`${comparables.length} similar matches in the corpus`}>
              <div className="space-y-1">
                {comparables.map(({ match: cm, creator: cc, brand: cb }) => (
                  <Link key={cm.id} href={`/report/${cm.id}`}>
                    <div className="flex items-center gap-3 py-2 border-b border-border/25 last:border-0 hover:bg-secondary/20 transition-colors cursor-pointer px-1 rounded">
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium text-foreground/85 truncate">@{cc?.handle} × {cb?.brandName}</div>
                        <div className={T_DETAIL}>{cb?.brandType ?? "—"} · {cc?.archetype ?? "—"}</div>
                      </div>
                      <span className="font-mono tabular-nums text-sm text-foreground/85">{fmt(Number(cm.caiScore))}</span>
                      <Pill tone={VERDICT_TONE[cm.caiStatus] ?? TONE_NEUTRAL}>{cm.caiStatus}</Pill>
                      {cm.parrScore != null && <span className={`${T_DETAIL} tabular-nums`}>PARR {cm.parrScore}</span>}
                      <ExternalLink className="w-3 h-3 text-muted-foreground/40" />
                    </div>
                  </Link>
                ))}
              </div>
            </Disclosure>
          )}
        </div>
      </Section>

      {/* ══ 5 COST AND PROCESS ════════════════════════════════════════════ */}
      <Section n={5} title="Cost and process" blurb="how this score was produced" icon={Receipt}>
        <CostSection llm={llm} createdAt={d.createdAt} />
      </Section>
    </div>
  );
}
