import { eq, desc, like, or, ne, and, sql, inArray, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { createHash } from "crypto";
import {
  users,
  subjects, observations, creatorObservations, brandObservations,
  signalValues, decodedSignals, contentItems,
  nicheTaxonomy, archetypeTransitions, audienceMentions,
  llmInvocations, scrapeEvents,
  matchScores, matchNarratives, matchWarnings, matchOverlaps, matchContentDirections,
  semanticDocuments, pipelineRuns, platformHandles,
  type InsertUser, type InsertSubject, type InsertObservation,
  type InsertCreatorObservation, type InsertBrandObservation,
  type InsertSignalValue, type InsertDecodedSignal, type InsertContentItem,
  type InsertMatchScore, type InsertAudienceMention,
} from "../drizzle/schema";
import { ENV } from './_core/env';
import { currentRunId } from './_core/runContext';
import { canonicalizeHandle } from './_core/handles';
import { isSpeechTranscript, classifyTranscriptSource } from '@shared/transcriptSource';
import { computeLlmCostUsd } from '../shared/llmPricing';

// Re-export legacy types for routers.ts compilation
export type { InsertUser } from "../drizzle/schema";

// ═══════════════════════════════════════════════════════════════════════════════
// DATABASE-DOWN POLICY (uniform — Session 5)
//
// Every helper in this file — writes AND reads — THROWS "Database not available"
// when there is no database handle (DATABASE_URL unset, or the pool could not be
// created). Nothing silently no-ops, returns false, or returns empty data when
// the database is down: silent fallbacks made a dead DB indistinguishable from
// "subject has no data", which is exactly the lie this session removes.
//
//  - Write paths: throw. Callers that can tolerate a failed write (enrichments)
//    catch at the call site and RECORD the failure (persistence_status /
//    runEnrichment in routers.ts) — the failure is never invisible.
//  - Read paths: throw the same error. Callers that have a legitimate fallback
//    (e.g. token-metric displays) attach an explicit .catch at the call site,
//    so the fallback decision is visible where it is made.
//  - Row-level semantics are unchanged: e.g. updateContentItemTranscript still
//    returns false when the UPDATE itself errors for one row (its callers count
//    successes) — but a missing database throws.
//
// Connectivity is probed eagerly at startup via probeDatabaseConnectivity()
// (called from server/_core/index.ts): the pg Pool constructor never opens a
// connection, so without the probe a dead database only surfaced at the first
// real query.
// ═══════════════════════════════════════════════════════════════════════════════

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    // Use a connection pool instead of a single connection string.
    // max: 10 — supports concurrent analyses without queuing writes.
    // idleTimeoutMillis: 30s — reclaim idle connections quickly.
    // connectionTimeoutMillis: 5s — fail fast if the pool is saturated.
    // NOTE: the Pool constructor never connects — connectivity is verified by
    // probeDatabaseConnectivity() at startup, not here.
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
    // An error on an idle client is emitted on the Pool itself; without a
    // handler Node treats it as unhandled and crashes the process. Log and
    // let pg reclaim the client so a transient DB blip can't take down the app.
    pool.on("error", (err) => {
      console.error("[Database] Idle client / pool error:", err.message);
    });
    _db = drizzle(pool);
  }
  return _db;
}

/**
 * Eager connectivity probe — a lightweight `select 1` run once at server
 * startup so a dead database surfaces immediately rather than at first query.
 *
 * Chosen failure policy:
 *  - production: FATAL (exit 1) — the platform (Railway) surfaces and restarts
 *    the dead deploy instead of serving an app whose every DB route 500s.
 *  - development: non-fatal warning — local work without a database (UI work,
 *    scraping experiments) stays possible; DB-touching routes throw per the
 *    policy above.
 */
export async function probeDatabaseConnectivity(): Promise<boolean> {
  if (!process.env.DATABASE_URL) {
    console.warn("[Database] DATABASE_URL not set — running without a database; all DB routes will throw");
    return false;
  }
  const db = await getDb();
  if (!db) return false;
  try {
    await db.execute(sql`select 1`);
    console.log("[Database] Startup connectivity probe OK");
    return true;
  } catch (err) {
    console.error("[Database] Startup connectivity probe FAILED — database unreachable:", err instanceof Error ? err.message : err);
    if (process.env.NODE_ENV === "production") {
      process.exit(1);
    }
    return false;
  }
}

// ─── Transaction plumbing ────────────────────────────────────────────────────
// Write helpers for the identity core accept an optional `executor` so the
// subject → observation → subtype-row chain can run inside ONE transaction
// (see persistCreatorToV2/persistBrandToV2 in routers.ts). When no executor is
// passed, each helper runs standalone against the pool exactly as before.

export type DbHandle = NonNullable<Awaited<ReturnType<typeof getDb>>>;
export type DbTransaction = Parameters<Parameters<DbHandle["transaction"]>[0]>[0];
export type DbExecutor = DbHandle | DbTransaction;

/** Run `fn` inside a single database transaction; rolls back on any throw. */
export async function withTransaction<T>(fn: (tx: DbTransaction) => Promise<T>): Promise<T> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.transaction(fn);
}

// ═══════════════════════════════════════════════════════════════════════════════
// USERS (auth layer — migrated from V1)
// ═══════════════════════════════════════════════════════════════════════════════

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  try {
    const values: InsertUser = { openId: user.openId };
    const updateSet: Record<string, unknown> = {};
    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];
    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };
    textFields.forEach(assignNullable);
    if (user.lastSignedIn !== undefined) { values.lastSignedIn = user.lastSignedIn; updateSet.lastSignedIn = user.lastSignedIn; }
    if (user.role !== undefined) { values.role = user.role; updateSet.role = user.role; }
    else if (user.openId === ENV.ownerOpenId) { values.role = 'admin'; updateSet.role = 'admin'; }
    if (!values.lastSignedIn) values.lastSignedIn = new Date();
    if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();
    await db.insert(users).values(values).onConflictDoUpdate({
      target: users.openId,
      set: updateSet,
    });
  } catch (error) { console.error("[Database] Failed to upsert user:", error); throw error; }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

/** Map platform string from app code (TikTok/YouTube/Multi/Google Maps/Yelp) to DB enum */
function normalizePlatform(p: string): "tiktok" | "instagram" | "youtube" | "google_maps" | "yelp" {
  const lower = p.toLowerCase();
  if (lower === "tiktok" || lower === "multi") return "tiktok";
  if (lower === "instagram") return "instagram";
  if (lower === "youtube") return "youtube";
  if (lower === "google_maps" || lower === "google maps" || lower === "googlemaps") return "google_maps";
  if (lower === "yelp") return "yelp";
  return "tiktok";
}

/** Compute engagement tier from follower count */
function computeEngagementTier(followers: number | undefined | null): "nano" | "micro" | "mid" | "macro" | "mega" | undefined {
  if (!followers) return undefined;
  if (followers < 10_000) return "nano";
  if (followers < 100_000) return "micro";
  if (followers < 500_000) return "mid";
  if (followers < 1_000_000) return "macro";
  return "mega";
}

/** SHA-256 hash for anonymizing author handles */
function hashHandle(handle: string): string {
  return createHash("sha256").update(handle).digest("hex");
}

// ═══════════════════════════════════════════════════════════════════════════════
// FIX 5.1: Enum Validation — replaces all `as any` casts
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Validate that a value is a member of an enum type.
 * Returns the value as the enum type if valid, or null with a warning if invalid.
 * This catches misspelled values at runtime instead of failing at the DB constraint level.
 */
function validateEnum<T extends string>(
  value: unknown,
  validValues: readonly T[],
  fieldName: string,
): T | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && (validValues as readonly string[]).includes(value)) {
    return value as T;
  }
  console.warn(`[db] Invalid enum value for ${fieldName}: "${value}" — storing null`);
  return null;
}

// Valid enum value arrays (derived from drizzle/schema.ts)
const VALID_PRONOUNS = ["she/her", "he/him", "they/them", "not specified"] as const;
const VALID_ARCHETYPES = ["The Sage", "The Hero", "The Outlaw", "The Explorer", "The Magician", "The Ruler", "The Caregiver", "The Lover", "The Jester", "The Innocent", "The Everyman", "The Creator"] as const;
const VALID_BRAND_ARCHETYPES = ["Trust", "Community", "Momentum"] as const;
const VALID_CAMPAIGN_TYPES = ["Heritage/Luxury", "Trend-First", "Long-Term Ambassador", "Product Launch", "Community/Local", "Awareness/Consideration"] as const;
const VALID_AUDIENCE_RELATIONSHIPS = ["Friend", "Mentor", "Authority"] as const;
const VALID_CULTURAL_CAPITAL = ["Produce", "Relay"] as const;
const VALID_GOFFMAN = ["Consistent", "Minor Gap", "Significant Gap"] as const;
const VALID_DRIFT_SIGNALS = ["Zero Change", "Minor Drift", "Significant Drift", "Full Pivot"] as const;
const VALID_HALL_DECODING = ["Dominant", "Negotiated", "Oppositional"] as const;
const VALID_ROGERS_STAGES = ["Innovators", "Early Adopters", "Early Majority", "Late Majority", "Laggards"] as const;
const VALID_NICHE_POSITIONS = ["Ahead", "Consistent", "Behind"] as const;
const VALID_LIFECYCLE_PHASES = ["Emergence", "Growth", "Maturity", "Decline"] as const;
const VALID_LIMINAL_PHASES = ["Pre-Liminal", "Liminal", "Post-Liminal Reintegration"] as const;
const VALID_CULTURAL_VELOCITY = ["Focusing", "Drifting", "Insufficient Data"] as const;
const VALID_CONFIDENCE_LEVELS = ["high", "medium", "low"] as const;
const VALID_FIT_STATUS = ["Green Light", "Proceed with Caution", "Do Not Proceed"] as const;
const VALID_SENTIMENT = ["positive", "mixed", "negative", "insufficient_data"] as const;
const VALID_SIGNAL_CONFIDENCE = ["Verified", "Estimated", "Insufficient Data"] as const;
const VALID_SIGNAL_DOMAINS = ["keyword", "hashtag", "content_theme", "theme", "visual_language", "symbolic_vocabulary", "music_title", "music_artist", "identity_claim", "status_signal", "community_reference", "aspiration_driver", "audience_language"] as const;
const VALID_SCRAPE_METHODS = ["tiktok_desktop_http", "tiktok_mobile_http", "tiktok_playwright", "tiktok_google_cache", "tiktok_search_xhr", "tiktok_search_html", "instagram_playwright", "instagram_picuki", "instagram_oembed", "youtube_api", "youtube_html", "google_maps_api", "google_search", "website_crawl", "whisper_transcription", "manual_entry"] as const;
const VALID_WARNING_TYPES = ["Low Alignment", "Archetype Tension", "Identity Instability", "Low Pulse", "Trajectory Divergence", "Low Social Engagement", "Negative Audience Sentiment"] as const;
const VALID_ENGAGEMENT_TIERS = ["nano", "micro", "mid", "macro", "mega"] as const;
const VALID_OVERLAP_DOMAINS = VALID_SIGNAL_DOMAINS;

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE A — CREATOR PIPELINE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Find or create a subject row by handle + platform.
 * If the subject already exists, update the latestArchetype and updatedAt.
 * Returns the subject UUID.
 */
export async function upsertSubject(data: {
  subjectType: "creator" | "brand";
  primaryHandle?: string;
  primaryPlatform?: string;
  displayName?: string;
  profileUrl?: string;
  websiteUrl?: string;
  pronouns?: string;
  latestArchetype?: string;
  latestBrandArchetype?: string;
  brandType?: string;
  brandCategory?: string;
  campaignType?: string;
  engagementTier?: string;
}, executor?: DbExecutor): Promise<string> {
  const db = executor ?? await getDb();
  if (!db) throw new Error("Database not available");

  const platform = data.primaryPlatform ? normalizePlatform(data.primaryPlatform) : undefined;

  // Try to find existing subject by handle + platform.
  // Session 7: case-insensitive handle match — stored handles were historically
  // LLM echoes with arbitrary casing; the exact-case lookup was a latent
  // duplicate-subject vector. New writes store canonical (lowercased) handles,
  // and lower() comparison also matches any legacy-cased rows.
  if (data.primaryHandle && platform) {
    const existing = await db.select({ id: subjects.id })
      .from(subjects)
      .where(and(
        sql`lower(${subjects.primaryHandle}) = lower(${data.primaryHandle})`,
        eq(subjects.primaryPlatform, platform),
        eq(subjects.subjectType, data.subjectType),
      ))
      .limit(1);

    if (existing.length > 0) {
      // Update existing subject
      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (data.latestArchetype) updates.latestArchetype = data.latestArchetype;
      if (data.latestBrandArchetype) updates.latestBrandArchetype = data.latestBrandArchetype;
      if (data.displayName) updates.displayName = data.displayName;
      if (data.profileUrl) updates.profileUrl = data.profileUrl;
      if (data.engagementTier) updates.engagementTier = data.engagementTier;
      if (data.brandType) updates.brandType = data.brandType;
      if (data.campaignType) updates.campaignType = data.campaignType;
      await db.update(subjects).set(updates).where(eq(subjects.id, existing[0].id));
      return existing[0].id;
    }
  }

  // For brands, also try finding by displayName (brandName) when no handle
  if (data.subjectType === "brand" && data.displayName) {
    const existing = await db.select({ id: subjects.id })
      .from(subjects)
      .where(and(
        eq(subjects.displayName, data.displayName),
        eq(subjects.subjectType, "brand"),
      ))
      .limit(1);

    if (existing.length > 0) {
      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (data.latestArchetype) updates.latestArchetype = data.latestArchetype;
      if (data.latestBrandArchetype) updates.latestBrandArchetype = data.latestBrandArchetype;
      if (data.websiteUrl) updates.websiteUrl = data.websiteUrl;
      if (data.brandType) updates.brandType = data.brandType;
      if (data.campaignType) updates.campaignType = data.campaignType;
      await db.update(subjects).set(updates).where(eq(subjects.id, existing[0].id));
      return existing[0].id;
    }
  }

  // Cross-platform creator dedup: match by displayName when handle+platform didn't match
  if (data.subjectType === "creator" && data.displayName) {
    const existing = await db.select({ id: subjects.id })
      .from(subjects)
      .where(and(
        eq(subjects.displayName, data.displayName),
        eq(subjects.subjectType, "creator"),
      ))
      .limit(1);

    if (existing.length > 0) {
      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (data.latestArchetype) updates.latestArchetype = data.latestArchetype;
      if (data.displayName) updates.displayName = data.displayName;
      if (data.profileUrl) updates.profileUrl = data.profileUrl;
      if (data.engagementTier) updates.engagementTier = data.engagementTier;
      await db.update(subjects).set(updates).where(eq(subjects.id, existing[0].id));
      return existing[0].id;
    }
  }

  // Create new subject
  const insertData: InsertSubject = {
    subjectType: data.subjectType,
    displayName: data.displayName ?? null,
    primaryHandle: data.primaryHandle ?? null,
    primaryPlatform: platform ?? null,
    profileUrl: data.profileUrl ?? null,
    websiteUrl: data.websiteUrl ?? null,
    pronouns: validateEnum(data.pronouns, VALID_PRONOUNS, "pronouns"),
    latestArchetype: validateEnum(data.latestArchetype, VALID_ARCHETYPES, "latestArchetype"),
    latestBrandArchetype: validateEnum(data.latestBrandArchetype, VALID_BRAND_ARCHETYPES, "latestBrandArchetype"),
    brandType: data.brandType ?? null,
    brandCategory: data.brandCategory ?? null,
    campaignType: validateEnum(data.campaignType, VALID_CAMPAIGN_TYPES, "campaignType"),
    engagementTier: validateEnum(data.engagementTier, VALID_ENGAGEMENT_TIERS, "engagementTier"),
  };

  const result = await db.insert(subjects).values(insertData).returning({ id: subjects.id });
  return result[0].id;
}

/**
 * Find or create a platform_handles row.
 */
export async function upsertPlatformHandle(
  subjectId: string,
  platform: string,
  handle: string,
  profileUrl?: string,
  executor?: DbExecutor,
): Promise<string> {
  const db = executor ?? await getDb();
  if (!db) throw new Error("Database not available");

  const normalizedPlatform = normalizePlatform(platform);

  const existing = await db.select({ id: platformHandles.id })
    .from(platformHandles)
    .where(and(
      eq(platformHandles.platform, normalizedPlatform),
      // Session 7: case-insensitive — see upsertSubject
      sql`lower(${platformHandles.handle}) = lower(${handle})`,
    ))
    .limit(1);

  if (existing.length > 0) return existing[0].id;

  const result = await db.insert(platformHandles).values({
    subjectId,
    platform: normalizedPlatform,
    handle,
    profileUrl: profileUrl ?? null,
    isPrimary: true,
  }).returning({ id: platformHandles.id });

  return result[0].id;
}

/**
 * Insert a new observation row (append-only, never upsert).
 * Sets isLatest=true on the new row, false on all previous ones for this subject.
 */
export async function insertObservation(
  subjectId: string,
  data: {
    followerCount?: number | null;
    followingCount?: number | null;
    engagementRate?: number | null;
    bio?: string | null;
    dataConfidenceLevel?: string | null;
    transcriptCount?: number | null;
    /** Analysis-run correlation id; defaults to the ambient run context. */
    runId?: string | null;
    /** Review gate (womo_0006); defaults to 'pending'. */
    reviewStatus?: "pending" | "accepted" | "declined";
  },
  executor?: DbExecutor,
): Promise<string> {
  const db = executor ?? await getDb();
  if (!db) throw new Error("Database not available");

  // Default 'accepted' preserves pre-gate behavior for ungated paths (brand
  // until Session 7); the gated creator path passes 'pending' explicitly.
  const reviewStatus = data.reviewStatus ?? "accepted";

  // FIX 2.6: Wrap in transaction so isLatest update + insert are atomic.
  // Previously, a failed insert after the update left zero 'latest' observations.
  // When called with a transaction executor this nests as a savepoint.
  const result = await db.transaction(async (tx) => {
    // Review-gate reconciliation (womo_0006): is_latest marks the AUTHORITATIVE
    // observation, not merely the newest. A pending observation only takes
    // is_latest when the subject has no accepted observation (first-ever
    // analysis — profile visible, marked pending). If an accepted observation
    // exists it keeps is_latest until the analyst accepts the new run
    // (setObservationReviewStatus transfers it).
    let takeLatest = true;
    if (reviewStatus === "pending") {
      const accepted = await tx.select({ id: observations.id })
        .from(observations)
        .where(and(
          eq(observations.subjectId, subjectId),
          eq(observations.reviewStatus, "accepted"),
        ))
        .limit(1);
      takeLatest = accepted.length === 0;
    }

    if (takeLatest) {
      // Set all previous observations for this subject to isLatest=false
      await tx.update(observations)
        .set({ isLatest: false })
        .where(and(eq(observations.subjectId, subjectId), eq(observations.isLatest, true)));
    }

    const [obs] = await tx.insert(observations).values({
      subjectId,
      isLatest: takeLatest,
      followerCount: data.followerCount ?? null,
      followingCount: data.followingCount ?? null,
      engagementRate: data.engagementRate ?? null,
      bio: data.bio ?? null,
      dataConfidenceLevel: validateEnum(data.dataConfidenceLevel, VALID_CONFIDENCE_LEVELS, "dataConfidenceLevel"),
      transcriptCount: data.transcriptCount ?? 0,
      runId: data.runId ?? currentRunId(),
      reviewStatus,
    }).returning({ id: observations.id });

    return obs;
  });

  return result.id;
}

/**
 * Analyst review action (womo_0006): accept or decline an observation.
 * NEVER deletes — decline is a status change only; the run's data and full
 * provenance are retained for scraper-failure analysis.
 *
 * is_latest reconciliation:
 *  - accept: this observation becomes the authoritative one (is_latest
 *    transfers to it from whichever row held it).
 *  - decline: relinquishes is_latest if held; the newest remaining accepted
 *    observation (by observed_at) is promoted. A declined-only subject ends
 *    with no is_latest row and disappears from default views.
 * Transitions from any prior state are allowed (accepted→declined corrects a
 * bad acceptance; declined→accepted un-archives).
 */
export async function setObservationReviewStatus(
  observationId: string,
  status: "accepted" | "declined",
  reviewedBy?: string,
): Promise<{ observationId: string; subjectId: string; reviewStatus: string }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return db.transaction(async (tx) => {
    const [obs] = await tx.select({
      id: observations.id,
      subjectId: observations.subjectId,
      isLatest: observations.isLatest,
    })
      .from(observations)
      .where(eq(observations.id, observationId))
      .limit(1);
    if (!obs) throw new Error("Observation not found");

    await tx.update(observations)
      .set({
        reviewStatus: status,
        reviewedAt: new Date(),
        reviewedBy: reviewedBy?.slice(0, 64) ?? null,
      })
      .where(eq(observations.id, observationId));

    if (status === "accepted") {
      // Transfer is_latest to the accepted observation.
      await tx.update(observations)
        .set({ isLatest: false })
        .where(and(eq(observations.subjectId, obs.subjectId), eq(observations.isLatest, true)));
      await tx.update(observations)
        .set({ isLatest: true })
        .where(eq(observations.id, observationId));
    } else if (obs.isLatest) {
      // Declining the current authoritative observation: relinquish is_latest
      // and promote the newest remaining accepted one, if any.
      await tx.update(observations)
        .set({ isLatest: false })
        .where(eq(observations.id, observationId));
      const [promote] = await tx.select({ id: observations.id })
        .from(observations)
        .where(and(
          eq(observations.subjectId, obs.subjectId),
          eq(observations.reviewStatus, "accepted"),
        ))
        .orderBy(desc(observations.observedAt))
        .limit(1);
      if (promote) {
        await tx.update(observations)
          .set({ isLatest: true })
          .where(eq(observations.id, promote.id));
      }
    }

    return { observationId, subjectId: obs.subjectId, reviewStatus: status };
  });
}

/**
 * Evidence snapshots (womo_0007): persist the structured inputs used to build
 * the extraction prompt AND the exact prompt string sent to the LLM, keyed by
 * run_id. Two semantic_documents rows per run; the partial unique index
 * sd_run_doc_unique enforces one of each kind per run (append-only history —
 * a duplicate write for the same run rejects rather than replacing).
 */
export async function insertEvidenceSnapshots(args: {
  subjectId: string;
  observationId: string | null;
  /** Defaults to the ambient analysis-run id. */
  runId?: string | null;
  /** 'creator' this session; 'brand' reserved for Session 8 */
  kindPrefix: "creator" | "brand";
  /** JSON string of the structured inputs used to build the prompt */
  inputsJson: string;
  /** The exact user-prompt string sent to the LLM */
  promptText: string;
  /** { systemPrompt, model, purpose, temperature } — reconstructs the messages array */
  promptMeta: Record<string, unknown>;
  inputsMeta?: Record<string, unknown>;
}): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const runId = args.runId ?? currentRunId();
  await db.insert(semanticDocuments).values([
    {
      subjectId: args.subjectId,
      observationId: args.observationId,
      runId,
      documentType: `${args.kindPrefix}_evidence_inputs`,
      contentText: args.inputsJson,
      metadata: args.inputsMeta ?? { schemaVersion: 1 },
    },
    {
      subjectId: args.subjectId,
      observationId: args.observationId,
      runId,
      documentType: `${args.kindPrefix}_extraction_prompt`,
      contentText: args.promptText,
      metadata: args.promptMeta,
    },
  ]);
}

/**
 * Read the evidence snapshot set for a run (diagnostics / replay tooling).
 */
export async function getEvidenceSnapshotsByRunId(runId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.select().from(semanticDocuments)
    .where(eq(semanticDocuments.runId, runId))
    .orderBy(semanticDocuments.documentType);
}

/**
 * Session 9 (A7): fetch a run's evidence snapshot(s) by observation id, so an
 * analyst can read exactly what the model received (structured inputs + the
 * verbatim extraction prompt, plus any longitudinal snapshot). Read-only.
 */
export async function getEvidenceSnapshotByObservation(observationId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.select({
    documentType: semanticDocuments.documentType,
    contentText: semanticDocuments.contentText,
    metadata: semanticDocuments.metadata,
    createdAt: semanticDocuments.createdAt,
  }).from(semanticDocuments)
    .where(eq(semanticDocuments.observationId, observationId))
    .orderBy(semanticDocuments.documentType);
}

/** semantic_documents.document_type for the verbatim 6-3-3 longitudinal sample. */
export const LONGITUDINAL_SAMPLE_DOC_TYPE = "creator_longitudinal_sample";

/**
 * Session 8: persist the VERBATIM 6-3-3 longitudinal sample object as a single
 * run-keyed semantic_documents row (womo_0007 snapshot mechanism — no new DDL;
 * document_type is a free varchar). This preserves exactly what the sampler
 * produced — bucket membership, fill-forward decisions, ordering, totalFetched,
 * completeness, culturalVelocity — which a reconstruction from content_items
 * cannot fully recover. Append-only: the sd_run_doc_unique index enforces one
 * per (run_id, document_type), so a duplicate write for the same run rejects.
 */
export async function insertLongitudinalSampleSnapshot(args: {
  subjectId: string;
  observationId: string | null;
  runId?: string | null;
  /** JSON string of the LongitudinalSample object. */
  sampleJson: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(semanticDocuments).values({
    subjectId: args.subjectId,
    observationId: args.observationId,
    runId: args.runId ?? currentRunId(),
    documentType: LONGITUDINAL_SAMPLE_DOC_TYPE,
    contentText: args.sampleJson,
    metadata: args.metadata ?? { schemaVersion: 1 },
  });
}

/**
 * Read the verbatim longitudinal sample snapshot for an observation, if present.
 * Returns the parsed object (or null). Retrieval seam for future drift analysis;
 * no fit/UI consumer wires it into the profile today (the functional need is met
 * by content_items.temporal_bucket + creator_observations.cultural_velocity).
 */
export async function getLongitudinalSampleSnapshot(observationId: string): Promise<Record<string, unknown> | null> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [doc] = await db.select({ contentText: semanticDocuments.contentText })
    .from(semanticDocuments)
    .where(and(
      eq(semanticDocuments.observationId, observationId),
      eq(semanticDocuments.documentType, LONGITUDINAL_SAMPLE_DOC_TYPE),
    ))
    .limit(1);
  if (!doc?.contentText) return null;
  try {
    return JSON.parse(doc.contentText) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Write the per-component persistence outcome map onto an observation row
 * (womo_0005). Shape: { component: { status, reason, at } } with status
 * success | failed | skipped_no_data | skipped_not_attempted.
 */
export async function updateObservationPersistenceStatus(
  observationId: string,
  // Component entries are { status, reason, at }. Session 8: the map may also
  // carry reserved, underscore-prefixed metadata keys (e.g. `_meta`) that are
  // NOT enrichment components — hence Record<string, unknown>. getRunDiagnostics
  // skips reserved keys in its component loop and surfaces known ones.
  statusMap: Record<string, unknown>,
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(observations)
    .set({ persistenceStatus: statusMap })
    .where(eq(observations.id, observationId));
}

/**
 * Duplicate pre-flight lookup (Session 7): find an existing creator subject
 * for a raw handle-or-URL input, using the canonical (lowercased, extracted)
 * form against both subjects.primary_handle and platform_handles. Returns a
 * summary for the pre-flight warning dialog, or null.
 */
export async function findExistingCreatorByHandle(
  handleOrUrl: string,
  platform: string,
): Promise<{
  subjectId: string;
  handle: string | null;
  displayName: string | null;
  lastAnalyzedAt: Date | null;
  reviewStatus: string | null;
  pendingObservation: { id: string; observedAt: Date } | null;
} | null> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const canonical = canonicalizeHandle(handleOrUrl);
  if (!canonical) return null;
  const normalizedPlatform = normalizePlatform(platform);

  // Primary probe: subjects.primary_handle (case-insensitive)
  const [subj] = await db.select({
    id: subjects.id,
    handle: subjects.primaryHandle,
    displayName: subjects.displayName,
  })
    .from(subjects)
    .where(and(
      eq(subjects.subjectType, "creator"),
      eq(subjects.primaryPlatform, normalizedPlatform),
      sql`lower(${subjects.primaryHandle}) = ${canonical}`,
    ))
    .limit(1);

  let found = subj ?? null;

  // Secondary probe: platform_handles (covers subjects whose primary platform differs)
  if (!found) {
    const [ph] = await db.select({
      id: subjects.id,
      handle: subjects.primaryHandle,
      displayName: subjects.displayName,
    })
      .from(platformHandles)
      .innerJoin(subjects, and(
        eq(subjects.id, platformHandles.subjectId),
        eq(subjects.subjectType, "creator"),
      ))
      .where(and(
        eq(platformHandles.platform, normalizedPlatform),
        sql`lower(${platformHandles.handle}) = ${canonical}`,
      ))
      .limit(1);
    found = ph ?? null;
  }

  if (!found) return null;

  const [latestObs] = await db.select({
    observedAt: observations.observedAt,
    reviewStatus: observations.reviewStatus,
  })
    .from(observations)
    .where(eq(observations.subjectId, found.id))
    .orderBy(desc(observations.observedAt))
    .limit(1);

  const [pending] = await db.select({ id: observations.id, observedAt: observations.observedAt })
    .from(observations)
    .where(and(eq(observations.subjectId, found.id), eq(observations.reviewStatus, "pending")))
    .orderBy(desc(observations.observedAt))
    .limit(1);

  return {
    subjectId: found.id,
    handle: found.handle,
    displayName: found.displayName,
    lastAnalyzedAt: latestObs?.observedAt ?? null,
    reviewStatus: latestObs?.reviewStatus ?? null,
    pendingObservation: pending ? { id: pending.id, observedAt: pending.observedAt } : null,
  };
}

/**
 * Get the authoritative (is_latest) observation's id + run id for a subject.
 * Used to resolve exact per-run metrics/diagnostics (womo_0006).
 */
export async function getLatestObservationRun(
  subjectId: string,
): Promise<{ observationId: string; runId: string | null } | null> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const rows = await db.select({ id: observations.id, runId: observations.runId })
    .from(observations)
    .where(and(eq(observations.subjectId, subjectId), eq(observations.isLatest, true)))
    .limit(1);

  return rows[0] ? { observationId: rows[0].id, runId: rows[0].runId } : null;
}

/**
 * Get the latest observation ID for a given subject.
 * Used when appending content items after the initial pipeline
 * (e.g., supplemental video ingestion).
 */
export async function getLatestObservationId(subjectId: string): Promise<string | null> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const rows = await db.select({ id: observations.id })
    .from(observations)
    .where(and(
      eq(observations.subjectId, subjectId),
      eq(observations.isLatest, true),
    ))
    .limit(1);

  return rows[0]?.id ?? null;
}

/**
 * Insert one creator_observations row linked to an observation.
 */
export async function insertCreatorObservation(
  observationId: string,
  data: {
    totalLikes?: number | null;
    videoCount?: number | null;
    totalViews?: number | null;
    avgViews?: number | null;
    avgVideoDuration?: number | null;
    primaryRegion?: string | null;
    archetype?: string | null;
    toneRegister?: string | null;
    parasocialBondStrength?: number | null;
    audienceRelationshipType?: string | null;
    barthesMyth?: string | null;
    culturalCapital?: string | null;
    goffmanStageConsistency?: string | null;
    driftSignal?: string | null;
    stuartHallDecoding?: string | null;
    nicheTopicNode?: string | null;
    undergroundDensity?: boolean | null;
    mainstreamBleed?: boolean | null;
    remixRate?: boolean | null;
    brandSaturation?: boolean | null;
    rogersAdopterStage?: string | null;
    creatorNichePosition?: string | null;
    lifecyclePhase?: string | null;
    barthesNicheMeaning?: string | null;
    turnerLiminalPhase?: string | null;
    culturalVelocity?: string | null;
    engagementQualityScore?: number | null;
    engagementQualityConfidence?: string | null;
    symbolicSummary?: string | null;
    aiSummary?: string | null;
  },
  executor?: DbExecutor,
): Promise<string> {
  const db = executor ?? await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(creatorObservations).values({
    observationId,
    totalLikes: data.totalLikes ?? null,
    videoCount: data.videoCount ?? null,
    totalViews: data.totalViews ?? null,
    avgViews: data.avgViews ?? null,
    avgVideoDuration: data.avgVideoDuration ?? null,
    primaryRegion: data.primaryRegion ?? null,
    archetype: validateEnum(data.archetype, VALID_ARCHETYPES, "archetype"),
    toneRegister: data.toneRegister ?? null,
    parasocialBondStrength: data.parasocialBondStrength ?? null,
    audienceRelationshipType: validateEnum(data.audienceRelationshipType, VALID_AUDIENCE_RELATIONSHIPS, "audienceRelationshipType"),
    barthesMyth: data.barthesMyth ?? null,
    culturalCapital: validateEnum(data.culturalCapital, VALID_CULTURAL_CAPITAL, "culturalCapital"),
    goffmanStageConsistency: validateEnum(data.goffmanStageConsistency, VALID_GOFFMAN, "goffmanStageConsistency"),
    driftSignal: validateEnum(data.driftSignal, VALID_DRIFT_SIGNALS, "driftSignal"),
    stuartHallDecoding: validateEnum(data.stuartHallDecoding, VALID_HALL_DECODING, "stuartHallDecoding"),
    nicheTopicNode: data.nicheTopicNode ?? null,
    undergroundDensity: data.undergroundDensity ?? null,
    mainstreamBleed: data.mainstreamBleed ?? null,
    remixRate: data.remixRate ?? null,
    brandSaturation: data.brandSaturation ?? null,
    rogersAdopterStage: validateEnum(data.rogersAdopterStage, VALID_ROGERS_STAGES, "rogersAdopterStage"),
    creatorNichePosition: validateEnum(data.creatorNichePosition, VALID_NICHE_POSITIONS, "creatorNichePosition"),
    lifecyclePhase: validateEnum(data.lifecyclePhase, VALID_LIFECYCLE_PHASES, "lifecyclePhase"),
    barthesNicheMeaning: data.barthesNicheMeaning ?? null,
    turnerLiminalPhase: validateEnum(data.turnerLiminalPhase, VALID_LIMINAL_PHASES, "turnerLiminalPhase"),
    culturalVelocity: validateEnum(data.culturalVelocity, VALID_CULTURAL_VELOCITY, "culturalVelocity"),
    engagementQualityScore: data.engagementQualityScore ?? null,
    engagementQualityConfidence: validateEnum(data.engagementQualityConfidence, VALID_SIGNAL_CONFIDENCE, "engagementQualityConfidence"),
    symbolicSummary: data.symbolicSummary ?? null,
    aiSummary: data.aiSummary ?? null,
  }).returning({ id: creatorObservations.id });

  return result[0].id;
}

/**
 * I2: Update avgVideoDuration on an existing creator_observations row.
 * Called after insertContentItems, since duration data isn't available at initial insert time.
 */
export async function updateCreatorObservationAvgDuration(
  observationId: string,
  avgVideoDuration: number,
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(creatorObservations)
    .set({ avgVideoDuration })
    .where(eq(creatorObservations.observationId, observationId));
}

/**
 * Bulk insert signal_values rows.
 */
export async function insertSignalValues(
  subjectId: string,
  observationId: string,
  signals: Array<{
    domain: string;
    signalKey: string;
    signalValue?: string | null;
    confidence?: number | null;
    source?: string | null;
    rank?: number | null;
  }>,
): Promise<void> {
  if (signals.length === 0) return;
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const rows: InsertSignalValue[] = signals.map(s => ({
    subjectId,
    observationId,
    domain: validateEnum(s.domain, VALID_SIGNAL_DOMAINS, "signalValues.domain") ?? "keyword",
    signalKey: s.signalKey,
    signalValue: s.signalValue ?? null,
    confidence: s.confidence ?? null,
    source: s.source ?? null,
    rank: s.rank ?? null,
  }));

  // Batch insert in chunks of 500 to avoid hitting PG parameter limits
  for (let i = 0; i < rows.length; i += 500) {
    await db.insert(signalValues).values(rows.slice(i, i + 500));
  }
}

/**
 * Bulk insert decoded_signals rows from symbol decoder output.
 */
export async function insertDecodedSignals(
  subjectId: string,
  observationId: string,
  signals: Array<{
    category: string;
    phrase: string;
    meaning: string;
    informsFields?: string[];
    source?: string;
  }>,
): Promise<void> {
  if (signals.length === 0) return;
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const rows: InsertDecodedSignal[] = signals.map(s => ({
    subjectId,
    observationId,
    category: validateEnum(s.category, VALID_SIGNAL_DOMAINS, "decodedSignals.category") ?? "identity_claim",
    phrase: s.phrase,
    meaning: s.meaning,
    informsFields: s.informsFields ?? null,
    source: s.source ?? null,
  }));

  await db.insert(decodedSignals).values(rows);
}

/**
 * Bulk insert content_items rows.
 * Uses ON CONFLICT DO NOTHING on platform + platform_video_id + subject_id.
 */
export async function insertContentItems(
  subjectId: string,
  observationId: string,
  items: Array<{
    platform: string;
    platformVideoId?: string;
    videoUrl?: string;
    caption?: string;
    transcriptText?: string;
    transcriptSource?: string;
    transcriptWordCount?: number;
    videoDuration?: number;
    createTime?: number; // Unix seconds
    region?: string;
    temporalBucket?: string;
    likeCount?: number;
    commentCount?: number;
    shareCount?: number;
    viewCount?: number;
    saveCount?: number;
    musicTitle?: string;
    musicArtist?: string;
    isOriginalAudio?: boolean;
    status?: string;
  }>,
): Promise<void> {
  if (items.length === 0) return;
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const rows: InsertContentItem[] = items.map(item => ({
    subjectId,
    observationId,
    platform: normalizePlatform(item.platform),
    platformVideoId: item.platformVideoId ?? null,
    videoUrl: item.videoUrl ?? null,
    caption: item.caption ?? null,
    transcriptText: item.transcriptText ?? null,
    transcriptSource: item.transcriptSource ?? null,
    transcriptWordCount: item.transcriptWordCount ?? null,
    videoDuration: item.videoDuration ?? null,
    createTime: item.createTime ? new Date(item.createTime * 1000) : null,
    region: item.region ?? null,
    temporalBucket: item.temporalBucket ?? null,
    likeCount: item.likeCount ?? null,
    commentCount: item.commentCount ?? null,
    shareCount: item.shareCount ?? null,
    viewCount: item.viewCount ?? null,
    saveCount: item.saveCount ?? null,
    musicTitle: item.musicTitle ?? null,
    musicArtist: item.musicArtist ?? null,
    isOriginalAudio: item.isOriginalAudio ?? null,
    status: item.status ?? "sampled",
  }));

  // Upsert: on conflict, update with latest data (especially transcript fields)
  for (let i = 0; i < rows.length; i += 500) {
    await db.insert(contentItems).values(rows.slice(i, i + 500)).onConflictDoUpdate({
      target: [contentItems.platform, contentItems.platformVideoId, contentItems.subjectId],
      set: {
        transcriptText: sql`COALESCE(excluded.transcript_text, ${contentItems.transcriptText})`,
        transcriptSource: sql`COALESCE(excluded.transcript_source, ${contentItems.transcriptSource})`,
        transcriptWordCount: sql`COALESCE(excluded.transcript_word_count, ${contentItems.transcriptWordCount})`,
        videoDuration: sql`COALESCE(excluded.video_duration, ${contentItems.videoDuration})`,
        videoUrl: sql`COALESCE(excluded.video_url, ${contentItems.videoUrl})`,
        viewCount: sql`COALESCE(excluded.view_count, ${contentItems.viewCount})`,
        likeCount: sql`COALESCE(excluded.like_count, ${contentItems.likeCount})`,
        commentCount: sql`COALESCE(excluded.comment_count, ${contentItems.commentCount})`,
        status: sql`CASE WHEN excluded.transcript_text IS NOT NULL THEN 'sampled' ELSE ${contentItems.status} END`,
      },
    });
  }
}

/**
 * Update an existing content_items row with transcript data.
 * Matches by platform + platform_video_id + subject_id.
 */
export async function updateContentItemTranscript(
  subjectId: string,
  platformVideoId: string,
  platform: string,
  transcriptText: string,
  transcriptSource: string,
  wordCount: number,
  /**
   * Session 8: the 6-3-3 sample bucket (recent/mid/anchor) for this video, when
   * known. Persisting it here — during transcript wiring — populates the
   * previously-unwritten content_items.temporal_bucket for the transcript-bearing
   * sampled videos, which is exactly the set the longitudinal sample contains.
   * The read model (getCreatorProfileById) and getRunDiagnostics already consume
   * this column. Null/undefined for non-6-3-3 platforms (Instagram/YouTube).
   */
  temporalBucket?: string | null,
): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  try {
    const normalizedPlatform = normalizePlatform(platform);
    // Session 8: RETURN whether a row was actually matched. This previously
    // returned `true` unconditionally, so the caller's transcriptSuccessCount
    // incremented even when the WHERE matched zero content_items rows — inflating
    // observations.transcript_count and, through it, data_confidence_level.
    // `.returning()` reports the rows genuinely updated. (Caption handling is
    // unchanged: a caption-sourced transcript that matches a row still counts,
    // exactly as before — only phantom updates stop counting.)
    const updatedRows = await db.update(contentItems)
      .set({
        transcriptText,
        transcriptSource,
        transcriptWordCount: wordCount,
        status: "sampled",
        ...(temporalBucket ? { temporalBucket } : {}),
      })
      .where(and(
        eq(contentItems.subjectId, subjectId),
        eq(contentItems.platform, normalizedPlatform),
        eq(contentItems.platformVideoId, platformVideoId),
      ))
      .returning({ id: contentItems.id });
    return updatedRows.length > 0;
  } catch (err) {
    console.warn("[Database] Failed to update content item transcript:", err);
    return false;
  }
}

/**
 * Update an observation row with transcript count and confidence level.
 */
export async function updateObservationTranscriptCount(
  observationId: string,
  transcriptCount: number,
  confidenceLevel: "high" | "medium" | "low",
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Errors propagate: the caller (transcript_count enrichment in routers.ts)
  // records the failure into persistence_status instead of it being swallowed.
  await db.update(observations)
    .set({
      transcriptCount,
      dataConfidenceLevel: confidenceLevel,
    })
    .where(eq(observations.id, observationId));
}

/**
 * Insert one scrape_events row.
 */
export async function insertScrapeEvent(data: {
  observationId?: string;
  subjectId?: string;
  platform?: string;
  scrapeMethod: string;
  urlRequested?: string;
  httpStatus?: number;
  responseSizeBytes?: number;
  silentFailureDetected?: boolean;
  failureReason?: string;
  durationMs?: number;
}): Promise<string> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(scrapeEvents).values({
    observationId: data.observationId ?? null,
    subjectId: data.subjectId ?? null,
    platform: data.platform ? normalizePlatform(data.platform) : null,
    scrapeMethod: validateEnum(data.scrapeMethod, VALID_SCRAPE_METHODS, "scrapeMethod") ?? "manual_entry",
    urlRequested: data.urlRequested ?? null,
    httpStatus: data.httpStatus ?? null,
    responseSizeBytes: data.responseSizeBytes ?? null,
    silentFailureDetected: data.silentFailureDetected ?? false,
    failureReason: data.failureReason ?? null,
    durationMs: data.durationMs ?? null,
    runId: currentRunId(),
  }).returning({ id: scrapeEvents.id });

  return result[0].id;
}

/**
 * Insert one llm_invocations row.
 */
export async function insertLlmInvocation(data: {
  observationId?: string;
  matchScoreId?: string;
  subjectId?: string;
  purpose: string;
  model: string;
  promptVersion?: string;
  temperature?: number;
  inputTokens?: number;
  outputTokens?: number;
  responseJson?: Record<string, unknown>;
  durationMs?: number;
  /** womo_0005: 'success' (default) | 'failed'. Failed calls leave a trace too. */
  status?: "success" | "failed";
  errorMessage?: string;
}): Promise<string> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(llmInvocations).values({
    observationId: data.observationId ?? null,
    matchScoreId: data.matchScoreId ?? null,
    subjectId: data.subjectId ?? null,
    purpose: data.purpose,
    model: data.model,
    promptVersion: data.promptVersion ?? null,
    temperature: data.temperature ?? null,
    inputTokens: data.inputTokens ?? null,
    outputTokens: data.outputTokens ?? null,
    responseJson: data.responseJson ?? null,
    durationMs: data.durationMs ?? null,
    status: data.status ?? "success",
    errorMessage: data.errorMessage ?? null,
    runId: currentRunId(),
  }).returning({ id: llmInvocations.id });

  return result[0].id;
}

/**
 * Get aggregated LLM token usage for a given subject — used for pipeline metrics display.
 */
export async function getLlmTokenUsageBySubject(subjectId: string): Promise<{
  inputTokens: number; outputTokens: number; totalTokens: number; llmCalls: number; model: string;
}> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const rows = await db.select({
    inputTokens: llmInvocations.inputTokens,
    outputTokens: llmInvocations.outputTokens,
    model: llmInvocations.model,
  }).from(llmInvocations).where(eq(llmInvocations.subjectId, subjectId));

  let inputTokens = 0, outputTokens = 0, llmCalls = 0;
  let model = "unknown";
  for (const r of rows) {
    inputTokens += r.inputTokens ?? 0;
    outputTokens += r.outputTokens ?? 0;
    if (r.model) model = r.model;
    llmCalls++;
  }
  return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, llmCalls, model };
}

/**
 * Get aggregated LLM token usage for one analysis run — exact, via run_id
 * (womo_0006). Replaces time-window inference for run-tagged data.
 */
export async function getLlmTokenUsageByRunId(runId: string): Promise<{
  inputTokens: number; outputTokens: number; totalTokens: number; llmCalls: number; model: string;
}> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const rows = await db.select({
    inputTokens: llmInvocations.inputTokens,
    outputTokens: llmInvocations.outputTokens,
    model: llmInvocations.model,
  }).from(llmInvocations).where(eq(llmInvocations.runId, runId));

  let inputTokens = 0, outputTokens = 0, llmCalls = 0;
  let model = "unknown";
  for (const r of rows) {
    inputTokens += r.inputTokens ?? 0;
    outputTokens += r.outputTokens ?? 0;
    if (r.model) model = r.model;
    llmCalls++;
  }
  return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, llmCalls, model };
}

/**
 * Get aggregated LLM token usage for invocations since a given timestamp.
 * Kept ONLY as the fallback for observations that predate run_id tracking
 * (womo_0006) — run-tagged data uses getLlmTokenUsageByRunId instead.
 */
export async function getLlmTokenUsageByTimeWindow(since: Date, until?: Date): Promise<{
  inputTokens: number; outputTokens: number; totalTokens: number; llmCalls: number; model: string;
}> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const conditions = [sql`${llmInvocations.createdAt} >= ${since}`];
  if (until) conditions.push(sql`${llmInvocations.createdAt} <= ${until}`);

  const rows = await db.select({
    inputTokens: llmInvocations.inputTokens,
    outputTokens: llmInvocations.outputTokens,
    model: llmInvocations.model,
  }).from(llmInvocations).where(
    conditions.length === 1 ? conditions[0] : and(...conditions)
  );

  let inputTokens = 0, outputTokens = 0, llmCalls = 0;
  let model = "unknown";
  for (const r of rows) {
    inputTokens += r.inputTokens ?? 0;
    outputTokens += r.outputTokens ?? 0;
    if (r.model) model = r.model;
    llmCalls++;
  }
  return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, llmCalls, model };
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE A — READ FUNCTIONS (Creator)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get a creator "profile" view by subject ID — joins subjects + latest observation + creator_observations.
 * Returns a flat object compatible with existing routers.ts expectations.
 */
export async function getCreatorProfileById(subjectId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const rows = await db.select()
    .from(subjects)
    .innerJoin(observations, and(eq(observations.subjectId, subjects.id), eq(observations.isLatest, true)))
    .innerJoin(creatorObservations, eq(creatorObservations.observationId, observations.id))
    .where(eq(subjects.id, subjectId))
    .limit(1);

  if (rows.length === 0) return null;
  const row = rows[0];
  const observationId = row.observations.id;

  // Review-gate visibility (womo_0006): list-shaped data (signals, decoded
  // symbols, content items) accumulates across observations by subject_id —
  // rows belonging to a PENDING rerun or a DECLINED run must not bleed into
  // the authoritative profile. Visible rows = those tied to accepted
  // observations, to the current authoritative observation (covers a
  // first-run pending profile being reviewed), or legacy rows with no
  // observation link (content_items only — its FK is SET NULL).
  const visibleObservationIds = db.select({ id: observations.id })
    .from(observations)
    .where(and(
      eq(observations.subjectId, subjectId),
      or(eq(observations.reviewStatus, "accepted"), eq(observations.id, observationId)),
    ));

  // ── Parallel subqueries for signal_values, decoded_signals, content_items ──
  const [
    contentThemeRows,
    keywordRows,
    hashtagRows,
    themeRows,
    decodedSignalRows,
    contentItemRows,
  ] = await Promise.all([
    db.select({ key: signalValues.signalKey })
      .from(signalValues)
      .where(and(eq(signalValues.subjectId, subjectId), eq(signalValues.domain, "content_theme"), inArray(signalValues.observationId, visibleObservationIds)))
      .orderBy(signalValues.rank),
    db.select({ key: signalValues.signalKey })
      .from(signalValues)
      .where(and(eq(signalValues.subjectId, subjectId), eq(signalValues.domain, "keyword"), inArray(signalValues.observationId, visibleObservationIds)))
      .orderBy(signalValues.rank),
    db.select({ key: signalValues.signalKey })
      .from(signalValues)
      .where(and(eq(signalValues.subjectId, subjectId), eq(signalValues.domain, "hashtag"), inArray(signalValues.observationId, visibleObservationIds)))
      .orderBy(signalValues.rank),
    db.select({ key: signalValues.signalKey })
      .from(signalValues)
      .where(and(eq(signalValues.subjectId, subjectId), eq(signalValues.domain, "theme"), inArray(signalValues.observationId, visibleObservationIds)))
      .orderBy(signalValues.rank),
    db.select({
      category: decodedSignals.category,
      phrase: decodedSignals.phrase,
      meaning: decodedSignals.meaning,
      informsFields: decodedSignals.informsFields,
    })
      .from(decodedSignals)
      .where(and(eq(decodedSignals.subjectId, subjectId), inArray(decodedSignals.observationId, visibleObservationIds))),
    db.select()
      .from(contentItems)
      .where(and(
        eq(contentItems.subjectId, subjectId),
        or(isNull(contentItems.observationId), inArray(contentItems.observationId, visibleObservationIds)),
      ))
      .orderBy(desc(contentItems.viewCount)),
  ]);

  // Newest pending observation for this subject (if any) — lets the UI state
  // that a pending rerun exists while the accepted profile stays displayed.
  const [newestPending] = await db.select({
    id: observations.id,
    runId: observations.runId,
    observedAt: observations.observedAt,
  })
    .from(observations)
    .where(and(eq(observations.subjectId, subjectId), eq(observations.reviewStatus, "pending")))
    .orderBy(desc(observations.observedAt))
    .limit(1);

  // ── Assemble decoded symbols into the shape TranscriptPanel expects ──
  const decodedSymbolsObj: {
    identityClaims: { phrase: string; meaning: string; informs: string[] }[];
    statusSignals: { phrase: string; meaning: string; informs: string[] }[];
    communityReferences: { phrase: string; meaning: string; informs: string[] }[];
    aspirationDrivers: { phrase: string; meaning: string; informs: string[] }[];
    symbolicSummary: string;
  } = {
    identityClaims: [],
    statusSignals: [],
    communityReferences: [],
    aspirationDrivers: [],
    symbolicSummary: row.creator_observations.symbolicSummary ?? "",
  };
  for (const sig of decodedSignalRows) {
    const entry = { phrase: sig.phrase, meaning: sig.meaning, informs: sig.informsFields ?? [] };
    switch (sig.category) {
      case "identity_claim": decodedSymbolsObj.identityClaims.push(entry); break;
      case "status_signal": decodedSymbolsObj.statusSignals.push(entry); break;
      case "community_reference": decodedSymbolsObj.communityReferences.push(entry); break;
      case "aspiration_driver": decodedSymbolsObj.aspirationDrivers.push(entry); break;
    }
  }
  const hasDecodedSignals = decodedSignalRows.length > 0;

  // ── B3 (Session 9): order transcript EVIDENCE by value, not view count ──
  // Speech-sourced transcripts (subtitle/audio) first, then by word count desc,
  // so the analyst sees the strongest spoken evidence first — not whichever
  // clip happened to go viral. (The discovered-pool and video-title lists below
  // deliberately keep view-count order — that IS what those surfaces want.)
  // viewCount is the final, deterministic tiebreak so ordering is stable.
  const transcriptRows = contentItemRows
    .filter(ci => ci.transcriptText)
    .sort((a, b) => {
      const aSpeech = isSpeechTranscript(a.transcriptSource) ? 1 : 0;
      const bSpeech = isSpeechTranscript(b.transcriptSource) ? 1 : 0;
      if (aSpeech !== bSpeech) return bSpeech - aSpeech;                 // speech before caption
      const wc = (b.transcriptWordCount ?? 0) - (a.transcriptWordCount ?? 0);
      if (wc !== 0) return wc;                                           // then word count desc
      return (b.viewCount ?? 0) - (a.viewCount ?? 0);                    // stable tiebreak
    });

  // ── Assemble transcript excerpts from content_items ──
  const transcriptsArray = transcriptRows.map(ci => {
    const src = classifyTranscriptSource(ci.transcriptSource);
    return {
      videoId: ci.platformVideoId ?? "",
      caption: ci.caption ?? "",
      transcriptText: ci.transcriptText!,
      wordCount: ci.transcriptWordCount ?? 0,
      temporalBucket: ci.temporalBucket ?? "",
      viewCount: ci.viewCount ?? 0,
      createTime: ci.createTime,
      // Session 9: expose provenance so the UI can distinguish speech from a
      // post-caption fallback instead of labeling everything "Spoken Content".
      transcriptSource: ci.transcriptSource ?? null,
      sourceKind: src.kind,        // "speech" | "caption"
      sourceLabel: src.label,      // e.g. "Subtitle track" | "Post caption"
    };
  });

  // ── Assemble discovered video pool from content_items ──
  const discoveredPool = contentItemRows.map(ci => ({
    id: ci.platformVideoId ?? ci.id,
    url: ci.videoUrl ?? `https://www.tiktok.com/@/video/${ci.platformVideoId}`,
    caption: ci.caption ?? "",
    createTime: ci.createTime ? Math.floor(ci.createTime.getTime() / 1000) : 0,
    viewCount: ci.viewCount ?? 0,
    likeCount: ci.likeCount ?? 0,
    commentCount: ci.commentCount ?? 0,
    shareCount: ci.shareCount ?? 0,
    saveCount: ci.saveCount ?? 0,
    videoDuration: ci.videoDuration ?? 0,
    musicTitle: ci.musicTitle ?? "",
    musicArtist: ci.musicArtist ?? "",
    isOriginalAudio: ci.isOriginalAudio ?? false,
    transcriptText: ci.transcriptText ?? null,
    transcriptWordCount: ci.transcriptWordCount ?? null,
    status: ci.status,
    alreadySampled: ci.status === "sampled",
  }));

  // ── Assemble video titles from content_items captions ──
  const videoTitles = contentItemRows
    .filter(ci => ci.caption)
    .map(ci => ci.caption!);

  // Flatten into a shape compatible with existing routers.ts access patterns
  return {
    id: row.subjects.id,
    observationId,
    handle: row.subjects.primaryHandle ?? "",
    platform: row.subjects.primaryPlatform ?? "tiktok",
    profileUrl: row.subjects.profileUrl ?? "",
    displayName: row.subjects.displayName ?? "",
    pronouns: row.subjects.pronouns ?? "not specified",
    bio: row.observations.bio ?? null,
    // From creator_observations
    archetype: row.creator_observations.archetype,
    toneRegister: row.creator_observations.toneRegister,
    parasocialBondStrength: row.creator_observations.parasocialBondStrength,
    audienceRelationshipType: row.creator_observations.audienceRelationshipType,
    barthesMyth: row.creator_observations.barthesMyth,
    culturalCapital: row.creator_observations.culturalCapital,
    goffmanStageConsistency: row.creator_observations.goffmanStageConsistency,
    driftSignal: row.creator_observations.driftSignal,
    stuartHallDecoding: row.creator_observations.stuartHallDecoding,
    nicheTopicNode: row.creator_observations.nicheTopicNode,
    undergroundDensity: row.creator_observations.undergroundDensity,
    mainstreamBleed: row.creator_observations.mainstreamBleed,
    remixRate: row.creator_observations.remixRate,
    brandSaturation: row.creator_observations.brandSaturation,
    rogersAdopterStage: row.creator_observations.rogersAdopterStage,
    creatorNichePosition: row.creator_observations.creatorNichePosition,
    lifecyclePhase: row.creator_observations.lifecyclePhase,
    barthesNicheMeaning: row.creator_observations.barthesNicheMeaning,
    turnerLiminalPhase: row.creator_observations.turnerLiminalPhase,
    culturalVelocity: row.creator_observations.culturalVelocity,
    aiSummary: row.creator_observations.aiSummary,
    symbolicSummary: row.creator_observations.symbolicSummary ?? null,
    // From observations
    followerCount: row.observations.followerCount,
    engagementRate: row.observations.engagementRate,
    dataConfidenceLevel: row.observations.dataConfidenceLevel,
    transcriptCount: row.observations.transcriptCount,
    // From creator_observations (metrics)
    totalLikes: row.creator_observations.totalLikes,
    videoCount: row.creator_observations.videoCount,
    totalViews: row.creator_observations.totalViews,
    avgViews: row.creator_observations.avgViews,
    avgVideoDuration: row.creator_observations.avgVideoDuration ?? null,
    engagementQualityScore: row.creator_observations.engagementQualityScore ?? null,
    engagementQualityConfidence: row.creator_observations.engagementQualityConfidence ?? null,
    primaryRegion: row.creator_observations.primaryRegion ?? null,
    // From signal_values
    rawKeywords: keywordRows.length > 0 ? keywordRows.map(r => r.key) : null,
    contentThemeLabels: contentThemeRows.length > 0 ? contentThemeRows.map(r => r.key) : null,
    topHashtags: hashtagRows.length > 0 ? hashtagRows.map(r => r.key) : null,
    recurringThemes: themeRows.length > 0 ? themeRows.map(r => r.key) : null,
    // From decoded_signals
    decodedSymbols: hasDecodedSignals ? decodedSymbolsObj : null,
    // From content_items
    discoveredVideoPoolJson: discoveredPool.length > 0 ? discoveredPool : null,
    transcriptExcerpts: transcriptsArray.length > 0 ? transcriptsArray : null,
    // Session 7 (J-4 creator side): the shape fit.calculate reads for music
    // overlap — transcripts[].musicMetadata.soundName. Built from the
    // transcript-bearing content_items rows, mirroring the fresh-analysis
    // TranscriptEntry semantics (music of sampled/transcribed videos).
    transcripts: transcriptRows.map(ci => ({
      videoId: ci.platformVideoId ?? "",
      transcript: ci.transcriptText!,
      wordCount: ci.transcriptWordCount ?? 0,
      musicMetadata: ci.musicTitle
        ? { soundName: ci.musicTitle, isOriginal: ci.isOriginalAudio ?? undefined }
        : undefined,
    })),
    recentVideoTitles: videoTitles.length > 0 ? videoTitles : null,
    // V1 compat
    location: row.creator_observations.primaryRegion ?? null,
    // Review gate (womo_0006)
    reviewStatus: row.observations.reviewStatus,
    reviewedAt: row.observations.reviewedAt,
    reviewedBy: row.observations.reviewedBy,
    runId: row.observations.runId,
    // Newest pending run for this subject, if any. When it differs from the
    // displayed observation, the profile shown is the previously accepted run.
    pendingObservation: newestPending && newestPending.id !== observationId
      ? { id: newestPending.id, runId: newestPending.runId, observedAt: newestPending.observedAt }
      : null,
    // Timestamps
    createdAt: row.observations.createdAt,
    observedAt: row.observations.observedAt,
    updatedAt: row.subjects.updatedAt,
  };
}

/**
 * Get all content items for a subject (for Video Evidence Table).
 */
export async function getContentItemsBySubject(subjectId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Same review-gate visibility rule as the profile getters (womo_0006):
  // exclude rows tied to pending reruns / declined runs, keep accepted +
  // current authoritative + legacy (null observation) rows.
  const visibleObservationIds = db.select({ id: observations.id })
    .from(observations)
    .where(and(
      eq(observations.subjectId, subjectId),
      or(eq(observations.reviewStatus, "accepted"), eq(observations.isLatest, true)),
    ));

  const rows = await db.select()
    .from(contentItems)
    .where(and(
      eq(contentItems.subjectId, subjectId),
      or(isNull(contentItems.observationId), inArray(contentItems.observationId, visibleObservationIds)),
    ))
    .orderBy(desc(contentItems.viewCount));

  return rows.map(ci => ({
    id: ci.id,
    platformVideoId: ci.platformVideoId,
    videoUrl: ci.videoUrl,
    caption: ci.caption,
    transcriptText: ci.transcriptText,
    transcriptSource: ci.transcriptSource,
    transcriptWordCount: ci.transcriptWordCount,
    videoDuration: ci.videoDuration,
    createTime: ci.createTime,
    temporalBucket: ci.temporalBucket,
    likeCount: ci.likeCount,
    commentCount: ci.commentCount,
    shareCount: ci.shareCount,
    viewCount: ci.viewCount,
    saveCount: ci.saveCount,
    musicTitle: ci.musicTitle,
    musicArtist: ci.musicArtist,
    isOriginalAudio: ci.isOriginalAudio,
    status: ci.status,
    observationId: ci.observationId,
  }));
}

// ═══════════════════════════════════════════════════════════════════════════════
// RUN DIAGNOSTICS (womo_0006) — factual breakdown for the analyst review gate.
// Facts and counts only: no data-quality score, confidence percentage, or any
// derived metric that resembles a scoring output (metrics belong to Jason).
// ═══════════════════════════════════════════════════════════════════════════════

export type RunDiagnostics = {
  observationId: string;
  subjectId: string;
  runId: string | null;
  /** false = observation predates run tagging; scrape/LLM data fell back to observation_id linkage and may be incomplete */
  exactRunLinkage: boolean;
  reviewStatus: string;
  observedAt: Date;
  /**
   * Session 8: provenance of the sociological fields (parasocialBondStrength,
   * audienceRelationshipType, culturalCapital, remixRate). "computed" = derived
   * from TikTok engagement signals and copied by the model; "estimated" = LLM
   * rubric guess (Instagram / YouTube, or a TikTok run with no engagement data).
   * null = run predates the marker. Read from persistence_status._meta.
   */
  sociologicalFieldsProvenance: "computed" | "estimated" | null;
  /** Session 10: pool integrity — count of videos rejected by the author guard (foreign / author-less). null = not recorded. */
  pool: { authorRejected: number } | null;
  /** Session 9: why the confidence level is what it is (existing thresholds explained, not changed). */
  confidence: { level: string | null; transcriptCount: number; rationale: string };
  /** Session 9: cultural velocity + why (which temporal buckets are populated). null when absent. */
  velocity: { value: string | null; rationale: string } | null;
  scrapes: {
    total: number;
    failed: number;
    /** Session 9: plain-language consequences derived from which scrape METHODS failed. */
    consequences: string[];
    byPlatform: Array<{
      platform: string;
      attempts: number;
      succeeded: number;
      failed: number;
      events: Array<{
        method: string;
        url: string | null;
        httpStatus: number | null;
        failureReason: string | null;
        silentFailure: boolean;
        durationMs: number | null;
        at: Date;
      }>;
    }>;
  };
  videos: {
    total: number;
    byStatus: Record<string, number>;
    withTranscript: number;
    withoutTranscript: number;
    transcriptSources: Record<string, number>;
    /** Session 9: total videos on the channel (creator_observations.video_count). */
    channelVideoCount: number | null;
    /** Session 9: captured / channelVideoCount as a percentage (coverage of the channel). null if unknown. */
    coveragePct: number | null;
  };
  llm: {
    calls: number;
    failed: number;
    failures: Array<{ purpose: string; errorMessage: string | null; durationMs: number | null; at: Date }>;
    byPurpose: Record<string, number>;
    /** Session 9: per-call model settings (temperature) so run configuration is auditable. */
    settings: Array<{ purpose: string; temperature: number | null }>;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    model: string;
    costUsd: number;
  };
  enrichments: {
    /** verbatim persistence_status map; null = observation predates womo_0005 */
    raw: Record<string, { status: string; reason: string | null; at: string }> | null;
    succeeded: string[];
    failed: Array<{ component: string; reason: string | null }>;
    skippedNoData: Array<{ component: string; reason: string | null }>;
    skippedNotAttempted: Array<{ component: string; reason: string | null }>;
  };
  fields: {
    present: string[];
    missing: string[];
    /** Session 9: per-field provenance so the panel can distinguish evidence-backed from model-inferred values. */
    provenance: Array<{ field: string; provenance: "scraped" | "derived" | "evidence" | "computed" | "estimated" | "inferred" }>;
    counts: { keywords: number; contentThemes: number; hashtags: number; decodedSignals: number; contentItems: number; transcripts: number; temporalBuckets: number };
  };
  summary: string[];
};

export async function getRunDiagnostics(observationId: string): Promise<RunDiagnostics | null> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [obs] = await db.select().from(observations)
    .where(eq(observations.id, observationId)).limit(1);
  if (!obs) return null;

  const runId = obs.runId;
  // Exact linkage via run_id when the run was tagged (womo_0006+); otherwise
  // fall back to observation_id linkage for older rows (scrape/LLM rows
  // written before persistence carry no observation_id, so pre-run_id
  // diagnostics are inherently incomplete — flagged via exactRunLinkage).
  const scrapeWhere = runId ? eq(scrapeEvents.runId, runId) : eq(scrapeEvents.observationId, observationId);
  const llmWhere = runId ? eq(llmInvocations.runId, runId) : eq(llmInvocations.observationId, observationId);

  const [scrapeRows, llmRows, contentRows, creatorObsRows, signalCountRows, decodedCountRows] = await Promise.all([
    db.select().from(scrapeEvents).where(scrapeWhere).orderBy(scrapeEvents.createdAt).limit(500),
    db.select().from(llmInvocations).where(llmWhere).orderBy(llmInvocations.createdAt).limit(500),
    db.select().from(contentItems).where(eq(contentItems.observationId, observationId)),
    db.select().from(creatorObservations).where(eq(creatorObservations.observationId, observationId)).limit(1),
    db.select({ domain: signalValues.domain, count: sql<number>`count(*)::int` })
      .from(signalValues).where(eq(signalValues.observationId, observationId))
      .groupBy(signalValues.domain),
    db.select({ count: sql<number>`count(*)::int` })
      .from(decodedSignals).where(eq(decodedSignals.observationId, observationId)),
  ]);

  // ── Scrapes per platform ──
  const isFailedScrape = (e: typeof scrapeRows[number]) =>
    Boolean(e.failureReason) || Boolean(e.silentFailureDetected) || (e.httpStatus != null && e.httpStatus >= 400);
  const platformMap = new Map<string, RunDiagnostics["scrapes"]["byPlatform"][number]>();
  for (const e of scrapeRows) {
    const key = e.platform ?? "unknown";
    let entry = platformMap.get(key);
    if (!entry) {
      entry = { platform: key, attempts: 0, succeeded: 0, failed: 0, events: [] };
      platformMap.set(key, entry);
    }
    const failed = isFailedScrape(e);
    entry.attempts++;
    if (failed) entry.failed++; else entry.succeeded++;
    entry.events.push({
      method: e.scrapeMethod,
      url: e.urlRequested,
      httpStatus: e.httpStatus,
      failureReason: e.failureReason,
      silentFailure: Boolean(e.silentFailureDetected),
      durationMs: e.durationMs,
      at: e.createdAt,
    });
  }
  const byPlatform = Array.from(platformMap.values());
  const scrapesFailed = byPlatform.reduce((s, p) => s + p.failed, 0);

  // ── Scrape-failure consequences (Session 9): derived from which METHODS failed,
  // not hardcoded to any one run. Tells the analyst what a failure cost.
  const failedMethods = new Set<string>();
  for (const p of byPlatform) {
    for (const e of p.events) {
      if (e.failureReason || e.silentFailure || (e.httpStatus != null && e.httpStatus >= 400)) failedMethods.add(e.method);
    }
  }
  const fm = Array.from(failedMethods);
  const scrapeConsequences: string[] = [];
  if (fm.some(m => m.includes("search"))) {
    scrapeConsequences.push("Search-based video discovery failed — the captured pool is limited to the primary profile/API page, so coverage and any view-based averages (engagement, avg views) reflect that subset, not the whole channel.");
  }
  if (fm.some(m => m.includes("playwright") && !m.includes("search"))) {
    scrapeConsequences.push("A profile scrape failed or fell back to a lower-fidelity path — follower/bio/stat coverage may be degraded.");
  }
  if (fm.some(m => m === "tiktok_desktop_http" || m === "tiktok_mobile_http" || m === "tiktok_google_cache")) {
    scrapeConsequences.push("Some per-video page fetches failed — fewer transcripts than videos were sampled.");
  }
  if (fm.some(m => m.startsWith("instagram"))) {
    scrapeConsequences.push("An Instagram scrape failed — profile, posts, or reel transcription may be incomplete.");
  }
  if (fm.some(m => m.startsWith("youtube"))) {
    scrapeConsequences.push("A YouTube fetch failed — channel stats or captions may be incomplete.");
  }

  // ── Video funnel ──
  const byStatus: Record<string, number> = {};
  const transcriptSources: Record<string, number> = {};
  let withTranscript = 0;
  const temporalBuckets = new Set<string>();
  for (const ci of contentRows) {
    byStatus[ci.status] = (byStatus[ci.status] ?? 0) + 1;
    if (ci.transcriptText) {
      withTranscript++;
      const src = ci.transcriptSource ?? "unknown";
      transcriptSources[src] = (transcriptSources[src] ?? 0) + 1;
    }
    if (ci.temporalBucket) temporalBuckets.add(ci.temporalBucket);
  }

  // ── Coverage (Session 9): captured videos vs the channel's total ──
  // Derived stats (engagement, avg views) are computed over the CAPTURED subset,
  // so low coverage means those numbers describe a sample, not the channel.
  const channelVideoCount = creatorObsRows[0]?.videoCount ?? null;
  const coveragePct = channelVideoCount && channelVideoCount > 0
    ? Math.round((contentRows.length / channelVideoCount) * 1000) / 10
    : null;

  // ── LLM ──
  let inputTokens = 0, outputTokens = 0, llmFailed = 0;
  let model = "unknown";
  const byPurpose: Record<string, number> = {};
  const llmFailures: RunDiagnostics["llm"]["failures"] = [];
  const llmSettings: RunDiagnostics["llm"]["settings"] = [];
  for (const r of llmRows) {
    inputTokens += r.inputTokens ?? 0;
    outputTokens += r.outputTokens ?? 0;
    if (r.model) model = r.model;
    byPurpose[r.purpose] = (byPurpose[r.purpose] ?? 0) + 1;
    // Session 9: surface per-call temperature (null = provider default was used).
    llmSettings.push({ purpose: r.purpose, temperature: r.temperature ?? null });
    if (r.status === "failed") {
      llmFailed++;
      llmFailures.push({ purpose: r.purpose, errorMessage: r.errorMessage, durationMs: r.durationMs, at: r.createdAt });
    }
  }

  // ── Enrichment persistence outcomes ──
  // persistence_status may carry reserved, underscore-prefixed metadata keys
  // (Session 8: `_meta`) that are NOT enrichment components. Skip them in the
  // component loop and surface known ones (sociologicalFieldsProvenance) below.
  const rawStatus = obs.persistenceStatus as Record<string, unknown> | null;
  const raw: RunDiagnostics["enrichments"]["raw"] = rawStatus ? {} : null;
  const succeeded: string[] = [];
  const failedComponents: Array<{ component: string; reason: string | null }> = [];
  const skippedNoData: Array<{ component: string; reason: string | null }> = [];
  const skippedNotAttempted: Array<{ component: string; reason: string | null }> = [];
  let sociologicalFieldsProvenance: RunDiagnostics["sociologicalFieldsProvenance"] = null;
  let pool: RunDiagnostics["pool"] = null;
  if (rawStatus) {
    for (const [key, value] of Object.entries(rawStatus)) {
      if (key.startsWith("_")) {
        if (key === "_meta") {
          const meta = value as Record<string, unknown> | null;
          const p = meta?.sociologicalFieldsProvenance;
          if (p === "computed" || p === "estimated") sociologicalFieldsProvenance = p;
          const rejected = (meta?.pool as Record<string, unknown> | undefined)?.authorRejected;
          if (typeof rejected === "number") pool = { authorRejected: rejected };
        }
        continue; // reserved run metadata, not an enrichment component
      }
      const outcome = value as { status: string; reason: string | null; at: string };
      (raw as NonNullable<typeof raw>)[key] = outcome;
      if (outcome.status === "success") succeeded.push(key);
      else if (outcome.status === "failed") failedComponents.push({ component: key, reason: outcome.reason });
      else if (outcome.status === "skipped_no_data") skippedNoData.push({ component: key, reason: outcome.reason });
      else if (outcome.status === "skipped_not_attempted") skippedNotAttempted.push({ component: key, reason: outcome.reason });
    }
  }

  // ── Field presence (what extraction actually produced) ──
  const co = creatorObsRows[0];
  const signalCounts = Object.fromEntries(signalCountRows.map(r => [r.domain, r.count]));
  const decodedCount = decodedCountRows[0]?.count ?? 0;
  const fieldChecks: Array<[string, boolean]> = [
    ["bio", obs.bio != null && obs.bio !== ""],
    ["followerCount", obs.followerCount != null],
    ["followingCount", obs.followingCount != null],
    ["engagementRate", obs.engagementRate != null],
    ["archetype", co?.archetype != null],
    ["toneRegister", co?.toneRegister != null],
    ["barthesMyth", co?.barthesMyth != null],
    ["nicheTopicNode", co?.nicheTopicNode != null],
    ["aiSummary", co?.aiSummary != null],
    ["symbolicSummary", co?.symbolicSummary != null],
    ["contentThemes", (signalCounts["content_theme"] ?? 0) > 0],
    ["keywords", (signalCounts["keyword"] ?? 0) > 0],
    ["decodedSymbols", decodedCount > 0],
    ["longitudinalSample", temporalBuckets.size > 0],
  ];
  const present = fieldChecks.filter(([, ok]) => ok).map(([name]) => name);
  const missing = fieldChecks.filter(([, ok]) => !ok).map(([name]) => name);

  // ── Confidence rationale (Session 9): explains the EXISTING thresholds
  // (>=6 high, >=3 medium, else low) — it does NOT change them (Jason's ruling). ──
  const transcriptCount = obs.transcriptCount ?? 0;
  const confidenceLevel = obs.dataConfidenceLevel ?? null;
  const confidenceRationale =
    confidenceLevel === "high" ? `${transcriptCount} transcripts (>= 6) → high.`
    : confidenceLevel === "medium" ? `${transcriptCount} transcripts (3-5) → medium; 6+ needed for high.`
    : confidenceLevel === "low" ? `${transcriptCount} transcript${transcriptCount === 1 ? "" : "s"} (< 3) → low; 3+ needed for medium, 6+ for high.`
    : `confidence not recorded (${transcriptCount} transcripts).`;

  // ── Velocity rationale (Session 9): why the cultural-velocity label is what it is. ──
  const velocityValue = co?.culturalVelocity ?? null;
  const velocity = velocityValue
    ? (velocityValue !== "Insufficient Data"
        ? { value: velocityValue, rationale: `theme overlap across time buckets with transcripts: ${Array.from(temporalBuckets).join(", ") || "none"}.` }
        : (() => {
            const missingBuckets = ["recent", "mid", "anchor"].filter(b => !temporalBuckets.has(b));
            return { value: velocityValue, rationale: `requires speech in the recent bucket plus mid or anchor; buckets with transcripts: ${Array.from(temporalBuckets).join(", ") || "none"}${missingBuckets.length ? ` (empty: ${missingBuckets.join(", ")})` : ""}.` };
          })())
    : null;

  // ── Per-field provenance (Session 9): evidence-backed vs model-inferred, using
  // ONLY data already stored — signal_values (themes/keywords/hashtags),
  // decoded_signals (symbols), and persistence_status._meta (sociological). This
  // marks PROVENANCE, not quality. Fields with no backing signal are "inferred". ──
  const socioProv: "computed" | "estimated" = sociologicalFieldsProvenance ?? "estimated";
  const ev = (n: number): "evidence" | "inferred" => (n > 0 ? "evidence" : "inferred");
  const fieldProvenance: RunDiagnostics["fields"]["provenance"] = [
    { field: "bio", provenance: "scraped" },
    { field: "followerCount", provenance: "scraped" },
    { field: "followingCount", provenance: "scraped" },
    { field: "engagementRate", provenance: "derived" },
    { field: "contentThemes", provenance: ev(signalCounts["content_theme"] ?? 0) },
    { field: "recurringThemes", provenance: ev(signalCounts["theme"] ?? 0) },
    { field: "keywords", provenance: ev(signalCounts["keyword"] ?? 0) },
    { field: "hashtags", provenance: ev(signalCounts["hashtag"] ?? 0) },
    { field: "decodedSymbols", provenance: ev(decodedCount) },
    { field: "symbolicSummary", provenance: ev(decodedCount) },
    { field: "parasocialBondStrength", provenance: socioProv },
    { field: "audienceRelationshipType", provenance: socioProv },
    { field: "culturalCapital", provenance: socioProv },
    { field: "remixRate", provenance: socioProv },
    { field: "archetype", provenance: "inferred" },
    { field: "toneRegister", provenance: "inferred" },
    { field: "barthesMyth", provenance: "inferred" },
    { field: "nicheTopicNode", provenance: "inferred" },
    { field: "driftSignal", provenance: "inferred" },
    { field: "goffmanStageConsistency", provenance: "inferred" },
    { field: "stuartHallDecoding", provenance: "inferred" },
    { field: "rogersAdopterStage", provenance: "inferred" },
    { field: "creatorNichePosition", provenance: "inferred" },
    { field: "lifecyclePhase", provenance: "inferred" },
    { field: "turnerLiminalPhase", provenance: "inferred" },
    { field: "barthesNicheMeaning", provenance: "inferred" },
    { field: "aiSummary", provenance: "inferred" },
  ];

  // ── Plain factual summary ──
  const summary: string[] = [];
  if (raw) {
    const totalComponents = Object.keys(raw).length;
    summary.push(`${succeeded.length} of ${totalComponents} persistence components succeeded`);
    if (failedComponents.length > 0) {
      summary.push(`failed: ${failedComponents.map(f => f.component).join(", ")}`);
    }
  } else {
    summary.push("no persistence outcome map (observation predates womo_0005 tracking)");
  }
  for (const p of byPlatform) {
    if (p.failed > 0) {
      const firstFailure = p.events.find(e => e.failureReason || e.httpStatus != null && e.httpStatus >= 400);
      const reason = firstFailure?.httpStatus != null && firstFailure.httpStatus >= 400
        ? `HTTP ${firstFailure.httpStatus}`
        : firstFailure?.failureReason?.slice(0, 80) ?? "unknown reason";
      summary.push(`${p.platform}: ${p.failed} of ${p.attempts} scrapes failed (${reason})`);
    }
  }
  if (contentRows.length > 0) {
    summary.push(`${withTranscript} of ${contentRows.length} captured videos have transcripts`);
  } else {
    summary.push("no videos captured");
  }
  if (llmRows.length > 0) {
    summary.push(`${llmRows.length} LLM calls${llmFailed > 0 ? `, ${llmFailed} failed` : ", all succeeded"}`);
  } else {
    summary.push(runId ? "no LLM calls recorded for this run" : "LLM calls not linkable (observation predates run tagging)");
  }
  if (missing.length > 0) {
    summary.push(`missing fields: ${missing.join(", ")}`);
  }

  return {
    observationId,
    subjectId: obs.subjectId,
    runId,
    exactRunLinkage: runId != null,
    reviewStatus: obs.reviewStatus,
    observedAt: obs.observedAt,
    sociologicalFieldsProvenance,
    pool,
    confidence: { level: confidenceLevel, transcriptCount, rationale: confidenceRationale },
    velocity,
    scrapes: { total: scrapeRows.length, failed: scrapesFailed, consequences: scrapeConsequences, byPlatform },
    videos: {
      total: contentRows.length,
      byStatus,
      withTranscript,
      withoutTranscript: contentRows.length - withTranscript,
      transcriptSources,
      channelVideoCount,
      coveragePct,
    },
    llm: {
      calls: llmRows.length,
      failed: llmFailed,
      failures: llmFailures,
      byPurpose,
      settings: llmSettings,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      model,
      costUsd: computeLlmCostUsd(model, inputTokens, outputTokens),
    },
    enrichments: { raw, succeeded, failed: failedComponents, skippedNoData, skippedNotAttempted },
    fields: { present, missing, provenance: fieldProvenance, counts: {
      keywords: signalCounts["keyword"] ?? 0,
      contentThemes: signalCounts["content_theme"] ?? 0,
      hashtags: signalCounts["hashtag"] ?? 0,
      decodedSignals: decodedCount,
      contentItems: contentRows.length,
      transcripts: withTranscript,
      temporalBuckets: temporalBuckets.size,
    } },
    summary,
  };
}

/**
 * Get provenance data (LLM invocations + scrape events) for an observation.
 */
export async function getProvenance(observationId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [llmRows, scrapeRows, obsRow] = await Promise.all([
    db.select({
      purpose: llmInvocations.purpose,
      model: llmInvocations.model,
      inputTokens: llmInvocations.inputTokens,
      outputTokens: llmInvocations.outputTokens,
      durationMs: llmInvocations.durationMs,
      createdAt: llmInvocations.createdAt,
    })
      .from(llmInvocations)
      .where(eq(llmInvocations.observationId, observationId))
      .orderBy(desc(llmInvocations.createdAt)),
    db.select({
      platform: scrapeEvents.platform,
      scrapeMethod: scrapeEvents.scrapeMethod,
      urlRequested: scrapeEvents.urlRequested,
      httpStatus: scrapeEvents.httpStatus,
      responseSizeBytes: scrapeEvents.responseSizeBytes,
      silentFailureDetected: scrapeEvents.silentFailureDetected,
      failureReason: scrapeEvents.failureReason,
      durationMs: scrapeEvents.durationMs,
      createdAt: scrapeEvents.createdAt,
    })
      .from(scrapeEvents)
      .where(eq(scrapeEvents.observationId, observationId))
      .orderBy(desc(scrapeEvents.createdAt)),
    db.select({
      observedAt: observations.observedAt,
      dataConfidenceLevel: observations.dataConfidenceLevel,
    })
      .from(observations)
      .where(eq(observations.id, observationId))
      .limit(1),
  ]);

  return {
    llmCalls: llmRows,
    scrapeEvents: scrapeRows,
    analyzedAt: obsRow[0]?.observedAt ?? null,
    dataConfidenceLevel: obsRow[0]?.dataConfidenceLevel ?? null,
  };
}

export async function listCreatorProfiles(
  userId?: number,
  search?: string,
  opts?: {
    /** true = accepted only (matching eligibility); default lists accepted + pending */
    matchableOnly?: boolean;
  },
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const searchCondition = search
    ? and(
        eq(subjects.subjectType, "creator"),
        or(
          like(subjects.primaryHandle ?? '', `%${search}%`),
          like(subjects.displayName ?? '', `%${search}%`),
        ),
      )
    : eq(subjects.subjectType, "creator");

  // Review-gate eligibility (womo_0006): the default library view lists
  // accepted + pending (pending marked in the UI); declined runs never hold
  // is_latest and declined-only subjects have no is_latest row, so the INNER
  // join (was a left join) excludes them from default views. Archived runs
  // are browsable via listArchivedCreatorRuns. matchableOnly narrows to
  // accepted-only for creator-selection surfaces (matching eligibility).
  const baseCondition = opts?.matchableOnly
    ? and(searchCondition, eq(observations.reviewStatus, "accepted"))
    : and(searchCondition, ne(observations.reviewStatus, "declined"));

  const rows = await db.select()
    .from(subjects)
    .innerJoin(observations, and(eq(observations.subjectId, subjects.id), eq(observations.isLatest, true)))
    .leftJoin(creatorObservations, eq(creatorObservations.observationId, observations.id))
    .where(baseCondition)
    .orderBy(desc(subjects.createdAt))
    .limit(50);

  return rows.map(row => ({
    id: row.subjects.id,
    handle: row.subjects.primaryHandle,
    displayName: row.subjects.displayName,
    platform: row.subjects.primaryPlatform,
    archetype: row.creator_observations?.archetype ?? row.subjects.latestArchetype,
    engagementTier: row.subjects.engagementTier,
    createdAt: row.subjects.createdAt,
    // Review gate (womo_0006) — library must mark pending unmistakably
    reviewStatus: row.observations?.reviewStatus ?? null,
    observationId: row.observations?.id ?? null,
    runId: row.observations?.runId ?? null,
    // Fields accessed by Library.tsx rows
    nicheTopicNode: row.creator_observations?.nicheTopicNode ?? null,
    goffmanStageConsistency: row.creator_observations?.goffmanStageConsistency ?? null,
    aiSummary: row.creator_observations?.aiSummary ?? null,
    followerCount: row.observations?.followerCount ?? null,
    engagementRate: row.observations?.engagementRate ?? null,
    transcriptCount: row.observations?.transcriptCount ?? null,
    // Library row layout fields
    toneRegister: row.creator_observations?.toneRegister ?? null,
    driftSignal: row.creator_observations?.driftSignal ?? null,
    undergroundDensity: row.creator_observations?.undergroundDensity ?? null,
    mainstreamBleed: row.creator_observations?.mainstreamBleed ?? null,
    rogersAdopterStage: row.creator_observations?.rogersAdopterStage ?? null,
    turnerLiminalPhase: row.creator_observations?.turnerLiminalPhase ?? null,
    lifecyclePhase: row.creator_observations?.lifecyclePhase ?? null,
    culturalVelocity: row.creator_observations?.culturalVelocity ?? null,
    culturalCapital: row.creator_observations?.culturalCapital ?? null,
    primaryRegion: row.creator_observations?.primaryRegion ?? null,
    totalViews: row.creator_observations?.totalViews ?? null,
    avgViews: row.creator_observations?.avgViews ?? null,
    dataConfidenceLevel: row.observations?.dataConfidenceLevel ?? null,
  }));
}

export async function deleteCreatorProfile(subjectId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(subjects).where(eq(subjects.id, subjectId));
}

/**
 * Archived (declined) creator runs — retained with full provenance for
 * scraper-failure analysis, hidden from default views (womo_0006).
 */
export async function listArchivedCreatorRuns() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const rows = await db.select({
    observationId: observations.id,
    runId: observations.runId,
    observedAt: observations.observedAt,
    reviewedAt: observations.reviewedAt,
    reviewedBy: observations.reviewedBy,
    followerCount: observations.followerCount,
    dataConfidenceLevel: observations.dataConfidenceLevel,
    transcriptCount: observations.transcriptCount,
    subjectId: subjects.id,
    handle: subjects.primaryHandle,
    displayName: subjects.displayName,
    platform: subjects.primaryPlatform,
    archetype: creatorObservations.archetype,
  })
    .from(observations)
    .innerJoin(subjects, and(eq(subjects.id, observations.subjectId), eq(subjects.subjectType, "creator")))
    .leftJoin(creatorObservations, eq(creatorObservations.observationId, observations.id))
    .where(eq(observations.reviewStatus, "declined"))
    .orderBy(desc(observations.reviewedAt))
    .limit(100);

  return rows;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE B — BRAND PIPELINE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Insert one brand_observations row linked to an observation.
 */
export async function insertBrandObservation(
  observationId: string,
  data: {
    brandArchetypeClassification?: string | null;
    archetype?: string | null;
    emotionalPromise?: string | null;
    audienceTribe?: string | null;
    culturalTension?: string | null;
    brandTone?: string | null;
    barthesMyth?: string | null;
    brandCulturalCapital?: string | null;
    brandGoffmanConsistency?: string | null;
    brandDriftSignal?: string | null;
    brandHallDecoding?: string | null;
    brandRogersStage?: string | null;
    brandLiminalPhase?: string | null;
    brandLifecyclePhase?: string | null;
    brandBarthesNicheMeaning?: string | null;
    brandAudienceDecodingSplit?: boolean | null;
    weightAlpha?: number | null;
    weightBeta?: number | null;
    weightGamma?: number | null;
    weightPriority?: string | null;
    googleRating?: number | null;
    googleReviewCount?: number | null;
    googleReviewExcerpts?: string | null;
    yelpRating?: number | null;
    yelpReviewCount?: number | null;
    yelpReviewExcerpts?: string | null;
    overallRating?: number | null;
    totalReviews?: number | null;
    tiktokHandle?: string | null;
    tiktokFollowerCount?: number | null;
    tiktokEngagementRate?: number | null;
    mentionTotalCount?: number | null;
    mentionUniqueAuthors?: number | null;
    mentionSentiment?: string | null;
    mentionSentimentConfidence?: string | null;
    mentionAudienceSummary?: string | null;
    symbolicSummary?: string | null;
    aiSummary?: string | null;
    semanticWordCount?: number | null;
    crawledPagesCount?: number | null;
  },
  executor?: DbExecutor,
): Promise<string> {
  const db = executor ?? await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(brandObservations).values({
    observationId,
    brandArchetypeClassification: validateEnum(data.brandArchetypeClassification, VALID_BRAND_ARCHETYPES, "brandArchetypeClassification"),
    archetype: validateEnum(data.archetype, VALID_ARCHETYPES, "brandObservation.archetype"),
    emotionalPromise: data.emotionalPromise ?? null,
    audienceTribe: data.audienceTribe ?? null,
    culturalTension: data.culturalTension ?? null,
    brandTone: data.brandTone ?? null,
    barthesMyth: data.barthesMyth ?? null,
    brandCulturalCapital: validateEnum(data.brandCulturalCapital, VALID_CULTURAL_CAPITAL, "brandCulturalCapital"),
    brandGoffmanConsistency: validateEnum(data.brandGoffmanConsistency, VALID_GOFFMAN, "brandGoffmanConsistency"),
    brandDriftSignal: validateEnum(data.brandDriftSignal, VALID_DRIFT_SIGNALS, "brandDriftSignal"),
    brandHallDecoding: validateEnum(data.brandHallDecoding, VALID_HALL_DECODING, "brandHallDecoding"),
    brandRogersStage: validateEnum(data.brandRogersStage, VALID_ROGERS_STAGES, "brandRogersStage"),
    brandLiminalPhase: validateEnum(data.brandLiminalPhase, VALID_LIMINAL_PHASES, "brandLiminalPhase"),
    brandLifecyclePhase: validateEnum(data.brandLifecyclePhase, VALID_LIFECYCLE_PHASES, "brandLifecyclePhase"),
    brandBarthesNicheMeaning: data.brandBarthesNicheMeaning ?? null,
    brandAudienceDecodingSplit: data.brandAudienceDecodingSplit ?? null,
    weightAlpha: data.weightAlpha ?? null,
    weightBeta: data.weightBeta ?? null,
    weightGamma: data.weightGamma ?? null,
    weightPriority: data.weightPriority ?? null,
    googleRating: data.googleRating ?? null,
    googleReviewCount: data.googleReviewCount ?? null,
    googleReviewExcerpts: data.googleReviewExcerpts ?? null,
    yelpRating: data.yelpRating ?? null,
    yelpReviewCount: data.yelpReviewCount ?? null,
    yelpReviewExcerpts: data.yelpReviewExcerpts ?? null,
    overallRating: data.overallRating ?? null,
    totalReviews: data.totalReviews ?? null,
    tiktokHandle: data.tiktokHandle ?? null,
    tiktokFollowerCount: data.tiktokFollowerCount ?? null,
    tiktokEngagementRate: data.tiktokEngagementRate ?? null,
    mentionTotalCount: data.mentionTotalCount ?? null,
    mentionUniqueAuthors: data.mentionUniqueAuthors ?? null,
    mentionSentiment: validateEnum(data.mentionSentiment, VALID_SENTIMENT, "mentionSentiment"),
    mentionSentimentConfidence: validateEnum(data.mentionSentimentConfidence, VALID_CONFIDENCE_LEVELS, "mentionSentimentConfidence"),
    mentionAudienceSummary: data.mentionAudienceSummary ?? null,
    symbolicSummary: data.symbolicSummary ?? null,
    aiSummary: data.aiSummary ?? null,
    semanticWordCount: data.semanticWordCount ?? null,
    crawledPagesCount: data.crawledPagesCount ?? null,
  }).returning({ id: brandObservations.id });

  return result[0].id;
}

/**
 * Bulk insert audience_mentions rows.
 * Author handles are SHA-256 hashed before storage.
 */
export async function insertAudienceMentions(
  subjectId: string,
  observationId: string,
  mentions: Array<{
    platform?: string;
    mentionVideoId?: string;
    authorHandle?: string;
    caption?: string;
    sentiment?: string;
    viewCount?: number;
    likeCount?: number;
    commentCount?: number;
    shareCount?: number;
    saveCount?: number;
    musicTitle?: string;
    musicArtist?: string;
  }>,
): Promise<void> {
  if (mentions.length === 0) return;
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const rows: InsertAudienceMention[] = mentions.map(m => ({
    subjectId,
    observationId,
    platform: m.platform ? normalizePlatform(m.platform) : ("tiktok" as const),
    mentionVideoId: m.mentionVideoId ?? null,
    authorHandleHash: m.authorHandle ? hashHandle(m.authorHandle) : null,
    caption: m.caption ?? null,
    sentiment: validateEnum(m.sentiment, VALID_SENTIMENT, "audienceMention.sentiment"),
    viewCount: m.viewCount ?? null,
    likeCount: m.likeCount ?? null,
    commentCount: m.commentCount ?? null,
    shareCount: m.shareCount ?? null,
    saveCount: m.saveCount ?? null,
    musicTitle: m.musicTitle ?? null,
    musicArtist: m.musicArtist ?? null,
  }));

  for (let i = 0; i < rows.length; i += 500) {
    await db.insert(audienceMentions).values(rows.slice(i, i + 500));
  }
}

/**
 * Get a brand "profile" view by subject ID.
 */
export async function getBrandProfileById(subjectId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const rows = await db.select()
    .from(subjects)
    .innerJoin(observations, and(eq(observations.subjectId, subjects.id), eq(observations.isLatest, true)))
    .innerJoin(brandObservations, eq(brandObservations.observationId, observations.id))
    .where(eq(subjects.id, subjectId))
    .limit(1);

  if (rows.length === 0) return null;
  const row = rows[0];

  // Review-gate visibility (womo_0006) — same rule as getCreatorProfileById.
  // All brand observations are 'accepted' until Session 7 gates the brand
  // path, so this is currently a no-op; it keeps the visibility rule uniform.
  const visibleObservationIds = db.select({ id: observations.id })
    .from(observations)
    .where(and(
      eq(observations.subjectId, subjectId),
      or(eq(observations.reviewStatus, "accepted"), eq(observations.id, row.observations.id)),
    ));

  // ── Parallel subqueries for signal_values + decoded_signals (mirrors getCreatorProfileById) ──
  const [
    brandKeywordRows,
    brandThemeRows,
    brandVocabRows,
    brandVisualRows,
    mentionHashtagRows,
    mentionIdentityRows,
    mentionMusicTitleRows,
    mentionMusicArtistRows,
    decodedSignalRows,
    contentItemRows,
    igHandleRows,
  ] = await Promise.all([
    // Brand signal values
    db.select({ key: signalValues.signalKey })
      .from(signalValues)
      .where(and(eq(signalValues.subjectId, subjectId), eq(signalValues.domain, "keyword"), inArray(signalValues.observationId, visibleObservationIds)))
      .orderBy(signalValues.rank),
    db.select({ key: signalValues.signalKey })
      .from(signalValues)
      .where(and(eq(signalValues.subjectId, subjectId), eq(signalValues.domain, "content_theme"), inArray(signalValues.observationId, visibleObservationIds)))
      .orderBy(signalValues.rank),
    db.select({ key: signalValues.signalKey })
      .from(signalValues)
      .where(and(eq(signalValues.subjectId, subjectId), eq(signalValues.domain, "symbolic_vocabulary"), inArray(signalValues.observationId, visibleObservationIds)))
      .orderBy(signalValues.rank),
    db.select({ key: signalValues.signalKey })
      .from(signalValues)
      .where(and(eq(signalValues.subjectId, subjectId), eq(signalValues.domain, "visual_language"), inArray(signalValues.observationId, visibleObservationIds)))
      .orderBy(signalValues.rank),
    // Mention signal values
    db.select({ key: signalValues.signalKey })
      .from(signalValues)
      .where(and(eq(signalValues.subjectId, subjectId), eq(signalValues.domain, "hashtag"), inArray(signalValues.observationId, visibleObservationIds)))
      .orderBy(signalValues.rank),
    db.select({ key: signalValues.signalKey })
      .from(signalValues)
      .where(and(eq(signalValues.subjectId, subjectId), eq(signalValues.domain, "identity_claim"), inArray(signalValues.observationId, visibleObservationIds)))
      .orderBy(signalValues.rank),
    db.select({ key: signalValues.signalKey })
      .from(signalValues)
      .where(and(eq(signalValues.subjectId, subjectId), eq(signalValues.domain, "music_title"), inArray(signalValues.observationId, visibleObservationIds)))
      .orderBy(signalValues.rank),
    db.select({ key: signalValues.signalKey })
      .from(signalValues)
      .where(and(eq(signalValues.subjectId, subjectId), eq(signalValues.domain, "music_artist"), inArray(signalValues.observationId, visibleObservationIds)))
      .orderBy(signalValues.rank),
    // Decoded signals
    db.select({
      category: decodedSignals.category,
      phrase: decodedSignals.phrase,
      meaning: decodedSignals.meaning,
      informsFields: decodedSignals.informsFields,
    })
      .from(decodedSignals)
      .where(and(eq(decodedSignals.subjectId, subjectId), inArray(decodedSignals.observationId, visibleObservationIds))),
    // Content items (brand videos)
    db.select()
      .from(contentItems)
      .where(and(
        eq(contentItems.subjectId, subjectId),
        or(isNull(contentItems.observationId), inArray(contentItems.observationId, visibleObservationIds)),
      ))
      .orderBy(desc(contentItems.viewCount)),
    // Instagram platform handle
    db.select({ handle: platformHandles.handle, profileUrl: platformHandles.profileUrl })
      .from(platformHandles)
      .where(and(
        eq(platformHandles.subjectId, subjectId),
        eq(platformHandles.platform, "instagram"),
      ))
      .limit(1),
  ]);

  // ── Assemble decoded symbols into structured object ──
  const brandDecodedSymbolsObj: {
    identityClaims: { phrase: string; meaning: string; informs: string[] }[];
    statusSignals: { phrase: string; meaning: string; informs: string[] }[];
    communityReferences: { phrase: string; meaning: string; informs: string[] }[];
    aspirationDrivers: { phrase: string; meaning: string; informs: string[] }[];
    symbolicSummary: string;
  } = {
    identityClaims: [],
    statusSignals: [],
    communityReferences: [],
    aspirationDrivers: [],
    symbolicSummary: row.brand_observations.symbolicSummary ?? "",
  };
  for (const sig of decodedSignalRows) {
    const entry = { phrase: sig.phrase, meaning: sig.meaning, informs: sig.informsFields ?? [] };
    switch (sig.category) {
      case "identity_claim": brandDecodedSymbolsObj.identityClaims.push(entry); break;
      case "status_signal": brandDecodedSymbolsObj.statusSignals.push(entry); break;
      case "community_reference": brandDecodedSymbolsObj.communityReferences.push(entry); break;
      case "aspiration_driver": brandDecodedSymbolsObj.aspirationDrivers.push(entry); break;
    }
  }
  const hasDecodedSignals = decodedSignalRows.length > 0;

  // ── Assemble brand video transcripts from content_items ──
  const brandVideoTranscriptsArr = contentItemRows
    .filter(ci => ci.transcriptText)
    .map(ci => ({
      videoId: ci.platformVideoId ?? "",
      caption: ci.caption ?? "",
      transcriptText: ci.transcriptText!,
      wordCount: ci.transcriptWordCount ?? 0,
    }));

  return {
    id: row.subjects.id,
    observationId: row.observations.id,
    brandName: row.subjects.displayName ?? "",
    brandUrl: row.subjects.websiteUrl ?? "",
    category: row.subjects.brandCategory ?? "",
    brandType: row.subjects.brandType ?? "",
    // From brand_observations
    archetype: row.brand_observations.archetype,
    brandArchetypeClassification: row.brand_observations.brandArchetypeClassification,
    emotionalPromise: row.brand_observations.emotionalPromise,
    audienceTribe: row.brand_observations.audienceTribe,
    culturalTension: row.brand_observations.culturalTension,
    barthesMyth: row.brand_observations.barthesMyth,
    brandTone: row.brand_observations.brandTone,
    campaignType: row.subjects.campaignType,
    // Brand-side framework
    brandCulturalCapital: row.brand_observations.brandCulturalCapital,
    brandGoffmanStageConsistency: row.brand_observations.brandGoffmanConsistency,
    brandDriftSignal: row.brand_observations.brandDriftSignal,
    brandStuartHallDecoding: row.brand_observations.brandHallDecoding,
    brandRogersAdopterStage: row.brand_observations.brandRogersStage,
    brandTurnerLiminalPhase: row.brand_observations.brandLiminalPhase,
    brandLifecyclePhase: row.brand_observations.brandLifecyclePhase,
    brandBarthesNicheMeaning: row.brand_observations.brandBarthesNicheMeaning,
    brandAudienceDecodingSplit: row.brand_observations.brandAudienceDecodingSplit,
    // Weights
    weightAlpha: row.brand_observations.weightAlpha,
    weightBeta: row.brand_observations.weightBeta,
    weightGamma: row.brand_observations.weightGamma,
    weightPriority: row.brand_observations.weightPriority,
    // Reviews
    yelpRating: row.brand_observations.yelpRating,
    yelpReviewCount: row.brand_observations.yelpReviewCount,
    googleRating: row.brand_observations.googleRating,
    googleReviewCount: row.brand_observations.googleReviewCount,
    overallRating: row.brand_observations.overallRating,
    totalReviews: row.brand_observations.totalReviews,
    // TikTok
    tiktokChannelUrl: row.brand_observations.tiktokHandle ? `https://www.tiktok.com/@${row.brand_observations.tiktokHandle}` : null,
    tiktokEngagementRate: row.brand_observations.tiktokEngagementRate,
    tiktokAudienceSize: row.brand_observations.tiktokFollowerCount,
    tiktokMetadata: null as Record<string, unknown> | null,
    // Mentions — now populated from signal_values
    mentionSentiment: row.brand_observations.mentionSentiment,
    mentionSentimentConfidence: row.brand_observations.mentionSentimentConfidence,
    mentionHashtagCloud: mentionHashtagRows.length > 0 ? mentionHashtagRows.map(r => r.key) : null,
    mentionRawKeywords: mentionIdentityRows.length > 0 ? mentionIdentityRows.map(r => r.key) : null,
    mentionMusicSignals: mentionMusicTitleRows.length > 0 ? mentionMusicTitleRows.map(r => r.key) : null,
    mentionMusicArtists: mentionMusicArtistRows.length > 0 ? mentionMusicArtistRows.map(r => r.key) : null,
    mentionTotalCount: row.brand_observations.mentionTotalCount,
    mentionUniqueAuthors: row.brand_observations.mentionUniqueAuthors,
    mentionAudienceSummary: row.brand_observations.mentionAudienceSummary,
    // Symbols — now populated from signal_values + decoded_signals
    brandRawKeywords: brandKeywordRows.length > 0 ? brandKeywordRows.map(r => r.key) : null,
    brandThemeLabels: brandThemeRows.length > 0 ? brandThemeRows.map(r => r.key) : null,
    brandSymbolicVocabulary: brandVocabRows.length > 0 ? brandVocabRows.map(r => r.key) : null,
    brandDecodedSymbols: hasDecodedSignals ? brandDecodedSymbolsObj : null,
    // V1 compat fields — now populated from signal_values + content_items
    visualLanguage: brandVisualRows.length > 0 ? brandVisualRows.map(r => r.key).join(", ") : null,
    yelpReviewExcerpts: row.brand_observations.yelpReviewExcerpts ?? null,
    googleReviewExcerpts: row.brand_observations.googleReviewExcerpts ?? null,
    brandVideoTranscripts: brandVideoTranscriptsArr.length > 0 ? brandVideoTranscriptsArr : null,
    // Summaries
    aiSummary: row.brand_observations.aiSummary,
    // Audit columns (P1-5, I8)
    semanticWordCount: row.brand_observations.semanticWordCount ?? null,
    crawledPagesCount: row.brand_observations.crawledPagesCount ?? null,
    // Timestamps
    createdAt: row.observations.createdAt,
    updatedAt: row.subjects.updatedAt,
    // Instagram (from platform_handles)
    instagramHandle: igHandleRows[0]?.handle ?? null,
    instagramProfileUrl: igHandleRows[0]?.profileUrl ?? null,
  };
}

export async function listBrandProfiles(userId?: number, search?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const baseCondition = search
    ? and(
        eq(subjects.subjectType, "brand"),
        like(subjects.displayName ?? '', `%${search}%`),
      )
    : eq(subjects.subjectType, "brand");

  const rows = await db.select()
    .from(subjects)
    .leftJoin(observations, and(eq(observations.subjectId, subjects.id), eq(observations.isLatest, true)))
    .leftJoin(brandObservations, eq(brandObservations.observationId, observations.id))
    .where(baseCondition)
    .orderBy(desc(subjects.createdAt))
    .limit(50);

  return rows.map(row => ({
    id: row.subjects.id,
    brandName: row.subjects.displayName,
    brandType: row.subjects.brandType,
    latestArchetype: row.subjects.latestArchetype,
    createdAt: row.subjects.createdAt,
    // Fields accessed by Library.tsx rows
    archetype: row.brand_observations?.archetype ?? row.subjects.latestArchetype,
    category: row.subjects.brandCategory ?? null,
    weightPriority: row.brand_observations?.weightPriority ?? null,
    aiSummary: row.brand_observations?.aiSummary ?? null,
    campaignType: row.subjects.campaignType ?? null,
    overallRating: row.brand_observations?.overallRating ?? null,
    mentionSentiment: row.brand_observations?.mentionSentiment ?? null,
    // Library row layout fields
    emotionalPromise: row.brand_observations?.emotionalPromise ?? null,
    audienceTribe: row.brand_observations?.audienceTribe ?? null,
    brandTone: row.brand_observations?.brandTone ?? null,
    brandCulturalCapital: row.brand_observations?.brandCulturalCapital ?? null,
    brandGoffmanConsistency: row.brand_observations?.brandGoffmanConsistency ?? null,
    brandDriftSignal: row.brand_observations?.brandDriftSignal ?? null,
    googleRating: row.brand_observations?.googleRating ?? null,
    yelpRating: row.brand_observations?.yelpRating ?? null,
    totalReviews: row.brand_observations?.totalReviews ?? null,
    tiktokFollowerCount: row.brand_observations?.tiktokFollowerCount ?? null,
    tiktokEngagementRate: row.brand_observations?.tiktokEngagementRate ?? null,
    mentionTotalCount: row.brand_observations?.mentionTotalCount ?? null,
    mentionSentimentConfidence: row.brand_observations?.mentionSentimentConfidence ?? null,
    brandUrl: row.subjects.websiteUrl ?? null,
    dataConfidenceLevel: row.observations?.dataConfidenceLevel ?? null,
  }));
}

export async function deleteBrandProfile(subjectId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(subjects).where(eq(subjects.id, subjectId));
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE C — MATCH PIPELINE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Insert one match_scores row.
 */
export async function insertMatchScore(data: {
  creatorSubjectId: string;
  brandSubjectId: string;
  creatorObservationId?: string;
  brandObservationId?: string;
  alignmentScoreRaw?: number;
  pulseScoreRaw?: number;
  stabilityScoreRaw?: number;
  archetypeMatchScore?: number;
  mythAlignmentScore?: number;
  tribMatchScore?: number;
  decodingModifier?: number;
  rogersBaseScore?: number;
  liminalAdjustment?: number;
  goffmanScore?: number;
  driftScore?: number;
  weightAlpha?: number;
  weightBeta?: number;
  weightGamma?: number;
  fitScore?: number;
  fitStatus?: string;
  parrScore?: number;
  parrLabel?: string;
  parrTribeOverlap?: number;
  parrDecodingAcceptance?: number;
  parrArchetypeResonance?: number;
  parrSymbolicOverlap?: number;
  parrPersonaConsistency?: number;
  symbolicOverlapScore?: number;
  qovScore?: number;
  creativeIntegritySignal?: number;
  creativeIntegrityConfidence?: string;
  performanceConsistencySignal?: number;
  performanceConsistencyConfidence?: string;
  communityQualitySignal?: number;
  communityQualityConfidence?: string;
  audienceReceptivitySignal?: number;
  audienceReceptivityConfidence?: string;
  brandTrustSignal?: number;
  brandTrustConfidence?: string;
  musicOverlapStrength?: string;
  mentionSentimentPenalty?: number;
  mentionVocabBoost?: number;
  culturalVelocity?: string;
  dataConfidenceLevel?: string;
}): Promise<string> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(matchScores).values({
    creatorSubjectId: data.creatorSubjectId,
    brandSubjectId: data.brandSubjectId,
    creatorObservationId: data.creatorObservationId ?? null,
    brandObservationId: data.brandObservationId ?? null,
    alignmentScoreRaw: data.alignmentScoreRaw ?? null,
    pulseScoreRaw: data.pulseScoreRaw ?? null,
    stabilityScoreRaw: data.stabilityScoreRaw ?? null,
    archetypeMatchScore: data.archetypeMatchScore ?? null,
    mythAlignmentScore: data.mythAlignmentScore ?? null,
    tribMatchScore: data.tribMatchScore ?? null,
    decodingModifier: data.decodingModifier ?? null,
    rogersBaseScore: data.rogersBaseScore ?? null,
    liminalAdjustment: data.liminalAdjustment ?? null,
    goffmanScore: data.goffmanScore ?? null,
    driftScore: data.driftScore ?? null,
    weightAlpha: data.weightAlpha ?? null,
    weightBeta: data.weightBeta ?? null,
    weightGamma: data.weightGamma ?? null,
    fitScore: data.fitScore ?? null,
    fitStatus: validateEnum(data.fitStatus, VALID_FIT_STATUS, "fitStatus"),
    parrScore: data.parrScore ?? null,
    parrLabel: data.parrLabel ?? null,
    parrTribeOverlap: data.parrTribeOverlap ?? null,
    parrDecodingAcceptance: data.parrDecodingAcceptance ?? null,
    parrArchetypeResonance: data.parrArchetypeResonance ?? null,
    parrSymbolicOverlap: data.parrSymbolicOverlap ?? null,
    parrPersonaConsistency: data.parrPersonaConsistency ?? null,
    symbolicOverlapScore: data.symbolicOverlapScore ?? null,
    qovScore: data.qovScore ?? null,
    creativeIntegritySignal: data.creativeIntegritySignal ?? null,
    creativeIntegrityConfidence: validateEnum(data.creativeIntegrityConfidence, VALID_SIGNAL_CONFIDENCE, "creativeIntegrityConfidence"),
    performanceConsistencySignal: data.performanceConsistencySignal ?? null,
    performanceConsistencyConfidence: validateEnum(data.performanceConsistencyConfidence, VALID_SIGNAL_CONFIDENCE, "performanceConsistencyConfidence"),
    communityQualitySignal: data.communityQualitySignal ?? null,
    communityQualityConfidence: validateEnum(data.communityQualityConfidence, VALID_SIGNAL_CONFIDENCE, "communityQualityConfidence"),
    audienceReceptivitySignal: data.audienceReceptivitySignal ?? null,
    audienceReceptivityConfidence: validateEnum(data.audienceReceptivityConfidence, VALID_SIGNAL_CONFIDENCE, "audienceReceptivityConfidence"),
    brandTrustSignal: data.brandTrustSignal ?? null,
    brandTrustConfidence: validateEnum(data.brandTrustConfidence, VALID_SIGNAL_CONFIDENCE, "brandTrustConfidence"),
    musicOverlapStrength: data.musicOverlapStrength ?? null,
    mentionSentimentPenalty: data.mentionSentimentPenalty ?? null,
    mentionVocabBoost: data.mentionVocabBoost ?? null,
    culturalVelocity: validateEnum(data.culturalVelocity, VALID_CULTURAL_VELOCITY, "matchScore.culturalVelocity"),
    dataConfidenceLevel: validateEnum(data.dataConfidenceLevel, VALID_CONFIDENCE_LEVELS, "matchScore.dataConfidenceLevel"),
  }).returning({ id: matchScores.id });

  return result[0].id;
}

/**
 * Insert one match_narratives row.
 */
export async function insertMatchNarrative(
  matchScoreId: string,
  data: {
    narrativeSummary?: string;
    alignmentNarrative?: string;
    synergyNarrative?: string;
    culturalBorrowingSummary?: string;
    archetypeAnalysis?: string;
    mythAlignment?: string;
    audienceOverlap?: string;
    culturalMomentum?: string;
    identityStability?: string;
    recommendation?: string;
  },
): Promise<string> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(matchNarratives).values({
    matchScoreId,
    narrativeSummary: data.narrativeSummary ?? null,
    alignmentNarrative: data.alignmentNarrative ?? null,
    synergyNarrative: data.synergyNarrative ?? null,
    culturalBorrowingSummary: data.culturalBorrowingSummary ?? null,
    archetypeAnalysis: data.archetypeAnalysis ?? null,
    mythAlignment: data.mythAlignment ?? null,
    audienceOverlap: data.audienceOverlap ?? null,
    culturalMomentum: data.culturalMomentum ?? null,
    identityStability: data.identityStability ?? null,
    recommendation: data.recommendation ?? null,
  }).returning({ id: matchNarratives.id });

  return result[0].id;
}

/**
 * Bulk insert match_warnings rows.
 */
export async function insertMatchWarnings(
  matchScoreId: string,
  warnings: string[],
): Promise<void> {
  if (warnings.length === 0) return;
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.insert(matchWarnings).values(
    warnings.map(w => ({
      matchScoreId,
      warningType: validateEnum(w, VALID_WARNING_TYPES, "warningType") ?? "Low Alignment",
    })),
  );
}

/**
 * Bulk insert match_overlaps rows.
 */
export async function insertMatchOverlaps(
  matchScoreId: string,
  overlaps: Array<{ domain: string; value: string }>,
): Promise<void> {
  if (overlaps.length === 0) return;
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.insert(matchOverlaps).values(
    overlaps.map(o => ({
      matchScoreId,
      domain: validateEnum(o.domain, VALID_OVERLAP_DOMAINS, "matchOverlap.domain") ?? "keyword",
      value: o.value,
    })),
  );
}

/**
 * Bulk insert match_content_directions rows.
 */
export async function insertMatchContentDirections(
  matchScoreId: string,
  directions: Array<{ title: string; rationale: string; exampleAngle: string }>,
): Promise<void> {
  if (directions.length === 0) return;
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.insert(matchContentDirections).values(
    directions.map((d, i) => ({
      matchScoreId,
      title: d.title,
      rationale: d.rationale,
      exampleAngle: d.exampleAngle,
      rank: i + 1,
    })),
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE C — READ FUNCTIONS (Match)
// ═══════════════════════════════════════════════════════════════════════════════

export async function listMatchRecords(userId?: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // I4: Rewritten as a single JOIN query (was 150 DB round-trips via N+1).
  // Join subjects twice (aliased) to get creator handle + brand name in one query.
  const rows = await db.select({
    match: matchScores,
    creatorHandle: subjects.primaryHandle,
    creatorDisplayName: subjects.displayName,
  })
    .from(matchScores)
    .innerJoin(subjects, eq(subjects.id, matchScores.creatorSubjectId))
    .orderBy(desc(matchScores.createdAt))
    .limit(50);

  // We need brand names too — single batch query for all brand IDs
  const brandIds = Array.from(new Set(rows.map(r => r.match.brandSubjectId)));
  const brandRows = brandIds.length > 0
    ? await db.select({ id: subjects.id, brandName: subjects.displayName })
        .from(subjects)
        .where(or(...brandIds.map(id => eq(subjects.id, id))))
    : [];
  const brandMap = new Map(brandRows.map(b => [b.id, b.brandName]));

  // Batch-fetch all warnings for the 50 matches
  const matchIds = rows.map(r => r.match.id);
  const allWarnings = matchIds.length > 0
    ? await db.select().from(matchWarnings)
        .where(or(...matchIds.map(id => eq(matchWarnings.matchScoreId, id))))
    : [];
  const warningMap = new Map<string, string[]>();
  for (const w of allWarnings) {
    const existing = warningMap.get(w.matchScoreId) ?? [];
    existing.push(w.warningType);
    warningMap.set(w.matchScoreId, existing);
  }

  return rows.map(row => ({
    ...row.match,
    id: row.match.id,
    caiScore: row.match.fitScore,
    caiStatus: row.match.fitStatus,
    creatorProfileId: row.match.creatorSubjectId,
    brandProfileId: row.match.brandSubjectId,
    creatorHandle: row.creatorHandle ?? null,
    creatorDisplayName: row.creatorDisplayName ?? null,
    brandName: brandMap.get(row.match.brandSubjectId) ?? null,
    radarWarnings: warningMap.get(row.match.id) ?? [],
  }));
}

export async function deleteMatchRecord(matchId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(matchScores).where(eq(matchScores.id, matchId));
}

export async function getMatchWithProfiles(matchId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [match] = await db.select().from(matchScores).where(eq(matchScores.id, matchId)).limit(1);
  if (!match) return null;

  const creator = await getCreatorProfileById(match.creatorSubjectId);
  const brand = await getBrandProfileById(match.brandSubjectId);

  // Also fetch narrative
  const [narrative] = await db.select().from(matchNarratives)
    .where(eq(matchNarratives.matchScoreId, matchId)).limit(1);

  // Fetch warnings
  const warningRows = await db.select().from(matchWarnings)
    .where(eq(matchWarnings.matchScoreId, matchId));

  // Fetch overlaps
  const overlapRows = await db.select().from(matchOverlaps)
    .where(eq(matchOverlaps.matchScoreId, matchId));

  // Fetch content directions
  const directionRows = await db.select().from(matchContentDirections)
    .where(eq(matchContentDirections.matchScoreId, matchId))
    .orderBy(matchContentDirections.rank);

  // Build V1-compat overlap arrays
  const sharedKeywords = overlapRows.filter(o => o.domain === "keyword").map(o => o.value);
  const sharedThemes = overlapRows.filter(o => o.domain === "theme").map(o => o.value);

  return {
    match: {
      ...match,
      caiScore: match.fitScore,
      caiStatus: match.fitStatus,
      creatorProfileId: match.creatorSubjectId,
      brandProfileId: match.brandSubjectId,
      narrativeSummary: narrative?.narrativeSummary ?? null,
      synergyNarrative: narrative?.synergyNarrative ?? null,
      culturalBorrowingSummary: narrative?.culturalBorrowingSummary ?? null,
      alignmentNarrative: narrative?.alignmentNarrative ?? null,
      radarWarnings: warningRows.map(w => w.warningType),
      // V1 compat: overlaps and content directions
      sharedKeywords,
      sharedThemes,
      // P2-3: Reconstruct music overlap from overlaps table
      musicOverlap: {
        sharedTitles: overlapRows.filter(o => o.domain === "music_title").map(o => o.value),
        sharedArtists: overlapRows.filter(o => o.domain === "music_artist").map(o => o.value),
        overlapStrength: (match.musicOverlapStrength as "strong" | "moderate" | "none" | null) ?? "none",
      },
      contentDirections: directionRows.map(d => ({
        title: d.title,
        rationale: d.rationale,
        exampleAngle: d.exampleAngle,
      })),
      // PARR signal breakdown (reconstructed from stored fields)
      parrSignalBreakdown: {
        tribeOverlap: match.parrTribeOverlap,
        decodingAcceptance: match.parrDecodingAcceptance,
        archetypeResonance: match.parrArchetypeResonance,
        symbolicOverlap: match.parrSymbolicOverlap,
        personaConsistency: match.parrPersonaConsistency,
      },
      alignmentNotes: narrative ? {
        archetypeAnalysis: narrative.archetypeAnalysis,
        mythAlignment: narrative.mythAlignment,
        audienceOverlap: narrative.audienceOverlap,
        culturalMomentum: narrative.culturalMomentum,
        identityStability: narrative.identityStability,
        recommendation: narrative.recommendation,
      } : null,
    },
    creator,
    brand,
  };
}

export async function getComparablePartnerships(input: {
  excludeMatchId: string;
  brandType?: string | null;
  brandArchetypeClassification?: string | null;
  creatorArchetype?: string | null;
  creatorNicheTopicNode?: string | null;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // I5: Rewritten as a JOIN query instead of N+1 (was 1200+ DB round-trips).
  // We only need a handful of fields for similarity scoring — no need for full profile loads.
  const allMatches = await db.select({
    match: matchScores,
    // Creator fields needed for similarity scoring
    creatorHandle: subjects.primaryHandle,
    creatorDisplayName: subjects.displayName,
    creatorLatestArchetype: subjects.latestArchetype,
  })
    .from(matchScores)
    .innerJoin(subjects, eq(subjects.id, matchScores.creatorSubjectId))
    .where(ne(matchScores.id, input.excludeMatchId))
    .orderBy(desc(matchScores.fitScore))
    .limit(100);

  if (allMatches.length === 0) return [];

  // Batch-fetch brand subject data for all matches
  const brandIds = Array.from(new Set(allMatches.map(r => r.match.brandSubjectId)));
  const brandSubjectRows = brandIds.length > 0
    ? await db.select({
        id: subjects.id,
        brandName: subjects.displayName,
        brandType: subjects.brandType,
        latestBrandArchetype: subjects.latestBrandArchetype,
      })
        .from(subjects)
        .where(or(...brandIds.map(id => eq(subjects.id, id))))
    : [];
  const brandMap = new Map(brandSubjectRows.map(b => [b.id, b]));

  // Batch-fetch creator_observations for archetype + niche (only needed fields)
  const creatorIds = Array.from(new Set(allMatches.map(r => r.match.creatorSubjectId)));
  const creatorObsRows = creatorIds.length > 0
    ? await db.select({
        subjectId: observations.subjectId,
        archetype: creatorObservations.archetype,
        nicheTopicNode: creatorObservations.nicheTopicNode,
      })
        .from(observations)
        .innerJoin(creatorObservations, eq(creatorObservations.observationId, observations.id))
        .where(and(
          eq(observations.isLatest, true),
          or(...creatorIds.map(id => eq(observations.subjectId, id))),
        ))
    : [];
  const creatorObsMap = new Map(creatorObsRows.map(c => [c.subjectId, c]));

  // Batch-fetch brand_observations for brand archetype classification
  const brandObsRows = brandIds.length > 0
    ? await db.select({
        subjectId: observations.subjectId,
        brandArchetypeClassification: brandObservations.brandArchetypeClassification,
      })
        .from(observations)
        .innerJoin(brandObservations, eq(brandObservations.observationId, observations.id))
        .where(and(
          eq(observations.isLatest, true),
          or(...brandIds.map(id => eq(observations.subjectId, id))),
        ))
    : [];
  const brandObsMap = new Map(brandObsRows.map(b => [b.subjectId, b]));

  const scored = allMatches
    .map(({ match, creatorHandle, creatorDisplayName }) => {
      const brand = brandMap.get(match.brandSubjectId);
      const creatorObs = creatorObsMap.get(match.creatorSubjectId);
      const brandObs = brandObsMap.get(match.brandSubjectId);

      if (!brand) return null;

      let similarityScore = 0;
      if (input.brandType && brand.brandType === input.brandType) similarityScore += 2;
      if (input.brandArchetypeClassification && brandObs?.brandArchetypeClassification === input.brandArchetypeClassification) similarityScore += 1;
      if (input.creatorArchetype && creatorObs?.archetype === input.creatorArchetype) similarityScore += 2;
      if (input.creatorNicheTopicNode && creatorObs?.nicheTopicNode === input.creatorNicheTopicNode) similarityScore += 1;

      if (similarityScore === 0) return null;

      return {
        match: {
          ...match,
          caiScore: match.fitScore,
          caiStatus: match.fitStatus,
        },
        creator: {
          id: match.creatorSubjectId,
          handle: creatorHandle,
          displayName: creatorDisplayName,
          archetype: creatorObs?.archetype ?? null,
          nicheTopicNode: creatorObs?.nicheTopicNode ?? null,
        },
        brand: {
          id: match.brandSubjectId,
          brandName: brand.brandName,
          brandType: brand.brandType,
          brandArchetypeClassification: brandObs?.brandArchetypeClassification ?? null,
        },
        similarityScore,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => b.similarityScore - a.similarityScore || (b.match.fitScore ?? 0) - (a.match.fitScore ?? 0));

  return scored.slice(0, 5);
}
