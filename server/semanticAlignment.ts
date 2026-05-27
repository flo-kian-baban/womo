/**
 * Semantic Alignment Scoring
 *
 * Compares creator and brand symbolic vocabularies to detect:
 * - Keyword overlap (shared values/interests)
 * - Semantic conflicts (opposing values)
 * - Vocabulary richness (depth of shared meaning)
 *
 * This feeds directly into the Alignment (α) score.
 */

export interface SemanticAlignmentResult {
  overlapScore: number; // 0-10: keyword overlap percentage
  conflictScore: number; // 0-10: detected conflicts (lower is better)
  vocabularyRichnessScore: number; // 0-10: depth of shared meaning
  sharedKeywords: string[]; // Keywords present in both vocabularies
  conflictingKeywords: string[]; // Keywords that suggest opposing values
  alignmentModifier: number; // -2.0 to +2.0: adjustment to Alignment score
  explanation: string; // Human-readable summary
}

/**
 * Normalize keywords for comparison
 */
function normalizeKeyword(keyword: string): string {
  return keyword
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ");
}

/**
 * Calculate semantic similarity between two keyword sets
 */
export function calculateSemanticAlignment(
  creatorKeywords: string[] | null | undefined,
  creatorVocabulary: string[] | null | undefined,
  brandKeywords: string[] | null | undefined,
  brandVocabulary: string[] | null | undefined
): SemanticAlignmentResult {
  // Combine all creator signals
  const creatorAll = [
    ...(creatorKeywords ?? []),
    ...(creatorVocabulary ?? []),
  ].map(normalizeKeyword);

  // Combine all brand signals
  const brandAll = [
    ...(brandKeywords ?? []),
    ...(brandVocabulary ?? []),
  ].map(normalizeKeyword);

  if (creatorAll.length === 0 || brandAll.length === 0) {
    return {
      overlapScore: 0,
      conflictScore: 0,
      vocabularyRichnessScore: 0,
      sharedKeywords: [],
      conflictingKeywords: [],
      alignmentModifier: 0,
      explanation: "Insufficient vocabulary data to calculate semantic alignment.",
    };
  }

  // Find shared keywords
  const creatorSet = new Set(creatorAll);
  const brandSet = new Set(brandAll);
  const sharedKeywords = Array.from(creatorSet).filter((k) => brandSet.has(k));

  // Calculate overlap score (0-10)
  const overlapPercentage = sharedKeywords.length / Math.max(creatorSet.size, brandSet.size);
  const overlapScore = Math.min(10, overlapPercentage * 15); // Scale to 0-10

  // Detect conflicts using semantic opposites
  const conflictPairs = [
    ["sustainable", "fast-fashion"],
    ["eco-friendly", "disposable"],
    ["luxury", "budget"],
    ["premium", "affordable"],
    ["exclusive", "accessible"],
    ["minimalist", "maximalist"],
    ["authentic", "artificial"],
    ["traditional", "trendy"],
    ["professional", "casual"],
    ["formal", "informal"],
    ["serious", "playful"],
    ["educational", "entertainment"],
    ["local", "global"],
    ["niche", "mainstream"],
  ];

  let conflictCount = 0;
  const conflictingKeywords: string[] = [];

  for (const [word1, word2] of conflictPairs) {
    const creatorHasWord1 = creatorSet.has(word1);
    const creatorHasWord2 = creatorSet.has(word2);
    const brandHasWord1 = brandSet.has(word1);
    const brandHasWord2 = brandSet.has(word2);

    // If creator has word1 and brand has word2 (or vice versa), it's a conflict
    if ((creatorHasWord1 && brandHasWord2) || (creatorHasWord2 && brandHasWord1)) {
      conflictCount++;
      conflictingKeywords.push(`${creatorHasWord1 ? word1 : word2} vs ${brandHasWord1 ? word1 : word2}`);
    }
  }

  // Conflict score (0-10, lower is better)
  const conflictScore = Math.min(10, conflictCount * 2);

  // Vocabulary richness (how many unique concepts are shared)
  const vocabularyRichnessScore = Math.min(10, (sharedKeywords.length / 5) * 10);

  // Calculate alignment modifier (-2.0 to +2.0)
  // Positive: good overlap, no conflicts
  // Negative: poor overlap or significant conflicts
  let alignmentModifier = 0;
  alignmentModifier += (overlapScore / 10) * 2; // +0 to +2 for overlap
  alignmentModifier -= (conflictScore / 10) * 2; // -0 to -2 for conflicts

  // Clamp to range
  alignmentModifier = Math.max(-2, Math.min(2, alignmentModifier));

  // Generate explanation
  let explanation = "";
  if (sharedKeywords.length > 0) {
    explanation += `Shared vocabulary: ${sharedKeywords.slice(0, 3).join(", ")}${sharedKeywords.length > 3 ? `, +${sharedKeywords.length - 3} more` : ""}. `;
  }
  if (conflictingKeywords.length > 0) {
    explanation += `Potential conflicts: ${conflictingKeywords.slice(0, 2).join("; ")}. `;
  }
  if (overlapScore >= 7) {
    explanation += "Strong semantic alignment.";
  } else if (overlapScore >= 4) {
    explanation += "Moderate semantic alignment.";
  } else {
    explanation += "Limited semantic overlap.";
  }

  return {
    overlapScore,
    conflictScore,
    vocabularyRichnessScore,
    sharedKeywords,
    conflictingKeywords,
    alignmentModifier,
    explanation,
  };
}
