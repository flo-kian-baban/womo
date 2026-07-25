/**
 * Scraper-reliability session — integration coverage against the DISPOSABLE
 * Docker Postgres (never production). Same activation as the other suites:
 * TEST_DATABASE_URL gates everything; `pnpm test:db:up` → `pnpm test:integration`.
 *
 * What this proves at the DB layer (the work-order integration criteria):
 *   1. recordRunOutcome stamps captureHealth into pipeline_runs.error_log,
 *      derived from the run's REAL scrape_events — a run that used the
 *      transient-retry reads "degraded" with the right marker counts, and the
 *      run_type "creator_reanalysis" write shape lands (Part 4 parity).
 *   2. getRunDiagnostics surfaces the same assessment (field + plain-language
 *      consequence line) for the analyst panel.
 *   3. A first-try-clean run reads "clean"; near-floor evidence reads "thin".
 */
import { describe, it, expect, beforeAll } from "vitest";
import { Client } from "pg";
import * as db from "../db";
import { newRunId, withAnalysisRun } from "../_core/runContext";
import { persistCreatorToV2 } from "../routers";

const TEST_URL = process.env.TEST_DATABASE_URL;
if (TEST_URL) process.env.DATABASE_URL = TEST_URL;

const suite = TEST_URL ? describe : describe.skip;

suite("capture health + reanalyze telemetry (ephemeral Postgres)", () => {
  let client: Client;
  const q = async (sql: string, args: unknown[] = []) =>
    (await client.query(sql, args)).rows;

  beforeAll(async () => {
    // Deliberately NO schema drop/recreate here: this suite only needs the
    // tables to exist and keys every row off fresh runIds/handles.
    // db.integration.ts (alphabetically first; files run serially —
    // fileParallelism:false) applies the schema.sql mirror; adding another
    // drop cycle mid-sequence poisons the shared db.ts pool's cached query
    // plans for the suites that follow.
    client = new Client({ connectionString: TEST_URL });
    await client.connect();
    const [{ ok }] = (await client.query(
      "select exists(select 1 from information_schema.tables where table_name='pipeline_runs') ok",
    )).rows;
    if (!ok) throw new Error("schema missing — run the full `pnpm test:integration` (db.integration.ts applies the schema first)");
    return async () => { await client.end(); };
  }, 30_000);

  it("a retried run lands run_type=creator_reanalysis with captureHealth=degraded, and diagnostics surface it", async () => {
    const runId = newRunId();
    let observationId = "";

    await withAnalysisRun(runId, async () => {
      // As a real run would write them: one clean terminal profile event, one
      // superseded transient search attempt, and the retry's terminal success.
      await db.insertScrapeEvent({
        platform: "tiktok", scrapeMethod: "tiktok_playwright",
        urlRequested: "https://www.tiktok.com/@rel_creator#profile=profile_xhr_scroll:success",
        httpStatus: 200, durationMs: 900,
      });
      await db.insertScrapeEvent({
        platform: "tiktok", scrapeMethod: "tiktok_search_xhr",
        urlRequested: "https://www.tiktok.com/search/video?q=x#search=search_xhr_scroll:transient-retry",
        failureReason: "search search_xhr_scroll: transient — browserContext.newPage: Target page, context or browser has been closed",
        durationMs: 1200,
      });
      await db.insertScrapeEvent({
        platform: "tiktok", scrapeMethod: "tiktok_search_xhr",
        urlRequested: "https://www.tiktok.com/search/video?q=x#search=search_xhr_scroll:success-after-retry",
        httpStatus: 200, durationMs: 8000,
      });
      const result = await persistCreatorToV2({
        handle: "rel_creator", platform: "TikTok", displayName: "Reliability Creator",
        extracted: { archetype: "The Explorer" },
        researchData: { followerCount: 500 },
      });
      if ("error" in result) throw new Error(result.error);
      observationId = result.observationId;
    });

    await db.recordRunOutcome(runId, "success", {
      runType: "creator_reanalysis",
      captureEvidence: { transcripts: 8, titles: 20 },
    });

    const [run] = await q("select run_type, status, error_log from pipeline_runs where id=$1", [runId]);
    expect(run.run_type).toBe("creator_reanalysis");
    expect(run.status).toBe("success");
    const health = run.error_log?.captureHealth;
    expect(health?.status).toBe("degraded");
    expect(health?.supersededAttempts).toBe(1);
    expect(health?.retryOutcomes).toBe(1);
    expect(health?.thinEvidence).toBe(false);

    const diag = await db.getRunDiagnostics(observationId);
    expect(diag?.captureHealth.status).toBe("degraded");
    expect(diag?.scrapes.consequences.some(c => c.includes("Capture health: DEGRADED"))).toBe(true);
    // The superseded attempt must NOT count as a failed search query (panel math).
    expect(diag?.captureHealth.failedSearchQueries).toBe(0);
  });

  it("a first-try-clean run reads clean, with no capture-health consequence line", async () => {
    const runId = newRunId();
    let observationId = "";
    await withAnalysisRun(runId, async () => {
      await db.insertScrapeEvent({
        platform: "tiktok", scrapeMethod: "tiktok_playwright",
        urlRequested: "https://www.tiktok.com/@clean_creator#profile=profile_xhr_scroll:success",
        httpStatus: 200, durationMs: 700,
      });
      const result = await persistCreatorToV2({
        handle: "clean_creator", platform: "TikTok", displayName: "Clean Creator",
        extracted: { archetype: "The Sage" },
        researchData: { followerCount: 50 },
      });
      if ("error" in result) throw new Error(result.error);
      observationId = result.observationId;
    });
    await db.recordRunOutcome(runId, "success", {
      captureEvidence: { transcripts: 8, titles: 20 },
    });

    const [run] = await q("select error_log from pipeline_runs where id=$1", [runId]);
    expect(run.error_log?.captureHealth?.status).toBe("clean");
    const diag = await db.getRunDiagnostics(observationId);
    expect(diag?.captureHealth.status).toBe("clean");
    expect(diag?.scrapes.consequences.some(c => c.includes("Capture health"))).toBe(false);
  });

  it("near-floor evidence reads thin (reporting only — the run itself proceeded)", async () => {
    const runId = newRunId();
    await withAnalysisRun(runId, async () => {
      await db.insertScrapeEvent({
        platform: "tiktok", scrapeMethod: "tiktok_playwright",
        urlRequested: "https://www.tiktok.com/@thin_creator#profile=profile_xhr_scroll:success",
        httpStatus: 200, durationMs: 700,
      });
    });
    await db.recordRunOutcome(runId, "success", {
      captureEvidence: { transcripts: 2, titles: 4 },
    });
    const [run] = await q("select error_log from pipeline_runs where id=$1", [runId]);
    expect(run.error_log?.captureHealth?.status).toBe("thin");
    expect(run.error_log?.captureHealth?.thinEvidence).toBe(true);
  });
});
