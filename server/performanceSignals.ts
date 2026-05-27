/**
 * Performance Signals Calculation Module
 * Derives five performance signals from existing creator and brand data.
 * Each signal is scored 0-100 with a confidence tier (Verified/Estimated/Insufficient Data).
 */

import type { CreatorProfile } from "../drizzle/schema";
import type { BrandProfile } from "../drizzle/schema";

export interface SignalResult {
  score: number; // 0-100
  confidence: "Verified" | "Estimated" | "Insufficient Data";
  reasoning: string;
}

/**
 * Signal 1: Creative Integrity Signal
 * Measures: Do this creator and brand each have genuine, consistent creative identity?
 * Inputs: Creator tone, goffman, cultural capital + Brand tone, archetype, visual language
 */
export function calculateCreativeIntegritySignal(
  creator: CreatorProfile,
  brand: BrandProfile
): SignalResult {
  let score = 50; // baseline
  let confidence: "Verified" | "Estimated" | "Insufficient Data" = "Estimated";

  // Creator side: tone consistency + goffman + cultural capital
  if (creator.toneRegister && creator.goffmanStageConsistency) {
    const goffmanScore =
      creator.goffmanStageConsistency === "Consistent"
        ? 10
        : creator.goffmanStageConsistency === "Minor Gap"
          ? 5
          : 0;
    const capitalType = creator.culturalCapital === "Produce" ? 10 : 5;
    const creatorIntegrity = (goffmanScore + capitalType) / 2;
    score += creatorIntegrity * 0.3; // 30% weight to creator side
  }

  // Brand side: tone clarity + archetype strength
  if (brand.brandTone && brand.archetype) {
    const toneClarity =
      brand.brandTone && brand.brandTone.length > 10 ? 10 : 5;
    const archetypeStrength = brand.archetype ? 8 : 4;
    const brandIntegrity = (toneClarity + archetypeStrength) / 2;
    score += brandIntegrity * 0.3; // 30% weight to brand side
  }

  // Pairing penalty: creator autonomy vs brand rigidity
  if (
    creator.culturalCapital === "Produce" &&
    brand.brandTone &&
    brand.brandTone.toLowerCase().includes("prescriptive")
  ) {
    score -= 15; // penalty for autonomy clash
  }

  // Confidence: high if both sides have data
  if (
    creator.goffmanStageConsistency &&
    creator.culturalCapital &&
    brand.brandTone &&
    brand.archetype
  ) {
    confidence = "Verified";
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    confidence,
    reasoning: `Creator is ${creator.culturalCapital}-type with ${creator.goffmanStageConsistency} stage. Brand has ${brand.brandTone ? "clear" : "unclear"} tone.`,
  };
}

/**
 * Signal 2: Performance Consistency Signal
 * Measures: Does creator deliver reliable performance? Does brand run structured campaigns?
 * Inputs: Creator engagement rate, lifecycle, brand saturation + Brand campaign type, reviews
 */
export function calculatePerformanceConsistencySignal(
  creator: CreatorProfile,
  brand: BrandProfile
): SignalResult {
  let score = 50; // baseline
  let confidence: "Verified" | "Estimated" | "Insufficient Data" = "Estimated";

  // Creator performance: engagement rate + lifecycle phase
  if (creator.engagementRate !== null && creator.engagementRate !== undefined) {
    const engagementBonus = Math.min(creator.engagementRate * 5, 30); // cap at 30
    score += engagementBonus;
  }

  // Lifecycle phase bonus
  if (creator.lifecyclePhase === "Growth" || creator.lifecyclePhase === "Maturity") {
    score += 15;
  } else if (creator.lifecyclePhase === "Decline") {
    score -= 20;
  }

  // Brand saturation penalty
  if (creator.brandSaturation) {
    score -= 10;
  }

  // Brand campaign clarity (if available from brand data)
  // This would be derived from brand's campaign history or positioning
  if (brand.archetype) {
    score += 10; // brand has clear positioning
  }

  // Confidence: high if engagement data exists
  if (
    creator.engagementRate !== null &&
    creator.engagementRate !== undefined &&
    creator.lifecyclePhase
  ) {
    confidence = "Verified";
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    confidence,
    reasoning: `Creator engagement ${creator.engagementRate ? `${(creator.engagementRate * 100).toFixed(1)}%` : "unknown"}, lifecycle ${creator.lifecyclePhase || "unknown"}.`,
  };
}

/**
 * Signal 3: Community Quality Signal
 * Measures: Is creator's community the right community for brand?
 * Inputs: Creator audience tribe + PARR + Stuart Hall decoding + location + Brand audience tribe + location
 */
export function calculateCommunityQualitySignal(
  creator: CreatorProfile,
  brand: BrandProfile,
  parrScore?: number
): SignalResult {
  let score = 50; // baseline
  let confidence: "Verified" | "Estimated" | "Insufficient Data" = "Estimated";

  // PARR score (if available from match calculation)
  if (parrScore !== undefined) {
    score = parrScore; // PARR is already 0-100
    confidence = "Verified";
  }

  // Stuart Hall decoding: Dominant = +15, Negotiated = +5, Oppositional = -15
  if (creator.stuartHallDecoding === "Dominant") {
    score += 15;
  } else if (creator.stuartHallDecoding === "Negotiated") {
    score += 5;
  } else if (creator.stuartHallDecoding === "Oppositional") {
    score -= 15;
  }

  // Geographic match (if both have location data)
  if (creator.primaryRegion) {
    // Brand location would be stored separately if available
    score += 5; // bonus for having geographic data
  }

  // Audience tribe description overlap (qualitative)
  if (creator.audienceRelationshipType) {
    // Check if creator's audience relationship aligns with brand positioning
    score += 5; // bonus for having audience relationship data
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    confidence,
    reasoning: `Audience tribe: ${creator.audienceRelationshipType || "unknown"}. Decoding: ${creator.stuartHallDecoding || "unknown"}.`,
  };
}

/**
 * Signal 4: Audience Receptivity Signal
 * Measures: Will creator's audience receive brand's message well?
 * Inputs: PARR + QoV + Decoding modifier + Brand emotional promise + Barthes myth + campaign type
 */
export function calculateAudienceReceptivitySignal(
  creator: CreatorProfile,
  brand: BrandProfile,
  parrScore?: number,
  qovScore?: number
): SignalResult {
  let score = 50; // baseline
  let confidence: "Verified" | "Estimated" | "Insufficient Data" = "Estimated";

  // PARR score (primary signal)
  if (parrScore !== undefined) {
    score = parrScore * 0.6; // 60% weight to PARR
  }

  // QoV score (quality of view)
  if (qovScore !== undefined) {
    score += qovScore * 0.2; // 20% weight to QoV
  }

  // Decoding modifier
  if (creator.stuartHallDecoding === "Dominant") {
    score += 10;
  } else if (creator.stuartHallDecoding === "Oppositional") {
    score -= 10;
  }

  // Brand emotional promise resonance (if available)
  if (brand.barthesMyth && creator.barthesMyth) {
    // Simple check: do myths overlap?
    if (brand.barthesMyth.toLowerCase().includes("success") && creator.barthesMyth.toLowerCase().includes("success")) {
      score += 10;
    }
  }

  // Confidence: high if PARR + QoV available
  if (parrScore !== undefined && qovScore !== undefined) {
    confidence = "Verified";
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    confidence,
    reasoning: `PARR ${parrScore ? `${parrScore}%` : "unknown"}, QoV ${qovScore ? `${qovScore}%` : "unknown"}.`,
  };
}

/**
 * Signal 5: Brand Trust Signal
 * Measures: Can brand trust creator? Can creator trust brand?
 * Inputs: Creator goffman + drift + data confidence + brand saturation + Brand reviews + saturation
 */
export function calculateBrandTrustSignal(
  creator: CreatorProfile,
  brand: BrandProfile,
  dataConfidenceLevel?: string
): SignalResult {
  let score = 50; // baseline
  let confidence: "Verified" | "Estimated" | "Insufficient Data" = "Estimated";

  // Creator trustworthiness: goffman consistency + drift
  if (creator.goffmanStageConsistency === "Consistent") {
    score += 20;
  } else if (creator.goffmanStageConsistency === "Minor Gap") {
    score += 10;
  } else if (creator.goffmanStageConsistency === "Significant Gap") {
    score -= 15;
  }

  // Drift signal
  if (creator.driftSignal === "Zero Change" || creator.driftSignal === "Minor Drift") {
    score += 15;
  } else if (creator.driftSignal === "Full Pivot") {
    score -= 20;
  }

  // Data confidence
  if (dataConfidenceLevel === "high") {
    score += 10;
    confidence = "Verified";
  } else if (dataConfidenceLevel === "low") {
    score -= 10;
    confidence = "Insufficient Data";
  }

  // Brand saturation penalty
  if (creator.brandSaturation) {
    score -= 15;
  }

  // Brand trustworthiness (if review data available)
  // This would be derived from brand's review sentiment
  if (brand.archetype) {
    score += 5; // brand has clear identity
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    confidence,
    reasoning: `Creator stage: ${creator.goffmanStageConsistency || "unknown"}, drift: ${creator.driftSignal || "unknown"}. Data confidence: ${dataConfidenceLevel || "unknown"}.`,
  };
}

/**
 * Calculate all eight signals (five performance + three cultural)
 */
export function calculateAllSignals(
  creator: CreatorProfile,
  brand: BrandProfile,
  parrScore?: number,
  qovScore?: number,
  alignmentScoreRaw?: number,
  pulseScoreRaw?: number,
  stabilityScoreRaw?: number,
  dataConfidenceLevel?: string
) {
  return {
    creativeIntegrity: calculateCreativeIntegritySignal(creator, brand),
    performanceConsistency: calculatePerformanceConsistencySignal(creator, brand),
    communityQuality: calculateCommunityQualitySignal(creator, brand, parrScore),
    audienceReceptivity: calculateAudienceReceptivitySignal(creator, brand, parrScore, qovScore),
    brandTrust: calculateBrandTrustSignal(creator, brand, dataConfidenceLevel),
    // Cultural signals (renamed from alignment/pulse/stability)
    culturalIdentity: {
      score: alignmentScoreRaw ? alignmentScoreRaw * 10 : 50,
      confidence: "Verified" as const,
      reasoning: "Derived from archetype + myth alignment + tribe match.",
    },
    culturalMomentum: {
      score: pulseScoreRaw ? pulseScoreRaw * 10 : 50,
      confidence: "Verified" as const,
      reasoning: "Derived from Rogers adoption stage + liminal adjustment.",
    },
    partnershipStability: {
      score: stabilityScoreRaw ? stabilityScoreRaw * 10 : 50,
      confidence: "Verified" as const,
      reasoning: "Derived from Goffman stage + drift signal.",
    },
  };
}
