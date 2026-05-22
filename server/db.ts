import { eq, desc, like, or, ne, and } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, users, creatorProfiles, brandProfiles, matchRecords, InsertCreatorProfile, InsertBrandProfile, InsertMatchRecord } from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) { console.warn("[Database] Cannot upsert user: database not available"); return; }
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
    await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
  } catch (error) { console.error("[Database] Failed to upsert user:", error); throw error; }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ─── Creator Profiles ─────────────────────────────────────────────────────────

export async function createCreatorProfile(data: InsertCreatorProfile) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(creatorProfiles).values(data);
  return result;
}

export async function getCreatorProfileById(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.select().from(creatorProfiles).where(eq(creatorProfiles.id, id)).limit(1);
  return result[0] ?? null;
}

export async function listCreatorProfiles(userId?: number, search?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  let query = db.select().from(creatorProfiles).orderBy(desc(creatorProfiles.createdAt));
  if (search) {
    return db.select().from(creatorProfiles)
      .where(or(like(creatorProfiles.handle, `%${search}%`), like(creatorProfiles.displayName ?? '', `%${search}%`)))
      .orderBy(desc(creatorProfiles.createdAt))
      .limit(50);
  }
  return query.limit(50);
}

export async function deleteCreatorProfile(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(creatorProfiles).where(eq(creatorProfiles.id, id));
}

export async function updateCreatorProfile(id: number, data: Partial<InsertCreatorProfile>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(creatorProfiles).set(data).where(eq(creatorProfiles.id, id));
}

// ─── Brand Profiles ───────────────────────────────────────────────────────────

export async function createBrandProfile(data: InsertBrandProfile) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(brandProfiles).values(data);
  return result;
}

export async function getBrandProfileById(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.select().from(brandProfiles).where(eq(brandProfiles.id, id)).limit(1);
  return result[0] ?? null;
}

export async function listBrandProfiles(userId?: number, search?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (search) {
    return db.select().from(brandProfiles)
      .where(like(brandProfiles.brandName, `%${search}%`))
      .orderBy(desc(brandProfiles.createdAt))
      .limit(50);
  }
  return db.select().from(brandProfiles).orderBy(desc(brandProfiles.createdAt)).limit(50);
}

export async function deleteBrandProfile(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(brandProfiles).where(eq(brandProfiles.id, id));
}

// ─── Match Records ────────────────────────────────────────────────────────────

export async function createMatchRecord(data: InsertMatchRecord) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(matchRecords).values(data);
  return result;
}

export async function getMatchRecordById(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.select().from(matchRecords).where(eq(matchRecords.id, id)).limit(1);
  return result[0] ?? null;
}

export async function listMatchRecords(userId?: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db.select().from(matchRecords).orderBy(desc(matchRecords.createdAt)).limit(50);
  // Enrich each match with creator handle and brand name via individual lookups
  const enriched = await Promise.all(rows.map(async (match) => {
    const [creator] = await db.select({ handle: creatorProfiles.handle, displayName: creatorProfiles.displayName })
      .from(creatorProfiles).where(eq(creatorProfiles.id, match.creatorProfileId)).limit(1);
    const [brand] = await db.select({ brandName: brandProfiles.brandName })
      .from(brandProfiles).where(eq(brandProfiles.id, match.brandProfileId)).limit(1);
    return {
      ...match,
      creatorHandle: creator?.handle ?? null,
      creatorDisplayName: creator?.displayName ?? null,
      brandName: brand?.brandName ?? null,
    };
  }));
  return enriched;
}

export async function deleteMatchRecord(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(matchRecords).where(eq(matchRecords.id, id));
}

export async function getMatchWithProfiles(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const match = await getMatchRecordById(id);
  if (!match) return null;
  const creator = await getCreatorProfileById(match.creatorProfileId);
  const brand = await getBrandProfileById(match.brandProfileId);
  return { match, creator, brand };
}

/**
 * Returns up to 5 comparable partnerships from the database that share:
 * - the same brand type OR brand archetype classification, OR
 * - the same creator niche/archetype
 * Ordered by fitScore descending. Excludes the current match.
 */
export async function getComparablePartnerships(input: {
  excludeMatchId: number;
  brandType?: string | null;
  brandArchetypeClassification?: string | null;
  creatorArchetype?: string | null;
  creatorNicheTopicNode?: string | null;
}) {
  const db = await getDb();
  if (!db) return [];

  // Fetch all recent matches (excluding current), then filter in-memory
  // This avoids complex OR queries across joined tables while keeping the helper simple
  const allMatches = await db
    .select()
    .from(matchRecords)
    .where(ne(matchRecords.id, input.excludeMatchId))
    .orderBy(desc(matchRecords.fitScore))
    .limit(100);

  if (allMatches.length === 0) return [];

  // Enrich with creator + brand profiles
  const enriched = await Promise.all(
    allMatches.map(async (match) => {
      const creator = await getCreatorProfileById(match.creatorProfileId);
      const brand = await getBrandProfileById(match.brandProfileId);
      return { match, creator, brand };
    })
  );

  // Score similarity: each matching dimension adds 1 point
  const scored = enriched
    .filter(({ creator, brand }) => creator && brand)
    .map(({ match, creator, brand }) => {
      let similarityScore = 0;
      if (input.brandType && brand?.brandType === input.brandType) similarityScore += 2;
      if (input.brandArchetypeClassification && brand?.brandArchetypeClassification === input.brandArchetypeClassification) similarityScore += 1;
      if (input.creatorArchetype && creator?.archetype === input.creatorArchetype) similarityScore += 2;
      if (input.creatorNicheTopicNode && creator?.nicheTopicNode === input.creatorNicheTopicNode) similarityScore += 1;
      return { match, creator: creator!, brand: brand!, similarityScore };
    })
    .filter(({ similarityScore }) => similarityScore > 0)
    .sort((a, b) => b.similarityScore - a.similarityScore || (b.match.fitScore ?? 0) - (a.match.fitScore ?? 0));

  return scored.slice(0, 5);
}
