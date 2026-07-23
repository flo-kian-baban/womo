/**
 * Session 5 integration tests — persistence integrity (hybrid model).
 * Runs against a DISPOSABLE local Docker Postgres, never production
 * (gated on TEST_DATABASE_URL exactly like db.integration.ts).
 *
 * Covers the three required behaviors:
 *  (a) the atomic identity core rolls back FULLY when a mid-core write fails
 *      (no orphaned subjects/handles/observations);
 *  (b) a failed enrichment leaves the core saved, records status 'failed'
 *      with a reason, and does not abort sibling enrichments;
 *  (c) observations.persistence_status reflects reality — statuses cross-check
 *      against actual row counts, including the two distinct skip kinds
 *      (skipped_no_data vs skipped_not_attempted).
 *
 * Failure simulation uses real Postgres constraint violations that occur at a
 * KNOWN step (varchar overflow / invalid real cast), so no mocking of db.ts is
 * needed — the real transaction/rollback machinery is exercised.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Client } from "pg";
import { persistCreatorToV2, persistBrandToV2 } from "../routers";

const TEST_URL = process.env.TEST_DATABASE_URL;
// Point db.ts's lazy Pool at the ephemeral test container (getDb() reads
// process.env.DATABASE_URL on first use, inside the calls below).
if (TEST_URL) process.env.DATABASE_URL = TEST_URL;

const suite = TEST_URL ? describe : describe.skip;
const here = path.dirname(fileURLToPath(import.meta.url));

suite("persistence integrity (ephemeral Postgres)", () => {
  let admin: Client;

  const q = async (text: string, params?: unknown[]) => (await admin.query(text, params)).rows;
  const count = async (text: string, params?: unknown[]) =>
    (await admin.query(`select count(*)::int c from ${text}`, params)).rows[0].c as number;

  beforeAll(async () => {
    admin = new Client({ connectionString: TEST_URL });
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
    // The dump clears search_path for its own session — restore it so the
    // unqualified table names in this suite's assertions resolve.
    await admin.query("SET search_path TO public;");
  });

  afterAll(async () => {
    await admin.end();
  });

  // ── (a) atomic core rollback ───────────────────────────────────────────────

  it("creator: rolls back subject + handle + observation when a mid-core write fails", async () => {
    // Poison step 4 (insertCreatorObservation): primary_region is varchar(255);
    // 300 chars violates the length constraint AFTER subject, platform handle,
    // and observation have been written inside the same transaction.
    const result = await persistCreatorToV2({
      handle: "atomic_rollback_creator",
      platform: "TikTok",
      displayName: "Atomic Rollback Creator",
      extracted: { archetype: "The Sage" },
      researchData: { followerCount: 42, location: "x".repeat(300) },
    });

    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.error).toMatch(/too long/i);

    // Nothing from the core survived the rollback.
    expect(await count("subjects where primary_handle=$1", ["atomic_rollback_creator"])).toBe(0);
    expect(await count("platform_handles where handle=$1", ["atomic_rollback_creator"])).toBe(0);
    expect(await count(
      "observations o join subjects s on s.id=o.subject_id where s.primary_handle=$1",
      ["atomic_rollback_creator"],
    )).toBe(0);
  });

  it("brand: rolls back subject + observation when the brand_observations write fails", async () => {
    // Poison step 3 (insertBrandObservation): google_rating is real; a
    // non-numeric string fails the cast after subject + observation are written.
    const result = await persistBrandToV2({
      brandName: "Atomic Rollback Brand",
      brandUrl: "https://example.com",
      category: "Coffee",
      extracted: { archetype: "The Ruler", brandArchetypeClassification: "Trust" },
      weights: { alpha: 0.5, beta: 0.3, gamma: 0.2, priority: "balanced" },
      reviewFields: { googleRating: "not-a-number" },
      tiktokMetadata: null,
      instagramMetadata: null,
      mentionFields: {},
      symbolFields: {},
    });

    expect("error" in result).toBe(true);
    expect(await count("subjects where display_name=$1", ["Atomic Rollback Brand"])).toBe(0);
    expect(await count(
      "observations o join subjects s on s.id=o.subject_id where s.display_name=$1",
      ["Atomic Rollback Brand"],
    )).toBe(0);
  });

  // ── (b) failed enrichment isolation ────────────────────────────────────────

  it("creator: a failed enrichment leaves the core saved, is recorded, and does not abort siblings", async () => {
    // Poison signal_values (signal_key varchar(512) ← 600 chars) while
    // decoded_signals has valid data — signals must fail, decoded must save.
    const result = await persistCreatorToV2({
      handle: "enrichment_fail_creator",
      platform: "TikTok",
      displayName: "Enrichment Fail Creator",
      extracted: { archetype: "The Hero" },
      researchData: {
        followerCount: 1000,
        rawKeywords: ["k".repeat(600)],
        decodedSymbols: {
          identityClaims: [{ phrase: "diy welder", meaning: "maker identity", informs: ["archetype"] }],
          symbolicSummary: "maker culture",
        },
      },
    });

    expect("subjectId" in result).toBe(true);
    if ("error" in result) throw new Error(result.error);

    // Core saved despite the enrichment failure.
    expect(await count("subjects where id=$1", [result.subjectId])).toBe(1);
    expect(await count("observations where id=$1", [result.observationId])).toBe(1);
    expect(await count("creator_observations where observation_id=$1", [result.observationId])).toBe(1);

    // Outcome map: failure recorded with reason; siblings unaffected.
    expect(result.persistence.identity_core.status).toBe("success");
    expect(result.persistence.signal_values.status).toBe("failed");
    expect(result.persistence.signal_values.reason).toMatch(/too long/i);
    expect(result.persistence.decoded_signals.status).toBe("success");

    // Reality matches the map: no signal rows, one decoded row.
    expect(await count("signal_values where subject_id=$1", [result.subjectId])).toBe(0);
    expect(await count("decoded_signals where subject_id=$1", [result.subjectId])).toBe(1);
  });

  // ── (c) persistence_status reflects reality ────────────────────────────────

  it("creator: persistence_status distinguishes success from skipped_no_data and matches row counts", async () => {
    const result = await persistCreatorToV2({
      handle: "status_truth_creator",
      platform: "TikTok",
      displayName: "Status Truth Creator",
      extracted: { archetype: "The Explorer" },
      researchData: {
        followerCount: 5000,
        rawKeywords: ["fitness", "outdoors"],
        // no decodedSymbols, no videos, no transcripts
      },
    });

    expect("subjectId" in result).toBe(true);
    if ("error" in result) throw new Error(result.error);

    const p = result.persistence;
    expect(p.identity_core.status).toBe("success");
    expect(p.signal_values.status).toBe("success");
    expect(p.decoded_signals.status).toBe("skipped_no_data");
    expect(p.content_items.status).toBe("skipped_no_data");
    expect(p.avg_video_duration.status).toBe("skipped_no_data");
    expect(p.transcripts.status).toBe("skipped_no_data");
    expect(p.transcript_count.status).toBe("success");
    // Skips carry a reason; successes carry none.
    expect(p.decoded_signals.reason).toBeTruthy();
    expect(p.signal_values.reason).toBeNull();

    // Cross-check every claim against actual rows.
    expect(await count("signal_values where subject_id=$1", [result.subjectId])).toBe(2);
    expect(await count("decoded_signals where subject_id=$1", [result.subjectId])).toBe(0);
    expect(await count("content_items where subject_id=$1", [result.subjectId])).toBe(0);
    const [obs] = await q(
      "select transcript_count, data_confidence_level, persistence_status from observations where id=$1",
      [result.observationId],
    );
    expect(obs.transcript_count).toBe(0);
    expect(obs.data_confidence_level).toBe("low");
    // The stored JSONB carries the same component outcomes the API returned,
    // plus a reserved `_meta` key (Session 8: sociological-field provenance)
    // that is NOT part of the component map. Compare components, then the marker.
    const { _meta, ...components } = obs.persistence_status as Record<string, unknown>;
    expect(components).toEqual(p);
    expect((_meta as Record<string, unknown>)?.sociologicalFieldsProvenance).toBe("estimated");
  });

  it("brand: distinguishes skipped_not_attempted (channel not requested) from skipped_no_data", async () => {
    const result = await persistBrandToV2({
      brandName: "Status Truth Brand",
      brandUrl: "https://statustruth.example.com",
      category: "Coffee",
      extracted: {
        archetype: "The Everyman",
        brandArchetypeClassification: "Community",
        visualLanguage: ["warm tones", "handwritten type"],
      },
      weights: { alpha: 0.5, beta: 0.3, gamma: 0.2, priority: "balanced" },
      reviewFields: { googleRating: 4.5, googleReviewCount: 120, overallRating: 4.5, totalReviews: 120 },
      tiktokMetadata: null,
      instagramMetadata: null,
      mentionFields: {},
      symbolFields: {},
      tiktokRequested: false,
      instagramRequested: false,
    });

    expect("subjectId" in result).toBe(true);
    if ("error" in result) throw new Error(result.error);

    const p = result.persistence;
    expect(p.identity_core.status).toBe("success");
    // Config gap → not attempted (with the reason naming the gap):
    expect(p.channel_content_items.status).toBe("skipped_not_attempted");
    expect(p.channel_content_items.reason).toMatch(/no TikTok channel URL/i);
    expect(p.instagram_handle.status).toBe("skipped_not_attempted");
    expect(p.instagram_content_items.status).toBe("skipped_not_attempted");
    expect(p.instagram_signal_values.status).toBe("skipped_not_attempted");
    expect(p.instagram_decoded_signals.status).toBe("skipped_not_attempted");
    // Genuine absence of data → skipped_no_data:
    expect(p.audience_mentions.status).toBe("skipped_no_data");
    expect(p.mention_content_items.status).toBe("skipped_no_data");
    expect(p.decoded_signals.status).toBe("skipped_no_data");
    // visualLanguage produced signal rows → success, and rows really exist:
    expect(p.signal_values.status).toBe("success");
    expect(await count("signal_values where subject_id=$1", [result.subjectId])).toBe(2);

    // Review data lives on the atomic core row (brand_observations), not a component.
    const [bo] = await q(
      "select bo.google_rating, o.persistence_status from brand_observations bo join observations o on o.id=bo.observation_id where o.id=$1",
      [result.observationId],
    );
    expect(bo.google_rating).toBe(4.5);
    expect(bo.persistence_status).toEqual(p);
  });
});
