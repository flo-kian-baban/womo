/**
 * Session 6 integration tests — review gate + run-id provenance + diagnostics.
 * Runs against a DISPOSABLE local Docker Postgres, never production
 * (gated on TEST_DATABASE_URL exactly like db.integration.ts).
 *
 * Covers the required behaviors:
 *  - run id correctly stamped (observation + scrape_events + llm_invocations)
 *    and queried exactly;
 *  - review lifecycle: first-run pending is authoritative; a rerun's pending
 *    observation waits while the accepted one stays authoritative; accept
 *    transfers is_latest; decline retains everything (never deletes) and
 *    promotes the newest accepted;
 *  - declined data retained but excluded from default library queries,
 *    browsable via the archive listing;
 *  - matching eligibility: fit.calculate rejects non-accepted creators
 *    (filter only — the scoring engine is never reached);
 *  - diagnostic breakdown returns accurate data for a seeded run, including
 *    both skip kinds.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Client } from "pg";
import * as db from "../db";
import { persistCreatorToV2, appRouter } from "../routers";
import { newRunId, withAnalysisRun } from "../_core/runContext";

const TEST_URL = process.env.TEST_DATABASE_URL;
if (TEST_URL) process.env.DATABASE_URL = TEST_URL;

const suite = TEST_URL ? describe : describe.skip;
const here = path.dirname(fileURLToPath(import.meta.url));

suite("review gate + run provenance (ephemeral Postgres)", () => {
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
    await admin.query("SET search_path TO public;");
  });

  afterAll(async () => {
    await admin.end();
  });

  // ── Run-id stamping ────────────────────────────────────────────────────────

  it("stamps the run id on the observation, scrape events, and llm invocations, and queries it exactly", async () => {
    const runId = newRunId();
    let subjectId = "", observationId = "";

    await withAnalysisRun(runId, async () => {
      // As the pipeline would: provenance rows are written BEFORE persistence.
      await db.insertScrapeEvent({
        platform: "tiktok", scrapeMethod: "tiktok_desktop_http",
        urlRequested: "https://www.tiktok.com/@runid_creator", httpStatus: 200,
        responseSizeBytes: 12345, durationMs: 800,
      });
      await db.insertLlmInvocation({
        purpose: "creator_extraction", model: "gemini-2.5-flash",
        inputTokens: 1000, outputTokens: 200, durationMs: 1500,
      });
      const result = await persistCreatorToV2({
        handle: "runid_creator", platform: "TikTok", displayName: "RunId Creator",
        extracted: { archetype: "The Sage" },
        researchData: { followerCount: 10 },
      });
      if ("error" in result) throw new Error(result.error);
      subjectId = result.subjectId;
      observationId = result.observationId;
    });

    const [obs] = await q("select run_id from observations where id=$1", [observationId]);
    expect(obs.run_id).toBe(runId);
    expect(await count("scrape_events where run_id=$1", [runId])).toBe(1);
    expect(await count("llm_invocations where run_id=$1", [runId])).toBe(1);

    // Exact per-run token lookup (replaces time-window inference)
    const usage = await db.getLlmTokenUsageByRunId(runId);
    expect(usage).toMatchObject({ inputTokens: 1000, outputTokens: 200, totalTokens: 1200, llmCalls: 1 });

    // Rows written OUTSIDE a run context carry no run id
    await db.insertScrapeEvent({ platform: "tiktok", scrapeMethod: "tiktok_desktop_http", httpStatus: 200 });
    expect(await count("scrape_events where run_id is null")).toBeGreaterThanOrEqual(1);
  });

  // ── Review lifecycle ───────────────────────────────────────────────────────

  it("walks the full review lifecycle with correct is_latest authority at every step", async () => {
    // (a) First run: pending AND authoritative (no accepted observation exists)
    const r1 = await persistCreatorToV2({
      handle: "lifecycle_creator", platform: "TikTok", displayName: "Lifecycle Creator",
      extracted: { archetype: "The Hero" },
      researchData: { followerCount: 100, rawKeywords: ["first"] },
    });
    if ("error" in r1) throw new Error(r1.error);
    let [row] = await q("select is_latest, review_status from observations where id=$1", [r1.observationId]);
    expect(row).toMatchObject({ is_latest: true, review_status: "pending" });

    // (b) Accept → stays authoritative, review metadata recorded
    await db.setObservationReviewStatus(r1.observationId, "accepted", "Analyst A");
    [row] = await q("select is_latest, review_status, reviewed_by from observations where id=$1", [r1.observationId]);
    expect(row).toMatchObject({ is_latest: true, review_status: "accepted", reviewed_by: "Analyst A" });

    // (c) Rerun: new pending observation does NOT take authority
    const r2 = await persistCreatorToV2({
      handle: "lifecycle_creator", platform: "TikTok", displayName: "Lifecycle Creator",
      extracted: { archetype: "The Explorer" },
      researchData: { followerCount: 200, rawKeywords: ["second"] },
    });
    if ("error" in r2) throw new Error(r2.error);
    expect(r2.subjectId).toBe(r1.subjectId); // same subject, append-only observation
    [row] = await q("select is_latest, review_status from observations where id=$1", [r2.observationId]);
    expect(row).toMatchObject({ is_latest: false, review_status: "pending" });
    [row] = await q("select is_latest from observations where id=$1", [r1.observationId]);
    expect(row.is_latest).toBe(true); // accepted run remains authoritative

    // The profile getter shows the ACCEPTED run and flags the pending rerun;
    // the pending run's list data does not bleed in.
    const profile = (await db.getCreatorProfileById(r1.subjectId)) as any;
    expect(profile.observationId).toBe(r1.observationId);
    expect(profile.archetype).toBe("The Hero");
    expect(profile.reviewStatus).toBe("accepted");
    expect(profile.pendingObservation?.id).toBe(r2.observationId);
    expect(profile.rawKeywords).toEqual(["first"]); // no bleed from the pending run

    // (d) Accept the rerun → authority transfers
    await db.setObservationReviewStatus(r2.observationId, "accepted", "Analyst B");
    const latest = await q("select id, is_latest from observations where subject_id=$1 and is_latest", [r1.subjectId]);
    expect(latest).toHaveLength(1);
    expect(latest[0].id).toBe(r2.observationId);

    // (e) Third run pending, then declined → nothing deleted, authority unchanged
    const r3 = await persistCreatorToV2({
      handle: "lifecycle_creator", platform: "TikTok", displayName: "Lifecycle Creator",
      extracted: { archetype: "The Jester" },
      researchData: { followerCount: 300 },
    });
    if ("error" in r3) throw new Error(r3.error);
    await db.setObservationReviewStatus(r3.observationId, "declined", "Analyst A");
    [row] = await q("select is_latest, review_status from observations where id=$1", [r3.observationId]);
    expect(row).toMatchObject({ is_latest: false, review_status: "declined" });
    expect(await count("observations where id=$1", [r3.observationId])).toBe(1); // retained
    expect(await count("creator_observations where observation_id=$1", [r3.observationId])).toBe(1); // retained
    const stillLatest = await q("select id from observations where subject_id=$1 and is_latest", [r1.subjectId]);
    expect(stillLatest[0].id).toBe(r2.observationId);

    // (f) Declining the current authoritative accepted run promotes the newest remaining accepted
    await db.setObservationReviewStatus(r2.observationId, "declined", "Analyst A");
    const promoted = await q("select id from observations where subject_id=$1 and is_latest", [r1.subjectId]);
    expect(promoted).toHaveLength(1);
    expect(promoted[0].id).toBe(r1.observationId);
  });

  // ── Declined: retained, excluded from defaults, browsable in archive ───────

  it("retains declined-only subjects' data but excludes them from default library queries", async () => {
    const r = await persistCreatorToV2({
      handle: "declined_only_creator", platform: "TikTok", displayName: "Declined Only",
      extracted: { archetype: "The Outlaw" },
      researchData: { followerCount: 50, rawKeywords: ["kw"] },
    });
    if ("error" in r) throw new Error(r.error);
    await db.setObservationReviewStatus(r.observationId, "declined", "Analyst B");

    // Retained with full provenance — never hard-deleted
    expect(await count("observations where id=$1", [r.observationId])).toBe(1);
    expect(await count("signal_values where observation_id=$1", [r.observationId])).toBe(1);

    // Excluded from the default library view (no is_latest row survives)
    const listed = await db.listCreatorProfiles();
    expect(listed.some((c: any) => c.handle === "declined_only_creator")).toBe(false);

    // Browsable via the archive listing
    const archived = await db.listArchivedCreatorRuns();
    const entry = archived.find(a => a.observationId === r.observationId);
    expect(entry).toBeTruthy();
    expect(entry!.handle).toBe("declined_only_creator");
    expect(entry!.reviewedBy).toBe("Analyst B");
  });

  // ── Matching eligibility ───────────────────────────────────────────────────

  it("excludes non-accepted creators from matchable listings and fit.calculate", async () => {
    const r = await persistCreatorToV2({
      handle: "pending_matcher", platform: "TikTok", displayName: "Pending Matcher",
      extracted: { archetype: "The Lover" },
      researchData: { followerCount: 500 },
    });
    if ("error" in r) throw new Error(r.error);

    // Default list shows the pending profile (marked); matchableOnly excludes it
    const defaultList = await db.listCreatorProfiles();
    expect(defaultList.some((c: any) => c.handle === "pending_matcher" && c.reviewStatus === "pending")).toBe(true);
    const matchable = await db.listCreatorProfiles(undefined, undefined, { matchableOnly: true });
    expect(matchable.some((c: any) => c.handle === "pending_matcher")).toBe(false);

    // Seed a brand (ungated this session — persists as accepted)
    const brandId = await db.upsertSubject({ subjectType: "brand", displayName: "Eligibility Brand" });
    const bObs = await db.insertObservation(brandId, {});
    await db.insertBrandObservation(bObs, { brandArchetypeClassification: "Trust", archetype: "The Ruler" });
    const [bRow] = await q("select review_status, is_latest from observations where id=$1", [bObs]);
    expect(bRow).toMatchObject({ review_status: "accepted", is_latest: true }); // brand behavior unchanged

    // fit.calculate rejects the pending creator BEFORE any scoring/LLM work
    const caller = appRouter.createCaller({
      authenticated: true,
      req: { ip: "127.0.0.1", headers: {} },
      res: {},
    } as any);
    await expect(
      caller.fit.calculate({ creatorProfileId: r.subjectId, brandProfileId: brandId }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });

    // Declined creators are equally ineligible
    await db.setObservationReviewStatus(r.observationId, "declined", "Analyst A");
    await expect(
      caller.fit.calculate({ creatorProfileId: r.subjectId, brandProfileId: brandId }),
    ).rejects.toThrow(); // profile getter finds no authoritative observation
  });

  // ── Diagnostics accuracy ───────────────────────────────────────────────────

  it("returns an accurate diagnostic breakdown for a seeded run, distinguishing both skip kinds", async () => {
    const runId = newRunId();
    let observationId = "";

    await withAnalysisRun(runId, async () => {
      await db.insertScrapeEvent({
        platform: "tiktok", scrapeMethod: "tiktok_desktop_http",
        urlRequested: "https://www.tiktok.com/@diag_creator", httpStatus: 200,
        responseSizeBytes: 50_000, durationMs: 700,
      });
      await db.insertScrapeEvent({
        platform: "instagram", scrapeMethod: "instagram_playwright",
        urlRequested: "https://www.instagram.com/diag_creator/", httpStatus: 403,
        failureReason: "HTTP 403 Forbidden for https://www.instagram.com/diag_creator/", durationMs: 400,
      });
      await db.insertLlmInvocation({
        purpose: "creator_extraction", model: "gemini-2.5-flash",
        inputTokens: 2000, outputTokens: 500, durationMs: 3000,
      });
      await db.insertLlmInvocation({
        purpose: "symbol_decoding", model: "gemini-2.5-flash",
        status: "failed", errorMessage: "Gemini API request timed out after 60000ms", durationMs: 60_000,
      });
      const result = await persistCreatorToV2({
        handle: "diag_creator", platform: "TikTok", displayName: "Diag Creator",
        extracted: { archetype: "The Magician" },
        researchData: {
          followerCount: 1234,
          rawKeywords: ["x".repeat(600)], // poison → signal_values enrichment fails
          decodedSymbols: {
            identityClaims: [{ phrase: "diag", meaning: "test", informs: [] }],
            symbolicSummary: "s",
          },
          // no videos, no transcripts → skipped_no_data components
        },
      });
      if ("error" in result) throw new Error(result.error);
      observationId = result.observationId;
    });

    const d = await db.getRunDiagnostics(observationId);
    expect(d).toBeTruthy();
    expect(d!.runId).toBe(runId);
    expect(d!.exactRunLinkage).toBe(true);
    expect(d!.reviewStatus).toBe("pending");

    // Scrapes: 1 tiktok ok, 1 instagram failed with reason + status
    expect(d!.scrapes.total).toBe(2);
    expect(d!.scrapes.failed).toBe(1);
    const ig = d!.scrapes.byPlatform.find(p => p.platform === "instagram")!;
    expect(ig).toMatchObject({ attempts: 1, failed: 1, succeeded: 0 });
    expect(ig.events[0]).toMatchObject({ httpStatus: 403, method: "instagram_playwright" });
    expect(ig.events[0].failureReason).toContain("403");

    // LLM: 2 calls, 1 failed with error text + duration; exact tokens + cost
    expect(d!.llm.calls).toBe(2);
    expect(d!.llm.failed).toBe(1);
    expect(d!.llm.failures[0]).toMatchObject({ purpose: "symbol_decoding", durationMs: 60_000 });
    expect(d!.llm.failures[0].errorMessage).toContain("timed out");
    expect(d!.llm.inputTokens).toBe(2000);
    expect(d!.llm.outputTokens).toBe(500);
    expect(d!.llm.costUsd).toBeGreaterThan(0);

    // Enrichments: failed vs the two distinct skip kinds
    expect(d!.enrichments.failed.map(f => f.component)).toContain("signal_values");
    expect(d!.enrichments.failed.find(f => f.component === "signal_values")!.reason).toMatch(/too long/i);
    expect(d!.enrichments.succeeded).toContain("decoded_signals");
    expect(d!.enrichments.skippedNoData.map(s => s.component)).toEqual(
      expect.arrayContaining(["content_items", "transcripts", "avg_video_duration"]),
    );

    // Field presence reflects what was actually produced
    expect(d!.fields.present).toEqual(expect.arrayContaining(["followerCount", "archetype", "decodedSymbols"]));
    expect(d!.fields.missing).toEqual(expect.arrayContaining(["bio", "contentThemes", "longitudinalSample"]));
    expect(d!.fields.counts.decodedSignals).toBe(1);
    expect(d!.fields.counts.keywords).toBe(0); // the poisoned write persisted nothing

    // Factual summary includes the scrape failure with its HTTP status
    expect(d!.summary.join(" | ")).toContain("instagram: 1 of 1 scrapes failed");
    expect(d!.summary.join(" | ")).toContain("2 LLM calls, 1 failed");
  });
});
