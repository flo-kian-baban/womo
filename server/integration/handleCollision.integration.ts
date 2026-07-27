/**
 * PLATFORM-HANDLE COLLISIONS (brand acceptance finding 3, Option B).
 *
 * ─── The defect ─────────────────────────────────────────────────────────────
 * `upsertPlatformHandle` matches on `(platform, lower(handle))` and ignores
 * `subject_id`, because `handles_lookup_idx` is `UNIQUE (platform, handle)` —
 * the database permits exactly one subject per handle. So when another subject
 * already held the handle, the function returned that subject's row id, wrote
 * nothing, and the caller recorded SUCCESS.
 *
 * The same shape as the content_items attribution bug: a write landing against
 * the wrong owner, reported as fine. It had already cost a CREATOR its handle
 * row (`vnilla` → brand `vnilla.co.uk`) inside the atomic identity core, before
 * brand campaigns existed.
 *
 * ─── What Option B changes, and what it does not ────────────────────────────
 * The uniqueness policy is UNTOUCHED — `handles_lookup_idx` stays global, and
 * whether to scope it to the subject is Option A, still open. What changes is
 * that the loss is now visible: a distinct outcome from the writer, `failed` in
 * `persistence_status`, and the owning subject named in the reason.
 *
 * ─── The load-bearing constraint ────────────────────────────────────────────
 * The creator call sits INSIDE the atomic identity core. Reporting the failure
 * must not abort that transaction: a subject without its handle row is degraded,
 * not dead. These assert the subject, observation and subtype row all still
 * commit — a rollback here would turn a cosmetic loss into a lost analysis.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Client } from "pg";
import { persistCreatorToV2, persistBrandToV2 } from "../routers";
import { upsertSubject, upsertPlatformHandle } from "../db";

const TEST_URL = process.env.TEST_DATABASE_URL;
if (TEST_URL) process.env.DATABASE_URL = TEST_URL;

const suite = TEST_URL ? describe : describe.skip;
const here = path.dirname(fileURLToPath(import.meta.url));

suite("platform-handle collisions (ephemeral Postgres)", () => {
  let admin: Client;
  const q = async (t: string, p: unknown[] = []) => (await admin.query(t, p)).rows;
  const count = async (t: string, p: unknown[] = []) =>
    (await admin.query(`select count(*)::int c from ${t}`, p)).rows[0].c as number;

  /** The squatter: a brand that already owns instagram/sharedhandle. */
  let ownerSubjectId: string;

  beforeAll(async () => {
    admin = new Client({ connectionString: TEST_URL });
    await admin.connect();
    await admin.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
    const ddl = readFileSync(path.join(here, "schema.sql"), "utf8")
      .split("\n")
      .filter(line => !line.startsWith("\\") && line.trim() !== "CREATE SCHEMA public;")
      .join("\n");
    await admin.query(ddl);
    await admin.query("SET search_path TO public;");

    ownerSubjectId = await upsertSubject({ subjectType: "brand", displayName: "Shared Handle Brand" });
    const first = await upsertPlatformHandle(ownerSubjectId, "instagram", "sharedhandle");
    expect(first.outcome).toBe("created");
  }, 60_000);

  afterAll(async () => { await admin.end(); });

  // ── the writer's own verdict ──

  it("reports created / already_owned / claimed_by_other distinctly", async () => {
    // Re-running the SAME subject is idempotent, not a collision.
    const again = await upsertPlatformHandle(ownerSubjectId, "instagram", "sharedhandle");
    expect(again.outcome).toBe("already_owned");
    expect(again.ownerSubjectId).toBeUndefined();

    // A DIFFERENT subject is a collision, and it names the owner.
    const other = await upsertSubject({ subjectType: "brand", displayName: "Other Brand" });
    const collided = await upsertPlatformHandle(other, "instagram", "sharedhandle");
    expect(collided.outcome).toBe("claimed_by_other");
    expect(collided.ownerSubjectId).toBe(ownerSubjectId);

    // And nothing was written: still exactly one row for that handle.
    expect(await count("platform_handles where platform='instagram' and lower(handle)='sharedhandle'")).toBe(1);
  });

  it("matches case-insensitively, as the lookup always has", async () => {
    const other = await upsertSubject({ subjectType: "brand", displayName: "Case Brand" });
    const collided = await upsertPlatformHandle(other, "instagram", "SharedHandle");
    expect(collided.outcome).toBe("claimed_by_other");
    expect(collided.ownerSubjectId).toBe(ownerSubjectId);
  });

  // ── the creator core: report WITHOUT aborting ──

  it("CREATOR: the identity core still commits, and platform_handle reports failed", async () => {
    const result = await persistCreatorToV2({
      handle: "sharedhandle",
      platform: "instagram",
      displayName: "Colliding Creator",
      extracted: { archetype: "The Hero" },
      researchData: { followerCount: 4242 },
    });

    if ("error" in result) throw new Error(String(result.error));
    expect(result.subjectId, "the core must still commit").toBeTruthy();

    // THE CONSTRAINT: every row the atomic core is responsible for exists.
    const [subject] = await q("select * from subjects where id=$1", [result.subjectId]);
    expect(subject.display_name).toBe("Colliding Creator");
    expect(subject.subject_type).toBe("creator");
    const [obs] = await q("select * from observations where id=$1", [result.observationId]);
    expect(Number(obs.follower_count)).toBe(4242);
    expect(await count("creator_observations where observation_id=$1", [result.observationId])).toBe(1);

    // identity_core is SUCCESS — the transaction genuinely committed and nothing
    // is orphaned. Downgrading it would send a reader to the wrong table.
    expect(result.persistence.identity_core.status).toBe("success");

    // The loss is its own component, and it names the owner.
    const ph = result.persistence.platform_handle;
    expect(ph, "platform_handle component missing").toBeTruthy();
    expect(ph.status).toBe("failed");
    expect(ph.reason).toContain(ownerSubjectId);
    expect(ph.reason).toContain("sharedhandle");

    // And the creator really does not own the handle — the defect is reported,
    // not repaired. Repairing it is Option A.
    expect(await count("platform_handles where subject_id=$1", [result.subjectId])).toBe(0);
  });

  it("CREATOR: a clean handle reports platform_handle success and owns its row", async () => {
    const result = await persistCreatorToV2({
      handle: "uncontested_creator",
      platform: "instagram",
      displayName: "Uncontested Creator",
      extracted: { archetype: "The Sage" },
      researchData: { followerCount: 100 },
    });
    if ("error" in result) throw new Error(String(result.error));
    expect(result.persistence.identity_core.status).toBe("success");
    expect(result.persistence.platform_handle.status).toBe("success");
    expect(result.persistence.platform_handle.reason).toBeNull();
    expect(await count("platform_handles where subject_id=$1", [result.subjectId])).toBe(1);
  });

  // ── the brand enrichment ──

  it("BRAND: instagram_handle reports failed and names the owner, and the brand still persists", async () => {
    const result = await persistBrandToV2({
      brandName: "Colliding Brand",
      brandUrl: "https://colliding.example",
      extracted: { archetype: "The Ruler", brandArchetypeClassification: "Trust" },
      weights: { alpha: 0.5, beta: 0.3, gamma: 0.2, priority: "balanced" },
      reviewFields: {},
      tiktokMetadata: null,
      instagramMetadata: { channelHandle: "sharedhandle", postCaptions: ["x"] },
      instagramRequested: true,
      mentionFields: {},
      symbolFields: {},
    });

    if ("error" in result) throw new Error(String(result.error));
    expect(result.subjectId, "the brand must still persist").toBeTruthy();

    const ih = result.persistence.instagram_handle;
    expect(ih.status, "instagram_handle reported success while writing nothing").toBe("failed");
    expect(ih.reason).toContain(ownerSubjectId);

    // Sibling enrichments are unaffected — a handle collision is not a brand
    // failure. The Instagram posts still land under this observation.
    expect(result.persistence.instagram_content_items.status).toBe("success");
    expect(await count("platform_handles where subject_id=$1", [result.subjectId])).toBe(0);
  });

  it("BRAND: an uncontested handle still reports success", async () => {
    const result = await persistBrandToV2({
      brandName: "Free Handle Brand",
      extracted: { archetype: "The Ruler" },
      weights: { alpha: 0.5, beta: 0.3, gamma: 0.2, priority: "balanced" },
      reviewFields: {},
      tiktokMetadata: null,
      instagramMetadata: { channelHandle: "freehandle", postCaptions: ["y"] },
      instagramRequested: true,
      mentionFields: {},
      symbolFields: {},
    });
    if ("error" in result) throw new Error(String(result.error));
    expect(result.persistence.instagram_handle.status).toBe("success");
    expect(await count("platform_handles where subject_id=$1", [result.subjectId])).toBe(1);
  });
});
