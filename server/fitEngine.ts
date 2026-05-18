/**
 * Connex F.I.T. Score Engine
 * Implements the exact scoring logic from the Excel workbook.
 * All formulas, weights, and archetype compatibility data are sourced directly
 * from the "Brand Weighting" and "Scoring And FIT Verdict" sheets.
 */

// ─── Archetype Compatibility Matrix ──────────────────────────────────────────
// Source: Field Notes sheet, rows 36–48

export const ARCHETYPES = [
  "The Sage",
  "The Hero",
  "The Outlaw",
  "The Explorer",
  "The Magician",
  "The Ruler",
  "The Caregiver",
  "The Lover",
  "The Jester",
  "The Innocent",
  "The Everyman",
  "The Creator",
] as const;

export type Archetype = (typeof ARCHETYPES)[number];

export const ARCHETYPE_COMPATIBILITY: Record<
  Archetype,
  { pairsWith: Archetype[]; clashesWith: Archetype[] }
> = {
  "The Sage": {
    pairsWith: ["The Sage", "The Creator", "The Explorer"],
    clashesWith: ["The Jester", "The Outlaw", "The Everyman"],
  },
  "The Hero": {
    pairsWith: ["The Hero", "The Explorer", "The Outlaw"],
    clashesWith: ["The Caregiver", "The Innocent", "The Lover"],
  },
  "The Outlaw": {
    pairsWith: ["The Outlaw", "The Hero", "The Explorer"],
    clashesWith: ["The Ruler", "The Caregiver", "The Innocent"],
  },
  "The Explorer": {
    pairsWith: ["The Explorer", "The Outlaw", "The Hero"],
    clashesWith: ["The Ruler", "The Caregiver", "The Innocent"],
  },
  "The Magician": {
    pairsWith: ["The Magician", "The Creator", "The Lover"],
    clashesWith: ["The Outlaw", "The Everyman", "The Jester"],
  },
  "The Ruler": {
    pairsWith: ["The Ruler", "The Sage", "The Lover"],
    clashesWith: ["The Everyman", "The Jester", "The Outlaw"],
  },
  "The Caregiver": {
    pairsWith: ["The Caregiver", "The Innocent", "The Everyman"],
    clashesWith: ["The Outlaw", "The Ruler", "The Hero"],
  },
  "The Lover": {
    pairsWith: ["The Lover", "The Magician", "The Ruler"],
    clashesWith: ["The Jester", "The Outlaw", "The Everyman"],
  },
  "The Jester": {
    pairsWith: ["The Jester", "The Everyman", "The Explorer"],
    clashesWith: ["The Ruler", "The Sage", "The Lover"],
  },
  "The Innocent": {
    pairsWith: ["The Innocent", "The Caregiver", "The Everyman"],
    clashesWith: ["The Outlaw", "The Ruler", "The Jester"],
  },
  "The Everyman": {
    pairsWith: ["The Everyman", "The Caregiver", "The Jester"],
    clashesWith: ["The Ruler", "The Sage", "The Magician"],
  },
  "The Creator": {
    pairsWith: ["The Creator", "The Sage", "The Magician"],
    clashesWith: ["The Everyman", "The Jester", "The Ruler"],
  },
};

/**
 * Returns archetype match score (0–10) based on compatibility.
 * Direct same-archetype: 10
 * In "Pairs Well With": 7
 * Neutral (neither pairs nor clashes): 5
 * In "Clashes With": 1
 */
export function getArchetypeMatchScore(
  brandArchetype: string,
  creatorArchetype: string
): number {
  const brand = brandArchetype as Archetype;
  const creator = creatorArchetype as Archetype;
  if (!ARCHETYPE_COMPATIBILITY[brand]) return 5;
  if (brand === creator) return 10;
  if (ARCHETYPE_COMPATIBILITY[brand].pairsWith.includes(creator)) return 7;
  if (ARCHETYPE_COMPATIBILITY[brand].clashesWith.includes(creator)) return 1;
  return 5;
}

export function archetypeClashes(brandArchetype: string, creatorArchetype: string): boolean {
  const brand = brandArchetype as Archetype;
  const creator = creatorArchetype as Archetype;
  if (!ARCHETYPE_COMPATIBILITY[brand]) return false;
  return ARCHETYPE_COMPATIBILITY[brand].clashesWith.includes(creator);
}

// ─── Brand Weight Table ───────────────────────────────────────────────────────
// Source: Brand Weighting sheet, rows 18–86

export interface BrandWeights {
  alpha: number;
  beta: number;
  gamma: number;
  priority: string;
}

export const BRAND_WEIGHT_TABLE: Record<string, BrandWeights> = {
  // Retail & E-Commerce
  "Retail — Local Boutique": { alpha: 0.5, beta: 0.2, gamma: 0.3, priority: "Community identity" },
  "Retail — E-Commerce / DTC Product": { alpha: 0.3, beta: 0.4, gamma: 0.3, priority: "Conversion + reach" },
  "Retail — Seasonal / Holiday Campaign": { alpha: 0.2, beta: 0.6, gamma: 0.2, priority: "Maximum pulse" },
  // Beauty & Personal Care
  "Beauty — Skincare": { alpha: 0.5, beta: 0.2, gamma: 0.3, priority: "Trust + value alignment" },
  "Beauty — Makeup / Color": { alpha: 0.3, beta: 0.5, gamma: 0.2, priority: "Trend currency" },
  "Beauty — Hair Care": { alpha: 0.4, beta: 0.3, gamma: 0.3, priority: "Community authority" },
  "Beauty — Salon / Local Service": { alpha: 0.5, beta: 0.2, gamma: 0.3, priority: "Local trust" },
  // Home & Lifestyle
  "Home — Interior Design / Décor": { alpha: 0.5, beta: 0.2, gamma: 0.3, priority: "Aesthetic alignment" },
  "Home — Cleaning / Household Products": { alpha: 0.4, beta: 0.3, gamma: 0.3, priority: "Relatability + trust" },
  "Home — Renovation / Contracting": { alpha: 0.5, beta: 0.1, gamma: 0.4, priority: "Credibility + safety" },
  // Health & Medical Services
  "Medical — General Practice / Clinic": { alpha: 0.5, beta: 0.1, gamma: 0.4, priority: "Trust + safety" },
  "Medical — Aesthetics / MedSpa": { alpha: 0.4, beta: 0.3, gamma: 0.3, priority: "Aspiration + trust" },
  "Medical — Chiropractic / PT / Allied Health": { alpha: 0.5, beta: 0.2, gamma: 0.3, priority: "Authority + lifestyle fit" },
  "Mental Health — Private Practice / App": { alpha: 0.5, beta: 0.1, gamma: 0.4, priority: "Trust + consistency" },
  // Professional Services
  "Legal — Personal Injury / Consumer Law": { alpha: 0.4, beta: 0.2, gamma: 0.4, priority: "Authority + trust" },
  "Financial — Personal Finance / Budgeting": { alpha: 0.5, beta: 0.2, gamma: 0.3, priority: "Value alignment" },
  "Financial — Local Accounting / Tax": { alpha: 0.5, beta: 0.1, gamma: 0.4, priority: "Trust + stability" },
  "Real Estate — Residential Agent": { alpha: 0.5, beta: 0.2, gamma: 0.3, priority: "Community trust" },
  "Real Estate — Property Developer": { alpha: 0.4, beta: 0.3, gamma: 0.3, priority: "Aspiration + authority" },
  "Insurance — Local Broker": { alpha: 0.5, beta: 0.1, gamma: 0.4, priority: "Trust + safety" },
  // Fitness & Sports
  "Fitness — Local Gym / Studio": { alpha: 0.5, beta: 0.2, gamma: 0.3, priority: "Community identity" },
  "Fitness — Equipment / Apparel": { alpha: 0.4, beta: 0.3, gamma: 0.3, priority: "Authority + momentum" },
  "Sports — Youth / Amateur Club": { alpha: 0.5, beta: 0.2, gamma: 0.3, priority: "Community values" },
  // Food & Beverage
  "F&B — Specialty Coffee / Café": { alpha: 0.5, beta: 0.2, gamma: 0.3, priority: "Lifestyle alignment" },
  "F&B — Craft Beverage / Alcohol": { alpha: 0.4, beta: 0.4, gamma: 0.2, priority: "Culture + momentum" },
  "F&B — Packaged Food / CPG": { alpha: 0.3, beta: 0.4, gamma: 0.3, priority: "Reach + relevance" },
  "F&B — Health Food / Organic": { alpha: 0.5, beta: 0.2, gamma: 0.3, priority: "Value alignment" },
  // Education & Coaching
  "Education — Online Course / Creator": { alpha: 0.5, beta: 0.3, gamma: 0.2, priority: "Authority alignment" },
  "Education — Local Tutoring / School": { alpha: 0.5, beta: 0.1, gamma: 0.4, priority: "Trust + stability" },
  "Coaching — Business / Life Coach": { alpha: 0.5, beta: 0.2, gamma: 0.3, priority: "Value + authority" },
  // Pet & Family
  "Pet — Products / Accessories": { alpha: 0.4, beta: 0.3, gamma: 0.3, priority: "Community fit" },
  "Pet — Veterinary / Local Service": { alpha: 0.5, beta: 0.1, gamma: 0.4, priority: "Trust + safety" },
  "Family — Children's Products": { alpha: 0.5, beta: 0.2, gamma: 0.3, priority: "Safety + value alignment" },
  // Travel & Hospitality
  "Travel — Local Tourism / Experience": { alpha: 0.4, beta: 0.3, gamma: 0.3, priority: "Lifestyle fit" },
  "Travel — Boutique Hotel / B&B": { alpha: 0.5, beta: 0.2, gamma: 0.3, priority: "Aesthetic alignment" },
  "Travel — Tour Operator / Activity": { alpha: 0.3, beta: 0.4, gamma: 0.3, priority: "Reach + excitement" },
  // Fashion
  "Fashion — Heritage / Luxury": { alpha: 0.5, beta: 0.2, gamma: 0.3, priority: "Semantic purity" },
  "Fashion — Trend-First / Streetwear": { alpha: 0.3, beta: 0.5, gamma: 0.2, priority: "Cultural momentum" },
  "Fashion — Accessible / Mid-Market": { alpha: 0.4, beta: 0.3, gamma: 0.3, priority: "Balanced reach" },
  // Campaign Types
  "Long-Term Ambassador": { alpha: 0.4, beta: 0.2, gamma: 0.4, priority: "Identity stability" },
  "Product Launch": { alpha: 0.3, beta: 0.4, gamma: 0.3, priority: "Reach + relevance" },
  // Restaurant
  "Restaurant — Casual Dining": { alpha: 0.4, beta: 0.3, gamma: 0.3, priority: "Community trust" },
  "Restaurant — Fine Dining / Experiential": { alpha: 0.5, beta: 0.2, gamma: 0.3, priority: "Semantic purity" },
  "Restaurant — QSR / Fast Food": { alpha: 0.3, beta: 0.5, gamma: 0.2, priority: "Viral momentum" },
  "Restaurant — QSR / Limited-Time Activation": { alpha: 0.2, beta: 0.6, gamma: 0.2, priority: "Maximum pulse" },
};

export const DEFAULT_WEIGHTS: BrandWeights = { alpha: 0.5, beta: 0.2, gamma: 0.3, priority: "Cultural alignment" };

export function getBrandWeights(brandType: string): BrandWeights {
  return BRAND_WEIGHT_TABLE[brandType] ?? DEFAULT_WEIGHTS;
}

// ─── Rogers Adoption Curve → Base Score ──────────────────────────────────────

export const ROGERS_BASE_SCORES: Record<string, number> = {
  Innovators: 5,
  "Early Adopters": 6,
  "Early Majority": 7,
  "Late Majority": 4,
  Laggards: 2,
};

// ─── Goffman Stage Test → Score ───────────────────────────────────────────────

export const GOFFMAN_SCORES: Record<string, number> = {
  Consistent: 10,
  "Minor Gap": 5,
  "Significant Gap": 0,
};

// ─── Drift Signal → Score ─────────────────────────────────────────────────────

export const DRIFT_SCORES: Record<string, number> = {
  "Zero Change": 9.5,
  "Minor Drift": 7,
  "Significant Drift": 3,
  "Full Pivot": 0,
};

// ─── Stuart Hall Decoding Modifier ───────────────────────────────────────────

export const DECODING_MODIFIERS: Record<string, number> = {
  Dominant: 0.5,
  Negotiated: 0,
  Oppositional: -1.0,
};

// ─── Liminal Adjustment ───────────────────────────────────────────────────────

export const LIMINAL_ADJUSTMENTS: Record<string, number> = {
  "Pre-Liminal": 0,
  Liminal: 0.5,
  "Post-Liminal Reintegration": 0.5,
};

// ─── Scoring Functions ────────────────────────────────────────────────────────

export interface AlignmentInputs {
  archetypeMatchScore: number;       // 0–10
  mythAlignmentScore: number;        // 0–10 (AI-evaluated)
  tribMatchScore: number;            // 0–10 (AI-evaluated)
  stuartHallDecoding: string;        // Dominant / Negotiated / Oppositional
}

export function calculateAlignmentScore(inputs: AlignmentInputs): {
  raw: number;
  decodingModifier: number;
} {
  const avg = (inputs.archetypeMatchScore + inputs.mythAlignmentScore + inputs.tribMatchScore) / 3;
  const modifier = DECODING_MODIFIERS[inputs.stuartHallDecoding] ?? 0;
  const raw = Math.min(10, avg + modifier);
  return { raw: Math.max(0, raw), decodingModifier: modifier };
}

export interface PulseInputs {
  rogersAdopterStage: string;
  turnerLiminalPhase: string;
}

export function calculatePulseScore(inputs: PulseInputs): {
  raw: number;
  rogersBase: number;
  liminalAdjustment: number;
} {
  const rogersBase = ROGERS_BASE_SCORES[inputs.rogersAdopterStage] ?? 5;
  const liminalAdj = LIMINAL_ADJUSTMENTS[inputs.turnerLiminalPhase] ?? 0;
  const raw = Math.min(10, Math.max(1, rogersBase + liminalAdj));
  return { raw, rogersBase, liminalAdjustment: liminalAdj };
}

export interface StabilityInputs {
  goffmanStageConsistency: string;
  driftSignal: string;
}

export function calculateStabilityScore(inputs: StabilityInputs): {
  raw: number;
  goffmanScore: number;
  driftScore: number;
} {
  const goffmanScore = GOFFMAN_SCORES[inputs.goffmanStageConsistency] ?? 5;
  const driftScore = DRIFT_SCORES[inputs.driftSignal] ?? 5;
  const raw = (goffmanScore + driftScore) / 2;
  return { raw, goffmanScore, driftScore };
}

export interface FITScoreInputs {
  alignmentRaw: number;
  pulseRaw: number;
  stabilityRaw: number;
  weights: BrandWeights;
}

export function calculateFITScore(inputs: FITScoreInputs): {
  fitScore: number;
  fitStatus: "Green Light" | "Proceed with Caution" | "Do Not Proceed";
} {
  const fitScore =
    inputs.alignmentRaw * inputs.weights.alpha +
    inputs.pulseRaw * inputs.weights.beta +
    inputs.stabilityRaw * inputs.weights.gamma;

  const rounded = Math.round(fitScore * 10) / 10;

  let fitStatus: "Green Light" | "Proceed with Caution" | "Do Not Proceed";
  if (rounded >= 7.5) fitStatus = "Green Light";
  else if (rounded >= 6.0) fitStatus = "Proceed with Caution";
  else fitStatus = "Do Not Proceed";

  return { fitScore: rounded, fitStatus };
}

// ─── Radar Warnings ───────────────────────────────────────────────────────────
// Exact names from the specification

export type RadarWarning =
  | "Low Alignment"
  | "Archetype Tension"
  | "Identity Instability"
  | "Low Pulse"
  | "Trajectory Divergence";

export interface RadarWarningInputs {
  alignmentRaw: number;
  pulseRaw: number;
  brandArchetype: string;
  creatorArchetype: string;
  stuartHallDecoding: string;
  driftSignal: string;
  goffmanStageConsistency: string;
  creatorNichePosition: string;
}

export function evaluateRadarWarnings(inputs: RadarWarningInputs): RadarWarning[] {
  const warnings: RadarWarning[] = [];

  // Low Alignment: α < 6.0
  if (inputs.alignmentRaw < 6.0) {
    warnings.push("Low Alignment");
  }

  // Archetype Tension: creator archetype is in brand's "Clashes With" list
  if (archetypeClashes(inputs.brandArchetype, inputs.creatorArchetype)) {
    warnings.push("Archetype Tension");
  }

  // Identity Instability: Full Pivot drift OR Significant Gap Goffman
  if (
    inputs.driftSignal === "Full Pivot" ||
    inputs.goffmanStageConsistency === "Significant Gap"
  ) {
    warnings.push("Identity Instability");
  }

  // Low Pulse: β < 4.0
  if (inputs.pulseRaw < 4.0) {
    warnings.push("Low Pulse");
  }

  // Trajectory Divergence: creator is "Behind" the niche
  if (inputs.creatorNichePosition === "Behind") {
    warnings.push("Trajectory Divergence");
  }

  return warnings;
}

// ─── Full Engine Entry Point ──────────────────────────────────────────────────

export interface FullFITCalculationInput {
  // Creator fields
  creatorArchetype: string;
  goffmanStageConsistency: string;
  driftSignal: string;
  stuartHallDecoding: string;
  rogersAdopterStage: string;
  turnerLiminalPhase: string;
  creatorNichePosition: string;
  // Brand fields
  brandArchetype: string;
  brandType: string;
  // AI-evaluated scores (0–10)
  mythAlignmentScore: number;
  tribMatchScore: number;
}

export interface FullFITResult {
  // Component scores
  archetypeMatchScore: number;
  mythAlignmentScore: number;
  tribMatchScore: number;
  decodingModifier: number;
  alignmentScoreRaw: number;
  rogersBaseScore: number;
  liminalAdjustment: number;
  pulseScoreRaw: number;
  goffmanScore: number;
  driftScore: number;
  stabilityScoreRaw: number;
  // Weights
  weightAlpha: number;
  weightBeta: number;
  weightGamma: number;
  weightPriority: string;
  // Final
  fitScore: number;
  fitStatus: "Green Light" | "Proceed with Caution" | "Do Not Proceed";
  radarWarnings: RadarWarning[];
}

export function runFullFITCalculation(input: FullFITCalculationInput): FullFITResult {
  const weights = getBrandWeights(input.brandType);

  const archetypeMatchScore = getArchetypeMatchScore(input.brandArchetype, input.creatorArchetype);

  const { raw: alignmentRaw, decodingModifier } = calculateAlignmentScore({
    archetypeMatchScore,
    mythAlignmentScore: input.mythAlignmentScore,
    tribMatchScore: input.tribMatchScore,
    stuartHallDecoding: input.stuartHallDecoding,
  });

  const { raw: pulseRaw, rogersBase, liminalAdjustment } = calculatePulseScore({
    rogersAdopterStage: input.rogersAdopterStage,
    turnerLiminalPhase: input.turnerLiminalPhase,
  });

  const { raw: stabilityRaw, goffmanScore, driftScore } = calculateStabilityScore({
    goffmanStageConsistency: input.goffmanStageConsistency,
    driftSignal: input.driftSignal,
  });

  const { fitScore, fitStatus } = calculateFITScore({
    alignmentRaw,
    pulseRaw,
    stabilityRaw,
    weights,
  });

  const radarWarnings = evaluateRadarWarnings({
    alignmentRaw,
    pulseRaw,
    brandArchetype: input.brandArchetype,
    creatorArchetype: input.creatorArchetype,
    stuartHallDecoding: input.stuartHallDecoding,
    driftSignal: input.driftSignal,
    goffmanStageConsistency: input.goffmanStageConsistency,
    creatorNichePosition: input.creatorNichePosition,
  });

  return {
    archetypeMatchScore,
    mythAlignmentScore: input.mythAlignmentScore,
    tribMatchScore: input.tribMatchScore,
    decodingModifier,
    alignmentScoreRaw: alignmentRaw,
    rogersBaseScore: rogersBase,
    liminalAdjustment,
    pulseScoreRaw: pulseRaw,
    goffmanScore,
    driftScore,
    stabilityScoreRaw: stabilityRaw,
    weightAlpha: weights.alpha,
    weightBeta: weights.beta,
    weightGamma: weights.gamma,
    weightPriority: weights.priority,
    fitScore,
    fitStatus,
    radarWarnings,
  };
}
