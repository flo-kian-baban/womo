/**
 * BRAND'S FOUR COLLECTION PHASES (S5, step 3).
 *
 * Brand is not another platform — it is a different KIND of subject. It has no
 * video pool, no sampler and no handle; it has a website, review sites, search
 * fallbacks and (optionally) two social channels. What it shares with a creator
 * is the operating model: five phases, banked outputs, the retry policy, the
 * ledger, park and resume. So it brings its own phases and calls the SAME
 * generic driver — `runPhaseCollection` — and nothing shared learns what a
 * brand is.
 *
 * ─── The ordering constraints, which are load-bearing ───────────────────────
 * These are not stylistic. Each one, if broken, changes the string handed to
 * the model while every other test still passes.
 *
 *  1. THE CRAWL SEEDS THE SNIPPETS. `researchBrand` did
 *     `snippets = crawlResult.snippets` and the fallbacks then PUSHED onto that
 *     same array. Capture therefore banks its snippets and augment EXTENDS
 *     them — never rebuilds. Only the first 8 reach the prompt, so a different
 *     first-8 is a different prompt, and the harness pins that cap.
 *
 *  2. `description` is set by the crawl and overwritten by a fallback ONLY when
 *     it is empty. Same pattern, same reason.
 *
 *  3. The Google fallback runs BEFORE the YouTube one, and the YouTube
 *     condition reads the ACCUMULATING snippets array (crawl + Google), not
 *     capture's. Both live in augment for exactly that reason.
 *
 *  4. Reviews feed `buildBrandBaseEvidence` as an INPUT; mentions become a
 *     separately appended block. So the banked shape keeps them distinguishable
 *     — blend them and the base can no longer be rebuilt.
 *
 * ─── Rescue vs perception ───────────────────────────────────────────────────
 * Augment does two jobs with different failure meanings, and the banked output
 * keeps them apart rather than blending:
 *   RESCUE     — snippets and the YouTube fallback. Failing means we have a
 *                thin SELF-description.
 *   PERCEPTION — reviews and audience mentions. Failing means we have only the
 *                brand's own words about itself.
 * Nothing scores off this distinction; it is recorded so it is not lost.
 */
import type {
  AnalysisPhase, CampaignState, PhaseResult, PhaseRunContext,
} from "../_core/analysisPhase";
import { NOT_READY, BRAND_PSEUDO_PLATFORM } from "../_core/analysisPhase";
import type { GateInput, GateVerdict } from "./platformTools";
import { crawlBrandWebsite, deriveBrandSymbols, runPhaseCollection } from "../webResearch";
import { searchWeb } from "../scraping/brand/searchFallback";
import { searchYouTube } from "../scraping/youtube/searchScraper";
import {
  fetchBrandReviews, selectBrandReviewFields,
  EMPTY_BRAND_REVIEW_FIELDS, type BrandReviewFields,
} from "../reviewResearch";
import {
  analyzeBrandTikTokChannel, fetchBrandMentionData, formatAudienceMentionEvidenceBlock,
  formatBrandTikTokEvidenceBlock, type AudienceMentionData, type BrandTikTokMetadata,
} from "../brandTikTokAnalysis";
import {
  analyzeBrandInstagramChannel, formatBrandInstagramEvidenceBlock,
  type BrandInstagramMetadata,
} from "../brandInstagramAnalysis";
import { formatBrandDecodedSymbolsBlock, type BrandDecodedSymbols } from "../brandSymbolDecoder";
import { classifyPhaseError } from "./collectionPhases";
import {
  assembleBrandEvidence, buildBrandBaseEvidence, buildBrandDecoderInputs,
  type BrandDecoderInputs, type BrandEvidenceParts,
} from "./brandEvidence";

// ─── Banked shapes ───────────────────────────────────────────────────────────

export interface BrandCaptureOutput {
  brandName: string;
  /** Null when the subject was a NAME rather than a URL — `isUrl` in the monolith. */
  websiteUrl: string | null;
  description: string;
  /** SEEDED here. Augment extends this exact array; see constraint 1. */
  snippets: string[];
  semanticWordCount: number;
  crawledPages: string[];
}

export interface BrandAugmentOutput {
  /** Rescuing a weak capture — the brand's own words, widened. */
  rescue: {
    description: string;
    /** Capture's snippets EXTENDED, in order. */
    snippets: string[];
    googleFallbackRan: boolean;
    youtubeFallbackRan: boolean;
  };
  /** Independent perception — what other people say. */
  perception: {
    /** Feeds the BASE block as an input (constraint 4). */
    audiencePerceptionBlock: string | null;
    totalReviews: number;
    /**
     * CONSTRAINT 5 — the review fetch is banked, not summarised away.
     *
     * The phase used to keep only the formatted block and the count, which
     * discarded the raw review text and the per-platform ratings/excerpts. Two
     * consumers need what was thrown away: the symbol decoder reads
     * `combinedReviewText` (and the excerpts, when the website corpus is too
     * thin), and a brand observation records the ratings and excerpts as
     * columns. A formatted block cannot be parsed back into either.
     */
    review: BrandReviewFields;
    /** Becomes a separately APPENDED block (constraint 4). */
    mentionEvidenceBlock: string | null;
    totalMentions: number;
    /** Kept whole for the derive phase and the router's review fields. */
    mentions: AudienceMentionData | null;
  };
}

export interface BrandTranscribeOutput {
  /**
   * The channel analysis IN FULL — profile, videos, transcripts, LLM output.
   *
   * This replaced a `transcripts: Array<{videoId, transcriptText}>` field, which
   * was a strictly poorer subset of `metadata.videoTranscripts`. Banking both
   * would put two representations of the same videos in one blob and let them
   * disagree; banking only the text would lose every field a brand observation
   * records — follower count, engagement rate, handle, captions, posted dates,
   * transcript sources and the channel's own decoded symbols.
   *
   * Nothing had consumed the old shape (this phase was a stub) and no brand
   * campaign exists in the ledger, so nothing resumes into it.
   */
  metadata: BrandTikTokMetadata | null;
  skippedReason: string | null;
}

/** Phase 4's banked shape — the brand's Instagram channel, whole. */
export interface BrandInstagramChannelOutput {
  /**
   * IN FULL, and `postRefs` is the reason this is not reduced to captions.
   *
   * Persistence keys each Instagram content item by `postRefs[].id`. Keying by
   * POSITION instead — the `ig-post-<handle>-<i>` form this replaced — means a
   * re-analysis whose feed shifted by one writes post #3's caption over a
   * DIFFERENT post #3. `postCaptions` stays alongside it, unchanged, because it
   * is fed verbatim to the model.
   */
  metadata: BrandInstagramMetadata | null;
  skippedReason: string | null;
}

export interface BrandDeriveOutput {
  decodedSymbols: BrandDecodedSymbols | null;
  decodedSymbolsBlock: string | null;
}

/** What a brand collection produces. */
export interface BrandCollectionResult {
  brandName: string;
  evidenceParts: BrandEvidenceParts;
  evidenceSummary: string;
  capture: BrandCaptureOutput;
  augment: BrandAugmentOutput;
  transcribe: BrandTranscribeOutput;
  channelInstagram: BrandInstagramChannelOutput;
  derive: BrandDeriveOutput;
}

// ─── Phase 1 — capture: the website crawl, and nothing else ──────────────────

export function makeBrandCapturePhase(brandNameOrUrl: string): AnalysisPhase<{ subject: string }, BrandCaptureOutput> {
  return {
    name: "capture",
    tool: "brand:website_crawl",
    retry: { maxAttempts: 3, backoffMs: { transient: [30_000, 120_000] } },
    inputs: () => ({ subject: brandNameOrUrl }),
    async run(input, _ctx: PhaseRunContext): Promise<PhaseResult<BrandCaptureOutput>> {
      const started = Date.now();
      const isUrl = input.subject.startsWith("http");
      const brandName = isUrl
        ? input.subject.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0]
        : input.subject;

      const base: BrandCaptureOutput = {
        brandName,
        websiteUrl: isUrl ? input.subject : null,
        description: "",
        snippets: [],
        semanticWordCount: 0,
        crawledPages: [],
      };

      // A name-only subject has nothing to crawl. That is not a failure — the
      // fallbacks in augment exist precisely for it.
      if (!isUrl) {
        return {
          outcome: "partial", output: base,
          attempts: [{ tool: "brand:website_crawl", outcome: "partial", durationMs: Date.now() - started,
            detail: "subject is a name, not a URL — nothing to crawl" }],
        };
      }

      try {
        const crawl = await crawlBrandWebsite(input.subject);
        return {
          outcome: crawl.wordCount > 0 ? "complete" : "partial",
          output: {
            ...base,
            // VERBATIM from researchBrand: allText capped at 6000, snippets
            // taken whole, wordCount and pages passed through.
            description: crawl.allText.slice(0, 6000),
            snippets: crawl.snippets,
            semanticWordCount: crawl.wordCount,
            crawledPages: crawl.crawledPages,
          },
          attempts: [{ tool: "brand:website_crawl", outcome: "complete", durationMs: Date.now() - started }],
        };
      } catch (err) {
        // Degrade, never fail: the fallbacks can still produce evidence, which
        // is exactly what the monolith did with its try/catch here.
        return {
          outcome: "partial", output: base, failureClass: classifyPhaseError(err),
          attempts: [{ tool: "brand:website_crawl", outcome: "partial", durationMs: Date.now() - started,
            detail: (err as Error).message?.slice(0, 300) }],
        };
      }
    },
  };
}

// ─── Phase 2 — augment: rescue, then perception ──────────────────────────────

export function makeBrandAugmentPhase(
  googleMapsUrl: string | undefined,
): AnalysisPhase<{ capture: BrandCaptureOutput }, BrandAugmentOutput> {
  return {
    name: "augment",
    tool: "brand:fallbacks+reviews+mentions",
    retry: { maxAttempts: 2, backoffMs: { transient: [30_000] } },
    inputs: (state: CampaignState) => {
      const capture = state.phases.capture?.output as BrandCaptureOutput | undefined;
      return capture ? { capture } : NOT_READY;
    },
    async run(input, _ctx: PhaseRunContext): Promise<PhaseResult<BrandAugmentOutput>> {
      const started = Date.now();
      const { capture } = input;
      const isUrl = capture.websiteUrl !== null;

      // CONSTRAINT 1 + 2: extend what capture banked; never rebuild it.
      const snippets = [...capture.snippets];
      let description = capture.description;
      let googleFallbackRan = false;
      let youtubeFallbackRan = false;

      // ── Rescue A: Google/DuckDuckGo snippets. Condition reads CAPTURE's word
      //    count, exactly as the monolith did. ──
      if (!isUrl || capture.semanticWordCount < 500) {
        googleFallbackRan = true;
        try {
          const res = await searchWeb(`${capture.brandName} company about mission values`) as unknown as Record<string, unknown>;
          for (const result of ((res?.results as unknown[]) ?? []).slice(0, 3)) {
            const item = result as Record<string, unknown>;
            const title = (item?.title as string) ?? "";
            const snippet = (item?.snippet as string) ?? "";
            if (title) snippets.push(`Google: ${title}`);
            if (snippet) snippets.push(`${snippet}`);
          }
          if (!description && snippets.length > 0) description = snippets.join(" | ").slice(0, 2000);
        } catch (err) {
          console.warn("[brandPhases] Google fallback failed (non-fatal):", err);
        }
      }

      // ── Rescue B: YouTube snippets. CONSTRAINT 3 — this reads the
      //    ACCUMULATING array, so it must run after rescue A. ──
      if (!isUrl || (snippets.length < 3 && capture.semanticWordCount < 300)) {
        youtubeFallbackRan = true;
        try {
          const yt = await searchYouTube(`${capture.brandName} brand about`, { hl: "en", gl: "US" }) as unknown as Record<string, unknown>;
          for (const item of ((yt?.contents as unknown[]) ?? []).slice(0, 5)) {
            const video = (item as Record<string, unknown>)?.video as Record<string, unknown>;
            if (!video) continue;
            const title = (video?.title as string) ?? "";
            const desc = (video?.descriptionSnippet as string) ?? "";
            if (title) snippets.push(`YouTube: ${title}`);
            if (desc) snippets.push(`${desc}`);
          }
          if (!description && snippets.length > 0) description = snippets.join(" | ").slice(0, 2000);
        } catch (err) {
          console.warn("[brandPhases] YouTube fallback failed (non-fatal):", err);
        }
      }

      // ── Perception A: reviews. Feeds the BASE block (constraint 4) AND the
      //    decoder's rescue corpus (constraint 5). ──
      let audiencePerceptionBlock: string | null = null;
      let review: BrandReviewFields = EMPTY_BRAND_REVIEW_FIELDS;
      try {
        const reviews = await fetchBrandReviews(capture.brandName, capture.websiteUrl ?? "", googleMapsUrl);
        audiencePerceptionBlock = reviews.audiencePerceptionBlock || null;
        review = selectBrandReviewFields(reviews);
      } catch (err) {
        console.warn("[brandPhases] Review fetch failed (non-fatal):", err);
      }

      // ── Perception B: mentions. Becomes an APPENDED block (constraint 4). ──
      let mentions: AudienceMentionData | null = null;
      try {
        mentions = await fetchBrandMentionData(capture.brandName);
      } catch (err) {
        console.warn("[brandPhases] Mention fetch failed (non-fatal):", err);
      }

      return {
        outcome: "complete",
        output: {
          rescue: { description, snippets, googleFallbackRan, youtubeFallbackRan },
          perception: {
            audiencePerceptionBlock,
            // Unchanged in meaning: the monolith's `totalReviews` is the review
            // fetch's own count, which is what `review` carries.
            totalReviews: review.totalReviews,
            review,
            mentionEvidenceBlock: mentions ? formatAudienceMentionEvidenceBlock(mentions) : null,
            totalMentions: mentions?.totalMentions ?? 0,
            mentions,
          },
        },
        attempts: [{ tool: "brand:fallbacks+reviews+mentions", outcome: "complete", durationMs: Date.now() - started }],
      };
    },
  };
}

// ─── Phase 3 — transcribe: the brand's own TikTok channel ────────────────────

/**
 * A REAL phase now, not a stub — the whole channel analysis: profile, video
 * list, up to TRANSCRIPT_LIMIT (6) transcripts, and the channel's own LLM pass.
 * The router owned this until S5; it banks here instead.
 *
 * ─── Degrade, never fail ────────────────────────────────────────────────────
 * The router wrapped this in a try/catch that warned and continued with no
 * channel data. So must this: a brand with an unreachable TikTok channel is
 * still an analysable brand. It reports `partial` with the reason rather than
 * `failed`, which is the same convention brand capture already uses for the
 * work the router swallowed.
 */
export function makeBrandTranscribePhase(
  tiktokChannelUrl: string | undefined,
): AnalysisPhase<{ augment: BrandAugmentOutput }, BrandTranscribeOutput> {
  const TOOL = "brand:channel_tiktok";
  return {
    name: "transcribe",
    tool: TOOL,
    retry: { maxAttempts: 2, backoffMs: { transient: [60_000] } },
    inputs: (state: CampaignState) => {
      const augment = state.phases.augment?.output as BrandAugmentOutput | undefined;
      return augment ? { augment } : NOT_READY;
    },
    async run(_input, _ctx: PhaseRunContext): Promise<PhaseResult<BrandTranscribeOutput>> {
      const started = Date.now();
      const skip = (reason: string): PhaseResult<BrandTranscribeOutput> => ({
        outcome: "partial",
        output: { metadata: null, skippedReason: reason },
        attempts: [{ tool: TOOL, outcome: "partial", durationMs: Date.now() - started, detail: reason }],
      });

      if (!tiktokChannelUrl || tiktokChannelUrl.trim() === "") {
        return skip("no brand channel supplied");
      }
      try {
        const metadata = await analyzeBrandTikTokChannel(tiktokChannelUrl);
        // `analyzeBrandTikTokChannel` returns null for an unusable URL rather
        // than throwing — the same "no data" outcome, recorded as such.
        if (!metadata) return skip("channel analysis returned no data");
        return {
          outcome: "complete",
          output: { metadata, skippedReason: null },
          attempts: [{ tool: TOOL, outcome: "complete", durationMs: Date.now() - started }],
        };
      } catch (err) {
        console.warn("[brandPhases] TikTok channel analysis failed (non-fatal):", err);
        return {
          outcome: "partial",
          output: { metadata: null, skippedReason: "channel analysis failed" },
          failureClass: classifyPhaseError(err),
          attempts: [{ tool: TOOL, outcome: "partial", durationMs: Date.now() - started,
            detail: (err as Error).message?.slice(0, 300) }],
        };
      }
    },
  };
}

// ─── Phase 4 — channel_instagram: the brand's own Instagram ───────────────────

/**
 * ITS OWN PHASE, and the reason is the retry unit.
 *
 * Folded into `augment` — the only place it would otherwise fit — a single
 * failed Instagram scrape would re-run the review fetch and the mention fetch
 * beside it, under one failure class that describes none of the three. Folded
 * into `capture` it would re-run the website crawl. The phase boundary is what
 * makes a retry cost only the thing that failed, which is the same argument
 * that made `derive` separate.
 *
 * It is also where `postRefs` enters the ledger — see BrandInstagramChannelOutput.
 */
export function makeBrandInstagramPhase(
  instagramHandle: string | undefined,
): AnalysisPhase<{ augment: BrandAugmentOutput }, BrandInstagramChannelOutput> {
  const TOOL = "brand:channel_instagram";
  return {
    name: "channel_instagram",
    tool: TOOL,
    retry: { maxAttempts: 2, backoffMs: { transient: [60_000] } },
    inputs: (state: CampaignState) => {
      const augment = state.phases.augment?.output as BrandAugmentOutput | undefined;
      return augment ? { augment } : NOT_READY;
    },
    async run(_input, _ctx: PhaseRunContext): Promise<PhaseResult<BrandInstagramChannelOutput>> {
      const started = Date.now();
      const skip = (reason: string): PhaseResult<BrandInstagramChannelOutput> => ({
        outcome: "partial",
        output: { metadata: null, skippedReason: reason },
        attempts: [{ tool: TOOL, outcome: "partial", durationMs: Date.now() - started, detail: reason }],
      });

      if (!instagramHandle || instagramHandle.trim() === "") {
        return skip("no Instagram handle supplied");
      }
      try {
        const metadata = await analyzeBrandInstagramChannel(instagramHandle);
        if (!metadata) return skip("Instagram analysis returned no data");
        return {
          outcome: "complete",
          output: { metadata, skippedReason: null },
          attempts: [{ tool: TOOL, outcome: "complete", durationMs: Date.now() - started }],
        };
      } catch (err) {
        // Same swallow the router performed: no Instagram is not no brand.
        console.warn("[brandPhases] Instagram analysis failed (non-fatal):", err);
        return {
          outcome: "partial",
          output: { metadata: null, skippedReason: "Instagram analysis failed" },
          failureClass: classifyPhaseError(err),
          attempts: [{ tool: TOOL, outcome: "partial", durationMs: Date.now() - started,
            detail: (err as Error).message?.slice(0, 300) }],
        };
      }
    },
  };
}

// ─── Phase 5 — derive: the brand symbol decoder ──────────────────────────────

/**
 * Route a banked augment output into the shared decoder-input builder.
 *
 * Exported so the harness can assert on the decoder's inputs WITHOUT running the
 * decoder — which is precisely the blind spot that let the S5 step 3 divergence
 * through. Every field the builder reads comes from `augment`; nothing here
 * reformats or re-derives.
 */
export function brandDecoderInputsFrom(augment: BrandAugmentOutput): BrandDecoderInputs {
  return buildBrandDecoderInputs({
    description: augment.rescue.description,
    snippets: augment.rescue.snippets,
    yelpReviewExcerpts: augment.perception.review.yelpReviewExcerpts,
    googleReviewExcerpts: augment.perception.review.googleReviewExcerpts,
    combinedReviewText: augment.perception.review.combinedReviewText,
  });
}

export function makeBrandDerivePhase(): AnalysisPhase<
  { capture: BrandCaptureOutput; augment: BrandAugmentOutput }, BrandDeriveOutput
> {
  return {
    name: "derive",
    tool: "llm:brand_symbols",
    retry: { maxAttempts: 2, backoffMs: { transient: [15_000] } },
    inputs: (state: CampaignState) => {
      const capture = state.phases.capture?.output as BrandCaptureOutput | undefined;
      const augment = state.phases.augment?.output as BrandAugmentOutput | undefined;
      return capture && augment ? { capture, augment } : NOT_READY;
    },
    async run(input, _ctx: PhaseRunContext): Promise<PhaseResult<BrandDeriveOutput>> {
      const started = Date.now();
      /**
       * THE DECODER'S INPUTS, THROUGH THE SHARED BUILDER.
       *
       * This phase previously passed `rescue.description` alone as the website
       * corpus and the FORMATTED perception block as the review text. Both were
       * wrong: the monolith's corpus is the description PLUS every snippet (plus
       * a review-excerpt rescue when that runs under 150 chars), and its review
       * text is the RAW combined review text. Different inputs, different
       * symbols, a different extraction prompt — a WHAT change, not a HOW one.
       *
       * There is now one construction, called from here and from `researchBrand`,
       * so the two cannot diverge again. The 80-char floor and the non-fatal
       * catch still live inside `deriveBrandSymbols` itself.
       */
      const { websiteText, reviewText } = brandDecoderInputsFrom(input.augment);
      const decodedSymbols = await deriveBrandSymbols({
        brandName: input.capture.brandName,
        websiteText,
        reviewText,
        audienceMentionData: input.augment.perception.mentions,
      });
      return {
        outcome: "complete",
        output: {
          decodedSymbols,
          decodedSymbolsBlock: decodedSymbols ? formatBrandDecodedSymbolsBlock(decodedSymbols) : null,
        },
        attempts: [{ tool: "llm:brand_symbols", outcome: "complete", durationMs: Date.now() - started }],
      };
    },
  };
}

// ─── The assembly ────────────────────────────────────────────────────────────

/**
 * Rebuild the evidence string from the banked pieces.
 *
 * THE COMMIT-CRITICAL FUNCTION: this is where a phased brand run either
 * reproduces the monolith's string byte-for-byte or silently does not. The
 * order and the absent-block asymmetry are both owned by the two pinned
 * builders — this only routes the banked pieces into them.
 *
 * All FIVE blocks now, including the two the router used to append: phases 3
 * and 4 bank the channel metadata, so the collection produces the whole string
 * rather than a prefix of it. The formatters are the router's own, unchanged,
 * so the blocks themselves are the same bytes; what moved is where they are
 * concatenated, which `assembleBrandEvidence` has owned since S5 Part 1.
 */
export function assembleBrandCollection(banked: {
  capture: BrandCaptureOutput;
  augment: BrandAugmentOutput;
  transcribe?: BrandTranscribeOutput | null;
  channelInstagram?: BrandInstagramChannelOutput | null;
  derive: BrandDeriveOutput | null;
}): BrandCollectionResult {
  const { capture, augment, transcribe, channelInstagram, derive } = banked;

  const parts: BrandEvidenceParts = {
    base: buildBrandBaseEvidence({
      brandName: capture.brandName,
      websiteUrl: capture.websiteUrl,
      // The RESCUED description and the EXTENDED snippets — capture's values
      // only when augment changed nothing.
      description: augment.rescue.description,
      snippets: augment.rescue.snippets,
      audiencePerceptionBlock: augment.perception.audiencePerceptionBlock,
    }),
    decodedSymbolsBlock: derive?.decodedSymbolsBlock ?? null,
    mentionEvidenceBlock: augment.perception.mentionEvidenceBlock,
    // Absent metadata contributes NO block — the same asymmetry the router had,
    // where a null channel meant the block was never appended at all.
    tiktokBlock: transcribe?.metadata ? formatBrandTikTokEvidenceBlock(transcribe.metadata) : null,
    instagramBlock: channelInstagram?.metadata
      ? formatBrandInstagramEvidenceBlock(channelInstagram.metadata)
      : null,
  };

  return {
    brandName: capture.brandName,
    evidenceParts: parts,
    evidenceSummary: assembleBrandEvidence(parts),
    capture,
    augment,
    transcribe: transcribe ?? { metadata: null, skippedReason: "phase produced nothing" },
    channelInstagram: channelInstagram ?? { metadata: null, skippedReason: "phase produced nothing" },
    derive: derive ?? { decodedSymbols: null, decodedSymbolsBlock: null },
  };
}

// ─── The gate (S5, Option C — brand supplies its own) ────────────────────────

/**
 * Brand's minimum-data gate, FROZEN.
 *
 * Lifted verbatim from the `brand.analyze` router: the same five conditions, the
 * same `&&`, the same PRECONDITION_FAILED message. It cannot come from the
 * platform registry because brand is not a platform — see BRAND_PSEUDO_PLATFORM
 * for why that compromise was taken over separating subject type from platform.
 *
 * IT MUST RUN AFTER PHASES 3 AND 4. `evidenceLength` is measured on the summary
 * INCLUDING the TikTok and Instagram blocks, and two of the five conditions ask
 * whether those channels produced anything at all. Gating before them would
 * refuse a brand whose only evidence is its channels — which the router
 * explicitly admits.
 */
export function brandGate(input: GateInput): GateVerdict {
  const capture = input.banked.capture as BrandCaptureOutput | null;
  const augment = input.banked.augment as BrandAugmentOutput | null;
  const transcribe = input.banked.transcribe as BrandTranscribeOutput | null;
  const channelInstagram = input.banked.channel_instagram as BrandInstagramChannelOutput | null;
  const derive = input.banked.derive as BrandDeriveOutput | null;

  const evidenceSummary = capture && augment
    ? assembleBrandCollection({ capture, augment, transcribe, channelInstagram, derive }).evidenceSummary
    : "";

  const evidenceLength = evidenceSummary.length;
  const hasReviewData = (augment?.perception.totalReviews ?? 0) > 0;
  const hasMentionData = (augment?.perception.totalMentions ?? 0) > 0;
  const hasTikTokChannel = (transcribe?.metadata ?? null) !== null;
  const hasInstagramChannel = (channelInstagram?.metadata ?? null) !== null;

  if (evidenceLength < 200 && !hasReviewData && !hasMentionData && !hasTikTokChannel && !hasInstagramChannel) {
    return {
      ok: false,
      code: "PRECONDITION_FAILED",
      message: "Insufficient data to analyze this brand. No website content, reviews, or social mentions were found. Please verify the brand URL and try again.",
    };
  }
  return { ok: true };
}

// ─── The brand collection, through the SHARED driver ─────────────────────────

/**
 * Brand's FIVE collection phases, run by the same generic driver every subject
 * uses.
 *
 * Note what is NOT here: no branch on subject type, no pool, no sampler. The
 * driver is handed phases, a gate and an assembly, and knows nothing else —
 * which is the whole reason generalising it was worth doing rather than writing
 * a second orchestration.
 *
 * The platform slot carries BRAND_PSEUDO_PLATFORM, a named and documented
 * compromise rather than a bare cast. Read its declaration before adding a
 * second one anywhere.
 */
export async function runBrandCollection(
  brandNameOrUrl: string,
  extras: { googleMapsUrl?: string; tiktokChannelUrl?: string; instagramHandle?: string } = {},
  initialPhases?: CampaignState["phases"],
): Promise<BrandCollectionResult> {
  return runPhaseCollection<BrandCollectionResult>({
    handle: brandNameOrUrl,
    platform: BRAND_PSEUDO_PLATFORM,
    initialPhases,
    phases: [
      makeBrandCapturePhase(brandNameOrUrl),
      makeBrandAugmentPhase(extras.googleMapsUrl),
      makeBrandTranscribePhase(extras.tiktokChannelUrl),
      makeBrandInstagramPhase(extras.instagramHandle),
      makeBrandDerivePhase(),
    ] as never,
    // Brand's own FROZEN gate — it resolves no toolset (Option C).
    gate: brandGate,
    assemble: ({ banked }) => assembleBrandCollection({
      capture: banked.capture as BrandCaptureOutput,
      augment: banked.augment as BrandAugmentOutput,
      transcribe: banked.transcribe as BrandTranscribeOutput | null,
      channelInstagram: banked.channel_instagram as BrandInstagramChannelOutput | null,
      derive: banked.derive as BrandDeriveOutput | null,
    }),
  });
}
