/**
 * Session 8 correctness fixes — integration (ephemeral Postgres, NEVER prod).
 * Gated on TEST_DATABASE_URL; skips when unset. See server/integration/README.md.
 *
 * Covers:
 *  - Commit 2: creator.reanalyze on research failure creates NO observation and
 *    persists nothing (previously it fell through to an empty-evidence extraction
 *    that fabricated a profile). Plus a happy-path regression so the new guard
 *    does not block a legitimate re-analysis.
 *  - Commit 3: observations.transcript_count reflects only content_items rows
 *    ACTUALLY updated — a transcript whose video is not in the pool no longer
 *    inflates the count (and therefore the derived confidence level).
 *
 * Commit-1 telemetry semantics are unit-tested in server/scraping/httpClient.test.ts
 * (silent-failure evaluation is a pure predicate; the DB round-trip of
 * scrape_events is already covered by session7.integration.ts).
 */
import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Client } from "pg";
import { TRPCError } from "@trpc/server";

// Mock ONLY the two impure boundaries so re-analysis runs offline and
// deterministically. researchCreator (scraping) and extractCreatorProfile (LLM)
// are overridden; everything else in those modules — and all of db.ts /
// routers.ts — stays real, including buildCreatorExtractionPrompts used by the
// evidence-snapshot writer.
vi.mock("../webResearch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../webResearch")>();
  return { ...actual, researchCreator: vi.fn() };
});
vi.mock("../aiExtraction", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../aiExtraction")>();
  return { ...actual, extractCreatorProfile: vi.fn() };
});

import * as db from "../db";
import { appRouter, persistCreatorToV2 } from "../routers";
import { researchCreator } from "../webResearch";
import { extractCreatorProfile } from "../aiExtraction";
import { newRunId, withAnalysisRun } from "../_core/runContext";
import type { TrpcContext } from "../_core/context";

const TEST_URL = process.env.TEST_DATABASE_URL;
if (TEST_URL) process.env.DATABASE_URL = TEST_URL;

const suite = TEST_URL ? describe : describe.skip;
const here = path.dirname(fileURLToPath(import.meta.url));
const mockResearch = researchCreator as unknown as ReturnType<typeof vi.fn>;
const mockExtract = extractCreatorProfile as unknown as ReturnType<typeof vi.fn>;

// Minimal authenticated context for protectedProcedure (requirePilotAuth only
// reads ctx.authenticated; reanalyze is not rate-limited).
const authedCtx = {
  req: { headers: {}, ip: "10.0.0.1", socket: { remoteAddress: "10.0.0.1" }, protocol: "https" },
  res: {},
  authenticated: true,
} as unknown as TrpcContext;

suite("session 8: correctness fixes (ephemeral Postgres)", () => {
  let admin: Client;
  const count = async (text: string, params?: unknown[]) =>
    (await admin.query(`select count(*)::int c from ${text}`, params)).rows[0].c as number;
  const q = async (text: string, params?: unknown[]) => (await admin.query(text, params)).rows;

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
  });

  afterAll(async () => {
    await admin.end();
  });

  // ── Commit 3: honest transcript counting ────────────────────────────────────
  it("transcript_count counts only transcripts that land on a content_items row", async () => {
    // Pool has ONE video (v_match). The transcripts array has TWO entries: one
    // matching the pool video, one whose id (v_ghost) is NOT in the pool. Before
    // the fix, updateContentItemTranscript returned true for both → count 2.
    // After the fix, the non-matching update returns false → count 1.
    const result = await persistCreatorToV2({
      handle: "count_creator",
      platform: "TikTok",
      displayName: "Count Creator",
      extracted: { archetype: "The Sage" },
      researchData: {
        followerCount: 1000,
        discoveredVideoPoolJson: [
          {
            id: "v_match",
            url: "https://www.tiktok.com/@count_creator/video/v_match",
            caption: "a real video", createTime: 1700000000,
            views: 100, likes: 10, comments: 1, saves: 0, shares: 0,
            musicOriginal: false, durationSec: 30,
          },
        ],
        // transcriptSource "captions" is preserved exactly — this test does NOT
        // change what counts as evidence, only whether phantom updates count.
        transcripts: [
          { videoId: "v_match", transcript: "spoken words that were transcribed", wordCount: 5, transcriptSource: "captions" },
          { videoId: "v_ghost", transcript: "this video is not in the pool", wordCount: 6, transcriptSource: "captions" },
        ],
      },
    });
    if ("error" in result) throw new Error(result.error);
    expect(result.persistence.transcripts.status).toBe("success");

    // Exactly one content_items row exists (v_match); v_ghost was never written.
    const rows = await q(
      "select platform_video_id, transcript_text from content_items where subject_id=$1 order by platform_video_id",
      [result.subjectId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].platform_video_id).toBe("v_match");
    expect(rows[0].transcript_text).toBe("spoken words that were transcribed");

    // The observation's transcript_count reflects the ONE matched row, not 2.
    const obs = await q(
      "select transcript_count, data_confidence_level::text from observations where subject_id=$1",
      [result.subjectId],
    );
    expect(obs[0].transcript_count).toBe(1);
    // 1 transcript → "low" (>=6 high, >=3 medium). Confidence is honest, not inflated.
    expect(obs[0].data_confidence_level).toBe("low");
  });

  // ── Commit 2: reanalyze fails cleanly on research failure ────────────────────
  it("reanalyze on research failure creates no observation and persists nothing", async () => {
    const subjectId = await db.upsertSubject({
      subjectType: "creator", primaryHandle: "reanalyze_target", primaryPlatform: "tiktok",
      displayName: "Reanalyze Target", latestArchetype: "The Hero",
    });
    const obsId = await db.insertObservation(subjectId, { followerCount: 500, reviewStatus: "accepted" });
    await db.insertCreatorObservation(obsId, { archetype: "The Hero" });

    expect(await count("observations where subject_id=$1", [subjectId])).toBe(1);
    const creatorObsBefore = await count("creator_observations", []);

    // Simulate the scraper failing (bot block / no public content).
    mockResearch.mockRejectedValueOnce(
      new TRPCError({ code: "NOT_FOUND", message: "No public content found for @reanalyze_target." }),
    );

    const caller = appRouter.createCaller(authedCtx);
    await expect(caller.creator.reanalyze({ id: subjectId }))
      .rejects.toThrow(/reanalyze_target|No public content|could not collect/i);

    // Extraction was never reached; nothing new persisted.
    expect(mockExtract).not.toHaveBeenCalled();
    expect(await count("observations where subject_id=$1", [subjectId])).toBe(1);
    expect(await count("creator_observations", [])).toBe(creatorObsBefore);
    expect(await count("semantic_documents where subject_id=$1", [subjectId])).toBe(0);
  });

  // ── Commit 2: happy path still works (guard does not over-block) ─────────────
  it("reanalyze on successful research appends a new observation (regression guard)", async () => {
    const subjectId = await db.upsertSubject({
      subjectType: "creator", primaryHandle: "happy_target", primaryPlatform: "tiktok",
      displayName: "Happy Target", latestArchetype: "The Jester",
    });
    const obsId = await db.insertObservation(subjectId, { followerCount: 700, reviewStatus: "accepted" });
    await db.insertCreatorObservation(obsId, { archetype: "The Jester" });

    mockResearch.mockResolvedValueOnce({
      handle: "happy_target", platform: "TikTok", displayName: "Happy Target", bio: "a real bio",
      followerCount: 700, videoCount: 3, totalLikes: 10, totalViews: 100, avgViews: 33,
      engagementRate: 4.2, location: "", profileUrl: "https://www.tiktok.com/@happy_target",
      recentVideoTitles: ["t1"], topHashtags: ["#a"], rawKeywords: ["k"], contentThemeLabels: ["Theme"],
      contentThemes: ["Theme"], transcripts: [], transcriptCount: 0, transcriptExcerpts: "",
      // Non-empty evidence summary → the guard passes and extraction runs.
      evidenceSummary: "CREATOR RESEARCH EVIDENCE — @happy_target (TikTok)\nFollowers: 700",
    } as unknown as Awaited<ReturnType<typeof researchCreator>>);

    mockExtract.mockResolvedValueOnce({
      handle: "happy_target", platform: "TikTok", displayName: "Happy Target",
      archetype: "The Jester", pronouns: "not specified", recurringThemes: ["Comedy"],
      toneRegister: "playful", parasocialBondStrength: 3, audienceRelationshipType: "Friend",
      barthesMyth: "m", culturalCapital: "Relay", goffmanStageConsistency: "Consistent",
      driftSignal: "Zero Change", stuartHallDecoding: "Dominant", nicheTopicNode: "n",
      undergroundDensity: false, mainstreamBleed: true, remixRate: false, brandSaturation: false,
      rogersAdopterStage: "Early Majority", creatorNichePosition: "Consistent",
      lifecyclePhase: "Growth", barthesNicheMeaning: "x", turnerLiminalPhase: "Pre-Liminal",
      aiSummary: "ok",
    } as Awaited<ReturnType<typeof extractCreatorProfile>>);

    const caller = appRouter.createCaller(authedCtx);
    const res = await caller.creator.reanalyze({ id: subjectId });

    expect(mockExtract).toHaveBeenCalledTimes(1);
    expect(res.persistence.saved).not.toBe("none");
    // A new (pending) observation was appended — append-only re-analysis.
    expect(await count("observations where subject_id=$1", [subjectId])).toBe(2);
    expect(await count("observations where subject_id=$1 and review_status='pending'", [subjectId])).toBe(1);
  });

  // ── Commit 4: persist the 6-3-3 longitudinal sample ─────────────────────────
  it("writes temporal_bucket on rows AND a verbatim longitudinal-sample snapshot", async () => {
    const runId = newRunId();
    const sample = {
      recent: [{ videoId: "v_recent", transcript: "r", wordCount: 1, bucket: "recent" }],
      mid: [], anchor: [],
      totalFetched: 1, completeness: "insufficient", culturalVelocity: "Insufficient Data",
    };

    let subjectId = "", observationId = "";
    await withAnalysisRun(runId, async () => {
      const result = await persistCreatorToV2({
        handle: "longi_creator", platform: "TikTok", displayName: "Longi Creator",
        extracted: { archetype: "The Sage" },
        researchData: {
          followerCount: 5000,
          discoveredVideoPoolJson: [
            {
              id: "v_recent", url: "https://www.tiktok.com/@longi_creator/video/v_recent",
              caption: "recent one", createTime: 1700000000,
              views: 10, likes: 1, comments: 0, saves: 0, shares: 0, musicOriginal: false, durationSec: 30,
            },
          ],
          transcripts: [
            { videoId: "v_recent", transcript: "r", wordCount: 1, transcriptSource: "captions", bucket: "recent" },
          ],
          longitudinalSampleJson: sample,
        },
      });
      if ("error" in result) throw new Error(result.error);
      expect(result.persistence.longitudinal_sample.status).toBe("success");
      subjectId = result.subjectId;
      observationId = result.observationId;
    });

    // (a) temporal_bucket written on the transcript-bearing content_items row.
    const rows = await q(
      "select platform_video_id, temporal_bucket from content_items where subject_id=$1",
      [subjectId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].temporal_bucket).toBe("recent");

    // (b) verbatim snapshot doc exists, run-keyed, and round-trips exactly.
    const docs = await q(
      "select run_id from semantic_documents where subject_id=$1 and document_type='creator_longitudinal_sample'",
      [subjectId],
    );
    expect(docs).toHaveLength(1);
    expect(docs[0].run_id).toBe(runId);
    const readBack = await db.getLongitudinalSampleSnapshot(observationId);
    expect(readBack).toMatchObject({ totalFetched: 1, completeness: "insufficient", culturalVelocity: "Insufficient Data" });
    expect((readBack as any).recent[0].bucket).toBe("recent");

    // (c) diagnostic now reports the longitudinal sample as PRESENT (was always
    // missing before, because temporal_bucket was never written).
    const diag = await db.getRunDiagnostics(observationId);
    expect(diag?.fields.present).toContain("longitudinalSample");
    expect(diag?.fields.counts.temporalBuckets).toBeGreaterThan(0);
  });

  // ── Commit 5: mark computed vs estimated sociological fields ─────────────────
  it("records sociological-field provenance: computed (TikTok) vs estimated (IG)", async () => {
    // TikTok run WITH a computed engagement-signal block → "computed".
    const tk = await persistCreatorToV2({
      handle: "prov_tiktok", platform: "TikTok", displayName: "Prov TikTok",
      extracted: { archetype: "The Sage" },
      researchData: { followerCount: 1000, sociologicalFieldsComputed: true },
    });
    if ("error" in tk) throw new Error(tk.error);
    const tkDiag = await db.getRunDiagnostics(tk.observationId);
    expect(tkDiag?.sociologicalFieldsProvenance).toBe("computed");
    // The reserved _meta key is NOT treated as an enrichment component.
    expect(tkDiag?.enrichments.succeeded).not.toContain("_meta");
    expect(Object.keys(tkDiag?.enrichments.raw ?? {})).not.toContain("_meta");

    // Instagram run (no computed engagement signals) → "estimated".
    const ig = await persistCreatorToV2({
      handle: "prov_ig", platform: "Instagram", displayName: "Prov IG",
      extracted: { archetype: "The Lover" },
      researchData: { followerCount: 2000, sociologicalFieldsComputed: false },
    });
    if ("error" in ig) throw new Error(ig.error);
    const igDiag = await db.getRunDiagnostics(ig.observationId);
    expect(igDiag?.sociologicalFieldsProvenance).toBe("estimated");

    // Stored under the reserved persistence_status._meta key (raw jsonb).
    const rows = await q("select persistence_status from observations where id=$1", [ig.observationId]);
    expect((rows[0].persistence_status as Record<string, any>)._meta.sociologicalFieldsProvenance).toBe("estimated");
  });
});
