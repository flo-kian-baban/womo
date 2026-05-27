import {
  int,
  mysqlEnum,
  mysqlTable,
  text,
  mediumtext,
  timestamp,
  varchar,
  float,
  json,
  boolean,
} from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ─── Creator Profiles ─────────────────────────────────────────────────────────

export const creatorProfiles = mysqlTable("creator_profiles", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId"),

  // Identity
  handle: varchar("handle", { length: 255 }).notNull(),
  // Note: Instagram kept in DB enum for data compatibility, but removed from UI and new analysis flows
  platform: mysqlEnum("platform", ["TikTok", "Instagram", "YouTube", "Multi"]).notNull(),
  profileUrl: text("profileUrl"),
  displayName: text("displayName"),

  // AI-extracted Field Note Two: Creator Snapshot
  archetype: varchar("archetype", { length: 64 }), // One of 12 Jungian archetypes
  recurringThemes: json("recurringThemes"), // string[] — 3-4 themes
  toneRegister: text("toneRegister"), // 2-3 words
  parasocialBondStrength: float("parasocialBondStrength"), // 1.0–5.0
  audienceRelationshipType: mysqlEnum("audienceRelationshipType", ["Friend", "Mentor", "Authority"]),
  barthesMyth: text("barthesMyth"), // "This creator makes it feel obvious that _"
  culturalCapital: mysqlEnum("culturalCapital", ["Produce", "Relay"]),
  goffmanStageConsistency: mysqlEnum("goffmanStageConsistency", ["Consistent", "Minor Gap", "Significant Gap"]),
  driftSignal: mysqlEnum("driftSignal", ["Zero Change", "Minor Drift", "Significant Drift", "Full Pivot"]),
  stuartHallDecoding: mysqlEnum("stuartHallDecoding", ["Dominant", "Negotiated", "Oppositional"]),

  // Field Note Three: Cultural Snapshot
  nicheTopicNode: text("nicheTopicNode"),
  undergroundDensity: boolean("undergroundDensity"),
  mainstreamBleed: boolean("mainstreamBleed"),
  remixRate: boolean("remixRate"),
  brandSaturation: boolean("brandSaturation"),
  rogersAdopterStage: mysqlEnum("rogersAdopterStage", [
    "Innovators",
    "Early Adopters",
    "Early Majority",
    "Late Majority",
    "Laggards",
  ]),
  creatorNichePosition: mysqlEnum("creatorNichePosition", ["Ahead", "Consistent", "Behind"]),
  lifecyclePhase: mysqlEnum("lifecyclePhase", ["Emergence", "Growth", "Maturity", "Decline"]),
  barthesNicheMeaning: text("barthesNicheMeaning"),
  turnerLiminalPhase: mysqlEnum("turnerLiminalPhase", [
    "Pre-Liminal",
    "Liminal",
    "Post-Liminal Reintegration",
  ]),

  // Research metrics (from platform APIs)
  followerCount: int("followerCount"),
  totalLikes: int("totalLikes"),
  videoCount: int("videoCount"),
  totalViews: int("totalViews"),
  avgViews: int("avgViews"),
  engagementRate: float("engagementRate"), // percentage 0–100
  location: text("location"),

  // Keyword & theme intelligence
  rawKeywords: json("rawKeywords"),        // string[] — all extracted keywords/hashtags
  contentThemeLabels: json("contentThemeLabels"), // string[] — 3-5 named themes (LLM-translated)
  topHashtags: json("topHashtags"),         // string[] — top hashtags
  recentVideoTitles: json("recentVideoTitles"), // string[] — sampled video titles

  // Transcript data (from transcript-first pipeline)
  transcriptCount: int("transcriptCount").default(0),
  transcriptExcerpts: mediumtext("transcriptExcerpts"), // Full transcript text from all sampled videos (no truncation)

  // Symbol Decoder output (pre-processed cultural signals from all creator-authored text)
  decodedSymbols: json("decodedSymbols"), // DecodedSymbols | null — identityClaims, statusSignals, communityReferences, aspirationDrivers, symbolicSummary

  // Creator pronouns (inferred from bio, transcripts, and display name)
  pronouns: mysqlEnum("pronouns", ["she/her", "he/him", "they/them", "not specified"]),

  // Phase 1.5 — Longitudinal & Confidence
  culturalVelocity: varchar("culturalVelocity", { length: 32 }),  // Focusing | Drifting | Insufficient Data
  dataConfidenceLevel: varchar("dataConfidenceLevel", { length: 16 }), // high | medium | low
  longitudinalSampleJson: json("longitudinalSampleJson"), // LongitudinalSample serialized
  discoveredVideoPoolJson: json("discoveredVideoPoolJson"), // Array<{id,url,caption,createTime}> — unsampled confirmed videos

  // Phase 1.6 — Metadata Intelligence
  avgVideoDuration: float("avgVideoDuration"), // Average video duration in seconds (from 12-video sample)
  primaryRegion: varchar("primaryRegion", { length: 128 }), // Primary geographic region (extracted from metadata + profile)

  // Phase 2 — Engagement Quality Score (from TikTok comment analysis)
  engagementQualityScore: float("engagementQualityScore"), // 0.0-1.0 ratio of substantive to passive comments
  engagementQualityConfidence: varchar("engagementQualityConfidence", { length: 16 }), // Verified | Estimated | Insufficient Data

  // Raw AI summary
  aiSummary: mediumtext("aiSummary"),
  rawAiResponse: json("rawAiResponse"),

  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type CreatorProfile = typeof creatorProfiles.$inferSelect;
export type InsertCreatorProfile = typeof creatorProfiles.$inferInsert;

// ─── Brand Profiles ───────────────────────────────────────────────────────────

export const brandProfiles = mysqlTable("brand_profiles", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId"),

  // Identity
  brandName: varchar("brandName", { length: 255 }).notNull(),
  brandUrl: text("brandUrl"),
  category: text("category"),

  // Social channels (optional)
  tiktokChannelUrl: text("tiktokChannelUrl"), // Optional TikTok channel URL
  tiktokMetadata: json("tiktokMetadata"), // TikTok channel analysis: tone, themes, engagement style
  tiktokEngagementRate: float("tiktokEngagementRate"), // TikTok engagement rate (0-100)
  tiktokAudienceSize: int("tiktokAudienceSize"), // TikTok follower count

  // AI-extracted Field Note One: Brand Snapshot
  archetype: varchar("archetype", { length: 64 }),
  emotionalPromise: text("emotionalPromise"), // "Our audience feels _ when they engage with us."
  visualLanguage: json("visualLanguage"), // string[] — exactly 3 adjectives
  audienceTribe: text("audienceTribe"),
  culturalTension: text("culturalTension"), // "This brand exists in the tension between _ and _."
  barthesMyth: text("barthesMyth"), // "This brand normalizes the belief that _."

  // Brand tone register (mirrors creator toneRegister — 2-3 words, e.g. "formal, institutional, aspirational")
  brandTone: text("brandTone"),

  // Brand Archetype Classification (Trust / Community / Momentum) — Chapter 3 logic
  brandArchetypeClassification: mysqlEnum("brandArchetypeClassification", ["Trust", "Community", "Momentum"]),

  // Brand type drives α/β/γ weight selection
  brandType: varchar("brandType", { length: 128 }),
  campaignType: mysqlEnum("campaignType", [
    "Heritage/Luxury",
    "Trend-First",
    "Long-Term Ambassador",
    "Product Launch",
    "Community/Local",
    "Awareness/Consideration",
  ]),

  // Weights (auto-loaded from brand type)
  weightAlpha: float("weightAlpha"),
  weightBeta: float("weightBeta"),
  weightGamma: float("weightGamma"),
  weightPriority: text("weightPriority"),

  // Audience Perception — review data from Yelp and Google Maps
  yelpRating: float("yelpRating"),
  yelpReviewCount: int("yelpReviewCount"),
  yelpReviewExcerpts: text("yelpReviewExcerpts"),
  googleRating: float("googleRating"),
  googleReviewCount: int("googleReviewCount"),
  googleReviewExcerpts: text("googleReviewExcerpts"),
  combinedReviewText: text("combinedReviewText"),
  overallRating: float("overallRating"),
  totalReviews: int("totalReviews").default(0),

  // ── Creator-parity sociological framework fields ──────────────────────────────
  // These mirror the creator extraction fields so both sides of a match use the same frameworks.
  // They feed directly into Alignment (stuartHallDecoding), Pulse (rogersAdopterStage + turnerLiminalPhase),
  // and Stability (goffmanStageConsistency + driftSignal) scoring.
  brandCulturalCapital: mysqlEnum("brandCulturalCapital", ["Produce", "Relay"]),
  brandGoffmanStageConsistency: mysqlEnum("brandGoffmanStageConsistency", ["Consistent", "Minor Gap", "Significant Gap"]),
  brandDriftSignal: mysqlEnum("brandDriftSignal", ["Zero Change", "Minor Drift", "Significant Drift", "Full Pivot"]),
  brandStuartHallDecoding: mysqlEnum("brandStuartHallDecoding", ["Dominant", "Negotiated", "Oppositional"]),
  brandRogersAdopterStage: mysqlEnum("brandRogersAdopterStage", ["Innovators", "Early Adopters", "Early Majority", "Late Majority", "Laggards"]),
  brandTurnerLiminalPhase: mysqlEnum("brandTurnerLiminalPhase", ["Pre-Liminal", "Liminal", "Post-Liminal Reintegration"]),
  brandLifecyclePhase: mysqlEnum("brandLifecyclePhase", ["Emergence", "Growth", "Maturity", "Decline"]),
  brandBarthesNicheMeaning: text("brandBarthesNicheMeaning"),
  brandAudienceDecodingSplit: boolean("brandAudienceDecodingSplit"),

  // Brand TikTok Video Transcripts
  brandVideoTranscripts: json("brandVideoTranscripts"), // BrandVideoTranscript[] — captions from each video

  // Brand Symbol Decoder — semantic artifacts (mirrors creator-side decodedSymbols)
  // rawKeywords: flat list of culturally significant words for trend tracking over time
  brandRawKeywords: json("brandRawKeywords"),       // string[] — 10-30 keywords from website + reviews
  // themeLabels: 3-5 named cultural themes (LLM-translated from keywords)
  brandThemeLabels: json("brandThemeLabels"),       // string[] — e.g. ["Local Pride", "Accessible Luxury"]
  // symbolicVocabulary: the brand's own identity-signalling words
  brandSymbolicVocabulary: json("brandSymbolicVocabulary"), // string[] — 5-15 items
  // Full decoded symbols object — mirrors creator decodedSymbols for direct field comparison
  brandDecodedSymbols: json("brandDecodedSymbols"),  // BrandDecodedSymbols | null

  // Raw AI summary
  aiSummary: text("aiSummary"),
  rawAiResponse: json("rawAiResponse"),

  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type BrandProfile = typeof brandProfiles.$inferSelect;
export type InsertBrandProfile = typeof brandProfiles.$inferInsert;

// ─── Match Records ────────────────────────────────────────────────────────────

export const matchRecords = mysqlTable("match_records", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId"),

  creatorProfileId: int("creatorProfileId").notNull(),
  brandProfileId: int("brandProfileId").notNull(),

  // Sub-scores (raw, 0–10) — now called Cultural Signals
  alignmentScoreRaw: float("alignmentScoreRaw"), // aka culturalIdentitySignal
  pulseScoreRaw: float("pulseScoreRaw"), // aka culturalMomentumSignal
  stabilityScoreRaw: float("stabilityScoreRaw"), // aka partnershipStabilitySignal

  // Sub-score components
  archetypeMatchScore: float("archetypeMatchScore"),
  mythAlignmentScore: float("mythAlignmentScore"),
  tribMatchScore: float("tribMatchScore"),
  decodingModifier: float("decodingModifier"),
  rogersBaseScore: float("rogersBaseScore"),
  liminalAdjustment: float("liminalAdjustment"),
  goffmanScore: float("goffmanScore"),
  driftScore: float("driftScore"),

  // Weights used
  weightAlpha: float("weightAlpha"),
  weightBeta: float("weightBeta"),
  weightGamma: float("weightGamma"),

  // Final CAI Score (Cultural Alignment Index)
  caiScore: float("caiScore"),
  caiStatus: mysqlEnum("caiStatus", ["Green Light", "Proceed with Caution", "Do Not Proceed"]),

  // Radar Warnings (exact names from spec)
  radarWarnings: json("radarWarnings"), // string[]

  // AI-generated narrative
  narrativeSummary: text("narrativeSummary"),
  alignmentNotes: json("alignmentNotes"), // field-by-field notes object

  // PARR — Predicted Audience Receptivity Rate (0–100, displayed as %)
  parrScore: int("parrScore"),
  parrLabel: varchar("parrLabel", { length: 64 }),
  parrSignalBreakdown: json("parrSignalBreakdown"), // Record<string, number>
  symbolicOverlapScore: float("symbolicOverlapScore"),
  sharedKeywords: json("sharedKeywords"),   // string[]
  sharedThemes: json("sharedThemes"),       // string[]
  qovScore: float("qovScore"),               // Quality of View — (caiScore/10) × (parrScore/100) as %

  // Phase 1.5 Visual Intelligence
  alignmentNarrative: text("alignmentNarrative"),       // 2-sentence match summary
  culturalVelocity: varchar("culturalVelocity", { length: 32 }),  // Focusing | Drifting | Insufficient Data
  dataConfidenceLevel: varchar("dataConfidenceLevel", { length: 16 }), // high | medium | low

  // Synergy Narrative + Content Directions
  synergyNarrative: text("synergyNarrative"),
  contentDirections: json("contentDirections"), // { title, rationale, exampleAngle }[]

  // Five Performance Signals (0–100 scale)
  creativeIntegritySignal: float("creativeIntegritySignal"),
  creativeIntegrityConfidence: varchar("creativeIntegrityConfidence", { length: 16 }), // Verified | Estimated | Insufficient Data
  performanceConsistencySignal: float("performanceConsistencySignal"),
  performanceConsistencyConfidence: varchar("performanceConsistencyConfidence", { length: 16 }),
  communityQualitySignal: float("communityQualitySignal"),
  communityQualityConfidence: varchar("communityQualityConfidence", { length: 16 }),
  audienceReceptivitySignal: float("audienceReceptivitySignal"),
  audienceReceptivityConfidence: varchar("audienceReceptivityConfidence", { length: 16 }),
  brandTrustSignal: float("brandTrustSignal"),
  brandTrustConfidence: varchar("brandTrustConfidence", { length: 16 }),

  // Three Cultural Signals (renamed from Alignment/Pulse/Stability with confidence tiers)
  culturalIdentitySignal: float("culturalIdentitySignal"),
  culturalIdentityConfidence: varchar("culturalIdentityConfidence", { length: 16 }),
  culturalMomentumSignal: float("culturalMomentumSignal"),
  culturalMomentumConfidence: varchar("culturalMomentumConfidence", { length: 16 }),
  partnershipStabilitySignal: float("partnershipStabilitySignal"),
  partnershipStabilityConfidence: varchar("partnershipStabilityConfidence", { length: 16 }),

  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type MatchRecord = typeof matchRecords.$inferSelect;
export type InsertMatchRecord = typeof matchRecords.$inferInsert;
