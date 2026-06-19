/**
 * Performance Signals Calculation Module
 * Derives five performance signals from existing creator and brand data.
 * Each signal is scored 0-100 with a confidence tier (Verified/Estimated/Insufficient Data).
 *
 * Design principles:
 *   - Creator-side inputs establish a baseline (0–50 range contribution)
 *   - Brand-side inputs differentiate the score across brands (0–50 range contribution)
 *   - No single creator signal should be able to push the score to 100 alone
 *   - Engagement rates are stored as percentages (e.g. 6.39 = 6.39%), NOT decimals
 */

// Local type aliases matching the flattened return shape from db.ts
// getCreatorProfileById / getBrandProfileById. Uses Record intersection
// so callers can pass objects with additional fields without conflicts.
// Only fields that require specific types for scoring operations are declared.
type CreatorProfile = Record<string, any> & {
  engagementRate: number | null;
  followerCount: number | null;
};

type BrandProfile = Record<string, any> & {
  overallRating: number | null;
  tiktokEngagementRate: number | null;
};

export interface SignalResult {
  score: number; // 0-100
  confidence: "Verified" | "Estimated" | "Insufficient Data";
  reasoning: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Map Goffman stage to a 0–10 score */
function goffmanToScore(stage: string | null | undefined): number {
  if (stage === "Consistent") return 10;
  if (stage === "Minor Gap") return 5;
  if (stage === "Significant Gap") return 0;
  return 5; // default
}

/** Map drift signal to a 0–10 score */
function driftToScore(drift: string | null | undefined): number {
  if (drift === "Zero Change") return 10;
  if (drift === "Minor Drift") return 7;
  if (drift === "Significant Drift") return 3;
  if (drift === "Full Pivot") return 0;
  return 5; // default
}

// ─── Signal 1: Creative Integrity ────────────────────────────────────────────
/**
 * Measures: Do this creator and brand each have genuine, consistent creative identity?
 *
 * Scoring breakdown (0–100):
 *   Creator side (max 40):
 *     - Goffman stage consistency (0–10) × 2 = 0–20
 *     - Cultural capital type: Produce = 10, Relay = 5 → 0–10
 *     - Tone register present: +10
 *   Brand side (max 40):
 *     - Mention sentiment: positive = 15, mixed = 8, negative = 0
 *     - Brand Goffman consistency (0–10) → 0–10
 *     - Overall rating bonus (0–15): (rating - 3.0) × 7.5, capped 0–15
 *   Pairing penalty (max -20):
 *     - Creator Produce + brand prescriptive tone: -20
 *
 * Baseline: 20 (ensures a floor even with no data)
 */
export function calculateCreativeIntegritySignal(
  creator: CreatorProfile,
  brand: BrandProfile
): SignalResult {
  let score = 20; // baseline
  let confidence: "Verified" | "Estimated" | "Insufficient Data" = "Estimated";
  const reasons: string[] = [];

  // ── Creator side (max 40) ──────────────────────────────────────────────────
  const creatorGoffman = goffmanToScore(creator.goffmanStageConsistency);
  score += creatorGoffman * 2; // 0–20
  if (creator.culturalCapital === "Produce") {
    score += 10;
  } else if (creator.culturalCapital === "Relay") {
    score += 5;
  }
  if (creator.toneRegister) {
    score += 10;
  }
  reasons.push(`Creator: ${creator.culturalCapital ?? "unknown"}-type, ${creator.goffmanStageConsistency ?? "unknown"} stage`);

  // ── Brand side (max 40) ───────────────────────────────────────────────────
  const mentionSentiment = brand.mentionSentiment as string | null;
  const mentionCount = (brand.mentionTotalCount as number | null) ?? 0;
  if (mentionSentiment === "positive" && mentionCount >= 5) {
    score += 15;
    reasons.push("brand audience sentiment: positive");
  } else if (mentionSentiment === "mixed" && mentionCount >= 5) {
    score += 5;
    reasons.push("brand audience sentiment: mixed");
  } else if (mentionSentiment === "negative" && mentionCount >= 5) {
    score -= 15; // negative audience perception undermines brand creative integrity
    reasons.push("brand audience sentiment: negative");
  } else {
    score += 3; // insufficient mention data
    reasons.push("brand audience sentiment: insufficient data");
  }

  const brandGoffman = goffmanToScore((brand as any).brandGoffmanStageConsistency);
  score += brandGoffman; // 0–10
  // Note: overallRating is used in Brand Trust signal, not Creative Integrity

  // ── Pairing penalty ───────────────────────────────────────────────────────
  if (
    creator.culturalCapital === "Produce" &&
    brand.brandTone &&
    brand.brandTone.toLowerCase().includes("prescriptive")
  ) {
    score -= 20;
    reasons.push("autonomy clash penalty");
  }

  // ── Confidence ────────────────────────────────────────────────────────────
  if (
    creator.goffmanStageConsistency &&
    creator.culturalCapital &&
    brand.brandTone &&
    brand.archetype &&
    mentionSentiment
  ) {
    confidence = "Verified";
  }

  return {
    score: Math.max(0, Math.min(100, Math.round(score * 100) / 100)),
    confidence,
    reasoning: reasons.join(". ") + ".",
  };
}

// ─── Signal 2: Performance Consistency ───────────────────────────────────────
/**
 * Measures: Does creator deliver reliable performance? Does brand run structured campaigns?
 *
 * Scoring breakdown (0–100):
 *   Creator side (max 50):
 *     - Engagement rate (stored as %, e.g. 6.39 = 6.39%):
 *         ≥ 6% = 20 pts, 3–6% = 15 pts, 1–3% = 10 pts, < 1% = 5 pts
 *     - Lifecycle phase: Growth/Maturity = 15, Emergence = 10, Decline = -10
 *     - Brand saturation penalty: -10
 *   Brand side (max 50):
 *     - Brand has clear archetype: +10
 *     - Brand Goffman consistency (0–10) → 0–10
 *     - Brand drift stability (0–10) → 0–10
 *     - TikTok engagement rate (if available): ≥ 3% = +10, 1–3% = +5
 *     - Overall rating: ≥ 4.0 = +10, 3.0–4.0 = +5
 *
 * Baseline: 0 (no artificial floor — must earn the score)
 */
export function calculatePerformanceConsistencySignal(
  creator: CreatorProfile,
  brand: BrandProfile
): SignalResult {
  let score = 0;
  let confidence: "Verified" | "Estimated" | "Insufficient Data" = "Estimated";
  const reasons: string[] = [];

  // ── Creator side (max 50) ──────────────────────────────────────────────────
  // Engagement rate is stored as a percentage (0–100), e.g. 6.39 means 6.39%
  if (creator.engagementRate !== null && creator.engagementRate !== undefined) {
    const engPct = creator.engagementRate; // already a percentage
    if (engPct >= 6) {
      score += 20;
    } else if (engPct >= 3) {
      score += 15;
    } else if (engPct >= 1) {
      score += 10;
    } else {
      score += 5;
    }
    reasons.push(`creator engagement ${engPct.toFixed(1)}%`);
  }

  if (creator.lifecyclePhase === "Growth" || creator.lifecyclePhase === "Maturity") {
    score += 15;
  } else if (creator.lifecyclePhase === "Emergence") {
    score += 10;
  } else if (creator.lifecyclePhase === "Decline") {
    score -= 10;
  }
  if (creator.lifecyclePhase) reasons.push(`lifecycle ${creator.lifecyclePhase}`);

  if (creator.brandSaturation) {
    score -= 10;
    reasons.push("brand saturation penalty");
  }

  // ── Brand side (max 50) ───────────────────────────────────────────────────
  if (brand.archetype) {
    score += 10;
  }

  const brandGoffman = goffmanToScore((brand as any).brandGoffmanStageConsistency);
  score += brandGoffman; // 0–10

  const brandDrift = driftToScore((brand as any).brandDriftSignal);
  score += brandDrift; // 0–10

  if (brand.tiktokEngagementRate !== null && brand.tiktokEngagementRate !== undefined) {
    if (brand.tiktokEngagementRate >= 3) {
      score += 10;
    } else if (brand.tiktokEngagementRate >= 1) {
      score += 5;
    }
    reasons.push(`brand TikTok engagement ${brand.tiktokEngagementRate.toFixed(1)}%`);
  }

  if (brand.overallRating !== null && brand.overallRating !== undefined) {
    if (brand.overallRating >= 4.0) {
      score += 10;
    } else if (brand.overallRating >= 3.0) {
      score += 5;
    }
    reasons.push(`brand rating ${brand.overallRating.toFixed(1)}`);
  }

  // ── Confidence ────────────────────────────────────────────────────────────
  if (
    creator.engagementRate !== null &&
    creator.engagementRate !== undefined &&
    creator.lifecyclePhase
  ) {
    confidence = "Verified";
  }

  return {
    score: Math.max(0, Math.min(100, Math.round(score * 100) / 100)),
    confidence,
    reasoning: reasons.join(", ") + ".",
  };
}

// ─── Signal 3: Community Quality ─────────────────────────────────────────────
/**
 * Measures: Is creator's community the right community for brand?
 * (unchanged — already differentiates by brand via PARR and hashtag overlap)
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
    score += 5; // bonus for having geographic data
  }

  // Audience tribe description overlap (qualitative)
  if (creator.audienceRelationshipType) {
    score += 5; // bonus for having audience relationship data
  }

  // TikTok mention keyword overlap: if brand mentions show audience keywords that match creator's audience
  const mentionHashtags = (brand.mentionHashtagCloud as string[]) ?? [];
  const creatorKeywords = (creator.rawKeywords as string[]) ?? [];
  if (mentionHashtags.length > 0 && creatorKeywords.length > 0) {
    const hashtagSet = new Set(mentionHashtags.map(h => h.toLowerCase()));
    const keywordSet = new Set(creatorKeywords.map(k => k.toLowerCase()));
    const overlap = Array.from(hashtagSet).filter(h => keywordSet.has(h)).length;
    const overlapRatio = overlap / Math.max(hashtagSet.size, keywordSet.size);
    if (overlapRatio > 0.3) {
      score += 10; // strong audience alignment
      confidence = "Verified";
    } else if (overlapRatio > 0.1) {
      score += 5; // some audience alignment
    }
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    confidence,
    reasoning: `Audience tribe: ${creator.audienceRelationshipType || "unknown"}. Decoding: ${creator.stuartHallDecoding || "unknown"}.`,
  };
}

// ─── Signal 4: Audience Receptivity ──────────────────────────────────────────
/**
 * Measures: Will creator's audience receive brand's message well?
 * (unchanged — already differentiates by brand via PARR + QoV)
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
    reasoning: `PARR ${parrScore ? `${parrScore}%` : "unknown"}, QoV ${qovScore ? `${qovScore.toFixed(1)}%` : "unknown"}.`,
  };
}

// ─── Signal 5: Brand Trust ────────────────────────────────────────────────────
/**
 * Measures: Can brand trust creator? Can creator trust brand?
 *
 * Scoring breakdown (0–100):
 *   Creator side (max 40):
 *     - Goffman stage: Consistent = 15, Minor Gap = 8, Significant Gap = -10
 *     - Drift signal: Zero Change = 10, Minor Drift = 7, Significant Drift = 3, Full Pivot = -15
 *     - Brand saturation: -10
 *   Brand side (max 60):
 *     - Mention sentiment: positive + ≥5 mentions = 20, mixed = 10, negative = -10
 *     - Overall rating: ≥ 4.5 = 15, 4.0–4.5 = 10, 3.5–4.0 = 5, < 3.0 = -5
 *     - Brand archetype present: +5
 *     - Brand Goffman consistency (0–10) → 0–10
 *   Data confidence modifier:
 *     - high = +5, low = -5
 *
 * Baseline: 20
 */
export function calculateBrandTrustSignal(
  creator: CreatorProfile,
  brand: BrandProfile,
  dataConfidenceLevel?: string
): SignalResult {
  let score = 20; // baseline
  let confidence: "Verified" | "Estimated" | "Insufficient Data" = "Estimated";
  const reasons: string[] = [];

  // ── Creator side (max 40) ──────────────────────────────────────────────────
  if (creator.goffmanStageConsistency === "Consistent") {
    score += 15;
  } else if (creator.goffmanStageConsistency === "Minor Gap") {
    score += 8;
  } else if (creator.goffmanStageConsistency === "Significant Gap") {
    score -= 10;
  }
  if (creator.goffmanStageConsistency) reasons.push(`creator stage: ${creator.goffmanStageConsistency}`);

  if (creator.driftSignal === "Zero Change") {
    score += 10;
  } else if (creator.driftSignal === "Minor Drift") {
    score += 7;
  } else if (creator.driftSignal === "Significant Drift") {
    score += 3;
  } else if (creator.driftSignal === "Full Pivot") {
    score -= 15;
  }
  if (creator.driftSignal) reasons.push(`drift: ${creator.driftSignal}`);

  if (creator.brandSaturation) {
    score -= 10;
    reasons.push("brand saturation penalty");
  }

  // ── Brand side (max 60) ───────────────────────────────────────────────────
  const mentionSentiment = brand.mentionSentiment as string | null;
  const mentionCount = (brand.mentionTotalCount as number | null) ?? 0;
  if (mentionSentiment === "positive" && mentionCount >= 5) {
    score += 20;
    confidence = "Verified";
    reasons.push("brand audience sentiment: positive");
  } else if (mentionSentiment === "mixed" && mentionCount >= 5) {
    score += 10;
    reasons.push("brand audience sentiment: mixed");
  } else if (mentionSentiment === "negative" && mentionCount >= 5) {
    score -= 10;
    reasons.push("brand audience sentiment: negative");
  }

  if (brand.overallRating !== null && brand.overallRating !== undefined) {
    if (brand.overallRating >= 4.5) {
      score += 15;
    } else if (brand.overallRating >= 4.0) {
      score += 10;
    } else if (brand.overallRating >= 3.5) {
      score += 5;
    } else if (brand.overallRating < 3.0) {
      score -= 5;
    }
    reasons.push(`brand rating: ${brand.overallRating.toFixed(1)}`);
  }

  if (brand.archetype) {
    score += 5;
  }

  const brandGoffman = goffmanToScore((brand as any).brandGoffmanStageConsistency);
  score += brandGoffman; // 0–10

  // ── Data confidence modifier ──────────────────────────────────────────────
  if (dataConfidenceLevel === "high") {
    score += 5;
    confidence = "Verified";
  } else if (dataConfidenceLevel === "low") {
    score -= 5;
    confidence = "Insufficient Data";
  }
  if (dataConfidenceLevel) reasons.push(`data confidence: ${dataConfidenceLevel}`);

  return {
    score: Math.max(0, Math.min(100, Math.round(score * 100) / 100)),
    confidence,
    reasoning: reasons.join(", ") + ".",
  };
}

// ─── calculateAllSignals ──────────────────────────────────────────────────────
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
