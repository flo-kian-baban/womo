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
import type { PlatformName, SampleBucket } from "../_core/analysisPhase";
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
import { emptyCaptureMessage } from "../webResearch";
import { isSpeechTranscript } from "@shared/transcriptSource";
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
  /** Opt-in raw-payload sink for the collection-fixture refresh
   *  (WOMO_COLLECTION_FIXTURE). Absent in normal operation. */
  rawCapture?: { searchResponses: Array<{ query: string; items: unknown[] }> };
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

/** Declared in the contract (_core/analysisPhase.ts) — see SampleBucket there. */
export type { SampleBucket };

export type SampledVideo = { item: PoolVideoItem; bucket: SampleBucket };

// ─── Evidence gate (S4 contract extension) ───────────────────────────────────

/**
 * A platform's verdict on whether the evidence it collected is fit to extract
 * from. Returned as DATA so the shared driver decides what to do with it.
 */
export type GateVerdict =
  | { ok: true }
  | {
      ok: false;
      /** tRPC code, preserved per platform (NOT_FOUND / TOO_MANY_REQUESTS / …). */
      code: "NOT_FOUND" | "TOO_MANY_REQUESTS" | "PRECONDITION_FAILED";
      /** The analyst-facing message, FROZEN and platform-specific. */
      message: string;
    };

/** What the gate reads: the banked outputs of phases 1-4. */
export interface GateInput {
  handle: string;
  capture: unknown;
  augment: unknown;
  transcribe: unknown;
}

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

  /**
   * S4 CONTRACT EXTENSION — the evidence gate.
   *
   * WHY THIS IS A TOOL AND NOT A BRANCH. Every platform decides "is this
   * evidence fit to extract from at all?", and every platform words that
   * decision differently in FROZEN, analyst-facing text: TikTok distinguishes a
   * transient block from a genuinely empty profile, Instagram says "on
   * Instagram", YouTube names its data API. Those messages are interpretation,
   * not plumbing. A shared driver with three message sets inside it would be a
   * platform branch in shared code — exactly what the architecture forbids. As a
   * tool, the driver only ever asks the toolset and throws what it is handed.
   *
   * Runs BETWEEN phase 4 and phase 5: a campaign that runs all five phases in
   * one pass would persist a profile the min-data gate exists to refuse.
   */
  gate(input: GateInput): GateVerdict;

  /**
   * The canonical public profile URL for a handle. Platform-specific by nature
   * and previously hardcoded in the shared assembly; a pure per-platform fact,
   * so it belongs with the platform's other facts rather than in a branch.
   */
  profileUrl(handle: string): string;

  /**
   * S4 CONTRACT EXTENSION — platform-specific evidence.
   *
   * Appended verbatim to the assembled evidence summary. TikTok and YouTube
   * return ""; Instagram returns its business-signals block, which the monolith
   * appended after buildCreatorEvidenceSummary and which the shared assembly had
   * no way to produce — routing Instagram through the shared path without this
   * would silently drop it from what the model reads.
   *
   * Must be a PURE function of banked evidence: the assembly is byte-compared.
   */
  evidenceExtras(banked: EvidenceExtrasInput): string;
}

/** The banked capture stats an extras block may draw on. */
export interface EvidenceExtrasInput {
  handle: string;
  capture: unknown;
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

/**
 * TikTok's evidence gate. Every message below is VERBATIM from the pre-S4
 * collection driver — the transient-vs-genuine discriminator
 * (`emptyCaptureMessage`, scraper-reliability Part 2), the quota refusal, and
 * the no-data refusal. Moving them must not reword them.
 */
const tiktokGate: PlatformToolset["gate"] = (input) => {
  const capture = input.capture as TikTokGateCapture | null;
  const augment = input.augment as { quotaExhausted?: boolean; pool?: { videoTitles?: string[] } } | null;
  const transcribe = input.transcribe as { transcripts?: unknown[]; discoveredVideoPool?: unknown[] } | null;
  const handle = input.handle;

  const generic = `No public content found for @${handle}. TikTok did not expose this profile through any capture path. Please verify the handle is correct and that the account is public.`;

  // ── Gate: the capture phase produced nothing usable ──
  if (!capture) {
    return { ok: false, code: "NOT_FOUND", message: emptyCaptureMessage(handle, undefined, generic) };
  }

  // Defensive reads throughout: a RESUMED campaign can hand this banked output
  // written by an older schema, and a gate that throws is reported by the queue
  // as a crash rather than as the refusal it actually is.
  const transcripts = transcribe?.transcripts ?? [];
  const allTitles = augment?.pool?.videoTitles ?? capture.pool?.videoTitles ?? [];
  const hasContentData = transcripts.length > 0 || allTitles.length > 0;
  const followerCount = Number(capture.stats?.followerCount ?? 0);
  const bio = String(capture.stats?.bio ?? "");
  const hasAnyData = hasContentData || followerCount > 0 || bio.length > 0;

  // ── Gate: quota exhausted with no content (FROZEN) ──
  if (augment?.quotaExhausted && !hasContentData) {
    return {
      ok: false,
      code: "TOO_MANY_REQUESTS",
      message: `The TikTok data API is temporarily rate-limited from recent activity. No video content could be retrieved for @${handle}. Please wait 2–5 minutes and try again.`,
    };
  }

  const assessment = capture.assessment as Parameters<typeof emptyCaptureMessage>[1];

  // ── Gate: truly nothing available (FROZEN) ──
  if (!hasAnyData) {
    return { ok: false, code: "NOT_FOUND", message: emptyCaptureMessage(handle, assessment, generic) };
  }

  // ── Gate: minimum data threshold (FROZEN — thresholds unchanged) ──
  const realTranscripts = (transcripts as Array<{ transcriptSource?: string }>)
    .filter(t => isSpeechTranscript(t.transcriptSource));
  const totalVideoPool = transcribe?.discoveredVideoPool?.length ?? 0;
  console.log(`[webResearch] @${handle}: data quality check — ${realTranscripts.length} real transcripts, ${transcripts.length} total transcripts, ${allTitles.length} titles, ${totalVideoPool} discovered videos`);

  if (realTranscripts.length < 2 && allTitles.length < 4) {
    const counts = `${totalVideoPool} videos discovered, ${realTranscripts.length} real transcripts, ${allTitles.length} video titles.`;
    return {
      ok: false,
      code: "PRECONDITION_FAILED",
      message: `Insufficient data for @${handle}: ${counts} ` + emptyCaptureMessage(handle, assessment,
        `The scraper could not collect enough content for a reliable analysis. This creator may have limited public content or TikTok may be blocking access. Try again or try a creator with more public content.`),
    };
  }

  return { ok: true };
};

interface TikTokGateCapture {
  stats?: { followerCount?: number; bio?: string };
  pool?: { videoTitles?: string[] };
  assessment?: unknown;
}

export const TIKTOK_TOOLSET: PlatformToolset = {
  capture: tiktokCapture,
  augment: tiktokAugment,
  transcribe: tiktokTranscribe,
  gate: tiktokGate,
  profileUrl: (handle) => `https://www.tiktok.com/@${handle}`,
  // TikTok contributes no evidence beyond what the shared builder produces.
  // The evidence harness proves this keeps the assembly byte-identical.
  evidenceExtras: () => "",
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
