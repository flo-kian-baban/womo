/**
 * Scraper Verification Test — Phase 2
 *
 * Tests the TikTok and Instagram scraping pipelines against 4 public profiles.
 * No database writes, no LLM analysis. Scraping-only verification.
 *
 * Run with: npx tsx server/test_scraper_verification.ts
 */

import { scrapeTikTokProfile } from "./scraping/tiktok/profileScraper";
import { scrapeInstagramProfile } from "./scraping/instagram/profileScraper";
import { fetchHtml, requestGovernor, detectSilentFailure } from "./scraping/httpClient";
import { shutdown } from "./scraping/browserClient";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TikTokVideoReport {
  id: string;
  caption: string;
  playCount: number;
  diggCount: number;
  commentCount: number;
  shareCount: number;
  createTime: string;
  duration: number;
  isOriginalAudio: boolean;
}

interface TikTokTranscriptReport {
  videoId: string;
  webvttFound: boolean;
  transcriptDownloaded: boolean;
  transcriptText: string;
  whisperFallbackTriggered: boolean;
  wordCount: number;
  source: string;
}

interface ProfileReport {
  handle: string;
  platform: "tiktok" | "instagram";
  overallStatus: "PASS" | "PARTIAL" | "FAIL";
  scrapePath: string;
  silentFailureDetected: boolean;
  profileData: Record<string, unknown>;
  videoCount: number;
  videos: TikTokVideoReport[];
  transcripts?: TikTokTranscriptReport[];
  posts?: Record<string, unknown>[];
  errors: string[];
  warnings: string[];
  timingMs: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(val: unknown): string {
  if (val === null || val === undefined) return "null";
  if (typeof val === "string") return val.length > 100 ? val.slice(0, 100) + "…" : val;
  return String(val);
}

function sep(title: string): void {
  console.log("\n" + "═".repeat(70));
  console.log(`  ${title}`);
  console.log("═".repeat(70));
}

// ─── TikTok Profile Test ──────────────────────────────────────────────────────

async function testTikTokProfile(handle: string): Promise<ProfileReport> {
  const report: ProfileReport = {
    handle,
    platform: "tiktok",
    overallStatus: "FAIL",
    scrapePath: "unknown",
    silentFailureDetected: false,
    profileData: {},
    videoCount: 0,
    videos: [],
    transcripts: [],
    errors: [],
    warnings: [],
    timingMs: 0,
  };

  const start = Date.now();

  try {
    console.log(`\n[TEST] Scraping TikTok profile: @${handle}`);
    const result = await scrapeTikTokProfile(handle);
    report.timingMs = Date.now() - start;

    // Determine scrape path from console output (captured in the function)
    // We'll detect it from the result shape
    const userInfo = result.userInfo?.userInfo;
    const posts = result.posts?.data?.itemList ?? [];

    // Profile data
    if (userInfo) {
      report.profileData = {
        nickname: userInfo.user?.nickname,
        bio: userInfo.user?.signature,
        followerCount: userInfo.stats?.followerCount,
        heartCount: userInfo.stats?.heartCount,
        videoCount: userInfo.stats?.videoCount,
        followingCount: userInfo.stats?.followingCount,
        uniqueId: userInfo.user?.uniqueId,
        verified: userInfo.user?.verified,
      };

      // Validate profile
      if (!userInfo.user?.nickname || userInfo.user.nickname === handle) {
        report.warnings.push("nickname equals handle — may be regex fallback");
      }
      if (userInfo.stats?.followerCount === 0) {
        report.warnings.push("followerCount is 0 — possible silent failure");
      }
      if (!userInfo.user?.signature) {
        report.warnings.push("bio/signature is empty");
      }
    } else {
      report.errors.push("userInfo is null/undefined");
    }

    // Video data
    report.videoCount = posts.length;
    report.videos = posts.slice(0, 30).map((v) => ({
      id: v.id,
      caption: v.desc?.slice(0, 100) ?? "",
      playCount: v.stats?.playCount ?? 0,
      diggCount: v.stats?.diggCount ?? 0,
      commentCount: v.stats?.commentCount ?? 0,
      shareCount: v.stats?.shareCount ?? 0,
      createTime: v.createTime
        ? new Date(v.createTime * 1000).toISOString().split("T")[0]
        : "unknown",
      duration: v.video?.duration ?? 0,
      isOriginalAudio: v.music?.original ?? false,
    }));

    if (posts.length === 0) {
      report.errors.push("No videos returned from post list");
    }

    // Transcript test: try 3 most recent videos
    const recentVideos = posts.slice(0, 3);
    for (const video of recentVideos) {
      const transcriptReport = await testTikTokTranscript(handle, video.id, video.desc);
      report.transcripts!.push(transcriptReport);
    }

    // Determine overall status
    const hasProfile = userInfo?.stats?.followerCount > 0;
    const hasVideos = posts.length > 0;
    const hasTranscripts = report.transcripts!.some((t) => t.wordCount > 0);

    if (hasProfile && hasVideos) {
      report.overallStatus = hasTranscripts ? "PASS" : "PARTIAL";
    } else if (hasProfile || hasVideos) {
      report.overallStatus = "PARTIAL";
    } else {
      report.overallStatus = "FAIL";
    }
  } catch (err) {
    report.timingMs = Date.now() - start;
    report.errors.push(`Fatal: ${(err as Error).message}`);
  }

  return report;
}

// ─── TikTok Transcript Test ──────────────────────────────────────────────────

async function testTikTokTranscript(
  handle: string,
  videoId: string,
  caption: string,
): Promise<TikTokTranscriptReport> {
  const report: TikTokTranscriptReport = {
    videoId,
    webvttFound: false,
    transcriptDownloaded: false,
    transcriptText: "",
    whisperFallbackTriggered: false,
    wordCount: 0,
    source: "none",
  };

  try {
    const videoUrl = `https://www.tiktok.com/@${handle}/video/${videoId}`;
    console.log(`  [TRANSCRIPT] Fetching video page: ${videoId}`);

    await requestGovernor("tiktok");
    const html = await fetchHtml(videoUrl, {
      extraHeaders: { Referer: "https://www.tiktok.com/" },
    });

    const rehydrationMatch = html.match(
      /<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/,
    );

    if (!rehydrationMatch) {
      console.log(`  [TRANSCRIPT] No rehydration data for video ${videoId}`);

      // Check for silent failure
      const check = detectSilentFailure("tiktok", html, videoUrl);
      if (check.isFailed) {
        console.log(`  [TRANSCRIPT] Silent failure: ${check.reason}`);
      }
      return report;
    }

    const pageData = JSON.parse(rehydrationMatch[1]) as Record<string, unknown>;
    const defaultScope = (pageData?.["__DEFAULT_SCOPE__"] as Record<string, unknown>) ?? {};
    const videoDetail = (defaultScope?.["webapp.video-detail"] as Record<string, unknown>) ?? {};
    const itemStruct =
      ((videoDetail?.itemInfo as Record<string, unknown>)?.itemStruct as Record<string, unknown>) ??
      {};
    const videoObj = (itemStruct?.video as Record<string, unknown>) ?? {};
    const subtitleInfos = (videoObj?.subtitleInfos as Array<Record<string, unknown>>) ?? [];

    if (subtitleInfos.length > 0) {
      report.webvttFound = true;

      // Find English subtitle
      const engSub =
        subtitleInfos.find((s) => (s?.LanguageCodeName as string)?.startsWith("eng")) ??
        subtitleInfos[0];

      const subtitleUrl = engSub?.Url as string;
      if (subtitleUrl) {
        try {
          const { default: axios } = await import("axios");
          const subResponse = await axios.get(subtitleUrl, {
            headers: {
              Referer: "https://www.tiktok.com/",
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            },
            timeout: 10000,
            responseType: "text",
          });

          const vttText = subResponse.data as string;

          // Parse WEBVTT
          const lines = vttText.split("\n");
          const textLines: string[] = [];
          for (const line of lines) {
            if (
              line.trim() &&
              !line.startsWith("WEBVTT") &&
              !line.startsWith("NOTE") &&
              !line.includes("-->") &&
              !/^\d+$/.test(line.trim())
            ) {
              textLines.push(line.replace(/<[^>]+>/g, "").trim());
            }
          }
          const transcript = textLines.filter(Boolean).join(" ");

          if (transcript.length >= 10) {
            report.transcriptDownloaded = true;
            report.transcriptText = transcript.slice(0, 200);
            report.wordCount = transcript.split(/\s+/).length;
            report.source = "webvtt";
          }
        } catch (err) {
          console.log(
            `  [TRANSCRIPT] WEBVTT download failed: ${(err as Error).message}`,
          );
        }
      }
    } else {
      console.log(`  [TRANSCRIPT] No subtitleInfos for video ${videoId}`);
      report.whisperFallbackTriggered = true;
      report.source = "whisper-would-trigger";
    }
  } catch (err) {
    console.log(`  [TRANSCRIPT] Error: ${(err as Error).message}`);
  }

  return report;
}

// ─── Instagram Profile Test ──────────────────────────────────────────────────

async function testInstagramProfile(handle: string): Promise<ProfileReport> {
  const report: ProfileReport = {
    handle,
    platform: "instagram",
    overallStatus: "FAIL",
    scrapePath: "unknown",
    silentFailureDetected: false,
    profileData: {},
    videoCount: 0,
    videos: [],
    posts: [],
    errors: [],
    warnings: [],
    timingMs: 0,
  };

  const start = Date.now();

  try {
    console.log(`\n[TEST] Scraping Instagram profile: @${handle}`);
    const result = await scrapeInstagramProfile(handle);
    report.timingMs = Date.now() - start;
    report.scrapePath = result.source;

    // Profile data
    const p = result.profile;
    report.profileData = {
      username: p.username,
      full_name: p.full_name,
      biography: p.biography?.slice(0, 200),
      follower_count: p.follower_count,
      following_count: p.following_count,
      media_count: p.media_count,
      is_business_account: p.is_business_account,
      category: p.category || null,
      is_verified: p.is_verified,
      external_url: p.external_url || null,
      confidence: result.confidence,
    };

    // Validate profile
    if (p.follower_count === 0) {
      report.warnings.push("follower_count is 0 — may be scrape failure");
    }
    if (!p.full_name) {
      report.warnings.push("full_name is empty");
    }
    if (!p.biography) {
      report.warnings.push("biography is empty");
    }

    // Post data
    report.posts = result.posts.slice(0, 12).map((post) => ({
      id: post.id,
      shortcode: post.shortcode,
      media_type: post.media_type,
      caption: post.caption?.slice(0, 100) ?? "",
      like_count: post.like_count,
      comment_count: post.comment_count,
      timestamp: post.timestamp
        ? new Date(post.timestamp * 1000).toISOString().split("T")[0]
        : "unknown",
      video_duration: post.video_duration ?? null,
      has_video_url: !!post.video_url,
    }));
    report.videoCount = result.posts.length;

    if (result.posts.length === 0) {
      report.warnings.push("No posts returned");
    }

    if (result.source === "none") {
      report.errors.push("All scrape paths failed");
      report.silentFailureDetected = true;
    }

    // Determine overall status
    const hasProfile = p.follower_count > 0 || p.biography.length > 0;
    const hasPosts = result.posts.length > 0;

    if (hasProfile && hasPosts) {
      report.overallStatus = "PASS";
    } else if (hasProfile || hasPosts) {
      report.overallStatus = "PARTIAL";
    } else {
      report.overallStatus = "FAIL";
    }
  } catch (err) {
    report.timingMs = Date.now() - start;
    report.errors.push(`Fatal: ${(err as Error).message}`);
  }

  return report;
}

// ─── Report Printer ───────────────────────────────────────────────────────────

function printTikTokReport(r: ProfileReport): void {
  sep(`TikTok: @${r.handle} — ${r.overallStatus}`);

  console.log(`\n  ▸ Scrape Time: ${r.timingMs}ms`);
  console.log(`  ▸ Silent Failure: ${r.silentFailureDetected ? "YES ⚠️" : "No"}`);

  console.log("\n  ── Profile Data ──");
  for (const [key, val] of Object.entries(r.profileData)) {
    console.log(`    ${key}: ${fmt(val)}`);
  }

  console.log(`\n  ── Videos (${r.videoCount} total) ──`);
  for (const v of r.videos.slice(0, 15)) {
    console.log(
      `    [${v.id}] ${v.createTime} | ${v.duration}s | ▶${v.playCount} ❤${v.diggCount} 💬${v.commentCount} 🔄${v.shareCount} | 🎵${v.isOriginalAudio ? "original" : "sound"} | "${v.caption}"`,
    );
  }
  if (r.videos.length > 15) {
    console.log(`    ... and ${r.videos.length - 15} more`);
  }

  if (r.transcripts && r.transcripts.length > 0) {
    console.log(`\n  ── Transcripts (${r.transcripts.length} attempted) ──`);
    for (const t of r.transcripts) {
      const status = t.wordCount > 0 ? "✅ PASS" : "❌ FAIL";
      console.log(`    [${t.videoId}] ${status}`);
      console.log(`      WEBVTT found: ${t.webvttFound}`);
      console.log(`      Downloaded: ${t.transcriptDownloaded}`);
      console.log(`      Source: ${t.source}`);
      console.log(`      Word count: ${t.wordCount}`);
      if (t.transcriptText) {
        console.log(`      Text: "${t.transcriptText}"`);
      }
      if (t.whisperFallbackTriggered) {
        console.log(`      Whisper fallback: would trigger (not executed in test)`);
      }
    }
  }

  if (r.errors.length > 0) {
    console.log("\n  ── Errors ──");
    for (const e of r.errors) console.log(`    ❌ ${e}`);
  }
  if (r.warnings.length > 0) {
    console.log("\n  ── Warnings ──");
    for (const w of r.warnings) console.log(`    ⚠️  ${w}`);
  }
}

function printInstagramReport(r: ProfileReport): void {
  sep(`Instagram: @${r.handle} — ${r.overallStatus}`);

  console.log(`\n  ▸ Scrape Path: ${r.scrapePath}`);
  console.log(`  ▸ Scrape Time: ${r.timingMs}ms`);
  console.log(`  ▸ Silent Failure: ${r.silentFailureDetected ? "YES ⚠️" : "No"}`);

  console.log("\n  ── Profile Data ──");
  for (const [key, val] of Object.entries(r.profileData)) {
    console.log(`    ${key}: ${fmt(val)}`);
  }

  console.log(`\n  ── Posts (${r.videoCount} total) ──`);
  for (const p of (r.posts ?? []).slice(0, 12)) {
    const caption = String(p.caption ?? "").slice(0, 80);
    console.log(
      `    [${p.shortcode}] ${p.timestamp} | ${p.media_type} | ❤${p.like_count} 💬${p.comment_count} | "${caption}"`,
    );
    if (p.media_type === "video" || p.media_type === "reel") {
      console.log(`      video_duration: ${p.video_duration ?? "N/A"} | video_url: ${p.has_video_url ? "YES" : "NO"}`);
    }
  }

  if (r.errors.length > 0) {
    console.log("\n  ── Errors ──");
    for (const e of r.errors) console.log(`    ❌ ${e}`);
  }
  if (r.warnings.length > 0) {
    console.log("\n  ── Warnings ──");
    for (const w of r.warnings) console.log(`    ⚠️  ${w}`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("╔══════════════════════════════════════════════════════════════════════╗");
  console.log("║  Phase 2 Scraper Verification Test                                 ║");
  console.log("║  4 profiles · No DB writes · No LLM                                ║");
  console.log("╚══════════════════════════════════════════════════════════════════════╝");

  const reports: ProfileReport[] = [];

  // ── TikTok Tests ──

  const tiktokHandles = ["qazalyadegarii", "orlandokyng"];
  for (const handle of tiktokHandles) {
    const report = await testTikTokProfile(handle);
    reports.push(report);
    printTikTokReport(report);
  }

  // ── Instagram Tests ──

  const instagramHandles = ["gretzieparth", "sarah.lemire"];
  for (const handle of instagramHandles) {
    const report = await testInstagramProfile(handle);
    reports.push(report);
    printInstagramReport(report);
  }

  // ── Reliability Summary ──

  sep("RELIABILITY SUMMARY");

  const tiktokReports = reports.filter((r) => r.platform === "tiktok");
  const instagramReports = reports.filter((r) => r.platform === "instagram");

  const tiktokProfileSuccess = tiktokReports.filter(
    (r) => r.overallStatus !== "FAIL" && (r.profileData.followerCount as number) > 0,
  ).length;
  const tiktokTranscriptAttempts = tiktokReports.reduce(
    (sum, r) => sum + (r.transcripts?.length ?? 0),
    0,
  );
  const tiktokTranscriptSuccess = tiktokReports.reduce(
    (sum, r) => sum + (r.transcripts?.filter((t) => t.wordCount > 0).length ?? 0),
    0,
  );
  const instagramProfileSuccess = instagramReports.filter(
    (r) => r.overallStatus !== "FAIL",
  ).length;
  const instagramPostSuccess = instagramReports.filter(
    (r) => (r.posts?.length ?? 0) > 0,
  ).length;

  console.log(`
  ┌──────────────────────────────────────────┬────────┐
  │ Metric                                   │ Result │
  ├──────────────────────────────────────────┼────────┤
  │ TikTok profile success                   │ ${tiktokProfileSuccess}/${tiktokReports.length}    │
  │ TikTok transcript success                │ ${tiktokTranscriptSuccess}/${tiktokTranscriptAttempts}    │
  │ Instagram profile success                │ ${instagramProfileSuccess}/${instagramReports.length}    │
  │ Instagram post scrape success            │ ${instagramPostSuccess}/${instagramReports.length}    │
  └──────────────────────────────────────────┴────────┘
  `);

  // Critical gaps
  const gaps: string[] = [];
  if (tiktokProfileSuccess < tiktokReports.length) {
    gaps.push("TikTok profile scraping has failures — check Cloudflare/silent failure detection");
  }
  if (tiktokTranscriptSuccess === 0 && tiktokTranscriptAttempts > 0) {
    gaps.push("No TikTok transcripts succeeded — WEBVTT extraction or subtitle availability issue");
  }
  if (instagramProfileSuccess < instagramReports.length) {
    gaps.push("Instagram profile scraping has failures — Playwright or Picuki issues");
  }
  if (instagramPostSuccess === 0) {
    gaps.push("No Instagram posts scraped — post extraction parsing may need fixes");
  }

  if (gaps.length > 0) {
    console.log("  CRITICAL GAPS:");
    for (const g of gaps) console.log(`    ⚠️  ${g}`);
  } else {
    console.log("  ✅ No critical gaps detected");
  }

  // Timing summary
  console.log("\n  TIMING:");
  for (const r of reports) {
    console.log(`    @${r.handle} (${r.platform}): ${r.timingMs}ms`);
  }

  // Cleanup
  try {
    await shutdown();
  } catch { /* ignore */ }

  console.log("\n  Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
