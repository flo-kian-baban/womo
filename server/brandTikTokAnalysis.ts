import { invokeLLM } from "./_core/llm";
import { callDataApi } from "./_core/dataApi";

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
  videoAnalysisSummary?: string; // LLM-generated summary of video analysis
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
 * 
 * Pipeline:
 * 1. Extract brand handle from input
 * 2. Fetch TikTok user info via Data API
 * 3. Fetch 10-15 recent videos
 * 4. Analyze video captions, engagement, and themes
 * 5. Use LLM to classify brand voice and content themes
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
    // Step 1: Fetch TikTok user info
    console.info(`[analyzeBrandTikTokChannel] Fetching TikTok data for @${handle}...`);
    
    let userInfo: any = null;
    let videos: any[] = [];
    let followerCount: number | undefined;
    let bioText: string | undefined;
    let engagementRate: number | undefined;
    let averageViews: number | undefined;

    try {
      userInfo = await callDataApi("TikTok/get_user_info", {
        query: { username: handle },
      });
      
      if (userInfo?.user) {
        followerCount = userInfo.user.stats?.followerCount;
        bioText = userInfo.user.signature;
        console.info(`[analyzeBrandTikTokChannel] Found @${handle} with ${followerCount?.toLocaleString()} followers`);
      }
    } catch (err) {
      console.warn(`[analyzeBrandTikTokChannel] Could not fetch user info for @${handle}:`, err);
    }

    // Step 2: Fetch recent videos
    try {
      const videosResult = await callDataApi("TikTok/get_user_post_list", {
        query: {
          username: handle,
          count: "15",
        },
      });
      
      videos = (videosResult as any)?.videos || [];
      console.info(`[analyzeBrandTikTokChannel] Fetched ${videos.length} recent videos for @${handle}`);
    } catch (err) {
      console.warn(`[analyzeBrandTikTokChannel] Could not fetch videos for @${handle}:`, err);
    }

    // Step 3: Extract video metadata and calculate engagement
    let totalEngagement = 0;
    let totalViews = 0;
    const videoCaptions: string[] = [];
    const videoThemes: string[] = [];

    if (videos.length > 0) {
      for (const video of videos) {
        const desc = video.desc || "";
        const playCount = video.stats?.playCount || 0;
        const commentCount = video.stats?.commentCount || 0;
        const shareCount = video.stats?.shareCount || 0;
        const diggCount = video.stats?.diggCount || 0;

        totalViews += playCount;
        totalEngagement += commentCount + shareCount + diggCount;

        if (desc) {
          videoCaptions.push(desc);
        }
      }

      if (totalViews > 0) {
        averageViews = Math.round(totalViews / videos.length);
        engagementRate = (totalEngagement / totalViews) * 100;
      }
    }

    // Step 4: Use LLM to analyze brand voice and themes
    let brandVoice: string | undefined;
    let contentThemes: string[] | undefined;
    let audienceInteractionStyle: string | undefined;
    let videoAnalysisSummary: string | undefined;

    if (videoCaptions.length > 0 || bioText) {
      try {
        const analysisPrompt = `
You are analyzing a TikTok brand channel to extract cultural and voice signals.

**Channel Handle:** @${handle}
**Bio:** ${bioText || "N/A"}
**Recent Video Captions (${videoCaptions.length} videos):**
${videoCaptions.slice(0, 10).map((c, i) => `${i + 1}. ${c}`).join("\n")}

**Engagement Metrics:**
- Total Views (last 15 videos): ${totalViews.toLocaleString()}
- Average Views per Video: ${averageViews?.toLocaleString() || "N/A"}
- Engagement Rate: ${engagementRate?.toFixed(2)}%
- Total Engagement: ${totalEngagement.toLocaleString()}

Based on this data, extract:
1. **Brand Voice** (2-4 descriptors): How does this brand communicate? (e.g., "playful, trendy, educational, authentic")
2. **Content Themes** (3-5 themes): What are the main content categories? (e.g., "lifestyle", "humor", "product demos", "behind-the-scenes")
3. **Audience Interaction Style** (1-2 sentences): How does the brand engage with its audience?
4. **Overall Analysis** (2-3 sentences): Summary of the brand's social media positioning and cultural presence

Format your response as JSON:
{
  "brandVoice": "comma-separated descriptors",
  "contentThemes": ["theme1", "theme2", "theme3"],
  "audienceInteractionStyle": "description of interaction style",
  "summary": "overall analysis"
}
`;

        const response = await invokeLLM({
          messages: [
            {
              role: "system",
              content: "You are a cultural analyst specializing in brand voice and social media positioning. Extract structured insights from TikTok channel data.",
            },
            {
              role: "user",
              content: analysisPrompt,
            },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "brand_tiktok_analysis",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  brandVoice: { type: "string", description: "Brand voice descriptors" },
                  contentThemes: {
                    type: "array",
                    items: { type: "string" },
                    description: "Content themes",
                  },
                  audienceInteractionStyle: {
                    type: "string",
                    description: "How the brand interacts with audience",
                  },
                  summary: { type: "string", description: "Overall analysis" },
                },
                required: ["brandVoice", "contentThemes", "audienceInteractionStyle", "summary"],
                additionalProperties: false,
              },
            },
          },
        });

        try {
          const content = response.choices?.[0]?.message?.content;
          if (content) {
            const parsed = typeof content === "string" ? JSON.parse(content) : content;
            brandVoice = parsed.brandVoice;
            contentThemes = parsed.contentThemes;
            audienceInteractionStyle = parsed.audienceInteractionStyle;
            videoAnalysisSummary = parsed.summary;
          }
        } catch (parseErr) {
          console.warn("[analyzeBrandTikTokChannel] Failed to parse LLM response:", parseErr);
        }
      } catch (llmErr) {
        console.warn("[analyzeBrandTikTokChannel] LLM analysis failed:", llmErr);
      }
    }

    // Step 5: Determine post frequency
    let postFrequency: string | undefined;
    if (videos.length >= 15) {
      postFrequency = "daily or near-daily";
    } else if (videos.length >= 8) {
      postFrequency = "3-5x per week";
    } else if (videos.length >= 4) {
      postFrequency = "1-2x per week";
    } else if (videos.length > 0) {
      postFrequency = "sporadic";
    }

    const metadata: BrandTikTokMetadata = {
      channelHandle: handle,
      followerCount,
      engagementRate: engagementRate ? Math.round(engagementRate * 100) / 100 : undefined,
      brandVoice,
      contentThemes,
      audienceInteractionStyle,
      topVideoThemes: contentThemes,
      averageViews,
      postFrequency,
      tiktokBioAnalysis: bioText,
      videoAnalysisSummary,
    };

    console.info(`[analyzeBrandTikTokChannel] Successfully analyzed @${handle}`);
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
  parts.push(`## TikTok Channel Analysis\n`);
  parts.push(`- Handle: @${metadata.channelHandle}`);

  if (metadata.followerCount) {
    parts.push(`- Followers: ${metadata.followerCount.toLocaleString()}`);
  }

  if (metadata.engagementRate !== undefined) {
    parts.push(`- Engagement Rate: ${metadata.engagementRate.toFixed(2)}%`);
  }

  if (metadata.averageViews) {
    parts.push(`- Average Views per Video: ${metadata.averageViews.toLocaleString()}`);
  }

  if (metadata.postFrequency) {
    parts.push(`- Post Frequency: ${metadata.postFrequency}`);
  }

  if (metadata.brandVoice) {
    parts.push(`- Brand Voice: ${metadata.brandVoice}`);
  }

  if (metadata.contentThemes && metadata.contentThemes.length > 0) {
    parts.push(`- Content Themes: ${metadata.contentThemes.join(", ")}`);
  }

  if (metadata.audienceInteractionStyle) {
    parts.push(`- Audience Interaction: ${metadata.audienceInteractionStyle}`);
  }

  if (metadata.videoAnalysisSummary) {
    parts.push(`- Analysis: ${metadata.videoAnalysisSummary}`);
  }

  if (metadata.tiktokBioAnalysis) {
    parts.push(`- Bio: "${metadata.tiktokBioAnalysis}"`);
  }

  return parts.join("\n");
}
