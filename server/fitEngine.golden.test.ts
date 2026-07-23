/**
 * GOLDEN REGRESSION BASELINE for the frozen scoring engine (`runFullFITCalculation`).
 *
 * These values were RECORDED from the real engine's CURRENT output — they document
 * reality, not correctness. fitEngine is FROZEN: if any assertion here fails, the
 * engine's behavior changed. That is a deliberate-change signal to review with the
 * owner, NOT a test to "fix" by editing the expected value.
 *
 * KNOWN ISSUES intentionally locked in (do NOT fix here — flagged for Jason):
 *   J-1: alignmentNarrative always says "weak archetype alignment" even when
 *        archetypeMatchScore is 10 (resonant). The narrative's ≥80/≥60 thresholds
 *        assume a 0–100 archetype score, but getArchetypeMatchScore returns 0–10,
 *        so the branch is unreachable → always "weak". (fitEngine.ts ~:1000)
 *   J-2: qovScore is computed from the PRE-adjustment caiScore, so it diverges from
 *        the returned (post mention-modifier) caiScore. (fitEngine.ts ~:994)
 *
 * Coverage (10 fixtures): Green/Caution/Do-Not-Proceed tiers; the alignment<6 cap;
 * archetype resonant(10)/complementary(7)/clash(2.5); decoding +0.5/0/-1; default
 * vs non-default (0.6/0.2/0.2) weights; music strong/moderate/none; mention-sentiment
 * penalty positive/negative × high/low confidence and none; mentionVocabBoost; PARR
 * tiers/labels; brand-side framework blending; and every radar warning.
 */

import { describe, it, expect } from "vitest";
import { runFullFITCalculation, type FullFITCalculationInput } from "./fitEngine";

type Golden = {
  caiScore: number;
  caiStatus: "Green Light" | "Proceed with Caution" | "Do Not Proceed";
  alignmentScoreRaw: number;
  pulseScoreRaw: number;
  stabilityScoreRaw: number;
  archetypeMatchScore: number;
  decodingModifier: number;
  weightAlpha: number;
  weightBeta: number;
  weightGamma: number;
  parrScore: number;
  parrLabel: string;
  qovScore: number;
  radarWarnings: string[];
  musicOverlapStrength: "strong" | "moderate" | "none";
  mentionSentimentPenalty: number;
  mentionVocabBoost: number;
};

const CASES: Array<{ name: string; note?: string; input: FullFITCalculationInput; expected: Golden }> = [
  {
    name: "green_resonant",
    note: "same archetype (resonant=10), positive-high sentiment (+0.5), vocab overlap (+1.5), strong music → Green Light",
    input: {
      creatorArchetype: "The Sage", goffmanStageConsistency: "Consistent", driftSignal: "Zero Change",
      stuartHallDecoding: "Dominant", rogersAdopterStage: "Early Majority", turnerLiminalPhase: "Liminal",
      creatorNichePosition: "Ahead", brandArchetype: "The Sage", brandType: "Education / EdTech",
      mythAlignmentScore: 9, tribMatchScore: 9,
      brandTiktokEngagementRate: 8, brandTiktokFollowerCount: 500000, brandTiktokPostFrequency: "daily",
      brandMentionSentiment: "positive", brandMentionSentimentConfidence: "high", brandMentionTotalCount: 40,
      creatorMusicTitles: ["song a", "song b"], creatorMusicArtists: ["Drake"],
      brandMentionMusicTitles: ["song a", "song b"], brandMentionMusicArtists: ["Drake"],
      creatorKeywords: ["learning", "growth"], creatorThemes: ["education"],
      brandMentionHashtags: ["learning"], brandMentionKeywords: ["growth"],
    },
    expected: {
      caiScore: 9.66, caiStatus: "Green Light",
      alignmentScoreRaw: 10, pulseScoreRaw: 8.3, stabilityScoreRaw: 10,
      archetypeMatchScore: 10, decodingModifier: 0.5, weightAlpha: 0.5, weightBeta: 0.2, weightGamma: 0.3,
      parrScore: 82, parrLabel: "High Cultural Legitimacy", qovScore: 78.6,
      radarWarnings: [], musicOverlapStrength: "strong", mentionSentimentPenalty: 0.5, mentionVocabBoost: 1.5,
    },
  },
  {
    name: "below_threshold_do_not_proceed",
    note: "caiScore 5.83 < 6.0 → Do Not Proceed; alignment 5.67 < 6 → Low Alignment warning; complementary archetype (7)",
    input: {
      creatorArchetype: "The Hero", goffmanStageConsistency: "Minor Gap", driftSignal: "Minor Drift",
      stuartHallDecoding: "Negotiated", rogersAdopterStage: "Early Adopters", turnerLiminalPhase: "Pre-Liminal",
      creatorNichePosition: "Consistent", brandArchetype: "The Ruler", brandType: "Financial Services",
      mythAlignmentScore: 5, tribMatchScore: 5,
    },
    expected: {
      caiScore: 5.83, caiStatus: "Do Not Proceed",
      alignmentScoreRaw: 5.666666666666667, pulseScoreRaw: 6, stabilityScoreRaw: 6,
      archetypeMatchScore: 7, decodingModifier: 0, weightAlpha: 0.5, weightBeta: 0.2, weightGamma: 0.3,
      parrScore: 47, parrLabel: "Mixed Signal", qovScore: 27.4,
      radarWarnings: ["Low Alignment"], musicOverlapStrength: "none", mentionSentimentPenalty: 0, mentionVocabBoost: 0,
    },
  },
  {
    name: "clash_all_warnings",
    note: "clashing archetype (2.5), oppositional decoding (-1), Full Pivot, Laggards, Behind, low brand ER, negative-high sentiment → fires ALL 7 radar warnings, Do Not Proceed",
    input: {
      creatorArchetype: "The Jester", goffmanStageConsistency: "Significant Gap", driftSignal: "Full Pivot",
      stuartHallDecoding: "Oppositional", rogersAdopterStage: "Laggards", turnerLiminalPhase: "Pre-Liminal",
      creatorNichePosition: "Behind", brandArchetype: "The Sage", brandType: "Financial Services",
      mythAlignmentScore: 2, tribMatchScore: 2,
      brandMentionSentiment: "negative", brandMentionSentimentConfidence: "high", brandMentionTotalCount: 20,
      brandTiktokEngagementRate: 0.2,
    },
    expected: {
      caiScore: 0.98, caiStatus: "Do Not Proceed",
      alignmentScoreRaw: 1.1666666666666665, pulseScoreRaw: 2, stabilityScoreRaw: 0,
      archetypeMatchScore: 2.5, decodingModifier: -1, weightAlpha: 0.5, weightBeta: 0.2, weightGamma: 0.3,
      parrScore: 12, parrLabel: "Low Legitimacy", qovScore: 1.2,
      radarWarnings: [
        "Low Alignment", "Archetype Tension", "Identity Instability", "Low Pulse",
        "Trajectory Divergence", "Low Social Engagement", "Negative Audience Sentiment",
      ],
      musicOverlapStrength: "none", mentionSentimentPenalty: -3, mentionVocabBoost: 0,
    },
  },
  {
    name: "alignment_cap_fires",
    note: "caiScore 7.66 ≥ 7.5 (would be Green Light) BUT alignment 5.83 < 6 → status CAPPED to Proceed with Caution",
    input: {
      creatorArchetype: "The Hero", goffmanStageConsistency: "Consistent", driftSignal: "Zero Change",
      stuartHallDecoding: "Dominant", rogersAdopterStage: "Early Majority", turnerLiminalPhase: "Liminal",
      creatorNichePosition: "Ahead", brandArchetype: "The Ruler", brandType: "Education / EdTech",
      mythAlignmentScore: 5, tribMatchScore: 4,
      brandTiktokEngagementRate: 12, brandTiktokFollowerCount: 2000000, brandTiktokPostFrequency: "daily",
    },
    expected: {
      caiScore: 7.66, caiStatus: "Proceed with Caution",
      alignmentScoreRaw: 5.833333333333333, pulseScoreRaw: 8.7, stabilityScoreRaw: 10,
      archetypeMatchScore: 7, decodingModifier: 0.5, weightAlpha: 0.5, weightBeta: 0.2, weightGamma: 0.3,
      parrScore: 61, parrLabel: "Moderate Legitimacy", qovScore: 46.7,
      radarWarnings: ["Low Alignment"], musicOverlapStrength: "none", mentionSentimentPenalty: 0, mentionVocabBoost: 0,
    },
  },
  {
    name: "music_strong",
    note: "3 shared artists → music overlap 'strong'",
    input: {
      creatorArchetype: "The Creator", goffmanStageConsistency: "Consistent", driftSignal: "Zero Change",
      stuartHallDecoding: "Dominant", rogersAdopterStage: "Early Majority", turnerLiminalPhase: "Liminal",
      creatorNichePosition: "Consistent", brandArchetype: "The Creator", brandType: "Music / Entertainment",
      mythAlignmentScore: 6, tribMatchScore: 6,
      creatorMusicArtists: ["Drake", "SZA", "Adele"], brandMentionMusicArtists: ["Drake", "SZA", "Adele"],
    },
    expected: {
      caiScore: 8.34, caiStatus: "Green Light",
      alignmentScoreRaw: 7.833333333333333, pulseScoreRaw: 7.5, stabilityScoreRaw: 9.75,
      archetypeMatchScore: 10, decodingModifier: 0.5, weightAlpha: 0.5, weightBeta: 0.2, weightGamma: 0.3,
      parrScore: 73, parrLabel: "Moderate Legitimacy", qovScore: 60.9,
      radarWarnings: [], musicOverlapStrength: "strong", mentionSentimentPenalty: 0, mentionVocabBoost: 0,
    },
  },
  {
    name: "music_moderate_sentiment_negative_lowconf",
    note: "1 shared artist → 'moderate'; negative sentiment at LOW confidence → penalty -0.9 (=-3×0.3) BUT no 'Negative Audience Sentiment' warning (confidence=low is excluded)",
    input: {
      creatorArchetype: "The Explorer", goffmanStageConsistency: "Consistent", driftSignal: "Zero Change",
      stuartHallDecoding: "Negotiated", rogersAdopterStage: "Innovators", turnerLiminalPhase: "Liminal",
      creatorNichePosition: "Consistent", brandArchetype: "The Explorer", brandType: "Travel",
      mythAlignmentScore: 6, tribMatchScore: 6,
      creatorMusicArtists: ["Drake"], brandMentionMusicArtists: ["Drake"],
      brandMentionSentiment: "negative", brandMentionSentimentConfidence: "low", brandMentionTotalCount: 6,
    },
    expected: {
      caiScore: 7.42, caiStatus: "Proceed with Caution",
      alignmentScoreRaw: 7.333333333333333, pulseScoreRaw: 5.5, stabilityScoreRaw: 8.85,
      archetypeMatchScore: 10, decodingModifier: 0, weightAlpha: 0.5, weightBeta: 0.2, weightGamma: 0.3,
      parrScore: 61, parrLabel: "Moderate Legitimacy", qovScore: 46.9,
      radarWarnings: [], musicOverlapStrength: "moderate", mentionSentimentPenalty: -0.8999999999999999, mentionVocabBoost: 0,
    },
  },
  {
    name: "sentiment_positive_lowconf",
    note: "positive sentiment at low confidence → penalty +0.15 (=+0.5×0.3)",
    input: {
      creatorArchetype: "The Caregiver", goffmanStageConsistency: "Consistent", driftSignal: "Zero Change",
      stuartHallDecoding: "Dominant", rogersAdopterStage: "Early Majority", turnerLiminalPhase: "Liminal",
      creatorNichePosition: "Consistent", brandArchetype: "The Caregiver", brandType: "Health / Wellness",
      mythAlignmentScore: 7, tribMatchScore: 7,
      brandMentionSentiment: "positive", brandMentionSentimentConfidence: "low", brandMentionTotalCount: 8,
    },
    expected: {
      caiScore: 8.72, caiStatus: "Green Light",
      alignmentScoreRaw: 8.5, pulseScoreRaw: 7.5, stabilityScoreRaw: 9.9,
      archetypeMatchScore: 10, decodingModifier: 0.5, weightAlpha: 0.5, weightBeta: 0.2, weightGamma: 0.3,
      parrScore: 76, parrLabel: "Moderate Legitimacy", qovScore: 66,
      radarWarnings: [], musicOverlapStrength: "none", mentionSentimentPenalty: 0.15, mentionVocabBoost: 0,
    },
  },
  {
    name: "brand_side_blended",
    note: "brand-side framework fields present → pulse/stability are blended (creator×brand)",
    input: {
      creatorArchetype: "The Ruler", goffmanStageConsistency: "Consistent", driftSignal: "Zero Change",
      stuartHallDecoding: "Dominant", rogersAdopterStage: "Early Majority", turnerLiminalPhase: "Liminal",
      creatorNichePosition: "Consistent", brandArchetype: "The Ruler", brandType: "Luxury",
      mythAlignmentScore: 7, tribMatchScore: 7,
      brandGoffmanStageConsistency: "Minor Gap", brandDriftSignal: "Minor Drift",
      brandStuartHallDecoding: "Negotiated", brandRogersAdopterStage: "Late Majority",
      brandTurnerLiminalPhase: "Post-Liminal Reintegration",
    },
    expected: {
      caiScore: 7.63, caiStatus: "Green Light",
      alignmentScoreRaw: 8, pulseScoreRaw: 6.3, stabilityScoreRaw: 7.9,
      archetypeMatchScore: 10, decodingModifier: 0, weightAlpha: 0.5, weightBeta: 0.2, weightGamma: 0.3,
      parrScore: 76, parrLabel: "Moderate Legitimacy", qovScore: 58,
      radarWarnings: [], musicOverlapStrength: "none", mentionSentimentPenalty: 0, mentionVocabBoost: 0,
    },
  },
  {
    name: "low_pulse_warning_with_green",
    note: "Laggards → pulse 2 (<4) fires 'Low Pulse' warning even though final status is Green Light",
    input: {
      creatorArchetype: "The Everyman", goffmanStageConsistency: "Consistent", driftSignal: "Zero Change",
      stuartHallDecoding: "Dominant", rogersAdopterStage: "Laggards", turnerLiminalPhase: "Pre-Liminal",
      creatorNichePosition: "Consistent", brandArchetype: "The Everyman", brandType: "Retail",
      mythAlignmentScore: 8, tribMatchScore: 8,
    },
    expected: {
      caiScore: 7.91, caiStatus: "Green Light",
      alignmentScoreRaw: 9.166666666666666, pulseScoreRaw: 2, stabilityScoreRaw: 9.75,
      archetypeMatchScore: 10, decodingModifier: 0.5, weightAlpha: 0.5, weightBeta: 0.2, weightGamma: 0.3,
      parrScore: 79, parrLabel: "Moderate Legitimacy", qovScore: 62.5,
      radarWarnings: ["Low Pulse"], musicOverlapStrength: "none", mentionSentimentPenalty: 0, mentionVocabBoost: 0,
    },
  },
  {
    name: "trust_weighted_nondefault_weights",
    note: "brandType in BRAND_WEIGHT_TABLE (Trust category) → non-default weights 0.6/0.2/0.2",
    input: {
      creatorArchetype: "The Sage", goffmanStageConsistency: "Consistent", driftSignal: "Zero Change",
      stuartHallDecoding: "Dominant", rogersAdopterStage: "Early Majority", turnerLiminalPhase: "Liminal",
      creatorNichePosition: "Consistent", brandArchetype: "The Sage",
      brandType: "Medical — General Practice / Clinic", mythAlignmentScore: 7, tribMatchScore: 7,
    },
    expected: {
      caiScore: 8.55, caiStatus: "Green Light",
      alignmentScoreRaw: 8.5, pulseScoreRaw: 7.5, stabilityScoreRaw: 9.75,
      archetypeMatchScore: 10, decodingModifier: 0.5, weightAlpha: 0.6, weightBeta: 0.2, weightGamma: 0.2,
      parrScore: 76, parrLabel: "Moderate Legitimacy", qovScore: 65,
      radarWarnings: [], musicOverlapStrength: "none", mentionSentimentPenalty: 0, mentionVocabBoost: 0,
    },
  },
];

describe("fitEngine golden regression baseline (frozen engine)", () => {
  for (const c of CASES) {
    describe(c.name, () => {
      const r = runFullFITCalculation(c.input);
      const e = c.expected;
      it("final score & status", () => {
        expect(r.caiScore).toBe(e.caiScore);
        expect(r.caiStatus).toBe(e.caiStatus);
      });
      it("sub-scores (alignment/pulse/stability raw)", () => {
        expect(r.alignmentScoreRaw).toBeCloseTo(e.alignmentScoreRaw, 6);
        expect(r.pulseScoreRaw).toBeCloseTo(e.pulseScoreRaw, 6);
        expect(r.stabilityScoreRaw).toBeCloseTo(e.stabilityScoreRaw, 6);
      });
      it("components & weights", () => {
        expect(r.archetypeMatchScore).toBe(e.archetypeMatchScore);
        expect(r.decodingModifier).toBe(e.decodingModifier);
        expect(r.weightAlpha).toBe(e.weightAlpha);
        expect(r.weightBeta).toBe(e.weightBeta);
        expect(r.weightGamma).toBe(e.weightGamma);
      });
      it("PARR / QoV", () => {
        expect(r.parrScore).toBe(e.parrScore);
        expect(r.parrLabel).toBe(e.parrLabel);
        expect(r.qovScore).toBe(e.qovScore); // NOTE: J-2 — derived from pre-adjustment caiScore
      });
      it("radar warnings", () => {
        expect(r.radarWarnings).toEqual(e.radarWarnings);
      });
      it("music overlap & mention modifiers", () => {
        expect(r.musicOverlap.overlapStrength).toBe(e.musicOverlapStrength);
        expect(r.mentionSentimentPenalty).toBeCloseTo(e.mentionSentimentPenalty, 6);
        expect(r.mentionVocabBoost).toBeCloseTo(e.mentionVocabBoost, 6);
      });
    });
  }

  // ─── KNOWN ISSUES — documented, NOT fixed (frozen engine) ───────────────────
  it("J-1: alignmentNarrative always says 'weak' even for a resonant (10) archetype match", () => {
    const r = runFullFITCalculation(CASES[0].input); // green_resonant, archetypeMatchScore = 10
    expect(r.archetypeMatchScore).toBe(10);
    // KNOWN ISSUE J-1 — flagged for Jason, do not fix here.
    expect(r.alignmentNarrative).toContain("weak archetype alignment");
  });

  it("J-2: qovScore is computed from the PRE-adjustment caiScore, so it diverges from the returned caiScore", () => {
    const r = runFullFITCalculation(CASES[0].input); // green_resonant
    const qovIfFromReturnedCai = (r.caiScore / 10) * (r.parrScore / 100) * 100;
    // KNOWN ISSUE J-2 — flagged for Jason, do not fix here.
    // The returned caiScore (post mention-modifier) would give ~79.2; actual qov is 78.6.
    expect(r.qovScore).toBe(78.6);
    expect(r.qovScore).not.toBeCloseTo(qovIfFromReturnedCai, 1);
  });
});
