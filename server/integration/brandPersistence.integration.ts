/**
 * BRAND PERSISTENCE FROM BANKED PHASES (S5).
 *
 * ─── Why this file exists ───────────────────────────────────────────────────
 * `persistBrandToV2` is the largest region of routers.ts and its failure mode is
 * SILENT: a wrong parameter shape saves a plausible-looking observation with
 * fields quietly missing, and nothing in the unit suite touches it. Moving the
 * call from the router onto the extract_commit phase means rebuilding all
 * sixteen of its parameters from banked phase output — so the move needs an
 * arbiter that reads the database, not a code review that reads the diff.
 *
 * ─── What is asserted ───────────────────────────────────────────────────────
 *  1. PARITY, before any database work: the parameters built from banked phases
 *     equal the parameters the router constructs today, field for field. The
 *     router's construction is transcribed literally here rather than imported,
 *     so this is a second statement of the shape and not a tautology.
 *  2. The persisted observation carries every field: review columns, weights,
 *     channel counts, mention columns, symbol summary.
 *  3. `content_items` are keyed by REAL platform ids — `postRefs[].id` for
 *     Instagram, `videoId` for the TikTok channel — never the positional
 *     `ig-post-<handle>-<i>` form. Position is not identity: a re-analysis whose
 *     feed shifted by one would otherwise write post #3's caption onto a
 *     different post #3.
 *  4. `persistence_status` reports every component, with the two skip kinds kept
 *     distinct.
 *
 * Gated on TEST_DATABASE_URL exactly like the other integration files; runs
 * against a disposable Docker Postgres, never production.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Client } from "pg";
import { persistBrandToV2 } from "../routers";
import { assembleBrandCollection, buildBrandPersistParams } from "../phases/brandPhases";
import { EMPTY_BRAND_REVIEW_FIELDS } from "../reviewResearch";

const TEST_URL = process.env.TEST_DATABASE_URL;
if (TEST_URL) process.env.DATABASE_URL = TEST_URL;

const suite = TEST_URL ? describe : describe.skip;
const here = path.dirname(fileURLToPath(import.meta.url));

// ─── The banked phase outputs a real brand campaign would produce ────────────

const REVIEW = {
  yelpRating: 4.5,
  yelpReviewCount: 120,
  yelpReviewExcerpts: '[5★] Ada: "great espresso"',
  googleRating: 4.2,
  googleReviewCount: 128,
  googleReviewExcerpts: '[4★] Grace: "solid flat white"',
  combinedReviewText: 'Ada: "great espresso"\n\nGrace: "solid flat white"',
  overallRating: 4.35,
  totalReviews: 248,
};

const MENTIONS = {
  totalMentions: 3,
  uniqueAuthors: 2,
  sentimentSignal: "positive",
  sentimentConfidence: "high",
  audienceLanguageSummary: "warm, ritual-oriented",
  audienceIdentityClaims: ["coffee snob"],
  topHashtags: ["#thirdwave"],
  mentionMusicTitles: ["Morning Light"],
  mentionMusicArtists: ["Kiasmos"],
  rawMentionVideos: [
    { videoId: "mention-1", authorHandle: "@fan", caption: "obsessed", plays: 900, likes: 40, comments: 3, shares: 1, saves: 2, musicTitle: "Morning Light", musicArtist: "Kiasmos" },
  ],
};

const banked = {
  capture: {
    brandName: "phasebrand.example",
    websiteUrl: "https://phasebrand.example",
    description: "A specialty coffee roaster.".repeat(20),
    snippets: ["Google: Phase Brand", "Specialty roaster", "Since 2011"],
    semanticWordCount: 2411,
    crawledPages: ["https://phasebrand.example", "https://phasebrand.example/about"],
  },
  augment: {
    rescue: {
      description: "A specialty coffee roaster.".repeat(20),
      snippets: ["Google: Phase Brand", "Specialty roaster", "Since 2011"],
      googleFallbackRan: false,
      youtubeFallbackRan: false,
    },
    perception: {
      audiencePerceptionBlock: "AUDIENCE PERCEPTION\nRated 4.35 across 248 reviews.",
      totalReviews: REVIEW.totalReviews,
      review: { ...EMPTY_BRAND_REVIEW_FIELDS, ...REVIEW },
      mentionEvidenceBlock: "AUDIENCE MENTIONS\n3 mentions.",
      totalMentions: MENTIONS.totalMentions,
      mentions: MENTIONS,
    },
  },
  transcribe: {
    metadata: {
      channelHandle: "phasebrand",
      followerCount: 51_000,
      engagementRate: 4.1,
      rawKeywords: ["roastery"],
      themeLabels: ["craft"],
      symbolicVocabulary: ["ritual"],
      videoTranscripts: [
        {
          videoId: "7500000000000000001",
          caption: "how we roast",
          transcriptText: "we roast in small batches",
          transcriptWordCount: 6,
          transcriptSource: "subtitle",
          postedDate: "2026-05-01T00:00:00.000Z",
        },
      ],
    },
    skippedReason: null,
  },
  channelInstagram: {
    metadata: {
      channelHandle: "phasebrand",
      followerCount: 62_000,
      engagementRate: 3.3,
      postCaptions: ["morning pour", "new single origin"],
      // THE STABLE IDS. Same posts, same order, each carrying the platform id
      // `postCaptions` throws away.
      postRefs: [
        { id: "C_real_ig_id_001", caption: "morning pour" },
        { id: "C_real_ig_id_002", caption: "new single origin" },
      ],
      decodedSymbols: [{ category: "identity_claim", phrase: "slow mornings", meaning: "ritual identity" }],
      rawKeywords: ["pour-over"],
      themeLabels: ["morning ritual"],
      symbolicVocabulary: ["slow"],
    },
    skippedReason: null,
  },
  derive: {
    decodedSymbols: {
      rawKeywords: ["craft", "origin"],
      themeLabels: ["provenance"],
      symbolicVocabulary: ["terroir"],
      symbolicSummary: "provenance as proof of care",
      identityClaims: [{ phrase: "we roast", meaning: "maker identity", informs: ["archetype"] }],
      statusSignals: [],
      communityReferences: [],
      aspirationDrivers: [],
      audienceLanguage: [],
    },
    decodedSymbolsBlock: "BRAND SYMBOLS\nprovenance as proof of care",
  },
};

const EXTRACTED = {
  brandName: "Phase Brand",
  category: "Coffee",
  archetype: "The Creator",
  brandArchetypeClassification: "Craft",
  brandType: "Retail — E-Commerce / DTC Product",
  campaignType: "Product Launch",
  emotionalPromise: "care made visible",
  audienceTribe: "third-wave drinkers",
  aiSummary: "A roaster trading on provenance.",
  visualLanguage: ["warm neutrals"],
};

const WEIGHTS = { alpha: 0.5, beta: 0.3, gamma: 0.2, priority: "balanced" };
const REQUESTED = { tiktokChannelUrl: "https://www.tiktok.com/@phasebrand", instagramHandle: "phasebrand" };

suite("brand persistence from banked phases (ephemeral Postgres)", () => {
  let admin: Client;
  const q = async (text: string, params?: unknown[]) => (await admin.query(text, params)).rows;

  beforeAll(async () => {
    admin = new Client({ connectionString: TEST_URL });
    await admin.connect();
    await admin.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
    // Same two pg_dump adjustments the other integration files make: psql
    // meta-commands are not SQL, and the dump's own CREATE SCHEMA collides.
    const ddl = readFileSync(path.join(here, "schema.sql"), "utf8")
      .split("\n")
      .filter(line => !line.startsWith("\\") && line.trim() !== "CREATE SCHEMA public;")
      .join("\n");
    await admin.query(ddl);
    // The dump clears search_path for its own session — restore it so the
    // unqualified table names in this suite's assertions resolve.
    await admin.query("SET search_path TO public;");
  }, 60_000);

  afterAll(async () => { await admin.end(); });

  /**
   * (1) PARITY — the shape, before any database work.
   *
   * The right-hand side is the `brand.analyze` router's construction,
   * transcribed literally. If the two ever disagree, the phased path is writing
   * a different observation than the endpoint does.
   */
  it("builds the SAME parameters the router builds today", () => {
    const collection = assembleBrandCollection(banked as never);
    const built = buildBrandPersistParams({
      collection, extracted: EXTRACTED, weights: WEIGHTS, requested: REQUESTED,
    });

    // ── the router, verbatim ──
    const m = MENTIONS;
    const routerShaped = {
      brandName: EXTRACTED.brandName,
      brandUrl: "https://phasebrand.example",
      category: EXTRACTED.category,
      extracted: EXTRACTED,
      weights: WEIGHTS,
      reviewFields: {
        yelpRating: REVIEW.yelpRating,
        yelpReviewCount: REVIEW.yelpReviewCount,
        yelpReviewExcerpts: REVIEW.yelpReviewExcerpts || undefined,
        googleRating: REVIEW.googleRating,
        googleReviewCount: REVIEW.googleReviewCount,
        googleReviewExcerpts: REVIEW.googleReviewExcerpts || undefined,
        combinedReviewText: REVIEW.combinedReviewText || undefined,
        overallRating: REVIEW.overallRating,
        totalReviews: REVIEW.totalReviews,
      },
      tiktokMetadata: banked.transcribe.metadata,
      instagramMetadata: banked.channelInstagram.metadata,
      mentionFields: {
        mentionDecodedSymbols: m,
        mentionRawKeywords: m.audienceIdentityClaims,
        mentionHashtagCloud: m.topHashtags,
        mentionSentiment: m.sentimentSignal,
        mentionSentimentConfidence: m.sentimentConfidence,
        mentionMusicSignals: m.mentionMusicTitles,
        mentionMusicArtists: m.mentionMusicArtists,
        mentionTotalCount: m.totalMentions,
        mentionUniqueAuthors: m.uniqueAuthors,
        mentionAudienceSummary: m.audienceLanguageSummary,
      },
      symbolFields: {
        brandRawKeywords: banked.derive.decodedSymbols.rawKeywords,
        brandThemeLabels: banked.derive.decodedSymbols.themeLabels,
        brandSymbolicVocabulary: banked.derive.decodedSymbols.symbolicVocabulary,
        brandDecodedSymbols: banked.derive.decodedSymbols,
      },
      // 2411 words, 248 reviews → 2411 + 1000 ≥ 2000 → "high"
      dataConfidenceLevel: "high",
      semanticWordCount: 2411,
      crawledPagesCount: 2,
      tiktokRequested: true,
      instagramRequested: true,
    };

    expect(built).toEqual(routerShaped);
  });

  it("persists, and the observation carries every field", async () => {
    const collection = assembleBrandCollection(banked as never);
    const params = buildBrandPersistParams({
      collection, extracted: EXTRACTED, weights: WEIGHTS, requested: REQUESTED,
    });

    const result = await persistBrandToV2(params as never);
    if ("error" in result) throw new Error(String(result.error));
    expect(result.subjectId).toBeTruthy();

    const [subject] = await q("select * from subjects where id=$1", [result.subjectId]);
    expect(subject.subject_type).toBe("brand");
    expect(subject.display_name).toBe("Phase Brand");
    expect(subject.website_url).toBe("https://phasebrand.example");

    const [obs] = await q("select * from observations where id=$1", [result.observationId]);
    // Follower count is the HIGHER of the two channels (Instagram, 62k).
    // bigint columns come back from pg as strings — compare numerically.
    expect(Number(obs.follower_count)).toBe(62_000);
    expect(obs.data_confidence_level).toBe("high");

    const [bo] = await q("select * from brand_observations where observation_id=$1", [result.observationId]);
    expect(Number(bo.google_rating)).toBeCloseTo(4.2, 5);
    expect(bo.google_review_count).toBe(128);
    expect(bo.google_review_excerpts).toBe(REVIEW.googleReviewExcerpts);
    expect(Number(bo.yelp_rating)).toBeCloseTo(4.5, 5);
    expect(bo.yelp_review_count).toBe(120);
    expect(bo.yelp_review_excerpts).toBe(REVIEW.yelpReviewExcerpts);
    expect(Number(bo.overall_rating)).toBeCloseTo(4.35, 5);
    expect(bo.total_reviews).toBe(248);
    expect(bo.tiktok_handle).toBe("phasebrand");
    expect(Number(bo.tiktok_follower_count)).toBe(51_000);
    expect(bo.mention_total_count).toBe(3);
    expect(bo.mention_unique_authors).toBe(2);
    expect(bo.mention_sentiment).toBe("positive");
    expect(bo.symbolic_summary).toBe("provenance as proof of care");
    expect(bo.semantic_word_count).toBe(2411);
    expect(bo.crawled_pages_count).toBe(2);
    expect(Number(bo.weight_alpha)).toBeCloseTo(0.5, 5);
  });

  /**
   * (3) THE STABLE-ID CLAIM. The whole reason `postRefs` had to survive the
   * move into a banked phase.
   */
  it("content_items carry REAL platform ids — postRefs, never positional", async () => {
    const rows = await q(
      `select ci.platform, ci.platform_video_id, ci.caption, ci.status
         from content_items ci
         join subjects s on s.id = ci.subject_id
        where s.display_name = $1
        order by ci.platform, ci.platform_video_id`,
      ["Phase Brand"],
    );

    const ig = rows.filter(r => r.platform === "instagram");
    expect(ig.map(r => r.platform_video_id)).toEqual(["C_real_ig_id_001", "C_real_ig_id_002"]);
    // The defect this replaced, asserted as absent.
    for (const r of ig) expect(r.platform_video_id).not.toMatch(/^ig-post-/);
    expect(ig.find(r => r.platform_video_id === "C_real_ig_id_001")!.caption).toBe("morning pour");

    // `insertContentItems` normalises the platform column to lower case.
    const tiktok = rows.filter(r => r.platform === "tiktok");
    // The channel video keeps its real id, and the mention video keeps its own.
    expect(tiktok.map(r => r.platform_video_id).sort())
      .toEqual(["7500000000000000001", "mention-1"]);
    for (const r of tiktok) expect(r.platform_video_id).not.toMatch(/^brand-video-/);
    expect(tiktok.find(r => r.platform_video_id === "mention-1")!.status).toBe("mention");
    expect(tiktok.find(r => r.platform_video_id === "7500000000000000001")!.status).toBe("sampled");
  });

  it("persistence_status reports every component", async () => {
    const [obs] = await q(
      `select o.persistence_status ps from observations o
         join subjects s on s.id = o.subject_id
        where s.display_name = $1`,
      ["Phase Brand"],
    );
    const ps = obs.ps as Record<string, { status: string }>;

    expect(ps.identity_core.status).toBe("success");
    for (const component of [
      "signal_values", "decoded_signals", "audience_mentions",
      "channel_content_items", "mention_content_items",
      "instagram_handle", "instagram_content_items",
      "instagram_signal_values", "instagram_decoded_signals",
    ]) {
      expect(ps[component], `missing component ${component}`).toBeTruthy();
      expect(ps[component].status, `${component} did not succeed`).toBe("success");
    }
  });

  /**
   * The two skip kinds stay distinct — a brand that was never asked about its
   * channels must not look like one whose channels failed.
   */
  it("an unrequested channel reports skipped_not_attempted, not failure", async () => {
    const noChannels = {
      ...banked,
      transcribe: { metadata: null, skippedReason: "no brand channel supplied" },
      channelInstagram: { metadata: null, skippedReason: "no Instagram handle supplied" },
    };
    const collection = assembleBrandCollection(noChannels as never);
    const params = buildBrandPersistParams({
      collection,
      extracted: { ...EXTRACTED, brandName: "Phase Brand No Channels" },
      weights: WEIGHTS,
      requested: {},
    });
    expect(params.tiktokRequested).toBe(false);
    expect(params.instagramRequested).toBe(false);

    const result = await persistBrandToV2(params as never);
    if ("error" in result) throw new Error(String(result.error));

    const [obs] = await q("select persistence_status ps from observations where id=$1", [result.observationId]);
    const ps = obs.ps as Record<string, { status: string; reason?: string }>;
    expect(ps.channel_content_items.status).toBe("skipped_not_attempted");
    expect(ps.instagram_handle.status).toBe("skipped_not_attempted");
    expect(ps.instagram_content_items.status).toBe("skipped_not_attempted");
    // Brand-level signals still saved — the channels are not the brand.
    expect(ps.signal_values.status).toBe("success");
  });
});
