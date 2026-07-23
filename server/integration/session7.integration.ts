/**
 * Session 7 integration tests — evidence snapshots, music metadata, and
 * instrumented scrape-event shapes. Runs against a DISPOSABLE local Docker
 * Postgres, never production (gated on TEST_DATABASE_URL like the others).
 *
 * Covers the required behaviors:
 *  - evidence snapshot (structured inputs + exact prompt) written per run and
 *    retrievable by run_id; one-set-per-run enforced by the partial unique
 *    index; skipped_not_attempted recorded when no payload is supplied;
 *  - creator music metadata persisted to content_items and returned by the
 *    read model in the exact shape fit.calculate reads
 *    (transcripts[].musicMetadata.soundName);
 *  - scrape_events written through recordScrapeEvent() — the single logging
 *    path used by every newly instrumented collection path — with run_id
 *    stamping and the new event shapes (tiktok_playwright, yelp via
 *    website_crawl, whisper_transcription with null platform).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Client } from "pg";
import * as db from "../db";
import { canonicalizeHandle } from "../_core/handles";
import { persistCreatorToV2 } from "../routers";
import { buildCreatorExtractionPrompts } from "../aiExtraction";
import { recordScrapeEvent } from "../scraping/httpClient";
import { newRunId, withAnalysisRun } from "../_core/runContext";

const TEST_URL = process.env.TEST_DATABASE_URL;
if (TEST_URL) process.env.DATABASE_URL = TEST_URL;

const suite = TEST_URL ? describe : describe.skip;
const here = path.dirname(fileURLToPath(import.meta.url));

suite("session 7: snapshots, music metadata, instrumented telemetry (ephemeral Postgres)", () => {
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

  // ── Evidence snapshots ─────────────────────────────────────────────────────

  it("writes both snapshot documents per run, retrievable by run_id, byte-identical prompt", async () => {
    const runId = newRunId();
    const evidenceSummary = "CREATOR RESEARCH EVIDENCE — @snap_creator (TikTok)\nFollowers: 42";
    const prompts = buildCreatorExtractionPrompts("snap_creator", "TikTok", evidenceSummary);
    const inputsJson = JSON.stringify({
      schemaVersion: 1,
      handleOrUrl: "snap_creator",
      platform: "TikTok",
      evidenceSummary,
      structuredInputs: { followerCount: 42, videoTitles: ["t1"] },
    });

    let subjectId = "", observationId = "";
    await withAnalysisRun(runId, async () => {
      const result = await persistCreatorToV2({
        handle: "snap_creator", platform: "TikTok", displayName: "Snap Creator",
        extracted: { archetype: "The Sage" },
        researchData: { followerCount: 42 },
        evidenceSnapshot: {
          inputsJson,
          promptText: prompts.userPrompt,
          promptMeta: {
            systemPrompt: prompts.systemPrompt,
            model: prompts.model,
            purpose: prompts.purpose,
            temperature: prompts.temperature,
          },
        },
      });
      if ("error" in result) throw new Error(result.error);
      subjectId = result.subjectId;
      observationId = result.observationId;
      expect(result.persistence.evidence_snapshot.status).toBe("success");
    });

    const docs = await db.getEvidenceSnapshotsByRunId(runId);
    expect(docs).toHaveLength(2);
    const inputsDoc = docs.find(d => d.documentType === "creator_evidence_inputs")!;
    const promptDoc = docs.find(d => d.documentType === "creator_extraction_prompt")!;
    expect(inputsDoc).toBeTruthy();
    expect(promptDoc).toBeTruthy();

    // Tied to subject + observation + run
    for (const d of [inputsDoc, promptDoc]) {
      expect(d.subjectId).toBe(subjectId);
      expect(d.observationId).toBe(observationId);
      expect(d.runId).toBe(runId);
    }

    // Structured inputs round-trip
    const parsedInputs = JSON.parse(inputsDoc.contentText);
    expect(parsedInputs.handleOrUrl).toBe("snap_creator");
    expect(parsedInputs.evidenceSummary).toBe(evidenceSummary);
    expect(parsedInputs.structuredInputs.followerCount).toBe(42);

    // The persisted prompt is byte-identical to the builder output (which is
    // the same builder extractCreatorProfile uses)
    expect(promptDoc.contentText).toBe(prompts.userPrompt);
    expect(promptDoc.contentText).toContain(evidenceSummary); // evidence embedded
    const meta = promptDoc.metadata as Record<string, unknown>;
    expect(meta.systemPrompt).toBe(prompts.systemPrompt);
    expect(meta.temperature).toBe(0);
    expect(meta.purpose).toBe("creator_profile_extraction");

    // One snapshot set per run: a duplicate write for the same run REJECTS
    // (append-only history — never replaced)
    await expect(withAnalysisRun(runId, () => db.insertEvidenceSnapshots({
      subjectId, observationId, kindPrefix: "creator",
      inputsJson: "{}", promptText: "dup", promptMeta: {},
    }))).rejects.toThrow();
    expect(await count("semantic_documents where run_id=$1", [runId])).toBe(2);
  });

  it("records skipped_not_attempted when no snapshot payload is supplied", async () => {
    const result = await persistCreatorToV2({
      handle: "no_snap_creator", platform: "TikTok", displayName: "No Snap",
      extracted: { archetype: "The Hero" },
      researchData: { followerCount: 7 },
    });
    if ("error" in result) throw new Error(result.error);
    expect(result.persistence.evidence_snapshot.status).toBe("skipped_not_attempted");
    expect(await count("semantic_documents where subject_id=$1", [result.subjectId])).toBe(0);
  });

  // ── Music metadata (J-4 creator side) ──────────────────────────────────────

  it("persists real music metadata and returns it in the shape fit.calculate reads", async () => {
    const result = await persistCreatorToV2({
      handle: "music_creator", platform: "TikTok", displayName: "Music Creator",
      extracted: { archetype: "The Jester" },
      researchData: {
        followerCount: 900,
        discoveredVideoPoolJson: [
          {
            id: "v-music-1", url: "https://www.tiktok.com/@music_creator/video/v-music-1",
            caption: "dance video", createTime: 1700000000,
            views: 1000, likes: 100, comments: 10, saves: 5, shares: 2,
            musicOriginal: false, musicTitle: "Espresso", musicArtist: "Sabrina Carpenter",
            durationSec: 30, transcriptText: "hello world this is a transcript",
            transcriptWordCount: 6, transcriptSource: "captions",
          },
          {
            id: "v-music-2", url: "https://www.tiktok.com/@music_creator/video/v-music-2",
            caption: "no music no transcript", createTime: 1700000100,
            views: 500, likes: 50, comments: 5, saves: 1, shares: 1,
            musicOriginal: true, durationSec: 20,
          },
        ],
      },
    });
    if ("error" in result) throw new Error(result.error);

    // Stored on content_items (real values, NULL when absent — not '')
    const rows = await q(
      "select platform_video_id, music_title, music_artist from content_items where subject_id=$1 order by platform_video_id",
      [result.subjectId],
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ platform_video_id: "v-music-1", music_title: "Espresso", music_artist: "Sabrina Carpenter" });
    expect(rows[1].music_title).toBeNull();

    // Read model: transcripts[].musicMetadata.soundName — exactly what
    // fit.calculate consumes for creator-side music overlap
    const profile = (await db.getCreatorProfileById(result.subjectId)) as any;
    expect(Array.isArray(profile.transcripts)).toBe(true);
    expect(profile.transcripts).toHaveLength(1); // only transcript-bearing rows
    expect(profile.transcripts[0].musicMetadata?.soundName).toBe("Espresso");

    // The exact extraction fit.calculate performs yields a non-empty title set
    const creatorMusicTitles = (profile.transcripts as Array<Record<string, any>>)
      .map(t => t.musicMetadata?.soundName as string | undefined)
      .filter((s): s is string => Boolean(s));
    expect(creatorMusicTitles).toEqual(["Espresso"]);
  });

  // ── Handle canonicalization + duplicate pre-flight ─────────────────────────

  it("canonicalizes handles at persist time so casing/@/URL variants map to ONE subject", async () => {
    expect(canonicalizeHandle("@Dup.Creator")).toBe("dup.creator");
    expect(canonicalizeHandle("https://www.tiktok.com/@Dup.Creator/")).toBe("dup.creator");
    expect(canonicalizeHandle("DUP.CREATOR")).toBe("dup.creator");

    // First analysis with an LLM-echo-style mixed-case handle
    const r1 = await persistCreatorToV2({
      handle: "Dup.Creator", platform: "TikTok", displayName: "Dup Creator",
      extracted: { archetype: "The Sage" },
      researchData: { followerCount: 10 },
    });
    if ("error" in r1) throw new Error(r1.error);

    // Second analysis with bulk-style raw input variants → SAME subject
    const r2 = await persistCreatorToV2({
      handle: "@dup.creator", platform: "TikTok", displayName: "Dup Creator",
      extracted: { archetype: "The Sage" },
      researchData: { followerCount: 11 },
    });
    if ("error" in r2) throw new Error(r2.error);
    expect(r2.subjectId).toBe(r1.subjectId);

    // Stored form is canonical (lowercase, no @)
    const [subj] = await q("select primary_handle from subjects where id=$1", [r1.subjectId]);
    expect(subj.primary_handle).toBe("dup.creator");
    expect(await count("subjects where lower(primary_handle)='dup.creator'")).toBe(1);
  });

  it("pre-flight lookup finds the existing subject from any input variant, with review summary", async () => {
    const r = await persistCreatorToV2({
      handle: "preflight_creator", platform: "TikTok", displayName: "Preflight Creator",
      extracted: { archetype: "The Hero" },
      researchData: { followerCount: 55 },
    });
    if ("error" in r) throw new Error(r.error);
    await db.setObservationReviewStatus(r.observationId, "accepted", "Analyst A");

    for (const variant of ["preflight_creator", "@PREFLIGHT_CREATOR", "https://www.tiktok.com/@Preflight_Creator"]) {
      const found = await db.findExistingCreatorByHandle(variant, "TikTok");
      expect(found?.subjectId).toBe(r.subjectId);
      expect(found?.reviewStatus).toBe("accepted");
      expect(found?.lastAnalyzedAt).toBeTruthy();
    }

    // A pending rerun surfaces in the summary
    const rerun = await persistCreatorToV2({
      handle: "preflight_creator", platform: "TikTok", displayName: "Preflight Creator",
      extracted: { archetype: "The Hero" },
      researchData: { followerCount: 56 },
    });
    if ("error" in rerun) throw new Error(rerun.error);
    const found = await db.findExistingCreatorByHandle("preflight_creator", "TikTok");
    expect(found?.pendingObservation?.id).toBe(rerun.observationId);

    // Unknown handle → null
    expect(await db.findExistingCreatorByHandle("does_not_exist_xyz", "TikTok")).toBeNull();
  });

  // ── Instrumented scrape-event shapes ───────────────────────────────────────

  it("recordScrapeEvent (the single path used by all instrumented scrapers) writes run-tagged events", async () => {
    const runId = newRunId();
    await withAnalysisRun(runId, async () => {
      // The three new event shapes introduced by Session 7 instrumentation:
      recordScrapeEvent({
        platform: "tiktok", scrapeMethod: "tiktok_playwright",
        urlRequested: "https://www.tiktok.com/@instrumented", httpStatus: 200,
        responseSizeBytes: 123456, silentFailureDetected: false, durationMs: 4200,
      });
      recordScrapeEvent({
        platform: "yelp", scrapeMethod: "website_crawl",
        urlRequested: "https://www.yelp.com/biz/instrumented", httpStatus: 403,
        silentFailureDetected: true, failureReason: "Yelp anti-bot (DataDome) block on business page",
        durationMs: 900,
      });
      recordScrapeEvent({
        scrapeMethod: "whisper_transcription",
        urlRequested: "https://cdn.example.com/reel.mp4",
        failureReason: "TRANSCRIPTION_FAILED: No speech detected", durationMs: 3000,
      });
      // recordScrapeEvent is fire-and-forget — wait for the inserts to land
      for (let i = 0; i < 20; i++) {
        if (await count("scrape_events where run_id=$1", [runId]) >= 3) break;
        await new Promise(r => setTimeout(r, 100));
      }
    });

    const events = await q(
      "select platform::text, scrape_method::text, http_status, silent_failure_detected, failure_reason, run_id from scrape_events where run_id=$1 order by scrape_method",
      [runId],
    );
    expect(events).toHaveLength(3);

    const playwright = events.find(e => e.scrape_method === "tiktok_playwright")!;
    expect(playwright).toMatchObject({ platform: "tiktok", http_status: 200, silent_failure_detected: false, run_id: runId });

    const yelp = events.find(e => e.scrape_method === "website_crawl")!;
    expect(yelp).toMatchObject({ platform: "yelp", http_status: 403, silent_failure_detected: true });
    expect(yelp.failure_reason).toContain("DataDome");

    const whisper = events.find(e => e.scrape_method === "whisper_transcription")!;
    expect(whisper.platform).toBeNull(); // transcription layer doesn't know the platform
    expect(whisper.failure_reason).toContain("No speech detected");
  });
});
