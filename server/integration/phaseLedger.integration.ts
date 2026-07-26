/**
 * Phase-ledger round-trip guard — phased architecture S2.
 *
 * THE REGRESSION THIS EXISTS TO PREVENT (womo_0010):
 * `analysis_phase_state.output` must be `json`, NOT `jsonb`. Phases read their
 * inputs back from this column, and those values land in the womo_0007 evidence
 * snapshot that the identity harness compares BYTE-for-byte. Postgres `jsonb`
 * normalizes key order (length-then-bytewise), so a jsonb column silently
 * re-serializes every transcript and pool entry — no value changes, but the
 * archival provenance bytes do, and the program's acceptance criterion breaks.
 *
 * Measured before the migration:
 *   jsonb round-trip byte-identical? false
 *   json  round-trip byte-identical? true
 *
 * If a future session flips the column back to jsonb, THIS TEST FAILS LOUDLY
 * with the exact reordering shown. Do not "fix" it by relaxing the assertion.
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

/**
 * A realistic TranscriptEntry in the key order the pipeline CONSTRUCTS it —
 * insertion order, with the conditionally-attached metadata keys last (see
 * enrichEntry in webResearch.ts). jsonb would reorder this to
 * bucket,caption,videoId,... ; json preserves it exactly.
 */
const REALISTIC_TRANSCRIPT = {
  videoId: "7300000000000000001",
  videoUrl: "https://www.tiktok.com/@x/video/7300000000000000001",
  caption: "asking strangers the hard questions #streetinterview",
  transcript: "If you could change one thing about this city what would it be?",
  wordCount: 13,
  bucket: "recent",
  createTime: 1774000000,
  transcriptSource: "subtitle",
  musicMetadata: { soundName: "original sound", isOriginal: true },
  remixMetadata: { duetCount: 0, stitchCount: 0 },
  videoDuration: 47,
};

suite("phase ledger round-trip fidelity (ephemeral Postgres)", () => {
  let client: Client;
  const RUN_ID = "00000000-0000-0000-0000-00000000f00d";

  beforeAll(async () => {
    client = new Client({ connectionString: TEST_URL });
    await client.connect();
  });

  afterAll(async () => {
    await client.query("delete from analysis_phase_state where run_id = $1", [RUN_ID]);
    await client.end();
  });

  it("the output column is json, not jsonb (the whole point of womo_0010)", async () => {
    const { rows } = await client.query(
      `select data_type from information_schema.columns
        where table_name = 'analysis_phase_state' and column_name = 'output'`,
    );
    expect(rows[0]?.data_type).toBe("json");
  });

  it("a banked payload reads back BYTE-IDENTICAL through the real column", async () => {
    const payload = {
      transcripts: [REALISTIC_TRANSCRIPT],
      musicTitles: ["original sound"],
      foreignVideosRejected: 3,
    };
    const before = JSON.stringify(payload);

    await db.recordPhaseState({
      runId: RUN_ID,
      subjectHint: "roundtrip@TikTok",
      phase: "transcribe",
      tool: "test",
      status: "complete",
      output: payload,
    });

    const rows = await db.getPhaseState(RUN_ID);
    const banked = rows.find(r => r.phase === "transcribe");
    expect(banked).toBeTruthy();
    // The assertion that guards the program's acceptance criterion.
    expect(JSON.stringify(banked!.output)).toBe(before);
    // …and specifically that key order survived (what jsonb would destroy).
    const t = (banked!.output as { transcripts: Array<Record<string, unknown>> }).transcripts[0];
    expect(Object.keys(t)).toEqual(Object.keys(REALISTIC_TRANSCRIPT));
  });

  it("re-running a completed phase replaces its OWN row and touches no other", async () => {
    await db.recordPhaseState({
      runId: RUN_ID, subjectHint: "roundtrip@TikTok", phase: "capture",
      tool: "test", status: "complete", output: { generation: 1 },
    });
    await db.recordPhaseState({
      runId: RUN_ID, subjectHint: "roundtrip@TikTok", phase: "derive",
      tool: "test", status: "complete", output: { untouched: true },
    });

    // Idempotent re-run of capture only.
    await db.recordPhaseState({
      runId: RUN_ID, subjectHint: "roundtrip@TikTok", phase: "capture",
      tool: "test", status: "complete", output: { generation: 2 },
    });

    const rows = await db.getPhaseState(RUN_ID);
    const capture = rows.filter(r => r.phase === "capture");
    expect(capture).toHaveLength(1); // replaced, not duplicated
    expect(capture[0]!.output).toEqual({ generation: 2 });
    expect(rows.find(r => r.phase === "derive")!.output).toEqual({ untouched: true });
  });
});
