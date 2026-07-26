/**
 * Platform tool seam — phased architecture S2, Part 2.
 *
 * THE POINT OF THIS FILE: platform differences live in TOOLS, not in separate
 * pipelines. Every platform implements the same three interfaces below and
 * plugs into the same phase units. Adding Instagram or YouTube in S4 is an
 * IMPLEMENTATION (write three functions, register them), not an architecture
 * change — no phase, no orchestrator, no ledger shape moves.
 *
 * Today only TikTok is registered. The registry deliberately types the other
 * two platforms as absent rather than pretending they exist, so a caller that
 * reaches for them gets a clear error instead of silent wrong behaviour.
 *
 * ─── Where Instagram and YouTube plug in (S4) ───────────────────────────────
 *   CaptureTool     Instagram → scrapeInstagramProfile (+ extractAndSupplementPosts):
 *                               one Playwright session yields profile + posts,
 *                               exactly like TikTok's profile_xhr_scroll.
 *                   YouTube   → scrapeYouTubeChannelDetails + scrapeYouTubeChannelVideos:
 *                               two cheap HTML fetches inside one tool call.
 *   AugmentTool     Instagram → oEmbed post supplementation.
 *                   YouTube   → none; register `null` and the augment phase
 *                               records a skipped outcome. Optional-by-design
 *                               is already how the contract treats augment.
 *   TranscribeTool  Instagram → reel Whisper path.
 *                   YouTube   → caption XML fetch (fetchYouTubeVideoTranscript).
 *
 * The shared output shapes are not aspirational — all three platforms already
 * persist into ONE content_items table and one CreatorResearchResult today,
 * which is what makes a single contract honest here.
 */
import type { PlatformName } from "../_core/analysisPhase";
import type {
  CreatorResearchResult, EngagementSignals, LongitudinalSample,
  PoolVideoItem, TranscriptEntry,
} from "../webResearch";
import {
  assembleTranscribeOutputs,
  collectPoolFromApi,
  collectPoolFromSupplementalSearch,
  selectLongitudinalSample,
  transcribeSampledVideos,
} from "../webResearch";
import { scrapeTikTokProfile } from "../scraping/tiktok/profileScraper";

// ─── Shared shapes every platform tool speaks ────────────────────────────────

/** Surface stats a capture tool must produce, whatever the platform. */
export interface SurfaceStats {
  displayName: string;
  bio: string;
  followerCount: number;
  followingCount: number;
  videoCount: number;
  totalLikes: number;
  location: string;
  secUid?: string;
}

/** Mutable pool state the collection tools accumulate into. */
export interface ToolPoolState {
  videoItems: PoolVideoItem[];
  seen: Set<string>;
  viewCounts: number[];
  videoTitles: string[];
  hashtags: string[];
  musicTitles: string[];
  foreignVideosRejected: number;
  searchQuotaExhausted: boolean;
  apiVideoCount: number;
}

export interface CaptureToolResult {
  stats: SurfaceStats;
  /** Profile-derived titles/views, kept separate because the merge ORDER of
   *  profile-vs-search contributions is load-bearing downstream. */
  profileTitles: string[];
  profileViewCounts: number[];
  /** The transient-vs-genuine empty discriminator's verdict, when the platform
   *  has one (TikTok does; others may not). */
  assessment?: unknown;
  /** Platform-native handle for the pool tools to reuse without re-scraping. */
  nativeProfile?: unknown;
}

export interface CaptureTool {
  platform: PlatformName;
  name: string;
  capture(handle: string): Promise<CaptureToolResult>;
  /** Seed the shared pool from what capture already fetched (no new network). */
  seedPool(handle: string, captured: CaptureToolResult, pool: ToolPoolState): Promise<void>;
}

export interface AugmentTool {
  platform: PlatformName;
  name: string;
  augment(handle: string, pool: ToolPoolState): Promise<void>;
}

export type SampledVideo = { item: PoolVideoItem; bucket: "recent" | "mid" | "anchor" };

export interface TranscribeTool {
  platform: PlatformName;
  name: string;
  /** Choose which items to transcribe. TikTok uses the frozen 6-3-3 sampler;
   *  another platform may sample differently without touching the phase. */
  selectSample(handle: string, pool: PoolVideoItem[], nowSec: number): SampledVideo[];
  /** Fetch transcripts for the selected items. TikTok delegates to the
   *  transcriptStrategies chain with its budgets and early-bail — called, never
   *  modified. Instagram's reel-Whisper path and YouTube's caption-XML fetch
   *  slot in here in S4 without the phase changing. */
  transcribe(handle: string, sampled: SampledVideo[]): Promise<TranscriptEntry[]>;
  /** Derive the engagement / longitudinal / pool artifacts from the collected
   *  pool and the fetched transcripts. FROZEN interpretation on TikTok. */
  assemble(
    handle: string,
    pool: PoolVideoItem[],
    transcripts: TranscriptEntry[],
    sampled: SampledVideo[],
  ): {
    engagementSignals: EngagementSignals;
    longitudinalSample: LongitudinalSample;
    discoveredVideoPool: NonNullable<CreatorResearchResult["discoveredVideoPool"]>;
  };
}

export interface PlatformToolset {
  capture: CaptureTool;
  /** null = this platform has no augmentation step (YouTube). The augment
   *  phase records a skipped outcome rather than failing. */
  augment: AugmentTool | null;
  transcribe: TranscribeTool;
}

// ─── TikTok implementation (reuses the hardened internals verbatim) ──────────

const tiktokCapture: CaptureTool = {
  platform: "TikTok",
  name: "tiktok:profile_xhr_scroll",
  async capture(handle) {
    // The hardened profile chain — empty-capture retry, classifyEmptyCapture
    // and the capture assessment all live inside here, untouched.
    const profile = await scrapeTikTokProfile(handle);
    const userInfoData = profile.userInfo?.userInfo ?? ({} as Record<string, unknown>);
    const user = (userInfoData as { user?: Record<string, unknown> }).user ?? {};
    const stats = (userInfoData as { stats?: Record<string, unknown> }).stats ?? {};

    const profileTitles: string[] = [];
    const profileViewCounts: number[] = [];
    for (const item of profile.posts?.data?.itemList ?? []) {
      const desc = item.desc ?? "";
      const views = Number(item.stats?.playCount ?? 0);
      if (desc.trim()) profileTitles.push(desc.trim());
      if (views > 0) profileViewCounts.push(views);
    }

    return {
      stats: {
        displayName: String(user.nickname ?? handle),
        bio: String(user.signature ?? ""),
        followerCount: Number(stats.followerCount ?? 0),
        followingCount: Number(stats.followingCount ?? 0),
        videoCount: Number(stats.videoCount ?? 0),
        totalLikes: Number(stats.heartCount ?? 0),
        location: "",
        secUid: String(user.secUid ?? ""),
      },
      profileTitles,
      profileViewCounts,
      assessment: profile.capture,
      nativeProfile: profile,
    };
  },
  async seedPool(handle, captured, pool) {
    // Reuses the profile already fetched — collectPoolFromApi takes the
    // prefetched profile and touches no network.
    await collectPoolFromApi(
      handle,
      captured.nativeProfile as Awaited<ReturnType<typeof scrapeTikTokProfile>>,
      pool,
    );
  },
};

const tiktokAugment: AugmentTool = {
  platform: "TikTok",
  name: "tiktok:search_xhr_scroll",
  async augment(handle, pool) {
    // The hardened search chain (transient retry, author guard) — untouched.
    await collectPoolFromSupplementalSearch(handle, handle.toLowerCase().replace(/[^a-z0-9]/g, ""), pool);
  },
};

const tiktokTranscribe: TranscribeTool = {
  platform: "TikTok",
  name: "tiktok:transcriptStrategies",
  selectSample(handle, pool, nowSec) {
    // The FROZEN 6-3-3 sampler, called not reimplemented.
    return selectLongitudinalSample(handle, pool, nowSec).sampledVideos;
  },
  transcribe(handle, sampled) {
    // The pLimit(3) loop over the transcriptStrategies chain, with the shared
    // batch phase (budgets + early-bail). Harness boundary 4 pins its output.
    return transcribeSampledVideos(handle, sampled);
  },
  assemble(handle, pool, transcripts, sampled) {
    // Engagement signals, LongitudinalSample (incl. the frozen cultural-velocity
    // heuristic) and discoveredVideoPool with 6-3-3 membership stamping.
    return assembleTranscribeOutputs(handle, pool, transcripts, sampled);
  },
};

export const TIKTOK_TOOLSET: PlatformToolset = {
  capture: tiktokCapture,
  augment: tiktokAugment,
  transcribe: tiktokTranscribe,
};

/**
 * Tool registry. S4 adds Instagram and YouTube entries here — that is the
 * WHOLE change at the architecture level.
 */
const REGISTRY: Partial<Record<PlatformName, PlatformToolset>> = {
  TikTok: TIKTOK_TOOLSET,
};

export function toolsetFor(platform: PlatformName): PlatformToolset {
  const toolset = REGISTRY[platform];
  if (!toolset) {
    throw new Error(
      `No phase toolset registered for ${platform}. Implement CaptureTool/AugmentTool/TranscribeTool and register it (S4) — no phase or orchestrator change is required.`,
    );
  }
  return toolset;
}

/** Which platforms currently have a toolset (for diagnostics and tests). */
export function registeredPlatforms(): PlatformName[] {
  return Object.keys(REGISTRY) as PlatformName[];
}
