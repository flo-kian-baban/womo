/**
 * Postgres integration test — runs against a DISPOSABLE local Docker Postgres,
 * NEVER production. Gated on TEST_DATABASE_URL: if unset, the whole suite skips,
 * so it never runs (or needs Docker) during the default `pnpm test`.
 *
 * Activation:
 *   pnpm test:db:up          # docker run postgres:17-alpine on :55432
 *   pnpm test:integration    # sets TEST_DATABASE_URL and runs this suite
 *   pnpm test:db:down        # remove the container
 * See server/integration/README.md.
 *
 * Method: a clean `public` schema is (re)created and the DDL in
 * server/integration/schema.sql is applied. That schema.sql is generated from the
 * live schema via `pg_dump --schema-only --no-owner --no-privileges --schema=public`
 * (drizzle-kit is intentionally blocked — see docs/STORAGE_MODEL.md), so it is an
 * exact structural mirror of production. The test then seeds a
 * subject → observation → creator/brand → match chain using the REAL db.ts helpers
 * and asserts round-trip reads + cascade-delete.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Client } from "pg";
import * as db from "../db";

const TEST_URL = process.env.TEST_DATABASE_URL;
// Point db.ts's lazy Pool at the ephemeral test container (getDb() reads
// process.env.DATABASE_URL on first use, which happens inside the tests below).
if (TEST_URL) process.env.DATABASE_URL = TEST_URL;

const suite = TEST_URL ? describe : describe.skip;
const here = path.dirname(fileURLToPath(import.meta.url));

suite("db.ts integration (ephemeral Postgres)", () => {
  beforeAll(async () => {
    // Fresh schema every run: drop + recreate public, then apply the DDL mirror.
    const admin = new Client({ connectionString: TEST_URL });
    await admin.connect();
    await admin.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
    // pg_dump output needs two adjustments to run through the pg driver:
    //  - psql meta-commands (\restrict, \unrestrict) are not SQL — strip them;
    //  - the dump's own CREATE SCHEMA public collides with the one above.
    const ddl = readFileSync(path.join(here, "schema.sql"), "utf8")
      .split("\n")
      .filter(line => !line.startsWith("\\") && line.trim() !== "CREATE SCHEMA public;")
      .join("\n");
    await admin.query(ddl);
    await admin.end();
  });

  it("round-trips a creator → observation → creator_observation chain", async () => {
    const subjectId = await db.upsertSubject({
      subjectType: "creator", primaryHandle: "seed_creator", primaryPlatform: "tiktok",
      displayName: "Seed Creator", latestArchetype: "The Sage",
    });
    const obsId = await db.insertObservation(subjectId, {
      followerCount: 123456, engagementRate: 5.5, dataConfidenceLevel: "high", transcriptCount: 6,
    });
    await db.insertCreatorObservation(obsId, {
      archetype: "The Sage", goffmanStageConsistency: "Consistent", driftSignal: "Zero Change",
      totalLikes: 999999, videoCount: 12,
    });

    const profile = (await db.getCreatorProfileById(subjectId)) as any;
    expect(profile).toBeTruthy();
    expect(profile.displayName).toBe("Seed Creator");
    expect(profile.archetype).toBe("The Sage");
    expect(Number(profile.followerCount)).toBe(123456);
    expect(Number(profile.totalLikes)).toBe(999999); // bigint round-trips through db.ts
  });

  it("round-trips a brand + match, then cascade-deletes the creator subject", async () => {
    const creatorId = await db.upsertSubject({
      subjectType: "creator", primaryHandle: "seed_creator_2", primaryPlatform: "tiktok", latestArchetype: "The Hero",
    });
    const cObs = await db.insertObservation(creatorId, { followerCount: 1000 });
    await db.insertCreatorObservation(cObs, { archetype: "The Hero" });

    const brandId = await db.upsertSubject({
      subjectType: "brand", primaryHandle: "seed_brand", primaryPlatform: "tiktok", latestBrandArchetype: "Trust",
    });
    const bObs = await db.insertObservation(brandId, {});
    await db.insertBrandObservation(bObs, {
      brandArchetypeClassification: "Trust", archetype: "The Ruler",
      weightAlpha: 0.6, weightBeta: 0.2, weightGamma: 0.2,
    });

    const matchId = await db.insertMatchScore({
      creatorSubjectId: creatorId, brandSubjectId: brandId,
      creatorObservationId: cObs, brandObservationId: bObs,
      fitScore: 8.55, fitStatus: "Green Light",
    });

    const match = (await db.getMatchWithProfiles(matchId)) as any;
    expect(match).toBeTruthy();

    // Cascade: deleting the creator subject must remove its observations AND the
    // match (match_scores.creator_subject_id → subjects ON DELETE CASCADE).
    await db.deleteCreatorProfile(creatorId);

    const admin = new Client({ connectionString: TEST_URL });
    await admin.connect();
    const obsLeft = await admin.query("select count(*)::int c from observations where subject_id=$1", [creatorId]);
    const coLeft = await admin.query("select count(*)::int c from creator_observations where observation_id=$1", [cObs]);
    const matchLeft = await admin.query("select count(*)::int c from match_scores where id=$1", [matchId]);
    await admin.end();

    expect(obsLeft.rows[0].c).toBe(0);   // observations cascaded from subject
    expect(coLeft.rows[0].c).toBe(0);    // creator_observations cascaded from observation
    expect(matchLeft.rows[0].c).toBe(0); // match cascaded from creator subject
  });
});
