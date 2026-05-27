/**
 * Engagement Quality Score Calculator
 * Analyzes TikTok comments to determine engagement quality.
 * Substantive comments (10+ words, personal disclosure, questions, full sentences)
 * vs passive reactions (emoji-only, single word, "lol" type responses).
 */

export interface EngagementQualityResult {
  engagementQualityScore: number; // 0.0-1.0
  substantiveCommentCount: number;
  passiveReactionCount: number;
  totalCommentsAnalyzed: number;
  reasoning: string;
}

/**
 * Determine if a comment is substantive (10+ words, meaningful content)
 * vs passive (emoji-only, single word, low-effort)
 */
function isSubstantiveComment(comment: string): boolean {
  if (!comment || typeof comment !== "string") return false;

  const trimmed = comment.trim();

  // Reject emoji-only comments (simple heuristic: if mostly special characters, likely emoji-only)
  // Check if comment is mostly non-alphanumeric characters
  const alphanumericCount = (trimmed.match(/[a-zA-Z0-9]/g) || []).length;
  if (alphanumericCount < 2) {
    return false; // Too few alphanumeric characters, likely emoji-only
  }

  // Reject single-word responses (including "lol", "haha", "ok", etc.)
  const words = trimmed.split(/\s+/).filter((w) => w.length > 0);
  if (words.length < 3) {
    return false;
  }

  // Reject low-effort responses
  const lowEffortPatterns = /^(lol|haha|ha|ok|yes|no|cool|nice|good|bad|wow|omg|wtf|bruh|lmao|rofl)$/i;
  if (lowEffortPatterns.test(trimmed)) {
    return false;
  }

  // Substantive if:
  // - Contains 10+ words
  // - Contains question mark (asking a question)
  // - Contains personal disclosure indicators ("I", "me", "my", "we")
  // - Contains multiple sentences (periods, exclamation marks)
  const hasEnoughWords = words.length >= 10;
  const hasQuestion = trimmed.includes("?");
  const hasPersonalDisclosure = /\b(i|me|my|we|us|our)\b/i.test(trimmed);
  const hasMultipleSentences = (trimmed.match(/[.!]/g) || []).length >= 2;

  return hasEnoughWords || hasQuestion || hasPersonalDisclosure || hasMultipleSentences;
}

/**
 * Calculate engagement quality score from a list of comments
 * @param comments Array of comment strings from TikTok videos
 * @returns EngagementQualityResult with score (0.0-1.0) and breakdown
 */
export function calculateEngagementQualityScore(comments: string[]): EngagementQualityResult {
  if (!comments || comments.length === 0) {
    return {
      engagementQualityScore: 0.5, // neutral if no data
      substantiveCommentCount: 0,
      passiveReactionCount: 0,
      totalCommentsAnalyzed: 0,
      reasoning: "No comments available for analysis.",
    };
  }

  // Limit analysis to first 50 comments for performance
  const analyzedComments = comments.slice(0, 50);

  let substantiveCount = 0;
  let passiveCount = 0;

  for (const comment of analyzedComments) {
    if (isSubstantiveComment(comment)) {
      substantiveCount++;
    } else {
      passiveCount++;
    }
  }

  const totalAnalyzed = analyzedComments.length;
  const score = totalAnalyzed > 0 ? substantiveCount / totalAnalyzed : 0.5;

  return {
    engagementQualityScore: Math.max(0, Math.min(1, score)), // clamp to 0-1
    substantiveCommentCount: substantiveCount,
    passiveReactionCount: passiveCount,
    totalCommentsAnalyzed: totalAnalyzed,
    reasoning:
      `${substantiveCount} substantive comments out of ${totalAnalyzed} analyzed. ` +
      `Quality score: ${(score * 100).toFixed(1)}%.`,
  };
}

/**
 * Extract comments from TikTok API response
 * Assumes comments are available in the API response structure
 * @param videoData Array of video objects from TikTok API
 * @returns Flattened array of comment strings
 */
export function extractCommentsFromVideos(
  videoData: Array<{
    comments?: number;
    caption?: string;
    id?: string;
    // Additional fields that might contain comment data
    [key: string]: unknown;
  }>
): string[] {
  const comments: string[] = [];

  for (const video of videoData) {
    // Note: TikTok API does not directly expose comment text in most endpoints
    // This function is a placeholder for future integration with comment endpoints
    // For now, we'll extract what we can from captions and video metadata

    if (video.caption && typeof video.caption === "string") {
      // Creator's own caption (not a comment, but related engagement signal)
      if (video.caption.length > 0) {
        comments.push(video.caption);
      }
    }
  }

  return comments;
}

/**
 * Apply engagement quality score as modifier to Performance Consistency Signal
 * High quality engagement (0.7+) = +15 bonus
 * Medium quality engagement (0.4-0.7) = +5 bonus
 * Low quality engagement (<0.4) = -10 penalty
 */
export function applyEngagementQualityModifier(
  baseScore: number,
  engagementQualityScore: number
): number {
  let modifier = 0;

  if (engagementQualityScore >= 0.7) {
    modifier = 15; // High quality
  } else if (engagementQualityScore >= 0.4) {
    modifier = 5; // Medium quality
  } else {
    modifier = -10; // Low quality
  }

  return Math.max(0, Math.min(100, baseScore + modifier));
}
