import { invokeLLM } from "./_core/llm";

/**
 * Brand TikTok Channel Analysis
 *
 * Analyzes a brand's TikTok channel to extract:
 * - Brand voice and tone signals
 * - Content themes and categories
 * - Engagement metrics and audience interaction style
 * - Social media positioning
 */

export interface BrandTikTokMetadata {
  channelHandle: string;
  followerCount?: number;
  engagementRate?: number;
  brandVoice?: string; // e.g., "playful, trendy, educational"
  contentThemes?: string[]; // e.g., ["lifestyle", "humor", "product demos"]
  audienceInteractionStyle?: string; // e.g., "highly responsive, community-driven"
  topVideoThemes?: string[];
  averageViews?: number;
  postFrequency?: string; // e.g., "daily", "3x per week"
  tiktokBioAnalysis?: string;
}

/**
 * Extract brand handle from URL or direct handle
 */
function extractBrandHandle(input: string): string {
  if (!input) return "";
  
  // Remove @ if present
  let handle = input.startsWith("@") ? input.slice(1) : input;
  
  // Extract handle from TikTok URL
  if (handle.includes("tiktok.com")) {
    const match = handle.match(/@([a-zA-Z0-9._-]+)/);
    if (match) handle = match[1];
  }
  
  return handle.toLowerCase();
}

/**
 * Analyze brand TikTok channel
 * Returns metadata about the brand's TikTok presence
 */
export async function analyzeBrandTikTokChannel(
  tiktokChannelUrl: string | undefined | null
): Promise<BrandTikTokMetadata | null> {
  if (!tiktokChannelUrl || tiktokChannelUrl.trim() === "") {
    return null;
  }

  const handle = extractBrandHandle(tiktokChannelUrl);
  if (!handle) {
    console.warn("[analyzeBrandTikTokChannel] Could not extract handle from:", tiktokChannelUrl);
    return null;
  }

  try {
    // In a real implementation, you would:
    // 1. Fetch brand's TikTok channel data via TikTok API
    // 2. Fetch 10-15 recent videos
    // 3. Analyze video content, captions, and comments
    // 4. Extract engagement metrics
    // 5. Use LLM to classify brand voice and themes

    // For now, return a placeholder structure
    // This will be filled in with actual API calls in the next phase
    const metadata: BrandTikTokMetadata = {
      channelHandle: handle,
      // These would be populated from actual API data
      followerCount: undefined,
      engagementRate: undefined,
      brandVoice: undefined,
      contentThemes: undefined,
      audienceInteractionStyle: undefined,
      topVideoThemes: undefined,
      averageViews: undefined,
      postFrequency: undefined,
      tiktokBioAnalysis: undefined,
    };

    return metadata;
  } catch (err) {
    console.warn("[analyzeBrandTikTokChannel] Error analyzing TikTok channel:", err);
    return null;
  }
}

/**
 * Generate TikTok evidence block for brand extraction prompt
 */
export function formatBrandTikTokEvidenceBlock(
  metadata: BrandTikTokMetadata | null
): string {
  if (!metadata) {
    return "";
  }

  const parts: string[] = [];
  parts.push(`## Brand TikTok Channel Analysis\n`);
  parts.push(`- Handle: @${metadata.channelHandle}`);

  if (metadata.followerCount) {
    parts.push(`- Followers: ${metadata.followerCount.toLocaleString()}`);
  }

  if (metadata.engagementRate) {
    parts.push(`- Engagement Rate: ${metadata.engagementRate.toFixed(2)}%`);
  }

  if (metadata.brandVoice) {
    parts.push(`- Brand Voice: ${metadata.brandVoice}`);
  }

  if (metadata.contentThemes && metadata.contentThemes.length > 0) {
    parts.push(`- Content Themes: ${metadata.contentThemes.join(", ")}`);
  }

  if (metadata.audienceInteractionStyle) {
    parts.push(`- Audience Interaction Style: ${metadata.audienceInteractionStyle}`);
  }

  if (metadata.postFrequency) {
    parts.push(`- Post Frequency: ${metadata.postFrequency}`);
  }

  if (metadata.tiktokBioAnalysis) {
    parts.push(`- Bio Analysis: ${metadata.tiktokBioAnalysis}`);
  }

  return parts.join("\n");
}
