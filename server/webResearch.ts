/**
 * Web Research Layer
 * Gathers real, evidence-based data about a creator or brand BEFORE passing
 * anything to the LLM for cultural extraction. This prevents hallucination by
 * grounding every profile in actual public content.
 *
 * Strategy:
 * 1. TikTok/Instagram creators → TikTok Data API (user info + popular posts) +
 *    web search for recent video titles and context
 * 2. Brands → web search for brand description, mission, audience, and reviews
 */

import { callDataApi } from "./_core/dataApi";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CreatorResearchResult {
  handle: string;
  platform: string;
  displayName: string;
  bio: string;
  followerCount: number;
  videoCount: number;
  totalLikes: number;
  location: string;
  profileUrl: string;
  recentVideoTitles: string[];
  topHashtags: string[];
  contentThemes: string[];
  evidenceSummary: string; // Plain-text evidence block passed to LLM
}

export interface BrandResearchResult {
  brandName: string;
  websiteUrl: string;
  description: string;
  searchSnippets: string[];
  evidenceSummary: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractHandle(handleOrUrl: string): string {
  // Handle formats: @handle, handle, https://tiktok.com/@handle, https://instagram.com/handle
  const urlMatch = handleOrUrl.match(/(?:tiktok\.com\/@?|instagram\.com\/)([^/?#\s]+)/i);
  if (urlMatch) return urlMatch[1].replace(/^@/, "");
  return handleOrUrl.replace(/^@/, "").trim();
}

function extractHashtags(texts: string[]): string[] {
  const tagCounts: Record<string, number> = {};
  for (const text of texts) {
    const matches = text.match(/#([a-zA-Z0-9_]+)/g) ?? [];
    for (const tag of matches) {
      const clean = tag.toLowerCase();
      tagCounts[clean] = (tagCounts[clean] ?? 0) + 1;
    }
  }
  return Object.entries(tagCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([tag]) => tag);
}

function inferContentThemes(
  videoTitles: string[],
  hashtags: string[],
  bio: string
): string[] {
  const allText = [...videoTitles, ...hashtags, bio].join(" ").toLowerCase();
  const themeMap: Record<string, string[]> = {
    "Food & Restaurant Reviews": ["food", "restaurant", "review", "eat", "taste", "menu", "halal", "shawarma", "pizza", "chicken", "cooking", "recipe", "chef"],
    "Local City Culture": ["toronto", "montreal", "nyc", "london", "city", "local", "street", "neighbourhood"],
    "Street Interviews": ["interview", "street", "ask", "people", "random", "reaction"],
    "Family & Parenting": ["father", "dad", "kids", "children", "family", "parenting", "single"],
    "Comedy & Entertainment": ["funny", "comedy", "laugh", "prank", "challenge", "skit"],
    "Lifestyle & Daily Life": ["day in", "vlog", "lifestyle", "daily", "routine"],
    "Culture & Identity": ["arab", "muslim", "culture", "heritage", "middle eastern", "immigrant", "diaspora"],
    "Fitness & Health": ["gym", "workout", "fitness", "health", "exercise", "training"],
    "Fashion & Beauty": ["fashion", "outfit", "style", "beauty", "makeup", "skincare"],
    "Travel": ["travel", "trip", "explore", "adventure", "visit", "destination"],
    "Tech & Gaming": ["tech", "gaming", "game", "app", "software", "review"],
    "Business & Finance": ["business", "money", "finance", "invest", "entrepreneur"],
  };

  const matched: string[] = [];
  for (const [theme, keywords] of Object.entries(themeMap)) {
    const score = keywords.filter((kw) => allText.includes(kw)).length;
    if (score >= 2) matched.push(theme);
  }
  return matched.length > 0 ? matched : ["General Content Creator"];
}

// ─── HTTP Fetch Helper ────────────────────────────────────────────────────────

async function fetchHtml(url: string): Promise<string> {
  const { default: axios } = await import("axios");
  const response = await axios.get(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
    },
    timeout: 12000,
  });
  return response.data as string;
}

// ─── TikTok Research ──────────────────────────────────────────────────────────

async function researchTikTokCreator(
  handleOrUrl: string
): Promise<CreatorResearchResult> {
  const handle = extractHandle(handleOrUrl);

  // Step 1: Get user info (bio, stats, secUid) from TikTok Data API
  let secUid = "";
  let displayName = handle;
  let bio = "";
  let followerCount = 0;
  let videoCount = 0;
  let totalLikes = 0;
  let location = "";

  try {
    const userResponse = await callDataApi("Tiktok/get_user_info", {
      query: { uniqueId: handle },
    }) as Record<string, unknown>;

    const userInfoData = (userResponse?.userInfo as Record<string, unknown>) ?? {};
    const user = (userInfoData?.user as Record<string, unknown>) ?? {};
    const stats = (userInfoData?.stats as Record<string, unknown>) ?? {};

    secUid = (user?.secUid as string) ?? "";
    displayName = (user?.nickname as string) ?? handle;
    bio = (user?.signature as string) ?? "";
    followerCount = Number(stats?.followerCount ?? 0);
    videoCount = Number(stats?.videoCount ?? 0);
    totalLikes = Number(stats?.heartCount ?? 0);

    // Extract location from bio
    const locationPatterns = [
      /\b(Toronto|New York|NYC|Los Angeles|LA|London|Dubai|Paris|Chicago|Miami|Houston|Atlanta|Montreal|Vancouver|Sydney|Melbourne|Calgary|Ottawa|Edmonton|Winnipeg|Quebec|Halifax)\b/i,
    ];
    for (const pattern of locationPatterns) {
      const match = bio.match(pattern);
      if (match) { location = match[1]; break; }
    }
  } catch (err) {
    console.warn("[webResearch] TikTok user info failed:", err);
  }

  // Step 2: Scrape TikTok profile page HTML for video descriptions
  const videoTitles: string[] = [];
  try {
    const html = await fetchHtml(`https://www.tiktok.com/@${handle}`);
    // Extract video descriptions from JSON embedded in page
    const descMatches = html.match(/"desc":"([^"]{10,200})"/g) ?? [];
    for (const m of descMatches) {
      const desc = m.replace(/^"desc":"/, "").replace(/"$/, "").trim();
      if (desc && !desc.includes("Followers") && !desc.includes("Watch awesome")) {
        videoTitles.push(desc);
      }
    }
    // Also extract signature if API failed
    if (!bio) {
      const sigMatch = html.match(/"signature":"([^"]+)"/);
      if (sigMatch) bio = sigMatch[1].replace(/\\n/g, " ").replace(/\\u[0-9a-fA-F]{4}/g, "").trim();
    }
  } catch (err) {
    console.warn("[webResearch] TikTok HTML scrape failed:", err);
  }

  // Step 3: Get popular posts via Data API (requires secUid)
  if (secUid) {
    try {
      const postsResponse = await callDataApi("Tiktok/get_user_popular_posts", {
        query: { secUid, count: "20" },
      }) as Record<string, unknown>;

      const itemList = ((postsResponse?.data as Record<string, unknown>)?.itemList as unknown[]) ?? [];
      for (const item of itemList) {
        const desc = ((item as Record<string, unknown>)?.desc as string) ?? "";
        if (desc.trim()) videoTitles.push(desc.trim());
      }
    } catch (err) {
      console.warn("[webResearch] TikTok popular posts failed:", err);
    }
  }

  // Step 4: TikTok search API for additional video context
  try {
    const searchResponse = await callDataApi("Tiktok/search_tiktok_video_general", {
      query: { keyword: handle },
    }) as Record<string, unknown>;

    const items = (searchResponse?.data as unknown[]) ?? [];
    for (const item of items) {
      const desc = ((item as Record<string, unknown>)?.desc as string) ?? "";
      const authorId = (((item as Record<string, unknown>)?.author as Record<string, unknown>)?.uniqueId as string) ?? "";
      if (authorId.toLowerCase() === handle.toLowerCase() && desc.trim()) {
        videoTitles.push(desc.trim());
      }
    }
  } catch (err) {
    console.warn("[webResearch] TikTok search failed:", err);
  }

  const uniqueVideoTitles = Array.from(new Set(videoTitles)).slice(0, 20);
  const topHashtags = extractHashtags([...uniqueVideoTitles, bio]);
  const contentThemes = inferContentThemes(uniqueVideoTitles, topHashtags, bio);

  // Build the evidence summary — this is the key input to the LLM
  const evidenceSummary = buildCreatorEvidenceSummary({
    handle,
    platform: "TikTok",
    displayName,
    bio,
    followerCount,
    videoCount,
    totalLikes,
    location,
    videoTitles: uniqueVideoTitles,
    topHashtags,
    contentThemes,
  });

  return {
    handle,
    platform: "TikTok",
    displayName,
    bio,
    followerCount,
    videoCount,
    totalLikes,
    location,
    profileUrl: `https://www.tiktok.com/@${handle}`,
    recentVideoTitles: uniqueVideoTitles,
    topHashtags,
    contentThemes,
    evidenceSummary,
  };
}

// ─── Instagram Research ───────────────────────────────────────────────────────

async function researchInstagramCreator(
  handleOrUrl: string
): Promise<CreatorResearchResult> {
  const handle = extractHandle(handleOrUrl);

  // Instagram blocks direct HTTP scraping. Instead, we use a multi-source research strategy:
  // 1. YouTube search for the creator (most reliable — returns real titles, descriptions, channel info)
  // 2. YouTube channel search to find their channel description
  // 3. Attempt Instagram page fetch as a best-effort fallback (often blocked but worth trying)

  let bio = "";
  let displayName = handle;
  let followerCount = 0;
  const videoCount = 0;
  const totalLikes = 0;
  const videoTitles: string[] = [];
  let location = "";

  // Step 1: Primary — YouTube video search for this creator
  // This is the most reliable source: YouTube returns real titles, descriptions, and channel names
  try {
    const ytVideoResponse = await callDataApi("Youtube/search", {
      query: { q: `${handle} instagram`, hl: "en", gl: "US" },
    }) as Record<string, unknown>;
    const contents = (ytVideoResponse?.contents as unknown[]) ?? [];
    for (const item of contents.slice(0, 10)) {
      const videoData = ((item as Record<string, unknown>)?.video as Record<string, unknown>);
      if (videoData) {
        const title = (videoData?.title as string) ?? "";
        const desc = (videoData?.descriptionSnippet as string) ?? "";
        const channelName = ((videoData?.author as Record<string, unknown>)?.title as string) ?? "";
        if (title) videoTitles.push(title);
        if (desc) videoTitles.push(desc);
        // If the channel name matches the handle, use it as display name
        if (channelName && channelName.toLowerCase().includes(handle.toLowerCase().replace(/[^a-z0-9]/g, ""))) {
          displayName = channelName;
        }
      }
    }
  } catch (err) {
    console.warn("[webResearch] Instagram/YouTube video search failed:", err);
  }

  // Step 2: YouTube channel search — gets the creator's channel description and subscriber count
  try {
    const ytChannelResponse = await callDataApi("Youtube/search", {
      query: { q: handle, type: "channel", hl: "en", gl: "US" },
    }) as Record<string, unknown>;
    const channelContents = (ytChannelResponse?.contents as unknown[]) ?? [];
    for (const item of channelContents.slice(0, 3)) {
      const channelData = ((item as Record<string, unknown>)?.channel as Record<string, unknown>);
      if (channelData) {
        const channelTitle = (channelData?.title as string) ?? "";
        const channelDesc = (channelData?.descriptionSnippet as string) ?? "";
        const subs = (channelData?.subscriberCountText as string) ?? "";
        if (channelTitle && !displayName.includes(" ")) displayName = channelTitle;
        if (channelDesc) { bio = channelDesc; videoTitles.push(channelDesc); }
        if (subs) {
          const subMatch = subs.match(/([\d.]+[KkMm]?)/);
          if (subMatch) {
            const raw = subMatch[1];
            if (raw.endsWith("K") || raw.endsWith("k")) followerCount = parseFloat(raw) * 1000;
            else if (raw.endsWith("M") || raw.endsWith("m")) followerCount = parseFloat(raw) * 1000000;
            else followerCount = parseInt(raw, 10);
          }
        }
      }
    }
  } catch (err) {
    console.warn("[webResearch] YouTube channel search failed:", err);
  }

  // Step 3: Best-effort Instagram page fetch (often blocked, but try anyway)
  try {
    const html = await fetchHtml(`https://www.instagram.com/${handle}/`);
    const metaDesc = html.match(/<meta\s+(?:name|property)="description"\s+content="([^"]+)"/i)?.[1] ?? "";
    if (metaDesc && !bio) bio = metaDesc;
    const titleMatch = html.match(/<title>([^<]+)<\/title>/i)?.[1] ?? "";
    if (titleMatch && displayName === handle) {
      displayName = titleMatch.split("•")[0].split("(")[0].trim() || handle;
    }
    // Extract follower count from meta
    const followerMatch = metaDesc.match(/([\d,.]+[KkMm]?)\s*Followers/i);
    if (followerMatch && followerCount === 0) {
      const raw = followerMatch[1].replace(/,/g, "");
      if (raw.endsWith("K") || raw.endsWith("k")) followerCount = parseFloat(raw) * 1000;
      else if (raw.endsWith("M") || raw.endsWith("m")) followerCount = parseFloat(raw) * 1000000;
      else followerCount = parseInt(raw, 10);
    }
  } catch (err) {
    // Expected to fail — Instagram blocks bots. Log at debug level only.
    console.log("[webResearch] Instagram direct fetch blocked (expected):", (err as Error).message?.slice(0, 80));
  }

  // Extract location from all collected text
  const allText = [bio, ...videoTitles].join(" ");
  const locationPatterns = [
    /\b(Toronto|New York|NYC|Los Angeles|LA|London|Dubai|Paris|Chicago|Miami|Houston|Atlanta|Montreal|Vancouver|Sydney|Melbourne|Cleveland|Brooklyn|Queens|Manhattan|Nashville|Austin|Seattle|Denver|Boston|Philadelphia)\b/i,
  ];
  for (const pattern of locationPatterns) {
    const match = allText.match(pattern);
    if (match) { location = match[1]; break; }
  }

  const topHashtags = extractHashtags([...videoTitles, bio]);
  const contentThemes = inferContentThemes(videoTitles, topHashtags, bio);

  const evidenceSummary = buildCreatorEvidenceSummary({
    handle,
    platform: "Instagram",
    displayName,
    bio,
    followerCount,
    videoCount,
    totalLikes,
    location,
    videoTitles: videoTitles.slice(0, 20),
    topHashtags,
    contentThemes,
  });

  return {
    handle,
    platform: "Instagram",
    displayName,
    bio,
    followerCount,
    videoCount,
    totalLikes,
    location,
    profileUrl: `https://www.instagram.com/${handle}/`,
    recentVideoTitles: videoTitles.slice(0, 20),
    topHashtags,
    contentThemes,
    evidenceSummary,
  };
}

// ─── Brand Research ───────────────────────────────────────────────────────────

export async function researchBrand(brandNameOrUrl: string): Promise<BrandResearchResult> {
  const isUrl = brandNameOrUrl.startsWith("http");
  const brandName = isUrl
    ? brandNameOrUrl.replace(/https?:\/\/(www\.)?/, "").split("/")[0]
    : brandNameOrUrl;

  const snippets: string[] = [];
  let description = "";

  // Fetch brand website if URL provided
  if (isUrl) {
    try {
      const html = await fetchHtml(brandNameOrUrl);

      // Extract meta description
      const metaDesc = html.match(/<meta\s+(?:name|property)="description"\s+content="([^"]+)"/i)?.[1] ?? "";
      if (metaDesc) snippets.push(`Website description: ${metaDesc}`);

      // Extract title
      const title = html.match(/<title>([^<]+)<\/title>/i)?.[1] ?? "";
      if (title) snippets.push(`Website title: ${title}`);

      // Extract h1 and h2 tags
      const headings = html.match(/<h[12][^>]*>([^<]+)<\/h[12]>/gi) ?? [];
      for (const h of headings.slice(0, 5)) {
        const text = h.replace(/<[^>]+>/g, "").trim();
        if (text.length > 5) snippets.push(`Heading: ${text}`);
      }

      // Extract about/mission text
      const aboutMatch = html.match(/(?:about|mission|vision|values)[^<]{0,50}<[^>]+>([^<]{30,300})/gi) ?? [];
      for (const m of aboutMatch.slice(0, 3)) {
        const text = m.replace(/<[^>]+>/g, "").trim();
        if (text.length > 20) snippets.push(`About: ${text}`);
      }

      description = snippets.join(" | ").slice(0, 1000);
    } catch (err) {
      console.warn("[webResearch] Brand website fetch failed:", err);
    }
  }

  // For brand-name-only input (no URL), search YouTube for brand context
  if (!isUrl || snippets.length < 2) {
    try {
      const ytResponse = await callDataApi("Youtube/search", {
        query: { q: `${brandName} brand about`, hl: "en", gl: "US" },
      }) as Record<string, unknown>;
      const contents = (ytResponse?.contents as unknown[]) ?? [];
      for (const item of contents.slice(0, 5)) {
        const videoData = ((item as Record<string, unknown>)?.video as Record<string, unknown>);
        if (videoData) {
          const title = (videoData?.title as string) ?? "";
          const desc = (videoData?.descriptionSnippet as string) ?? "";
          if (title) snippets.push(`YouTube result: ${title}`);
          if (desc) snippets.push(`YouTube description: ${desc}`);
        }
      }
      if (!description && snippets.length > 0) {
        description = snippets.join(" | ").slice(0, 1000);
      }
    } catch (err) {
      console.warn("[webResearch] Brand YouTube search failed:", err);
    }
  }

  // Build evidence summary
  const evidenceSummary = `
BRAND RESEARCH EVIDENCE
=======================
Brand Name: ${brandName}
Website: ${isUrl ? brandNameOrUrl : "Not provided"}
${description ? `Website Content:\n${description}` : ""}
${snippets.length > 0 ? `\nKey Snippets:\n${snippets.slice(0, 8).join("\n")}` : ""}

INSTRUCTIONS FOR ANALYSIS:
Based on the above evidence, extract the brand's cultural profile. If the website content is limited,
use your knowledge of this brand/business name to supplement, but clearly ground your analysis in
what the evidence shows. Do NOT invent a brand identity that contradicts the evidence.
`.trim();

  return {
    brandName,
    websiteUrl: isUrl ? brandNameOrUrl : "",
    description,
    searchSnippets: snippets,
    evidenceSummary,
  };
}

// ─── Evidence Summary Builder ─────────────────────────────────────────────────

function buildCreatorEvidenceSummary(data: {
  handle: string;
  platform: string;
  displayName: string;
  bio: string;
  followerCount: number;
  videoCount: number;
  totalLikes: number;
  location: string;
  videoTitles: string[];
  topHashtags: string[];
  contentThemes: string[];
}): string {
  const {
    handle, platform, displayName, bio, followerCount, videoCount,
    totalLikes, location, videoTitles, topHashtags, contentThemes,
  } = data;

  const formatNum = (n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
  };

  return `
CREATOR RESEARCH EVIDENCE — @${handle} (${platform})
=====================================================
Display Name: ${displayName}
Platform: ${platform}
Profile URL: https://www.${platform.toLowerCase()}.com/@${handle}
Bio / Signature: "${bio}"
Location: ${location || "Not specified in bio"}
Followers: ${formatNum(followerCount)}
Total Videos: ${videoCount}
Total Likes: ${formatNum(totalLikes)}

CONTENT THEMES DETECTED (from actual post analysis):
${contentThemes.map((t) => `  • ${t}`).join("\n")}

TOP HASHTAGS USED:
${topHashtags.slice(0, 10).join(", ")}

ACTUAL VIDEO TITLES / DESCRIPTIONS (${videoTitles.length} posts sampled):
${videoTitles.slice(0, 15).map((t, i) => `  ${i + 1}. ${t}`).join("\n")}

INSTRUCTIONS FOR ANALYSIS:
You are analyzing a REAL creator. The data above is scraped directly from their public profile.
Base your entire cultural analysis on this evidence. Do NOT contradict the evidence.
For example, if the video titles show food reviews in Toronto, the creator is a food/local culture creator — NOT a travel creator.
The bio, video titles, and hashtags are ground truth. Analyze them carefully.
`.trim();
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export async function researchCreator(
  handleOrUrl: string,
  platform: string
): Promise<CreatorResearchResult> {
  const handle = extractHandle(handleOrUrl);

  if (platform === "Instagram") {
    return researchInstagramCreator(handle);
  }

  // Default: TikTok (also handles TikTok URLs)
  if (
    platform === "TikTok" ||
    handleOrUrl.includes("tiktok.com") ||
    !handleOrUrl.includes("instagram.com")
  ) {
    return researchTikTokCreator(handle);
  }

  return researchInstagramCreator(handle);
}
