/**
 * content_items observation attribution (ephemeral Postgres).
 *
 * ─── The two defects ────────────────────────────────────────────────────────
 * (a) A RE-ANALYSIS attributes ZERO content_items to its new observation. The
 *     unique key is (platform, platform_video_id, subject_id) — no
 *     observation_id — so every repeated video collides, DO UPDATE refreshes
 *     the existing row in place, and the row keeps pointing at the FIRST
 *     observation that stored it. Postgres raises nothing.
 * (b) That same DO UPDATE silently REWRITES the earlier observation's stored
 *     evidence (view counts, transcripts), breaking the append-only guarantee
 *     the rest of the schema assumes.
 *
 * Measured in production: 0 of 20 first analyses affected, 15 of 23
 * re-analyses (65%).
 *
 * ─── What this file asserts RIGHT NOW ───────────────────────────────────────
 * The DEFECT, exactly — because that is what the database does today, and
 * because Part 1's whole job is to make it *visible* rather than silent. Each
 * case is marked with what the unique-index migration will change it to, so the
 * fix shows up as an intentional diff in these assertions rather than as a
 * quietly-passing test that never described either behaviour.
 *
 * Runs against the DISPOSABLE Docker Postgres (never production):
 * `pnpm test:db:up` → `pnpm test:integration`.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import * as db from "../db";

const TEST_URL = process.env.TEST_DATABASE_URL;
if (TEST_URL) process.env.DATABASE_URL = TEST_URL;

const suite = TEST_URL ? describe : describe.skip;

suite("content_items observation attribution (ephemeral Postgres)", () => {
  let client: Client;
  let subjectId: string;
  let obsOne: string;
  let obsTwo: string;

  /** The same three videos on both runs — a creator who posted nothing new. */
  const VIDEOS = ["7300000000000000001", "7300000000000000002", "7300000000000000003"];

  const rowsFor = (opts: { views: number; transcript: string }) =>
    VIDEOS.map((id, i) => ({
      platform: "tiktok",
      platformVideoId: id,
      videoUrl: `https://www.tiktok.com/@attrib/video/${id}`,
      caption: `caption ${i}`,
      viewCount: opts.views + i,
      likeCount: opts.views,
      transcriptText: opts.transcript,
      transcriptWordCount: opts.transcript.split(" ").length,
      transcriptSource: "subtitle",
      status: "sampled",
    }));

  beforeAll(async () => {
    // No schema drop — db.integration.ts (alphabetically first, files serial)
    // applies the schema.sql mirror. Same convention as the sibling suites.
    client = new Client({ connectionString: TEST_URL });
    await client.connect();
    const [{ ok }] = (await client.query(
      "select exists(select 1 from information_schema.tables where table_name='content_items') ok",
    )).rows;
    if (!ok) throw new Error("schema missing — run the full `pnpm test:integration`");

    subjectId = (await client.query(
      `insert into subjects (subject_type, display_name) values ('creator','attrib fixture') returning id`,
    )).rows[0].id;
    obsOne = (await client.query(
      `insert into observations (subject_id, observed_at, is_latest, review_status)
       values ($1, now() - interval '2 days', false, 'pending') returning id`, [subjectId],
    )).rows[0].id;
    obsTwo = (await client.query(
      `insert into observations (subject_id, observed_at, is_latest, review_status)
       values ($1, now(), true, 'pending') returning id`, [subjectId],
    )).rows[0].id;
  }, 30_000);

  afterAll(async () => {
    await client.query("delete from content_items where subject_id = $1", [subjectId]);
    await client.query("delete from observations where subject_id = $1", [subjectId]);
    await client.query("delete from subjects where id = $1", [subjectId]);
    await client.end();
  });

  it("a FIRST analysis attributes every row to its own observation", async () => {
    // Unchanged by the migration — first analyses were never affected.
    const written = await db.insertContentItems(
      subjectId, obsOne, rowsFor({ views: 100, transcript: "first run words here" }),
    );
    expect(written).toEqual({ attributed: 3, collided: 0 });

    const [{ count }] = (await client.query(
      "select count(*)::int from content_items where observation_id = $1", [obsOne],
    )).rows;
    expect(count).toBe(3);
  });

  it("DEFECT (a): a RE-ANALYSIS attributes NOTHING to the new observation, and says so", async () => {
    const written = await db.insertContentItems(
      subjectId, obsTwo, rowsFor({ views: 999, transcript: "second run words here" }),
    );

    // AFTER THE MIGRATION this becomes { attributed: 3, collided: 0 }.
    expect(written).toEqual({ attributed: 0, collided: 3 });

    // The new observation owns no evidence at all — the production symptom.
    const [{ count }] = (await client.query(
      "select count(*)::int from content_items where observation_id = $1", [obsTwo],
    )).rows;
    expect(count).toBe(0);

    // …and the write raised nothing. Without the returned count there is no
    // signal anywhere that this happened. That is the whole reason Part 1 exists.
  });

  it("DEFECT (b): the re-analysis REWROTE the earlier observation's stored evidence", async () => {
    // obsOne recorded views 100/101/102 and its own transcript. Append-only says
    // a historical observation records what was true when it was taken; the
    // upsert overwrote it with the second run's values.
    const rows = (await client.query(
      `select platform_video_id, view_count, transcript_text
         from content_items where observation_id = $1 order by platform_video_id`, [obsOne],
    )).rows;

    expect(rows).toHaveLength(3);
    // view_count is bigint — node-pg hands it back as a string.
    // AFTER THE MIGRATION these stay [100, 101, 102] / "first run words here".
    expect(rows.map(r => Number(r.view_count))).toEqual([999, 1000, 1001]);
    expect(rows.every(r => r.transcript_text === "second run words here")).toBe(true);
  });

  it("only ONE row set exists for the subject — later runs mutate rather than append", async () => {
    const [{ total }] = (await client.query(
      "select count(*)::int as total from content_items where subject_id = $1", [subjectId],
    )).rows;
    // AFTER THE MIGRATION this becomes 6 (one set per observation).
    expect(total).toBe(3);
  });

  it("DEFECT: transcript wiring is subject-scoped, so it counts ANOTHER observation's rows", async () => {
    // updateContentItemTranscript matches (subject, platform, video) with no
    // observation filter. obsTwo owns zero rows, yet wiring a transcript for it
    // "succeeds" — by updating the row obsOne owns. This is precisely how
    // transcript_count and data_confidence_level stayed high on observations
    // holding no content: transcriptSuccessCount counted these.
    const updated = await db.updateContentItemTranscript(
      subjectId, VIDEOS[0]!, "tiktok", "wired for obsTwo", "subtitle", 3, "recent",
    );
    expect(updated).toBe(true); // reports success…

    const two = (await client.query(
      "select count(*)::int as c from content_items where observation_id = $1", [obsTwo],
    )).rows[0];
    expect(two.c).toBe(0); // …while obsTwo still owns nothing

    const one = (await client.query(
      `select transcript_text from content_items
        where observation_id = $1 and platform_video_id = $2`, [obsOne, VIDEOS[0]],
    )).rows[0];
    // The text landed on the OTHER observation's row.
    expect(one.transcript_text).toBe("wired for obsTwo");
  });
});
