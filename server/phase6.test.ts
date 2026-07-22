/**
 * Phase 6 regression baseline — exercises the REAL fitEngine, not local copies.
 *
 * This suite locks in CURRENT behavior (a regression baseline), asserting only
 * invariants / tier boundaries / directions as the code defines them — never
 * specific magic score numbers. fitEngine is frozen; if a change moves any of
 * these, that is a deliberate behavior change to review, not a test to "fix".
 *
 * Covers the three real Phase 6 behaviors that the previous suite tested via
 * diverging inline copies:
 *   1. Music overlap tiers        → runFullFITCalculation().musicOverlap
 *   2. Mention sentiment modifier → runFullFITCalculation().mentionSentimentPenalty
 *   3. Negative-sentiment warning → evaluateRadarWarnings()
 *
 * Note: the previous suite also had 3 "temporal weighting" tests. fitEngine has
 * NO temporal-weighting code path (grep-verified: temporal weighting lives only
 * in brandTikTokAnalysis.ts, a separate scraping-time module). Those tests
 * asserted logic fitEngine does not contain and have been removed.
 */

import { describe, it, expect } from "vitest";
import { runFullFITCalculation, evaluateRadarWarnings } from "./fitEngine";
import type { FullFITCalculationInput, RadarWarningInputs } from "./fitEngine";

// Minimal valid input; the fields under test are added per-case. Values are
// neutral, valid enum members chosen so the base case triggers no unrelated
// behavior. Music/sentiment logic is independent of archetype/weights.
function baseInput(): FullFITCalculationInput {
  return {
    creatorArchetype: "The Sage",
    goffmanStageConsistency: "Consistent",
    driftSignal: "Zero Change",
    stuartHallDecoding: "Dominant",
    rogersAdopterStage: "Early Majority",
    turnerLiminalPhase: "Liminal",
    creatorNichePosition: "Consistent",
    brandArchetype: "The Sage",
    brandType: "Community",
    mythAlignmentScore: 5,
    tribMatchScore: 5,
  };
}

function baseRadar(): RadarWarningInputs {
  return {
    // alignment > 6 and pulse > 4 so those warnings don't fire; identical
    // archetypes don't clash; stable drift/goffman/niche — isolates sentiment.
    alignmentRaw: 8,
    pulseRaw: 8,
    brandArchetype: "The Sage",
    creatorArchetype: "The Sage",
    stuartHallDecoding: "Dominant",
    driftSignal: "Zero Change",
    goffmanStageConsistency: "Consistent",
    creatorNichePosition: "Consistent",
  };
}

// ─── 1. Music overlap tiers (totalOverlap = sharedTitles + sharedArtists) ──────
describe("Phase 6 (real fitEngine): music overlap tiers", () => {
  it("is 'none' when creator and brand share no music", () => {
    const r = runFullFITCalculation({
      ...baseInput(),
      creatorMusicTitles: ["original sound"],
      creatorMusicArtists: ["Drake"],
      brandMentionMusicTitles: ["viral audio"],
      brandMentionMusicArtists: ["Beyoncé"],
    });
    expect(r.musicOverlap.overlapStrength).toBe("none");
    expect(r.musicOverlap.sharedTitles).toHaveLength(0);
    expect(r.musicOverlap.sharedArtists).toHaveLength(0);
  });

  it("is 'moderate' with exactly one shared signal (totalOverlap = 1)", () => {
    const r = runFullFITCalculation({
      ...baseInput(),
      creatorMusicArtists: ["Drake", "Taylor Swift"],
      brandMentionMusicArtists: ["Drake", "Rihanna"],
    });
    expect(r.musicOverlap.overlapStrength).toBe("moderate");
    expect(r.musicOverlap.sharedArtists).toContain("drake");
  });

  it("stays 'moderate' at the tier boundary (totalOverlap = 2, below the strong cutoff of 3)", () => {
    const r = runFullFITCalculation({
      ...baseInput(),
      creatorMusicArtists: ["Drake", "Taylor Swift"],
      brandMentionMusicArtists: ["Drake", "Taylor Swift"],
    });
    expect(r.musicOverlap.sharedArtists).toHaveLength(2);
    expect(r.musicOverlap.overlapStrength).toBe("moderate");
  });

  it("is 'strong' when totalOverlap reaches 3 (titles + artists combined)", () => {
    const r = runFullFITCalculation({
      ...baseInput(),
      creatorMusicTitles: ["song a", "song b"],
      creatorMusicArtists: ["Drake"],
      brandMentionMusicTitles: ["song a", "song b"],
      brandMentionMusicArtists: ["Drake"],
    });
    expect(r.musicOverlap.overlapStrength).toBe("strong");
  });

  it("matches case-insensitively", () => {
    const r = runFullFITCalculation({
      ...baseInput(),
      creatorMusicArtists: ["DRAKE"],
      brandMentionMusicArtists: ["drake"],
    });
    expect(r.musicOverlap.overlapStrength).toBe("moderate");
    expect(r.musicOverlap.sharedArtists).toHaveLength(1);
  });
});

// ─── 2. Mention sentiment stability modifier (direction + confidence scaling) ──
describe("Phase 6 (real fitEngine): mention sentiment stability modifier", () => {
  const penaltyFor = (sentiment: string, confidence: string) =>
    runFullFITCalculation({
      ...baseInput(),
      brandMentionSentiment: sentiment,
      brandMentionSentimentConfidence: confidence,
    }).mentionSentimentPenalty;

  it("applies a negative modifier for negative sentiment", () => {
    expect(penaltyFor("negative", "high")).toBeLessThan(0);
  });

  it("applies a positive modifier for positive sentiment", () => {
    expect(penaltyFor("positive", "high")).toBeGreaterThan(0);
  });

  it("applies a negative modifier for mixed sentiment", () => {
    expect(penaltyFor("mixed", "high")).toBeLessThan(0);
  });

  it("applies no modifier for insufficient_data or absent sentiment", () => {
    expect(penaltyFor("insufficient_data", "high")).toBe(0);
    expect(runFullFITCalculation(baseInput()).mentionSentimentPenalty).toBe(0);
  });

  it("scales the modifier magnitude by confidence (high > medium > low)", () => {
    const high = penaltyFor("negative", "high");
    const medium = penaltyFor("negative", "medium");
    const low = penaltyFor("negative", "low");
    // More confidence ⇒ a more negative penalty.
    expect(high).toBeLessThan(medium);
    expect(medium).toBeLessThan(low);
    expect(low).toBeLessThan(0);
  });

  it("negative sentiment yields lower final stability than positive sentiment", () => {
    const neg = runFullFITCalculation({
      ...baseInput(),
      brandMentionSentiment: "negative",
      brandMentionSentimentConfidence: "high",
    }).stabilityScoreRaw;
    const pos = runFullFITCalculation({
      ...baseInput(),
      brandMentionSentiment: "positive",
      brandMentionSentimentConfidence: "high",
    }).stabilityScoreRaw;
    expect(neg).toBeLessThan(pos);
  });
});

// ─── 3. Negative Audience Sentiment radar warning ─────────────────────────────
describe("Phase 6 (real fitEngine): negative audience sentiment warning", () => {
  const warnings = (sentiment?: string, confidence?: string) =>
    evaluateRadarWarnings({
      ...baseRadar(),
      brandMentionSentiment: sentiment,
      brandMentionSentimentConfidence: confidence,
    });

  it("fires for negative sentiment at high or medium confidence", () => {
    expect(warnings("negative", "high")).toContain("Negative Audience Sentiment");
    expect(warnings("negative", "medium")).toContain("Negative Audience Sentiment");
  });

  it("does NOT fire for negative sentiment at low confidence", () => {
    expect(warnings("negative", "low")).not.toContain("Negative Audience Sentiment");
  });

  it("does NOT fire for positive or mixed sentiment", () => {
    expect(warnings("positive", "high")).not.toContain("Negative Audience Sentiment");
    expect(warnings("mixed", "high")).not.toContain("Negative Audience Sentiment");
  });

  it("does NOT fire when sentiment/confidence are absent", () => {
    expect(warnings()).not.toContain("Negative Audience Sentiment");
  });
});
