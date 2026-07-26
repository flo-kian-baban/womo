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
 * ─── Both are FIXED by womo_0011 ────────────────────────────────────────────
 * The unique key is now (platform, platform_video_id, subject_id,
 * observation_id), so each observation owns its own content snapshot, and
 * updateContentItemTranscript takes a REQUIRED observationId so transcript
 * wiring cannot land on a neighbouring observation's rows.
 *
 * These assertions previously described the defect; they now describe the fix.
 * The APPEND-ONLY case is the one that matters most — it is the only thing
 * standing between a re-analysis and the silent rewriting of history.
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
    const written = await db.insertContentItems(
      subjectId, obsOne, rowsFor({ views: 100, transcript: "first run words here" }),
    );
    expect(written).toEqual({ attributed: 3, collided: 0 });

    const [{ count }] = (await client.query(
      "select count(*)::int from content_items where observation_id = $1", [obsOne],
    )).rows;
    expect(count).toBe(3);
  });

  it("a RE-ANALYSIS attributes a FULL set to the new observation", async () => {
    // Before womo_0011 this returned { attributed: 0, collided: 3 } and the new
    // observation owned nothing — the production symptom, 15 observations deep.
    const written = await db.insertContentItems(
      subjectId, obsTwo, rowsFor({ views: 999, transcript: "second run words here" }),
    );
    expect(written).toEqual({ attributed: 3, collided: 0 });

    const [{ count }] = (await client.query(
      "select count(*)::int from content_items where observation_id = $1", [obsTwo],
    )).rows;
    expect(count).toBe(3);
  });

  it("APPEND-ONLY: the earlier observation's rows are UNTOUCHED by the re-analysis", async () => {
    // THE ONE THAT MATTERS. obsOne recorded views 100/101/102 and its own
    // transcript text. A historical observation records what was true when it
    // was taken; before womo_0011 the upsert silently overwrote all of it with
    // the second run's values, so every re-analysis rewrote history.
    const rows = (await client.query(
      `select platform_video_id, view_count, like_count, transcript_text, status
         from content_items where observation_id = $1 order by platform_video_id`, [obsOne],
    )).rows;

    expect(rows).toHaveLength(3);
    // view_count / like_count are bigint — node-pg hands them back as strings.
    expect(rows.map(r => Number(r.view_count))).toEqual([100, 101, 102]);
    expect(rows.every(r => Number(r.like_count) === 100)).toBe(true);
    expect(rows.every(r => r.transcript_text === "first run words here")).toBe(true);
  });

  it("the new observation carries the NEW values, not the old ones", async () => {
    const rows = (await client.query(
      `select view_count, transcript_text from content_items
        where observation_id = $1 order by platform_video_id`, [obsTwo],
    )).rows;
    expect(rows.map(r => Number(r.view_count))).toEqual([999, 1000, 1001]);
    expect(rows.every(r => r.transcript_text === "second run words here")).toBe(true);
  });

  it("both observations coexist — content is version history, not one mutable set", async () => {
    const [{ total }] = (await client.query(
      "select count(*)::int as total from content_items where subject_id = $1", [subjectId],
    )).rows;
    expect(total).toBe(6); // 3 per observation
  });

  it("transcript wiring lands on the TARGET observation and nowhere else", async () => {
    // updateContentItemTranscript used to match (subject, platform, video) with
    // no observation filter, so a success could be another observation's row —
    // precisely how a content-less observation still reported transcript_count 8
    // at "high" confidence. observationId is now a REQUIRED parameter.
    const updated = await db.updateContentItemTranscript(
      subjectId, obsTwo, VIDEOS[0]!, "tiktok", "rewired transcript", "subtitle", 2, "recent",
    );
    expect(updated).toBe(true);

    const one = (await client.query(
      `select transcript_text from content_items
        where observation_id = $1 and platform_video_id = $2`, [obsOne, VIDEOS[0]],
    )).rows[0];
    const two = (await client.query(
      `select transcript_text, temporal_bucket from content_items
        where observation_id = $1 and platform_video_id = $2`, [obsTwo, VIDEOS[0]],
    )).rows[0];

    expect(two.transcript_text).toBe("rewired transcript");
    expect(two.temporal_bucket).toBe("recent");
    // The earlier observation keeps what IT observed.
    expect(one.transcript_text).toBe("first run words here");
  });

  it("reports a miss honestly when the target observation has no such video", async () => {
    // A phantom success here is what inflated transcript_count historically.
    const updated = await db.updateContentItemTranscript(
      subjectId, obsTwo, "7399999999999999999", "tiktok", "orphan", "subtitle", 1, null,
    );
    expect(updated).toBe(false);
  });

  it("READ MODEL: a subject with two visible observations returns each video ONCE", async () => {
    // Both obsOne and obsTwo are visible under the old accepted-OR-current
    // union, and both now own a copy of all three videos. The union would return
    // six rows — every video duplicated. The authoritative-observation resolver
    // returns one observation's set.
    const items = await db.getContentItemsBySubject(subjectId);
    expect(items).toHaveLength(3);
    expect(new Set(items.map(i => i.platformVideoId)).size).toBe(3);
    // obsTwo is is_latest, so its values are the ones displayed.
    expect(items.every(i => i.transcriptText?.includes("second run") || i.transcriptText === "rewired transcript")).toBe(true);
  });
});
