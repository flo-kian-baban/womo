/**
 * ⚠️  TYPES ONLY — this DB is Supabase-migration-managed. Do NOT run drizzle-kit
 *     (migrate / push / generate) against production; there is no
 *     __drizzle_migrations ledger, so drizzle would try to recreate every object.
 *     Make schema changes via a Supabase migration (apply_migration), then mirror
 *     them here for types. See docs/STORAGE_MODEL.md.
 */

/**
 * WOMO Schema V2 — PostgreSQL / Drizzle ORM
 *
 * 20-table normalized schema replacing the previous 4-table MySQL schema.
 * Targets PostgreSQL 15+ with extensions: vector, uuid-ossp, pg_trgm.
 *
 * Frozen engine files (fitEngine.ts, aiExtraction.ts, symbolDecoder.ts,
 * brandSymbolDecoder.ts) are NOT modified — this schema replaces the
 * storage layer only. Application code migration is a separate phase.
 */

import {
  pgTable, pgEnum, uuid, text, varchar, integer, bigint, real, boolean,
  timestamp, jsonb, index, uniqueIndex, serial,
} from "drizzle-orm/pg-core";

// ═══════════════════════════════════════════════════════════════════════════════
// EXTENSIONS (run manually before first migration)
// ═══════════════════════════════════════════════════════════════════════════════
// CREATE EXTENSION IF NOT EXISTS vector;
// CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
// CREATE EXTENSION IF NOT EXISTS pg_trgm;

// ═══════════════════════════════════════════════════════════════════════════════
// ENUMS
// ═══════════════════════════════════════════════════════════════════════════════

export const platformEnum = pgEnum("platform", [
  "tiktok", "instagram", "youtube", "google_maps", "yelp",
]);

export const subjectTypeEnum = pgEnum("subject_type", [
  "creator", "brand",
]);

export const archetypeEnum = pgEnum("archetype", [
  "The Sage", "The Hero", "The Outlaw", "The Explorer",
  "The Magician", "The Ruler", "The Caregiver", "The Lover",
  "The Jester", "The Innocent", "The Everyman", "The Creator",
]);

export const brandArchetypeEnum = pgEnum("brand_archetype", [
  "Trust", "Community", "Momentum",
]);

export const campaignTypeEnum = pgEnum("campaign_type", [
  "Heritage/Luxury", "Trend-First", "Long-Term Ambassador",
  "Product Launch", "Community/Local", "Awareness/Consideration",
]);

export const audienceRelationshipEnum = pgEnum("audience_relationship", [
  "Friend", "Mentor", "Authority",
]);

export const culturalCapitalEnum = pgEnum("cultural_capital", [
  "Produce", "Relay",
]);

export const goffmanEnum = pgEnum("goffman_consistency", [
  "Consistent", "Minor Gap", "Significant Gap",
]);

export const driftSignalEnum = pgEnum("drift_signal", [
  "Zero Change", "Minor Drift", "Significant Drift", "Full Pivot",
]);

export const hallDecodingEnum = pgEnum("hall_decoding", [
  "Dominant", "Negotiated", "Oppositional",
]);

export const rogersStageEnum = pgEnum("rogers_stage", [
  "Innovators", "Early Adopters", "Early Majority",
  "Late Majority", "Laggards",
]);

export const nichePositionEnum = pgEnum("niche_position", [
  "Ahead", "Consistent", "Behind",
]);

export const lifecyclePhaseEnum = pgEnum("lifecycle_phase", [
  "Emergence", "Growth", "Maturity", "Decline",
]);

export const liminalPhaseEnum = pgEnum("liminal_phase", [
  "Pre-Liminal", "Liminal", "Post-Liminal Reintegration",
]);

export const pronounsEnum = pgEnum("pronouns", [
  "she/her", "he/him", "they/them", "not specified",
]);

export const culturalVelocityEnum = pgEnum("cultural_velocity", [
  "Focusing", "Drifting", "Insufficient Data",
]);

export const confidenceLevelEnum = pgEnum("confidence_level", [
  "high", "medium", "low",
]);

export const fitStatusEnum = pgEnum("fit_status", [
  "Green Light", "Proceed with Caution", "Do Not Proceed",
]);

export const sentimentEnum = pgEnum("sentiment", [
  "positive", "mixed", "negative", "insufficient_data",
]);

export const signalConfidenceEnum = pgEnum("signal_confidence", [
  "Verified", "Estimated", "Insufficient Data",
]);

export const signalDomainEnum = pgEnum("signal_domain", [
  "keyword", "hashtag", "content_theme", "theme",
  "visual_language", "symbolic_vocabulary",
  "music_title", "music_artist",
  "identity_claim", "status_signal", "community_reference",
  "aspiration_driver", "audience_language",
]);

export const scrapeMethodEnum = pgEnum("scrape_method", [
  "tiktok_desktop_http", "tiktok_mobile_http",
  "tiktok_playwright", "tiktok_google_cache",
  "tiktok_search_xhr", "tiktok_search_html",
  "instagram_playwright", "instagram_picuki", "instagram_oembed",
  "youtube_api", "youtube_html",
  "google_maps_api", "google_maps_http", "google_search", "website_crawl",
  "whisper_transcription",
  "manual_entry",
]);

export const warningTypeEnum = pgEnum("warning_type", [
  "Low Alignment", "Archetype Tension", "Identity Instability",
  "Low Pulse", "Trajectory Divergence",
  "Low Social Engagement", "Negative Audience Sentiment",
]);

export const engagementTierEnum = pgEnum("engagement_tier", [
  "nano", "micro", "mid", "macro", "mega",
]);


// ═══════════════════════════════════════════════════════════════════════════════
// TABLE 1: SUBJECTS — Stable entity registry
// ═══════════════════════════════════════════════════════════════════════════════

export const subjects = pgTable("subjects", {
  id: uuid("id").defaultRandom().primaryKey(),
  subjectType: subjectTypeEnum("subject_type").notNull(),

  // PII zone (nullable for anonymization)
  displayName: text("display_name"),
  primaryHandle: varchar("primary_handle", { length: 255 }),
  primaryPlatform: platformEnum("primary_platform"),
  profileUrl: text("profile_url"),
  websiteUrl: text("website_url"),
  pronouns: pronounsEnum("pronouns"),

  // Stable classification (survives anonymization)
  latestArchetype: archetypeEnum("latest_archetype"),
  latestBrandArchetype: brandArchetypeEnum("latest_brand_archetype"),
  brandType: varchar("brand_type", { length: 255 }),
  brandCategory: text("brand_category"),
  campaignType: campaignTypeEnum("campaign_type"),
  engagementTier: engagementTierEnum("engagement_tier"),

  // Anonymization
  anonymizedAt: timestamp("anonymized_at", { withTimezone: true }),

  // Timestamps
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  typeIdx: index("subjects_type_idx").on(t.subjectType),
  handleIdx: index("subjects_handle_idx").on(t.primaryHandle),
  archetypeIdx: index("subjects_archetype_idx").on(t.latestArchetype),
  brandArchIdx: index("subjects_brand_arch_idx").on(t.latestBrandArchetype),
  tierIdx: index("subjects_tier_idx").on(t.engagementTier),
  matchingIdx: index("subjects_matching_idx").on(
    t.subjectType, t.latestArchetype, t.engagementTier, t.primaryPlatform
  ),
}));


// ═══════════════════════════════════════════════════════════════════════════════
// TABLE 2: PLATFORM_HANDLES — Multi-platform identity mapping
// ═══════════════════════════════════════════════════════════════════════════════

export const platformHandles = pgTable("platform_handles", {
  id: uuid("id").defaultRandom().primaryKey(),
  subjectId: uuid("subject_id").notNull().references(() => subjects.id, { onDelete: "cascade" }),
  platform: platformEnum("platform").notNull(),
  handle: varchar("handle", { length: 255 }).notNull(),
  profileUrl: text("profile_url"),
  isPrimary: boolean("is_primary").default(false).notNull(),
  discoveredAt: timestamp("discovered_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  subjectIdx: index("handles_subject_idx").on(t.subjectId),
  lookupIdx: uniqueIndex("handles_lookup_idx").on(t.platform, t.handle),
}));


// ═══════════════════════════════════════════════════════════════════════════════
// TABLE 3: OBSERVATIONS — Shared metadata only
// ═══════════════════════════════════════════════════════════════════════════════

export const observations = pgTable("observations", {
  id: uuid("id").defaultRandom().primaryKey(),
  subjectId: uuid("subject_id").notNull().references(() => subjects.id, { onDelete: "cascade" }),
  isLatest: boolean("is_latest").default(true).notNull(),

  // Shared platform metrics snapshot
  followerCount: bigint("follower_count", { mode: "number" }),
  followingCount: bigint("following_count", { mode: "number" }),
  engagementRate: real("engagement_rate"),
  bio: text("bio"),

  // Shared confidence
  dataConfidenceLevel: confidenceLevelEnum("data_confidence_level"),
  transcriptCount: integer("transcript_count").default(0),

  // Timestamps
  observedAt: timestamp("observed_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  subjectIdx: index("obs_subject_idx").on(t.subjectId),
  latestIdx: index("obs_latest_idx").on(t.subjectId, t.isLatest),
  timeIdx: index("obs_time_idx").on(t.subjectId, t.observedAt),
}));


// ═══════════════════════════════════════════════════════════════════════════════
// TABLE 9: NICHE_TAXONOMY — Hierarchical niche classification
// (Declared before creator_observations due to FK reference)
// ═══════════════════════════════════════════════════════════════════════════════

export const nicheTaxonomy = pgTable("niche_taxonomy", {
  id: uuid("id").defaultRandom().primaryKey(),
  slug: varchar("slug", { length: 128 }).notNull().unique(),
  label: text("label").notNull(),
  parentId: uuid("parent_id"),
  level: integer("level").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  // nt_slug_idx removed — redundant with the column-level unique constraint
  // (niche_taxonomy_slug_unique). Dropped in the womo_0004_db_hardening migration.
  parentIdx: index("nt_parent_idx").on(t.parentId),
  levelIdx: index("nt_level_idx").on(t.level),
}));


// ═══════════════════════════════════════════════════════════════════════════════
// TABLE 4: CREATOR_OBSERVATIONS — Creator-specific cultural profile
// ═══════════════════════════════════════════════════════════════════════════════

export const creatorObservations = pgTable("creator_observations", {
  id: uuid("id").defaultRandom().primaryKey(),
  observationId: uuid("observation_id").notNull().references(() => observations.id, { onDelete: "cascade" }).unique(),

  // Platform metrics (creator-specific)
  totalLikes: bigint("total_likes", { mode: "number" }),
  videoCount: integer("video_count"),
  totalViews: bigint("total_views", { mode: "number" }),
  avgViews: integer("avg_views"),
  avgVideoDuration: real("avg_video_duration"),
  primaryRegion: varchar("primary_region", { length: 255 }),

  // AI-extracted cultural profile
  archetype: archetypeEnum("archetype"),
  toneRegister: text("tone_register"),
  parasocialBondStrength: real("parasocial_bond_strength"),
  audienceRelationshipType: audienceRelationshipEnum("audience_relationship_type"),
  barthesMyth: text("barthes_myth"),
  culturalCapital: culturalCapitalEnum("cultural_capital"),
  goffmanStageConsistency: goffmanEnum("goffman_stage_consistency"),
  driftSignal: driftSignalEnum("drift_signal"),
  stuartHallDecoding: hallDecodingEnum("stuart_hall_decoding"),

  // Niche (FK to taxonomy + free-text fallback)
  nicheId: uuid("niche_id").references(() => nicheTaxonomy.id, { onDelete: "set null" }),
  nicheTopicNode: text("niche_topic_node"),

  undergroundDensity: boolean("underground_density"),
  mainstreamBleed: boolean("mainstream_bleed"),
  remixRate: boolean("remix_rate"),
  brandSaturation: boolean("brand_saturation"),
  rogersAdopterStage: rogersStageEnum("rogers_adopter_stage"),
  creatorNichePosition: nichePositionEnum("creator_niche_position"),
  lifecyclePhase: lifecyclePhaseEnum("lifecycle_phase"),
  barthesNicheMeaning: text("barthes_niche_meaning"),
  turnerLiminalPhase: liminalPhaseEnum("turner_liminal_phase"),

  // Computed signals
  culturalVelocity: culturalVelocityEnum("cultural_velocity"),
  engagementQualityScore: real("engagement_quality_score"),
  engagementQualityConfidence: signalConfidenceEnum("engagement_quality_confidence"),

  // Summaries
  symbolicSummary: text("symbolic_summary"),
  aiSummary: text("ai_summary"),
}, (t) => ({
  observationIdx: index("co_observation_idx").on(t.observationId),
  archetypeIdx: index("co_archetype_idx").on(t.archetype),
  rogersIdx: index("co_rogers_idx").on(t.rogersAdopterStage),
  lifecycleIdx: index("co_lifecycle_idx").on(t.lifecyclePhase),
  nicheIdx: index("co_niche_idx").on(t.nicheId),
}));


// ═══════════════════════════════════════════════════════════════════════════════
// TABLE 5: BRAND_OBSERVATIONS — Brand-specific profile
// ═══════════════════════════════════════════════════════════════════════════════

export const brandObservations = pgTable("brand_observations", {
  id: uuid("id").defaultRandom().primaryKey(),
  observationId: uuid("observation_id").notNull().references(() => observations.id, { onDelete: "cascade" }).unique(),

  // Brand identity
  brandArchetypeClassification: brandArchetypeEnum("brand_archetype_classification"),
  archetype: archetypeEnum("archetype"),
  emotionalPromise: text("emotional_promise"),
  audienceTribe: text("audience_tribe"),
  culturalTension: text("cultural_tension"),
  brandTone: text("brand_tone"),
  barthesMyth: text("barthes_myth"),

  // Brand-side framework fields (creator parity)
  brandCulturalCapital: culturalCapitalEnum("brand_cultural_capital"),
  brandGoffmanConsistency: goffmanEnum("brand_goffman_consistency"),
  brandDriftSignal: driftSignalEnum("brand_drift_signal"),
  brandHallDecoding: hallDecodingEnum("brand_hall_decoding"),
  brandRogersStage: rogersStageEnum("brand_rogers_stage"),
  brandLiminalPhase: liminalPhaseEnum("brand_liminal_phase"),
  brandLifecyclePhase: lifecyclePhaseEnum("brand_lifecycle_phase"),
  brandBarthesNicheMeaning: text("brand_barthes_niche_meaning"),
  brandAudienceDecodingSplit: boolean("brand_audience_decoding_split"),

  // Weights
  weightAlpha: real("weight_alpha"),
  weightBeta: real("weight_beta"),
  weightGamma: real("weight_gamma"),
  weightPriority: text("weight_priority"),

  // Review data
  googleRating: real("google_rating"),
  googleReviewCount: integer("google_review_count"),
  googleReviewExcerpts: text("google_review_excerpts"),
  yelpRating: real("yelp_rating"),
  yelpReviewCount: integer("yelp_review_count"),
  yelpReviewExcerpts: text("yelp_review_excerpts"),
  overallRating: real("overall_rating"),
  totalReviews: integer("total_reviews"),

  // TikTok channel data
  tiktokHandle: varchar("tiktok_handle", { length: 255 }),
  tiktokFollowerCount: integer("tiktok_follower_count"),
  tiktokEngagementRate: real("tiktok_engagement_rate"),

  // Audience mention aggregates
  mentionTotalCount: integer("mention_total_count"),
  mentionUniqueAuthors: integer("mention_unique_authors"),
  mentionSentiment: sentimentEnum("mention_sentiment"),
  mentionSentimentConfidence: confidenceLevelEnum("mention_sentiment_confidence"),
  mentionAudienceSummary: text("mention_audience_summary"),

  // Summaries
  symbolicSummary: text("symbolic_summary"),
  aiSummary: text("ai_summary"),

  // Crawl metadata (P2-2)
  semanticWordCount: integer("semantic_word_count"),
  crawledPagesCount: integer("crawled_pages_count"),
}, (t) => ({
  observationIdx: index("bo_observation_idx").on(t.observationId),
  brandArchIdx: index("bo_brand_arch_idx").on(t.brandArchetypeClassification),
  sentimentIdx: index("bo_sentiment_idx").on(t.mentionSentiment),
}));


// ═══════════════════════════════════════════════════════════════════════════════
// TABLE 6: SIGNAL_VALUES — Normalized EAV for all list/categorical signals
// ═══════════════════════════════════════════════════════════════════════════════

export const signalValues = pgTable("signal_values", {
  id: uuid("id").defaultRandom().primaryKey(),
  subjectId: uuid("subject_id").notNull().references(() => subjects.id, { onDelete: "cascade" }),
  observationId: uuid("observation_id").notNull().references(() => observations.id, { onDelete: "cascade" }),
  domain: signalDomainEnum("domain").notNull(),
  signalKey: varchar("signal_key", { length: 512 }).notNull(),
  signalValue: text("signal_value"),
  confidence: real("confidence"),
  source: varchar("source", { length: 64 }),
  rank: integer("rank"),
}, (t) => ({
  subjectDomainIdx: index("sv_subject_domain_idx").on(t.subjectId, t.domain),
  observationIdx: index("sv_observation_idx").on(t.observationId),
  keyIdx: index("sv_key_idx").on(t.signalKey),
  domainKeyIdx: index("sv_domain_key_idx").on(t.domain, t.signalKey),
}));


// ═══════════════════════════════════════════════════════════════════════════════
// TABLE 7: DECODED_SIGNALS — Structured cultural signals from symbol decoders
// ═══════════════════════════════════════════════════════════════════════════════

export const decodedSignals = pgTable("decoded_signals", {
  id: uuid("id").defaultRandom().primaryKey(),
  subjectId: uuid("subject_id").notNull().references(() => subjects.id, { onDelete: "cascade" }),
  observationId: uuid("observation_id").notNull().references(() => observations.id, { onDelete: "cascade" }),
  category: signalDomainEnum("category").notNull(),
  phrase: text("phrase").notNull(),
  meaning: text("meaning").notNull(),
  informsFields: text("informs_fields").array(),
  source: varchar("source", { length: 32 }),
}, (t) => ({
  subjectIdx: index("ds_subject_idx").on(t.subjectId),
  observationIdx: index("ds_observation_idx").on(t.observationId),
  categoryIdx: index("ds_category_idx").on(t.category),
  phraseIdx: index("ds_phrase_idx").on(t.phrase),
}));


// ═══════════════════════════════════════════════════════════════════════════════
// TABLE 8: CONTENT_ITEMS — Individual videos, transcripts, and media
// ═══════════════════════════════════════════════════════════════════════════════

export const contentItems = pgTable("content_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  subjectId: uuid("subject_id").notNull().references(() => subjects.id, { onDelete: "cascade" }),
  observationId: uuid("observation_id").references(() => observations.id, { onDelete: "set null" }),
  platform: platformEnum("platform").notNull(),

  platformVideoId: varchar("platform_video_id", { length: 255 }),
  videoUrl: text("video_url"),
  caption: text("caption"),

  transcriptText: text("transcript_text"),
  transcriptSource: varchar("transcript_source", { length: 32 }),
  transcriptWordCount: integer("transcript_word_count"),

  videoDuration: real("video_duration"),
  createTime: timestamp("create_time", { withTimezone: true }),
  region: varchar("region", { length: 128 }),
  temporalBucket: varchar("temporal_bucket", { length: 16 }),

  likeCount: bigint("like_count", { mode: "number" }),
  commentCount: bigint("comment_count", { mode: "number" }),
  shareCount: bigint("share_count", { mode: "number" }),
  viewCount: bigint("view_count", { mode: "number" }),
  saveCount: bigint("save_count", { mode: "number" }),

  musicTitle: varchar("music_title", { length: 512 }),
  musicArtist: varchar("music_artist", { length: 255 }),
  isOriginalAudio: boolean("is_original_audio"),

  status: varchar("status", { length: 32 }).default("sampled").notNull(),

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  subjectIdx: index("ci_subject_idx").on(t.subjectId),
  observationIdx: index("ci_observation_idx").on(t.observationId),
  // Index correction: includes subjectId so the same video can exist
  // across multiple observation runs for the same creator
  platformVideoIdx: uniqueIndex("ci_platform_video_idx").on(t.platform, t.platformVideoId, t.subjectId),
  statusIdx: index("ci_status_idx").on(t.subjectId, t.status),
  timeIdx: index("ci_time_idx").on(t.subjectId, t.createTime),
}));


// ═══════════════════════════════════════════════════════════════════════════════
// TABLE 10: ARCHETYPE_TRANSITIONS — Longitudinal archetype tracking
// ═══════════════════════════════════════════════════════════════════════════════

export const archetypeTransitions = pgTable("archetype_transitions", {
  id: uuid("id").defaultRandom().primaryKey(),
  subjectId: uuid("subject_id").notNull().references(() => subjects.id, { onDelete: "cascade" }),
  fromArchetype: archetypeEnum("from_archetype").notNull(),
  toArchetype: archetypeEnum("to_archetype").notNull(),
  fromObservationId: uuid("from_observation_id").notNull().references(() => observations.id, { onDelete: "cascade" }),
  toObservationId: uuid("to_observation_id").notNull().references(() => observations.id, { onDelete: "cascade" }),
  daysBetween: integer("days_between"),
  engagementDelta: real("engagement_delta"),
  detectedAt: timestamp("detected_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  subjectIdx: index("at_subject_idx").on(t.subjectId),
  transitionIdx: index("at_transition_idx").on(t.fromArchetype, t.toArchetype),
}));


// ═══════════════════════════════════════════════════════════════════════════════
// TABLE 11: AUDIENCE_MENTIONS — Individual brand mention videos
// ═══════════════════════════════════════════════════════════════════════════════

export const audienceMentions = pgTable("audience_mentions", {
  id: uuid("id").defaultRandom().primaryKey(),
  subjectId: uuid("subject_id").notNull().references(() => subjects.id, { onDelete: "cascade" }),
  observationId: uuid("observation_id").references(() => observations.id, { onDelete: "set null" }),
  platform: platformEnum("platform").notNull(),

  mentionVideoId: varchar("mention_video_id", { length: 255 }),
  authorHandleHash: text("author_handle_hash"),
  caption: text("caption"),
  sentiment: sentimentEnum("sentiment"),

  viewCount: integer("view_count"),
  likeCount: integer("like_count"),
  commentCount: integer("comment_count"),
  shareCount: integer("share_count"),
  saveCount: integer("save_count"),

  musicTitle: varchar("music_title", { length: 512 }),
  musicArtist: varchar("music_artist", { length: 255 }),

  collectedAt: timestamp("collected_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  subjectSentimentIdx: index("am_subject_sentiment_idx").on(t.subjectId, t.sentiment),
  subjectTimeIdx: index("am_subject_time_idx").on(t.subjectId, t.collectedAt),
  observationIdx: index("am_observation_idx").on(t.observationId),
}));


// ═══════════════════════════════════════════════════════════════════════════════
// TABLE 12: LLM_INVOCATIONS — Full provenance for every LLM call
// ═══════════════════════════════════════════════════════════════════════════════

// llmInvocations references matchScores (defined later in this file). Drizzle's
// deferred reference thunk `() => matchScores.id` resolves the forward reference
// lazily, so no separate declaration is needed. The DB-level FK is created by the
// womo_0004_db_hardening migration.

export const llmInvocations = pgTable("llm_invocations", {
  id: uuid("id").defaultRandom().primaryKey(),
  observationId: uuid("observation_id").references(() => observations.id, { onDelete: "set null" }),
  matchScoreId: uuid("match_score_id").references(() => matchScores.id, { onDelete: "set null" }),
  subjectId: uuid("subject_id").references(() => subjects.id, { onDelete: "set null" }),

  purpose: varchar("purpose", { length: 64 }).notNull(),
  model: varchar("model", { length: 128 }).notNull(),
  promptVersion: varchar("prompt_version", { length: 32 }),
  temperature: real("temperature"),

  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  responseJson: jsonb("response_json"),
  durationMs: integer("duration_ms"),

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  observationIdx: index("llm_observation_idx").on(t.observationId),
  purposeIdx: index("llm_purpose_idx").on(t.purpose),
  modelIdx: index("llm_model_idx").on(t.model),
}));


// ═══════════════════════════════════════════════════════════════════════════════
// TABLE 13: SCRAPE_EVENTS — Provenance for every HTTP scrape
// ═══════════════════════════════════════════════════════════════════════════════

export const scrapeEvents = pgTable("scrape_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  observationId: uuid("observation_id").references(() => observations.id, { onDelete: "set null" }),
  subjectId: uuid("subject_id").references(() => subjects.id, { onDelete: "set null" }),

  platform: platformEnum("platform"),
  scrapeMethod: scrapeMethodEnum("scrape_method").notNull(),
  urlRequested: text("url_requested"),
  httpStatus: integer("http_status"),
  responseSizeBytes: integer("response_size_bytes"),
  silentFailureDetected: boolean("silent_failure_detected").default(false),
  failureReason: text("failure_reason"),
  durationMs: integer("duration_ms"),

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  observationIdx: index("se_observation_idx").on(t.observationId),
  methodIdx: index("se_method_idx").on(t.scrapeMethod),
  failureIdx: index("se_failure_idx").on(t.silentFailureDetected),
}));


// ═══════════════════════════════════════════════════════════════════════════════
// TABLE 14: MATCH_SCORES — F.I.T. compatibility calculations
// ═══════════════════════════════════════════════════════════════════════════════

export const matchScores = pgTable("match_scores", {
  id: uuid("id").defaultRandom().primaryKey(),

  creatorSubjectId: uuid("creator_subject_id").notNull().references(() => subjects.id, { onDelete: "cascade" }),
  brandSubjectId: uuid("brand_subject_id").notNull().references(() => subjects.id, { onDelete: "cascade" }),
  creatorObservationId: uuid("creator_observation_id").references(() => observations.id),
  brandObservationId: uuid("brand_observation_id").references(() => observations.id),

  // Sub-scores (raw, 0–10)
  alignmentScoreRaw: real("alignment_score_raw"),
  pulseScoreRaw: real("pulse_score_raw"),
  stabilityScoreRaw: real("stability_score_raw"),

  // Sub-score components
  archetypeMatchScore: real("archetype_match_score"),
  mythAlignmentScore: real("myth_alignment_score"),
  tribMatchScore: real("trib_match_score"),
  decodingModifier: real("decoding_modifier"),
  rogersBaseScore: real("rogers_base_score"),
  liminalAdjustment: real("liminal_adjustment"),
  goffmanScore: real("goffman_score"),
  driftScore: real("drift_score"),

  // Weights used
  weightAlpha: real("weight_alpha"),
  weightBeta: real("weight_beta"),
  weightGamma: real("weight_gamma"),

  // Final F.I.T. Score
  fitScore: real("fit_score"),
  fitStatus: fitStatusEnum("fit_status"),

  // PARR
  parrScore: integer("parr_score"),
  parrLabel: varchar("parr_label", { length: 64 }),
  parrTribeOverlap: real("parr_tribe_overlap"),
  parrDecodingAcceptance: real("parr_decoding_acceptance"),
  parrArchetypeResonance: real("parr_archetype_resonance"),
  parrSymbolicOverlap: real("parr_symbolic_overlap"),
  parrPersonaConsistency: real("parr_persona_consistency"),

  // Symbolic overlap
  symbolicOverlapScore: real("symbolic_overlap_score"),
  qovScore: real("qov_score"),

  // Five Performance Signals (0–100)
  creativeIntegritySignal: real("creative_integrity_signal"),
  creativeIntegrityConfidence: signalConfidenceEnum("creative_integrity_confidence"),
  performanceConsistencySignal: real("performance_consistency_signal"),
  performanceConsistencyConfidence: signalConfidenceEnum("performance_consistency_confidence"),
  communityQualitySignal: real("community_quality_signal"),
  communityQualityConfidence: signalConfidenceEnum("community_quality_confidence"),
  audienceReceptivitySignal: real("audience_receptivity_signal"),
  audienceReceptivityConfidence: signalConfidenceEnum("audience_receptivity_confidence"),
  brandTrustSignal: real("brand_trust_signal"),
  brandTrustConfidence: signalConfidenceEnum("brand_trust_confidence"),

  // Three Cultural Signals — DEPRECATED: computed by performanceSignals.ts under different
  // property names (culturalIdentity, partnershipStability) but never mapped to these columns.
  // Kept for schema stability; not written or read by application code.
  culturalIdentitySignal: real("cultural_identity_signal"),
  culturalIdentityConfidence: signalConfidenceEnum("cultural_identity_confidence"),
  culturalMomentumSignal: real("cultural_momentum_signal"),
  culturalMomentumConfidence: signalConfidenceEnum("cultural_momentum_confidence"),
  partnershipStabilitySignal: real("partnership_stability_signal"),
  partnershipStabilityConfidence: signalConfidenceEnum("partnership_stability_confidence"),

  // Music overlap
  musicOverlapStrength: varchar("music_overlap_strength", { length: 16 }),

  // Mention modifiers
  mentionSentimentPenalty: real("mention_sentiment_penalty"),
  mentionVocabBoost: real("mention_vocab_boost"),

  // Confidence & velocity
  culturalVelocity: culturalVelocityEnum("cultural_velocity"),
  dataConfidenceLevel: confidenceLevelEnum("data_confidence_level"),

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  creatorIdx: index("ms_creator_idx").on(t.creatorSubjectId),
  brandIdx: index("ms_brand_idx").on(t.brandSubjectId),
  fitScoreIdx: index("ms_fit_score_idx").on(t.fitScore),
  brandFitIdx: index("ms_brand_fit_idx").on(t.brandSubjectId, t.fitScore),
  creatorFitIdx: index("ms_creator_fit_idx").on(t.creatorSubjectId, t.fitScore),
  pairIdx: uniqueIndex("ms_pair_idx").on(t.creatorSubjectId, t.brandSubjectId, t.createdAt),
}));


// ═══════════════════════════════════════════════════════════════════════════════
// TABLE 15: MATCH_NARRATIVES — AI-generated match narratives
// ═══════════════════════════════════════════════════════════════════════════════

export const matchNarratives = pgTable("match_narratives", {
  id: uuid("id").defaultRandom().primaryKey(),
  matchScoreId: uuid("match_score_id").notNull().references(() => matchScores.id, { onDelete: "cascade" }),

  narrativeSummary: text("narrative_summary"),
  alignmentNarrative: text("alignment_narrative"),
  synergyNarrative: text("synergy_narrative"),
  culturalBorrowingSummary: text("cultural_borrowing_summary"),

  archetypeAnalysis: text("archetype_analysis"),
  mythAlignment: text("myth_alignment"),
  audienceOverlap: text("audience_overlap"),
  culturalMomentum: text("cultural_momentum"),
  identityStability: text("identity_stability"),
  recommendation: text("recommendation"),

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  matchIdx: index("mn_match_idx").on(t.matchScoreId),
}));


// ═══════════════════════════════════════════════════════════════════════════════
// TABLE 16: MATCH_WARNINGS — Radar warnings (normalized)
// ═══════════════════════════════════════════════════════════════════════════════

export const matchWarnings = pgTable("match_warnings", {
  id: uuid("id").defaultRandom().primaryKey(),
  matchScoreId: uuid("match_score_id").notNull().references(() => matchScores.id, { onDelete: "cascade" }),
  warningType: warningTypeEnum("warning_type").notNull(),
}, (t) => ({
  matchIdx: index("mw_match_idx").on(t.matchScoreId),
  typeIdx: index("mw_type_idx").on(t.warningType),
}));


// ═══════════════════════════════════════════════════════════════════════════════
// TABLE 17: MATCH_OVERLAPS — Shared signals between matches
// ═══════════════════════════════════════════════════════════════════════════════

export const matchOverlaps = pgTable("match_overlaps", {
  id: uuid("id").defaultRandom().primaryKey(),
  matchScoreId: uuid("match_score_id").notNull().references(() => matchScores.id, { onDelete: "cascade" }),
  domain: signalDomainEnum("domain").notNull(),
  value: text("value").notNull(),
}, (t) => ({
  matchIdx: index("mo_match_idx").on(t.matchScoreId),
  domainIdx: index("mo_domain_idx").on(t.domain),
}));


// ═══════════════════════════════════════════════════════════════════════════════
// TABLE 18: MATCH_CONTENT_DIRECTIONS — Content recommendations
// ═══════════════════════════════════════════════════════════════════════════════

export const matchContentDirections = pgTable("match_content_directions", {
  id: uuid("id").defaultRandom().primaryKey(),
  matchScoreId: uuid("match_score_id").notNull().references(() => matchScores.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 255 }).notNull(),
  rationale: text("rationale").notNull(),
  exampleAngle: text("example_angle").notNull(),
  rank: integer("rank"),
}, (t) => ({
  matchIdx: index("mcd_match_idx").on(t.matchScoreId),
}));


// ═══════════════════════════════════════════════════════════════════════════════
// TABLE 19: SEMANTIC_DOCUMENTS — Embedding storage (pgvector)
// ═══════════════════════════════════════════════════════════════════════════════
// Embedding column created via custom migration:
//   ALTER TABLE semantic_documents ADD COLUMN embedding vector(1536);
//   CREATE INDEX ON semantic_documents USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

export const semanticDocuments = pgTable("semantic_documents", {
  id: uuid("id").defaultRandom().primaryKey(),
  subjectId: uuid("subject_id").notNull().references(() => subjects.id, { onDelete: "cascade" }),
  observationId: uuid("observation_id").references(() => observations.id, { onDelete: "set null" }),

  documentType: varchar("document_type", { length: 64 }).notNull(),
  contentText: text("content_text").notNull(),
  tokenCount: integer("token_count"),
  metadata: jsonb("metadata"),

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  subjectIdx: index("sd_subject_idx").on(t.subjectId),
  typeIdx: index("sd_type_idx").on(t.documentType),
  observationIdx: index("sd_observation_idx").on(t.observationId),
}));


// ═══════════════════════════════════════════════════════════════════════════════
// TABLE 20: PIPELINE_RUNS — Persistent batch job tracking
// ═══════════════════════════════════════════════════════════════════════════════

export const pipelineRuns = pgTable("pipeline_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  runType: varchar("run_type", { length: 64 }).notNull(),
  status: varchar("status", { length: 32 }).default("pending").notNull(),
  totalItems: integer("total_items").default(0),
  completedItems: integer("completed_items").default(0),
  failedItems: integer("failed_items").default(0),
  errorLog: jsonb("error_log"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  statusIdx: index("pr_status_idx").on(t.status),
}));


// ═══════════════════════════════════════════════════════════════════════════════
// USERS — Auth layer
// ═══════════════════════════════════════════════════════════════════════════════

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  openId: varchar("open_id", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("login_method", { length: 64 }),
  role: varchar("role", { length: 16 }).default("user").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  lastSignedIn: timestamp("last_signed_in", { withTimezone: true }).defaultNow().notNull(),
});


// ═══════════════════════════════════════════════════════════════════════════════
// TYPE EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

export type Subject = typeof subjects.$inferSelect;
export type InsertSubject = typeof subjects.$inferInsert;

export type Observation = typeof observations.$inferSelect;
export type InsertObservation = typeof observations.$inferInsert;

export type CreatorObservation = typeof creatorObservations.$inferSelect;
export type InsertCreatorObservation = typeof creatorObservations.$inferInsert;

export type BrandObservation = typeof brandObservations.$inferSelect;
export type InsertBrandObservation = typeof brandObservations.$inferInsert;

export type SignalValue = typeof signalValues.$inferSelect;
export type InsertSignalValue = typeof signalValues.$inferInsert;

export type DecodedSignal = typeof decodedSignals.$inferSelect;
export type InsertDecodedSignal = typeof decodedSignals.$inferInsert;

export type ContentItem = typeof contentItems.$inferSelect;
export type InsertContentItem = typeof contentItems.$inferInsert;

export type NicheNode = typeof nicheTaxonomy.$inferSelect;
export type InsertNicheNode = typeof nicheTaxonomy.$inferInsert;

export type ArchetypeTransition = typeof archetypeTransitions.$inferSelect;
export type InsertArchetypeTransition = typeof archetypeTransitions.$inferInsert;

export type AudienceMention = typeof audienceMentions.$inferSelect;
export type InsertAudienceMention = typeof audienceMentions.$inferInsert;

export type MatchScore = typeof matchScores.$inferSelect;
export type InsertMatchScore = typeof matchScores.$inferInsert;

export type MatchNarrative = typeof matchNarratives.$inferSelect;
export type InsertMatchNarrative = typeof matchNarratives.$inferInsert;

export type MatchWarning = typeof matchWarnings.$inferSelect;
export type InsertMatchWarning = typeof matchWarnings.$inferInsert;

export type MatchOverlap = typeof matchOverlaps.$inferSelect;
export type InsertMatchOverlap = typeof matchOverlaps.$inferInsert;

export type MatchContentDirection = typeof matchContentDirections.$inferSelect;
export type InsertMatchContentDirection = typeof matchContentDirections.$inferInsert;

export type SemanticDocument = typeof semanticDocuments.$inferSelect;
export type InsertSemanticDocument = typeof semanticDocuments.$inferInsert;

export type PipelineRun = typeof pipelineRuns.$inferSelect;
export type InsertPipelineRun = typeof pipelineRuns.$inferInsert;

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// Legacy type aliases — kept temporarily for application code that
// still references old schema types. These will be removed when
// application code migration is complete.
export type CreatorProfile = CreatorObservation;
export type InsertCreatorProfile = InsertCreatorObservation;
export type BrandProfile = BrandObservation;
export type InsertBrandProfile = InsertBrandObservation;
