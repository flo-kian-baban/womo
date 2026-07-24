/**
 * Session 11 (Commit 7) integration — run-outcome telemetry.
 *
 * pipeline_runs was always empty, so a run that scraped + ran LLMs but persisted
 * nothing (a timeout orphaning a finished extraction, or a persist-time bail —
 * Part 0.3) left ZERO trace. recordRunOutcome now writes a terminal row per run,
 * keyed on the run id, so a late authoritative outcome (a raced extraction that
 * finishes AFTER the client already saw a timeout, and still persists) upserts
 * over the provisional one instead of duplicating it.
 *
 * Runs against the DISPOSABLE Docker Postgres only (gated on TEST_DATABASE_URL);
 * skips entirely during the default `pnpm test`.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Client } from "pg";
import * as db from "../db";
import { newRunId } from "../_core/runContext";

const TEST_URL = process.env.TEST_DATABASE_URL;
// Point db.ts's lazy Pool at the ephemeral test container.
if (TEST_URL) process.env.DATABASE_URL = TEST_URL;

const suite = TEST_URL ? describe : describe.skip;
const here = path.dirname(fileURLToPath(import.meta.url));

suite("run-outcome telemetry (ephemeral Postgres)", () => {
  beforeAll(async () => {
    const admin = new Client({ connectionString: TEST_URL });
    await admin.connect();
    await admin.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
    const ddl = readFileSync(path.join(here, "schema.sql"), "utf8")
      .split("\n")
      .filter(line => !line.startsWith("\\") && line.trim() !== "CREATE SCHEMA public;")
      .join("\n");
    await admin.query(ddl);
    await admin.end();
  });

  async function readRun(runId: string): Promise<Record<string, unknown> | null> {
    const c = new Client({ connectionString: TEST_URL });
    await c.connect();
    try {
      const r = await c.query(
        "select id, run_type, status, error_log, started_at, completed_at from pipeline_runs where id = $1",
        [runId],
      );
      return r.rows[0] ?? null;
    } finally {
      await c.end();
    }
  }

  it("records a terminal success with run_type + completed_at and no error detail", async () => {
    const runId = newRunId();
    await db.recordRunOutcome(runId, "success", { startedAt: new Date() });
    const row = await readRun(runId);
    expect(row).toBeTruthy();
    expect(row!.status).toBe("success");
    expect(row!.run_type).toBe("creator_analysis");
    expect(row!.completed_at).toBeTruthy();
    expect(row!.error_log).toBeNull();
  });

  it("upserts by run id: a completed extraction supersedes an earlier 'timeout' (the salvage)", async () => {
    const runId = newRunId();
    // The outer handler wrote a provisional 'timeout' when the race timed out…
    await db.recordRunOutcome(runId, "timeout", { detail: { note: "race timeout" } });
    expect((await readRun(runId))!.status).toBe("timeout");

    // …then the orphaned workPromise finished and persisted → the true outcome wins.
    await db.recordRunOutcome(runId, "success");
    expect((await readRun(runId))!.status).toBe("success"); // superseded, not duplicated

    // exactly one row for this run id
    const c = new Client({ connectionString: TEST_URL });
    await c.connect();
    const count = await c.query("select count(*)::int n from pipeline_runs where id = $1", [runId]);
    await c.end();
    expect((count.rows[0] as { n: number }).n).toBe(1);
  });

  it("captures the failure cause in error_log (closes the a8c1833e persist-bail blind spot)", async () => {
    const runId = newRunId();
    await db.recordRunOutcome(runId, "error", { detail: { message: "observation insert failed: null value" } });
    const row = await readRun(runId);
    expect(row!.status).toBe("error");
    expect(row!.error_log).toBeTruthy();
    expect(JSON.stringify(row!.error_log)).toContain("observation insert failed");
  });

  it("records a min-data rejection as its own terminal status", async () => {
    const runId = newRunId();
    await db.recordRunOutcome(runId, "min_data_rejection", { detail: { message: "Insufficient data" } });
    expect((await readRun(runId))!.status).toBe("min_data_rejection");
  });

  // Transcript-reliability session (C3): 6-3-3 sample membership persists
  // independently of transcript success — a subtitle-less creator keeps its
  // longitudinal structure (temporal_bucket) even with zero transcripts.
  it("persists temporal_bucket for sampled-but-transcriptless videos", async () => {
    const { persistCreatorToV2 } = await import("../routers");
    const result = await persistCreatorToV2({
      handle: "bucket_creator", platform: "TikTok", displayName: "Bucket Creator",
      extracted: { archetype: "The Sage" },
      researchData: {
        followerCount: 500,
        discoveredVideoPoolJson: [
          // sampled, transcript SUCCEEDED (the old path already covered this)
          { id: "vt1", url: "https://t/1", caption: "spoken one", createTime: 1700000000, views: 10, likes: 1, comments: 0, saves: 0, shares: 0, musicOriginal: false, durationSec: 30, temporalBucket: "recent", transcriptText: "real words here", transcriptSource: "subtitle", transcriptWordCount: 3 },
          // sampled, transcript FAILED — the bucket must still persist (the C3 fix)
          { id: "vt2", url: "https://t/2", caption: "", createTime: 1690000000, views: 20, likes: 2, comments: 0, saves: 0, shares: 0, musicOriginal: false, durationSec: 25, temporalBucket: "mid" },
          // not sampled — no bucket
          { id: "vt3", url: "https://t/3", caption: "", createTime: 1680000000, views: 30, likes: 3, comments: 0, saves: 0, shares: 0, musicOriginal: false, durationSec: 20 },
        ] as never,
      },
    });
    if ("error" in result) throw new Error(result.error);

    const c = new Client({ connectionString: TEST_URL });
    await c.connect();
    const rows = await c.query(
      "select platform_video_id id, temporal_bucket, status, transcript_text from content_items where observation_id = $1 order by platform_video_id",
      [result.observationId],
    );
    await c.end();
    type CiRow = { id: string; temporal_bucket: string | null; status: string; transcript_text: string | null };
    const byId = Object.fromEntries((rows.rows as CiRow[]).map((r) => [r.id, r]));
    expect(byId.vt1.temporal_bucket).toBe("recent");
    expect(byId.vt1.status).toBe("sampled");            // transcript-bearing, unchanged semantics
    expect(byId.vt2.temporal_bucket).toBe("mid");        // ← the fix: bucket without transcript
    expect(byId.vt2.status).toBe("discovered");          // status semantics untouched
    expect(byId.vt2.transcript_text).toBeNull();
    expect(byId.vt3.temporal_bucket).toBeNull();         // unsampled videos stay bucket-less
  });

  // Stability session (Part 1): the analyze mutation attaches a per-run memory
  // summary to EVERY terminal write — including clean successes — so the
  // --single-process before/after comparison is queryable from pipeline_runs.
  it("round-trips the memory instrumentation summary on a success row", async () => {
    const runId = newRunId();
    const memory = {
      singleProcess: true, samples: 12,
      peakNodeRssMb: 412.5, peakNodeHeapMb: 180.2,
      peakChromiumProcs: 1, peakChromiumRssMb: 640.0, peakContexts: 3,
      browserRelaunches: 1, relaunchTotalMs: 1450, crashRecoveries: 1,
    };
    await db.recordRunOutcome(runId, "success", { detail: { memory } });
    const row = await readRun(runId);
    expect(row!.status).toBe("success");
    const log = row!.error_log as { memory?: Record<string, unknown> };
    expect(log.memory).toMatchObject({ singleProcess: true, peakNodeRssMb: 412.5, peakChromiumProcs: 1, crashRecoveries: 1 });
  });
});
