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
import type { PhaseName, PlatformName, SampleBucket } from "../_core/analysisPhase";
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
  transcribeInstagramReels,
  captureYouTubeChannel,
  transcribeYouTubeVideos,
  extractHashtags,
} from "../webResearch";
import { emptyCaptureMessage } from "../webResearch";
import { isSpeechTranscript } from "@shared/transcriptSource";
import { scrapeTikTokProfile } from "../scraping/tiktok/profileScraper";
import { scrapeInstagramProfile } from "../scraping/instagram/profileScraper";
import { fetchPostViaOEmbed } from "../scraping/instagram/postScraper";
import type { InstagramPostData } from "../scraping/instagram/types";

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
  /**
   * Every phase's banked output, keyed by phase name (S5 — the seventh
   * extension).
   *
   * This used to be three fields named `capture`, `augment` and `transcribe`.
   * They were already typed `unknown`, so a subject with different phases could
   * technically pass its own shapes through them — but the NAMES would then lie
   * about what they held, which is worse than a type that needs widening. A map
   * keyed by phase name says exactly what it is for every subject type.
   *
   * Gates read the phases they care about and ignore the rest; a gate that
   * needs no transcribe simply never looks for it.
   */
  banked: Partial<Record<PhaseName, unknown>>;
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
    /** Absent when the platform computes none — see BankedCreatorEvidence. */
    engagementSignals?: EngagementSignals;
    longitudinalSample?: LongitudinalSample;
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
   * S4 CONTRACT EXTENSION — the engagement rate.
   *
   * WHY THIS IS A TOOL. `computeDeriveInputs` hardcoded ONE platform's formula
   * as though it were universal: TikTok's interaction rate (likes+comments per
   * play) with a views/followers fallback. Instagram has always used
   * likes/followers, with its own rounding — measured on a real capture, the
   * shared formula turns Instagram's 32.9 into a clamped 100. An engagement rate
   * is platform-specific INTERPRETATION and it lands in the evidence summary the
   * model reads, so it belongs with the platform's other interpretation.
   *
   * The two formulas are DIFFERENT BY DESIGN, including their rounding paths.
   * Do not normalise them.
   */
  engagementRate(input: EngagementRateInput): number;

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

/** Everything any platform's engagement-rate formula needs. */
export interface EngagementRateInput {
  followerCount: number;
  /** Mean of the recorded view counts — TikTok's fallback input. */
  avgViews: number;
  /** Present only when the platform computes per-video signals. */
  engagementSignals?: EngagementSignals;
  /** The collected pool — Instagram derives mean likes per post from it. */
  pool: PoolVideoItem[];
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
  const capture = input.banked.capture as TikTokGateCapture | null;
  const augment = input.banked.augment as { quotaExhausted?: boolean; pool?: { videoTitles?: string[] } } | null;
  const transcribe = input.banked.transcribe as { transcripts?: unknown[]; discoveredVideoPool?: unknown[] } | null;
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
  // VERBATIM from computeDeriveInputs. "FIXED engagement rate: use
  // (likes + comments) / plays, not views/followers — this is the true
  // interaction rate and will never exceed 100%." The views/followers branch is
  // the fallback for a pool with no per-video signals. Rounding path unchanged.
  engagementRate: ({ followerCount, avgViews, engagementSignals }) =>
    (engagementSignals?.avgLikeRate ?? 0) > 0
      ? Math.round((engagementSignals!.avgLikeRate + engagementSignals!.avgCommentRate) * 100 * 100) / 100
      : (followerCount > 0 && avgViews > 0
        ? Math.min(100, Math.round((avgViews / followerCount) * 100 * 10) / 10)
        : 0),
  // TikTok contributes no evidence beyond what the shared builder produces.
  // The evidence harness proves this keeps the assembly byte-identical.
  evidenceExtras: () => "",
};


// ─── Instagram implementation (S4) ───────────────────────────────────────────
//
// Every scraper below is CALLED, not reimplemented: scrapeInstagramProfile with
// its multi-path fallbacks, fetchPostViaOEmbed, and the reel speech-to-text path
// extracted verbatim from the monolith. What is new is the CONTRACT around them.
//
// The shapes differ from TikTok in ways the contract already absorbs: Instagram
// posts carry no music metadata, no duet/stitch flags and no share/save counts,
// so those pool fields are honestly zero/empty rather than invented.

/** Instagram's post list, kept from capture so augment and transcribe can use it. */
interface InstagramNative {
  posts: InstagramPostData[];
  source: string;
  isBusinessAccount: boolean;
  category: string;
  isVerified: boolean;
  externalUrl: string;
}

/** A caption's first line, trimmed to 60 chars — the monolith's title rule. */
function instagramTitleFromCaption(caption: string): string {
  const firstLine = caption.split("\n")[0] ?? "";
  return firstLine.length > 60 ? firstLine.slice(0, 57) + "..." : firstLine;
}

/** Map an Instagram post onto the shared pool item. */
function instagramPostToPoolItem(p: InstagramPostData): PoolVideoItem {
  return {
    id: p.shortcode || p.id,
    caption: p.caption || "",
    views: p.view_count || 0,
    likes: p.like_count || 0,
    comments: p.comment_count || 0,
    // Instagram exposes neither saves nor shares on this path — zero is the
    // honest value, not a placeholder to be filled in later.
    saves: 0,
    shares: 0,
    createTime: p.timestamp || 0,
    musicOriginal: false,
    musicTitle: "",
    musicArtist: "",
    duetEnabled: false,
    stitchEnabled: false,
    isAd: false,
    durationMs: p.video_duration ? Math.round(p.video_duration * 1000) : 0,
  };
}

const instagramCapture: CaptureTool = {
  platform: "Instagram",
  name: "instagram:profile_multipath",
  async capture(handle) {
    const scraped = await scrapeInstagramProfile(handle);
    const { profile, posts, source } = scraped;

    const profileTitles: string[] = [];
    const profileViewCounts: number[] = [];
    for (const p of posts) {
      const title = instagramTitleFromCaption(p.caption ?? "");
      if (title) profileTitles.push(title);
      if ((p.view_count ?? 0) > 0) profileViewCounts.push(p.view_count);
    }

    // Stash the CDN video URLs for the transcribe tool — see the note on
    // instagramVideoUrls. They expire, so they cannot be re-derived later.
    __rememberInstagramVideoUrls(handle, posts);

    const native: InstagramNative = {
      posts,
      source,
      isBusinessAccount: profile.is_business_account,
      category: profile.category,
      isVerified: profile.is_verified,
      externalUrl: profile.external_url,
    };

    return {
      stats: {
        displayName: profile.full_name || handle,
        bio: profile.biography,
        followerCount: profile.follower_count,
        followingCount: profile.following_count,
        videoCount: profile.media_count,
        // Instagram has no lifetime like total; the monolith summed post likes.
        totalLikes: posts.reduce((sum, p) => sum + (p.like_count ?? 0), 0),
        location: "",
      },
      profileTitles: profileTitles.slice(0, 25),
      profileViewCounts,
      /**
       * NO `genuineEmpty` HERE, DELIBERATELY.
       *
       * The capture phase reads `assessment.genuineEmpty` to decide whether an
       * empty result is PROVEN (terminate) or unproven (park and retry).
       * Instagram cannot currently prove it. When Instagram rate-limits post
       * extraction it returns a degraded profile that reports `media_count: 0`
       * while succeeding — so a stated zero is indistinguishable from a real
       * zero. Both live runs of `vnillalondon` and `olga.popovaa` recorded
       * `media_count: 0` with 0 posts, and vnillalondon demonstrably has 24.
       *
       * Claiming emptiness from that would resurrect the exact failure the
       * TikTok classifier exists to prevent: a false "no public content"
       * rejection of a live creator. Omitting the field costs a rate-limited
       * empty a few minutes of retries; asserting it costs a real creator their
       * profile. Instagram's own zero-post floor still produces the frozen
       * message after the retries are spent.
       */
      assessment: { source, postsCaptured: posts.length },
      nativeProfile: native,
    };
  },
  async seedPool(_handle, captured, pool) {
    const native = captured.nativeProfile as InstagramNative | undefined;
    for (const post of native?.posts ?? []) {
      const item = instagramPostToPoolItem(post);
      if (!item.id || pool.seen.has(item.id)) continue;
      pool.seen.add(item.id);
      pool.videoItems.push(item);
      if (item.caption.trim()) pool.videoTitles.push(instagramTitleFromCaption(item.caption));
      if (item.views > 0) pool.viewCounts.push(item.views);
    }
    pool.apiVideoCount = pool.videoItems.length;
    pool.hashtags.push(...extractHashtags(pool.videoItems.map(v => v.caption)));
  },
};

const instagramAugment: AugmentTool = {
  platform: "Instagram",
  name: "instagram:oembed_supplement",
  async augment(_handle, pool) {
    // The monolith supplemented posts whose caption was missing or very short.
    // Same rule here, applied to the pool the capture tool seeded.
    const thin = pool.videoItems.filter(v => !v.caption || v.caption.length <= 10);
    if (thin.length === 0) return;

    const pLimit = (await import("p-limit")).default;
    const limit = pLimit(3);
    await Promise.allSettled(thin.map(item => limit(async () => {
      const oembed = await fetchPostViaOEmbed(item.id);
      if (oembed?.caption) {
        item.caption = oembed.caption;
        const title = instagramTitleFromCaption(item.caption);
        if (title) pool.videoTitles.push(title);
      }
    })));
    pool.hashtags.length = 0;
    pool.hashtags.push(...extractHashtags(pool.videoItems.map(v => v.caption)));
  },
};

const instagramTranscribe: TranscribeTool = {
  platform: "Instagram",
  name: "instagram:reel_speech_to_text",
  selectSample(handle, pool) {
    // The monolith took the first 6 video/reel posts in feed order and stopped
    // once 5 transcripts landed. NOT temporal: there is no recent/mid/anchor
    // stratification to report, so the sample says `unbucketed` rather than
    // claiming a bucket the sampler never chose.
    //
    // The video test is URL presence, NOT duration: `video_duration` is never
    // populated by the scrape paths in use (verified across two live captures —
    // every post came back durationSec 0), so filtering on it would select
    // nothing and silently yield zero transcripts. A reel with no CDN URL cannot
    // be transcribed anyway, which is the same set the monolith skipped.
    const urls = instagramVideoUrls.get(handle);
    return pool
      .filter(v => Boolean(urls?.get(v.id)))
      .slice(0, 6)
      .map(item => ({ item, bucket: "unbucketed" as const }));
  },
  transcribe(handle, sampled) {
    const urls = instagramVideoUrls.get(handle) ?? new Map<string, string>();
    return transcribeInstagramReels(handle, sampled, urls);
  },
  assemble(_handle, pool, transcripts, sampled) {
    // Instagram computes NO engagement signals and NO longitudinal sample — it
    // never has, and `sociologicalFieldsComputed: false` on that path says so.
    // The contract makes both optional; returning fabricated empties would be
    // the lie the optionality exists to avoid.
    const byId = new Map(transcripts.map(t => [t.videoId, t]));
    // Stamp sample membership exactly as TikTok does — the value differs
    // (`unbucketed`, not a temporal bucket) but the meaning is the same: this
    // video was chosen for transcription.
    const sampledBucketById = new Map(sampled.map(sv => [sv.item.id, sv.bucket]));
    return {
      engagementSignals: undefined,
      longitudinalSample: undefined,
      discoveredVideoPool: pool.map(v => {
        const t = byId.get(v.id);
        return {
          id: v.id,
          url: `https://www.instagram.com/p/${v.id}/`,
          caption: v.caption,
          createTime: v.createTime,
          views: v.views,
          likes: v.likes,
          comments: v.comments,
          saves: 0,
          shares: 0,
          musicOriginal: false,
          musicTitle: undefined,
          musicArtist: undefined,
          durationSec: Math.round(v.durationMs / 1000),
          temporalBucket: sampledBucketById.get(v.id),
          videoUrl: instagramVideoUrls.get(_handle)?.get(v.id),
          transcriptText: t?.transcript,
          transcriptWordCount: t?.wordCount,
          transcriptSource: t?.transcriptSource,
        };
      }),
    };
  },
};

/**
 * Reel video URLs, keyed by handle then shortcode.
 *
 * WHY THIS EXISTS: a pool item carries no video_url — the shared PoolVideoItem
 * has no field for one, because TikTok resolves video URLs at transcript time.
 * Instagram's CDN URLs come from the profile scrape and expire, so they cannot
 * be re-derived later. Capture stashes them here and transcribe reads them back
 * within the same campaign. Deliberately NOT banked: a resumed campaign must
 * re-scrape for fresh URLs rather than replay dead ones.
 */
const instagramVideoUrls = new Map<string, Map<string, string>>();

export function __rememberInstagramVideoUrls(handle: string, posts: InstagramPostData[]): void {
  const m = new Map<string, string>();
  for (const p of posts) {
    if (p.video_url) m.set(p.shortcode || p.id, p.video_url);
  }
  instagramVideoUrls.set(handle, m);
}

/** Instagram's evidence gate — messages VERBATIM from the monolith. */
const instagramGate: PlatformToolset["gate"] = (input) => {
  const capture = input.banked.capture as {
    stats?: { followerCount?: number; bio?: string; videoCount?: number };
    pool?: { videoItems?: unknown[] };
  } | null;
  const handle = input.handle;

  const hasProfileData = Number(capture?.stats?.followerCount ?? 0) > 0
    || String(capture?.stats?.bio ?? "").length > 0;
  const postsCaptured = capture?.pool?.videoItems?.length ?? 0;

  // ── Gate: nothing at all (VERBATIM from researchInstagramCreator) ──
  if (!capture || (!hasProfileData && postsCaptured === 0)) {
    return {
      ok: false,
      code: "NOT_FOUND",
      message: `No public content found for @${handle} on Instagram. Please verify the handle is correct and that the account is public.`,
    };
  }

  // ── Gate: ZERO POSTS (S4b) ──
  // The floor this path never had. Instagram's only gate was
  // `hasProfileData || hasPostData`, so a capture that returned the profile and
  // NO posts passed, and the analysis was written from bio alone — the
  // fabrication risk TikTok's min-data threshold exists to prevent. Observed
  // live: after repeated requests from one IP, Instagram serves the profile with
  // zero posts while still reporting success.
  //
  // The two cases are NOT the same and must not read the same. The profile's own
  // media_count is the discriminator, exactly as TikTok's capture assessment
  // distinguishes a blocked capture from a genuinely empty creator.
  //
  // Deliberately a FLOOR, not a threshold: zero posts only. What counts as
  // "enough" Instagram evidence is a gate-policy question, and it is Jason's.
  if (postsCaptured === 0) {
    const stated = Number(capture.stats?.videoCount ?? 0);
    if (stated > 0) {
      return {
        ok: false,
        code: "PRECONDITION_FAILED",
        message: `Instagram returned @${handle}'s profile but none of their posts (the profile reports ${stated} posts). This is usually transient rate-limiting — wait a few minutes and retry. Nothing was saved, and the account should not be deleted.`,
      };
    }
    return {
      ok: false,
      code: "NOT_FOUND",
      message: `@${handle}'s Instagram profile reports 0 posts — there is no content to analyze. (Confirmed by the profile's own stats; this is not a scraping failure.)`,
    };
  }

  return { ok: true };
};

/**
 * Instagram's business-signals block — appended VERBATIM as the monolith did,
 * after the shared evidence summary.
 *
 * NOTE: `is_business_account` is populated only by the GraphQL scrape path
 * (profileScraper's extractProfileFromGraphqlUser). Live captures via
 * playwright-mobile-xhr leave it false, so in practice this block is usually
 * empty — see the S4 report.
 */
const instagramEvidenceExtras: PlatformToolset["evidenceExtras"] = ({ capture }) => {
  const native = (capture as { nativeProfile?: InstagramNative } | null)?.nativeProfile;
  if (!native?.isBusinessAccount) return "";
  return `\nINSTAGRAM BUSINESS SIGNALS:\n  Business Account: YES\n  Category: ${native.category || "Not specified"}\n  Verified: ${native.isVerified ? "YES" : "NO"}\n  External URL: ${native.externalUrl || "None"}`;
};

export const INSTAGRAM_TOOLSET: PlatformToolset = {
  capture: instagramCapture,
  augment: instagramAugment,
  transcribe: instagramTranscribe,
  gate: instagramGate,
  profileUrl: (handle) => `https://www.instagram.com/${handle}/`,
  // VERBATIM from researchInstagramCreator: mean LIKES per post over followers,
  // rounded to one decimal. Deliberately not TikTok's formula — Instagram view
  // counts are absent on many posts (5 of 12 read zero in the captured
  // baselines), so a views-based rate would be both inflated and arbitrary.
  engagementRate: ({ followerCount, pool }) => {
    const totalLikes = pool.reduce((sum, v) => sum + (v.likes ?? 0), 0);
    const avgLikes = pool.length > 0 ? Math.round(totalLikes / pool.length) : 0;
    return followerCount > 0 && avgLikes > 0
      ? Math.min(100, Math.round((avgLikes / followerCount) * 100 * 10) / 10)
      : 0;
  },
  evidenceExtras: instagramEvidenceExtras,
};


// ─── YouTube implementation (S4b) ────────────────────────────────────────────
//
// The third exercise the abstraction promised, and the one that tests it: on
// YouTube capture and transcription were FUSED in a single call, there was no
// augmentation step at all, and sampling is not temporal. All three are absorbed
// by the contract as it stands — the split was a scraper refactor
// (captureYouTubeChannel / transcribeYouTubeVideos, S4b Part 2), the null
// augment tool is the contract's optional-phase semantics, and `unbucketed` is
// the sample value added in S4.

/** Capture output kept so the transcribe tool can read the channel's video ids. */
interface YouTubeNative {
  videoIds: Array<{ id: string; title: string }>;
  channelId: string;
  quotaExhausted: boolean;
}

/**
 * YouTube video ids by handle, for the same reason as Instagram's CDN urls: the
 * shared PoolVideoItem has no field for a platform-native id list, and the
 * transcribe tool needs the channel's ordering. Per-campaign, never banked.
 */
const youtubeVideoIds = new Map<string, Array<{ id: string; title: string }>>();

const youtubeCapture: CaptureTool = {
  platform: "YouTube",
  name: "youtube:channel_html",
  async capture(handle) {
    const c = await captureYouTubeChannel(handle);
    youtubeVideoIds.set(handle, c.videoIds);

    return {
      stats: {
        displayName: c.displayName,
        bio: c.bio,
        followerCount: c.followerCount,
        // YouTube exposes no following count and no lifetime like total.
        followingCount: 0,
        videoCount: c.videoCount,
        totalLikes: 0,
        location: c.location,
      },
      profileTitles: c.videoTitles,
      profileViewCounts: c.videoViewCounts,
      assessment: {
        channelId: c.channelId,
        quotaExhausted: c.quotaExhausted,
        videosCaptured: c.videoIds.length,
        channelKeywords: c.channelKeywords,
        totalViews: c.totalViews,
      },
      nativeProfile: { videoIds: c.videoIds, channelId: c.channelId, quotaExhausted: c.quotaExhausted } as YouTubeNative,
    };
  },
  async seedPool(_handle, captured, pool) {
    const native = captured.nativeProfile as YouTubeNative | undefined;
    const views = captured.profileViewCounts;
    (native?.videoIds ?? []).forEach((v, i) => {
      if (!v.id || pool.seen.has(v.id)) return;
      pool.seen.add(v.id);
      pool.videoItems.push({
        id: v.id,
        caption: v.title,
        // The channel-videos page yields a view count per video but no likes,
        // comments, saves, shares, music or duration. Zero is the honest value.
        views: views[i] ?? 0,
        likes: 0, comments: 0, saves: 0, shares: 0,
        createTime: 0,
        musicOriginal: false, musicTitle: "", musicArtist: "",
        duetEnabled: false, stitchEnabled: false, isAd: false, durationMs: 0,
      });
    });
    // Titles come from the capture's own list, which includes the fallback
    // search results — those have titles but no ids, so they are NOT in the pool.
    pool.videoTitles.push(...captured.profileTitles);
    pool.viewCounts.push(...views.filter(v => v > 0));
    pool.apiVideoCount = pool.videoItems.length;
    pool.hashtags.push(...extractHashtags([...captured.profileTitles, captured.stats.bio]));
  },
};

const youtubeTranscribe: TranscribeTool = {
  platform: "YouTube",
  name: "youtube:caption_xml",
  selectSample(handle, pool) {
    // VERBATIM selection rule: the first 10 of the channel's videos, in channel
    // order. NOT temporal — YouTube's video list carries no usable createTime
    // here, so there is no recent/mid/anchor split to report and `unbucketed`
    // states that rather than inventing one.
    const ids = new Set((youtubeVideoIds.get(handle) ?? []).map(v => v.id));
    return pool
      .filter(v => ids.has(v.id))
      .slice(0, 10)
      .map(item => ({ item, bucket: "unbucketed" as const }));
  },
  transcribe(handle, sampled) {
    const byId = new Map((youtubeVideoIds.get(handle) ?? []).map(v => [v.id, v.title]));
    return transcribeYouTubeVideos(
      sampled.map(s => ({ id: s.item.id, title: byId.get(s.item.id) ?? s.item.caption })),
    );
  },
  assemble(_handle, pool, transcripts, sampled) {
    // Like Instagram: NO engagement signals and NO longitudinal sample. The
    // YouTube path has always reported sociologicalFieldsComputed: false.
    const byId = new Map(transcripts.map(t => [t.videoId, t]));
    const sampledBucketById = new Map(sampled.map(sv => [sv.item.id, sv.bucket]));
    return {
      engagementSignals: undefined,
      longitudinalSample: undefined,
      discoveredVideoPool: pool.map(v => {
        const t = byId.get(v.id);
        return {
          id: v.id,
          url: `https://www.youtube.com/watch?v=${v.id}`,
          caption: v.caption,
          createTime: v.createTime,
          views: v.views,
          likes: 0, comments: 0, saves: 0, shares: 0,
          musicOriginal: false,
          musicTitle: undefined,
          musicArtist: undefined,
          durationSec: 0,
          temporalBucket: sampledBucketById.get(v.id),
          transcriptText: t?.transcript,
          transcriptWordCount: t?.wordCount,
          transcriptSource: t?.transcriptSource,
        };
      }),
    };
  },
};

/** YouTube's evidence gates — messages VERBATIM from researchYouTubeCreator. */
const youtubeGate: PlatformToolset["gate"] = (input) => {
  const capture = input.banked.capture as {
    stats?: { followerCount?: number; bio?: string };
    pool?: { videoTitles?: string[] };
    assessment?: { quotaExhausted?: boolean };
  } | null;
  const transcribe = input.banked.transcribe as { transcripts?: unknown[] } | null;
  const handle = input.handle;

  const transcripts = transcribe?.transcripts ?? [];
  const videoTitles = capture?.pool?.videoTitles ?? [];
  const hasContentData = transcripts.length > 0 || videoTitles.length > 0;
  const hasAnyData = hasContentData
    || Number(capture?.stats?.followerCount ?? 0) > 0
    || String(capture?.stats?.bio ?? "").length > 0;

  // ── Gate: quota exhausted with no content (FROZEN) ──
  // "bio alone produces hallucinated profiles" — the original comment.
  if (capture?.assessment?.quotaExhausted && !hasContentData) {
    return {
      ok: false,
      code: "TOO_MANY_REQUESTS",
      message: `The YouTube data API is temporarily rate-limited from recent activity. No video content could be retrieved for @${handle}. Please wait 2–5 minutes and try again.`,
    };
  }

  // ── Gate: truly nothing available (FROZEN) ──
  if (!capture || !hasAnyData) {
    return {
      ok: false,
      code: "NOT_FOUND",
      message: `No public content found for @${handle}. Please verify the YouTube handle or channel URL is correct and that the channel is public.`,
    };
  }

  return { ok: true };
};

/**
 * ─── DISABLED — NOT REGISTERED. YouTube is not a supported platform. ─────────
 *
 * This toolset is complete and correct against the contract; it is deliberately
 * left out of `REGISTRY`, so `toolsetFor("YouTube")` throws like any other
 * unsupported platform and no YouTube campaign can be created or processed.
 *
 * WHY IT IS DISABLED — four defects, all diagnosed, none repaired:
 *   1. `USER_AGENTS` (httpClient.ts) holds 4 mobile agents in 16, so ~25% of
 *      fetches return MWEB HTML that serialises `ytInitialData` as a
 *      hex-escaped JS string. Every extractor pattern misses it.
 *   2. The videos tab moved from `richItemRenderer.content.videoRenderer` to
 *      `…content.lockupViewModel`, so the channel video list parses to zero.
 *   3. The channel page dropped `c4TabbedHeaderRenderer` for
 *      `pageHeaderRenderer`, so title and subscribers read empty — and
 *      `videoCount` was never assigned at all.
 *   4. `/api/timedtext` now answers HTTP 200 with an EMPTY body without a
 *      proof-of-origin (`pot`) token, so no captions can be downloaded.
 *
 * RE-ENABLING requires (1)–(3) repaired AND a decision on (4): captions cannot
 * be fetched at all today, so YouTube transcripts would have to come from audio
 * speech-to-text — which changes `transcriptSource` from `subtitle` to
 * `speech_to_text`, a FROZEN classification that needs explicit sign-off.
 *
 * Full diagnosis: docs/YOUTUBE_DISABLED.md. The scrapers under
 * server/scraping/youtube/ are kept for the same reason — the diagnosis is
 * complete, so deleting them would throw away work, but leaving them wired
 * would keep a broken path live.
 */
export const YOUTUBE_TOOLSET: PlatformToolset = {
  capture: youtubeCapture,
  // The contract's optional-phase semantics, used for the first time: YouTube
  // has no augmentation step, so the augment phase completes as a no-op.
  augment: null,
  transcribe: youtubeTranscribe,
  gate: youtubeGate,
  profileUrl: (handle) => `https://www.youtube.com/@${handle}`,
  // No platform-specific evidence block.
  evidenceExtras: () => "",
  // VERBATIM from researchYouTubeCreator: avgViews over followers. YouTube
  // exposes no per-video likes or comments on this path, so there is no
  // interaction rate to compute.
  engagementRate: ({ followerCount, avgViews }) =>
    followerCount > 0 && avgViews > 0
      ? Math.min(100, Math.round((avgViews / followerCount) * 100 * 10) / 10)
      : 0,
};

/**
 * Tool registry — the ONE place a platform becomes supported.
 *
 * YouTube is deliberately absent: `YOUTUBE_TOOLSET` above is written and
 * contract-complete, but not registered, so every path that resolves a toolset
 * refuses it in exactly the same way it refuses an unknown platform. Removing
 * the entry is the whole disable — no phase, runner, scheduler, queue or
 * harness change is needed, which is the point of the contract.
 */
const REGISTRY: Partial<Record<PlatformName, PlatformToolset>> = {
  TikTok: TIKTOK_TOOLSET,
  Instagram: INSTAGRAM_TOOLSET,
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
