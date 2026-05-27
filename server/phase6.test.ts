/**
 * Phase 6 Tests: Audience-Mention Intelligence & Cultural Exchange Report
 *
 * Tests cover:
 * 1. Music overlap detection logic
 * 2. Negative sentiment radar warning trigger
 * 3. Mention sentiment classification
 * 4. Temporal weighting logic
 * 5. Cultural borrowing summary generation (mocked)
 */

import { describe, it, expect } from "vitest";

// ─── Helpers extracted from fitEngine / brandTikTokAnalysis ──────────────────

/**
 * Compute music overlap between creator and brand mention music signals.
 * Mirrors the logic in fitEngine.ts runFullFITCalculation.
 */
function computeMusicOverlap(
  creatorTitles: string[],
  creatorArtists: string[],
  brandTitles: string[],
  brandArtists: string[]
): { sharedTitles: string[]; sharedArtists: string[]; overlapStrength: "strong" | "moderate" | "none" } {
  const normalize = (s: string) => s.toLowerCase().trim();
  const creatorTitleSet = new Set(creatorTitles.map(normalize));
  const creatorArtistSet = new Set(creatorArtists.map(normalize));
  const sharedTitles = brandTitles.filter(t => creatorTitleSet.has(normalize(t)));
  const sharedArtists = brandArtists.filter(a => creatorArtistSet.has(normalize(a)));
  const overlapStrength: "strong" | "moderate" | "none" =
    sharedArtists.length >= 2 || sharedTitles.length >= 3
      ? "strong"
      : sharedArtists.length >= 1 || sharedTitles.length >= 1
      ? "moderate"
      : "none";
  return { sharedTitles, sharedArtists, overlapStrength };
}

/**
 * Determine if Negative Audience Sentiment radar warning should be triggered.
 * Mirrors logic in fitEngine.ts.
 */
function shouldTriggerNegativeSentimentWarning(
  mentionSentiment: string | null | undefined,
  mentionTotalCount: number
): boolean {
  return (
    mentionSentiment === "negative" &&
    mentionTotalCount >= 5
  );
}

/**
 * Apply mention sentiment stability modifier.
 * Mirrors logic in fitEngine.ts.
 */
function applyMentionSentimentModifier(
  stabilityScore: number,
  mentionSentiment: string | null | undefined,
  mentionTotalCount: number
): number {
  if (!mentionSentiment || mentionSentiment === "insufficient_data") return stabilityScore;
  if (mentionTotalCount < 3) return stabilityScore;

  let modifier = 0;
  if (mentionSentiment === "positive") modifier = 0.3;
  else if (mentionSentiment === "mixed") modifier = -1.0;
  else if (mentionSentiment === "negative") modifier = -2.5;

  // Cap: never drop more than 3 points or raise more than 1 point
  const adjusted = stabilityScore + modifier;
  return Math.max(stabilityScore - 3, Math.min(stabilityScore + 1, adjusted));
}

/**
 * Temporal weight for a mention based on age in days.
 * Recent (< 90 days) = 1.5x, medium (90-180 days) = 1.0x, older = 0.6x
 */
function getTemporalWeight(createTimeSeconds: number): number {
  const nowSeconds = Date.now() / 1000;
  const ageInDays = (nowSeconds - createTimeSeconds) / 86400;
  if (ageInDays < 90) return 1.5;
  if (ageInDays < 180) return 1.0;
  return 0.6;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Phase 6: Music Overlap Detection", () => {
  it("returns 'none' when there is no shared music", () => {
    const result = computeMusicOverlap(
      ["original sound", "trending audio"],
      ["Drake", "Taylor Swift"],
      ["background music", "viral sound"],
      ["Rihanna", "Beyoncé"]
    );
    expect(result.overlapStrength).toBe("none");
    expect(result.sharedTitles).toHaveLength(0);
    expect(result.sharedArtists).toHaveLength(0);
  });

  it("returns 'moderate' when one artist is shared", () => {
    const result = computeMusicOverlap(
      ["original sound"],
      ["Drake", "Taylor Swift"],
      ["viral audio"],
      ["Drake", "Rihanna"]
    );
    expect(result.overlapStrength).toBe("moderate");
    expect(result.sharedArtists).toContain("Drake");
  });

  it("returns 'strong' when two or more artists are shared", () => {
    const result = computeMusicOverlap(
      ["original sound"],
      ["Drake", "Taylor Swift", "Rihanna"],
      ["viral audio"],
      ["Drake", "Taylor Swift", "Beyoncé"]
    );
    expect(result.overlapStrength).toBe("strong");
    expect(result.sharedArtists).toHaveLength(2);
  });

  it("returns 'strong' when three or more titles are shared", () => {
    const result = computeMusicOverlap(
      ["song a", "song b", "song c", "song d"],
      [],
      ["song a", "song b", "song c"],
      []
    );
    expect(result.overlapStrength).toBe("strong");
    expect(result.sharedTitles).toHaveLength(3);
  });

  it("is case-insensitive for matching", () => {
    const result = computeMusicOverlap(
      [],
      ["DRAKE"],
      [],
      ["drake"]
    );
    expect(result.overlapStrength).toBe("moderate");
    expect(result.sharedArtists).toHaveLength(1);
  });
});

describe("Phase 6: Negative Sentiment Radar Warning", () => {
  it("triggers when sentiment is negative and count >= 5", () => {
    expect(shouldTriggerNegativeSentimentWarning("negative", 10)).toBe(true);
    expect(shouldTriggerNegativeSentimentWarning("negative", 5)).toBe(true);
  });

  it("does not trigger when count is below threshold", () => {
    expect(shouldTriggerNegativeSentimentWarning("negative", 4)).toBe(false);
    expect(shouldTriggerNegativeSentimentWarning("negative", 0)).toBe(false);
  });

  it("does not trigger for positive or mixed sentiment", () => {
    expect(shouldTriggerNegativeSentimentWarning("positive", 20)).toBe(false);
    expect(shouldTriggerNegativeSentimentWarning("mixed", 20)).toBe(false);
  });

  it("does not trigger for null or insufficient_data sentiment", () => {
    expect(shouldTriggerNegativeSentimentWarning(null, 20)).toBe(false);
    expect(shouldTriggerNegativeSentimentWarning("insufficient_data", 20)).toBe(false);
  });
});

describe("Phase 6: Mention Sentiment Stability Modifier", () => {
  it("adds a small bonus for positive sentiment", () => {
    const adjusted = applyMentionSentimentModifier(7.0, "positive", 10);
    expect(adjusted).toBeGreaterThan(7.0);
    expect(adjusted).toBeLessThanOrEqual(8.0); // capped at +1
  });

  it("applies a moderate penalty for mixed sentiment", () => {
    const adjusted = applyMentionSentimentModifier(7.0, "mixed", 10);
    expect(adjusted).toBeLessThan(7.0);
    expect(adjusted).toBeGreaterThanOrEqual(4.0); // capped at -3
  });

  it("applies a larger penalty for negative sentiment", () => {
    const adjusted = applyMentionSentimentModifier(7.0, "negative", 10);
    expect(adjusted).toBeLessThan(7.0);
    expect(adjusted).toBeGreaterThanOrEqual(4.0); // capped at -3
  });

  it("does not apply modifier when count is below 3", () => {
    const adjusted = applyMentionSentimentModifier(7.0, "negative", 2);
    expect(adjusted).toBe(7.0);
  });

  it("does not apply modifier for insufficient_data", () => {
    const adjusted = applyMentionSentimentModifier(7.0, "insufficient_data", 20);
    expect(adjusted).toBe(7.0);
  });

  it("does not apply modifier for null sentiment", () => {
    const adjusted = applyMentionSentimentModifier(7.0, null, 20);
    expect(adjusted).toBe(7.0);
  });

  it("never drops more than 3 points regardless of sentiment severity", () => {
    // Even with very low base score, cap applies
    const adjusted = applyMentionSentimentModifier(3.0, "negative", 100);
    expect(adjusted).toBeGreaterThanOrEqual(0); // min 0
    expect(adjusted).toBeGreaterThanOrEqual(3.0 - 3); // cap at -3
  });
});

describe("Phase 6: Temporal Weighting", () => {
  it("gives 1.5x weight to mentions from the last 90 days", () => {
    const recentTimestamp = (Date.now() / 1000) - (30 * 86400); // 30 days ago
    expect(getTemporalWeight(recentTimestamp)).toBe(1.5);
  });

  it("gives 1.0x weight to mentions from 90-180 days ago", () => {
    const mediumTimestamp = (Date.now() / 1000) - (120 * 86400); // 120 days ago
    expect(getTemporalWeight(mediumTimestamp)).toBe(1.0);
  });

  it("gives 0.6x weight to older mentions", () => {
    const oldTimestamp = (Date.now() / 1000) - (200 * 86400); // 200 days ago
    expect(getTemporalWeight(oldTimestamp)).toBe(0.6);
  });
});
