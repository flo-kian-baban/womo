import { describe, expect, it } from "vitest";
import {
  runFullFITCalculation,
  getBrandWeights,
  ARCHETYPE_COMPATIBILITY,
  BRAND_WEIGHT_TABLE,
  ARCHETYPES,
} from "./fitEngine";

describe("ARCHETYPE_COMPATIBILITY", () => {
  it("contains all 12 archetypes as keys", () => {
    expect(Object.keys(ARCHETYPE_COMPATIBILITY)).toHaveLength(12);
    ARCHETYPES.forEach((a) => {
      expect(ARCHETYPE_COMPATIBILITY).toHaveProperty(a);
    });
  });

  it("each archetype has pairsWith and clashesWith arrays", () => {
    for (const [, entry] of Object.entries(ARCHETYPE_COMPATIBILITY)) {
      expect(entry).toHaveProperty("pairsWith");
      expect(entry).toHaveProperty("clashesWith");
      expect(Array.isArray(entry.pairsWith)).toBe(true);
      expect(Array.isArray(entry.clashesWith)).toBe(true);
    }
  });

  it("each archetype pairs with itself", () => {
    for (const archetype of ARCHETYPES) {
      const entry = ARCHETYPE_COMPATIBILITY[archetype];
      expect(entry.pairsWith).toContain(archetype);
    }
  });
});

describe("BRAND_WEIGHT_TABLE", () => {
  it("has more than 40 brand types", () => {
    expect(Object.keys(BRAND_WEIGHT_TABLE).length).toBeGreaterThan(40);
  });

  it("all weights sum to approximately 1.0", () => {
    for (const [type, weights] of Object.entries(BRAND_WEIGHT_TABLE)) {
      const sum = weights.alpha + weights.beta + weights.gamma;
      expect(sum).toBeCloseTo(1.0, 1);
    }
  });

  it("all weights are between 0 and 1", () => {
    for (const [, weights] of Object.entries(BRAND_WEIGHT_TABLE)) {
      expect(weights.alpha).toBeGreaterThanOrEqual(0);
      expect(weights.alpha).toBeLessThanOrEqual(1);
      expect(weights.beta).toBeGreaterThanOrEqual(0);
      expect(weights.beta).toBeLessThanOrEqual(1);
      expect(weights.gamma).toBeGreaterThanOrEqual(0);
      expect(weights.gamma).toBeLessThanOrEqual(1);
    }
  });

  it("has a priority label for each brand type", () => {
    for (const [, weights] of Object.entries(BRAND_WEIGHT_TABLE)) {
      expect(weights.priority).toBeTruthy();
      expect(typeof weights.priority).toBe("string");
    }
  });
});

describe("getBrandWeights", () => {
  it("returns correct weights for known brand types", () => {
    const weights = getBrandWeights("Beauty — Skincare");
    expect(weights.alpha).toBeGreaterThan(0);
    expect(weights.beta).toBeGreaterThan(0);
    expect(weights.gamma).toBeGreaterThan(0);
  });

  it("falls back to default weights for unknown brand type", () => {
    const weights = getBrandWeights("Unknown Brand Type XYZ");
    expect(weights.alpha + weights.beta + weights.gamma).toBeCloseTo(1.0, 1);
  });
});

describe("runFullFITCalculation", () => {
  const baseInput = {
    creatorArchetype: "The Hero",
    goffmanStageConsistency: "Consistent" as const,
    driftSignal: "Zero Change" as const,
    stuartHallDecoding: "Dominant" as const,
    rogersAdopterStage: "Early Adopters" as const,
    turnerLiminalPhase: "Pre-Liminal" as const,
    creatorNichePosition: "Ahead" as const,
    brandArchetype: "The Hero",
    brandType: "Fitness — Equipment / Apparel",
    mythAlignmentScore: 8,
    tribMatchScore: 8,
  };

  it("returns a valid F.I.T. score between 0 and 10", () => {
    const result = runFullFITCalculation(baseInput);
    expect(result.caiScore).toBeGreaterThanOrEqual(0);
    expect(result.caiScore).toBeLessThanOrEqual(10);
  });

  it("returns a caiStatus string", () => {
    const result = runFullFITCalculation(baseInput);
    expect(["Green Light", "Proceed with Caution", "Do Not Proceed"]).toContain(result.caiStatus);
  });

  it("returns three sub-scores between 0 and 10", () => {
    const result = runFullFITCalculation(baseInput);
    expect(result.alignmentScoreRaw).toBeGreaterThanOrEqual(0);
    expect(result.alignmentScoreRaw).toBeLessThanOrEqual(10);
    expect(result.pulseScoreRaw).toBeGreaterThanOrEqual(0);
    expect(result.pulseScoreRaw).toBeLessThanOrEqual(10);
    expect(result.stabilityScoreRaw).toBeGreaterThanOrEqual(0);
    expect(result.stabilityScoreRaw).toBeLessThanOrEqual(10);
  });

  it("returns an array of radar warnings", () => {
    const result = runFullFITCalculation(baseInput);
    expect(Array.isArray(result.radarWarnings)).toBe(true);
  });

  it("triggers Low Alignment warning when alignment is low", () => {
    const lowAlignInput = {
      ...baseInput,
      creatorArchetype: "The Jester",
      brandArchetype: "The Ruler",
      mythAlignmentScore: 2,
      tribMatchScore: 2,
    };
    const result = runFullFITCalculation(lowAlignInput);
    expect(result.radarWarnings).toContain("Low Alignment");
  });

  it("triggers Identity Instability for Full Pivot drift", () => {
    const unstableInput = {
      ...baseInput,
      driftSignal: "Full Pivot" as const,
      goffmanStageConsistency: "Significant Gap" as const,
    };
    const result = runFullFITCalculation(unstableInput);
    expect(result.radarWarnings).toContain("Identity Instability");
  });

  it("triggers Trajectory Divergence when creator is Behind", () => {
    const behindInput = {
      ...baseInput,
      creatorNichePosition: "Behind" as const,
    };
    const result = runFullFITCalculation(behindInput);
    expect(result.radarWarnings).toContain("Trajectory Divergence");
  });

  it("Green Light status for high-scoring compatible pair", () => {
    const result = runFullFITCalculation(baseInput);
    // Hero x Hero with high myth/trib scores should be green
    expect(result.caiScore).toBeGreaterThan(6);
  });

  it("weights sum to approximately 1.0", () => {
    const result = runFullFITCalculation(baseInput);
    const sum = result.weightAlpha + result.weightBeta + result.weightGamma;
    expect(sum).toBeCloseTo(1.0, 1);
  });
});
