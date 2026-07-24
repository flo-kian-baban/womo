/**
 * Session 9 — panel truthfulness & transcript honesty (ephemeral Postgres).
 * Gated on TEST_DATABASE_URL; skips when unset. See server/integration/README.md.
 *
 * Coverage grows across the Session 9 commits:
 *  - B3: read model orders transcript evidence by value (speech first, then word
 *    count), NOT by view count; discovered pool keeps view order; source fields exposed.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Client } from "pg";
import * as db from "../db";
import { persistCreatorToV2 } from "../routers";
import { TRANSCRIPT_SOURCE } from "@shared/transcriptSource";
import { newRunId, withAnalysisRun } from "../_core/runContext";

const TEST_URL = process.env.TEST_DATABASE_URL;
if (TEST_URL) process.env.DATABASE_URL = TEST_URL;

const suite = TEST_URL ? describe : describe.skip;
const here = path.dirname(fileURLToPath(import.meta.url));

suite("session 9: panel truthfulness (ephemeral Postgres)", () => {
  let admin: Client;

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

  afterAll(async () => { await admin.end(); });

  // ── B3: transcript evidence ordered by value, not views ─────────────────────
  it("orders transcripts speech-first then word-count-desc; pool stays view-ordered", async () => {
    // v_viral: a 95M-view clip whose only 'transcript' is a 20-word POST CAPTION.
    // v_speech: a 400K-view clip with a 1645-word SUBTITLE (real speech).
    // Old behavior surfaced v_viral first (view_count DESC). New: v_speech first.
    const result = await persistCreatorToV2({
      handle: "order_creator", platform: "TikTok", displayName: "Order Creator",
      extracted: { archetype: "The Sage" },
      researchData: {
        followerCount: 187200,
        discoveredVideoPoolJson: [
          { id: "v_viral", url: "https://www.tiktok.com/@order_creator/video/v_viral",
            caption: "They said it couldn't be done #hooverdam", createTime: 1699000000,
            views: 95300000, likes: 8400000, comments: 22700, saves: 0, shares: 0, musicOriginal: false, durationSec: 20 },
          { id: "v_speech", url: "https://www.tiktok.com/@order_creator/video/v_speech",
            caption: "an urgency brothers and sisters", createTime: 1690000000,
            views: 424500, likes: 74300, comments: 2918, saves: 0, shares: 0, musicOriginal: false, durationSec: 300 },
        ],
        transcripts: [
          { videoId: "v_viral", transcript: "They said it couldn't be done. So we did it.", wordCount: 20, transcriptSource: TRANSCRIPT_SOURCE.postCaption, bucket: "mid" },
          { videoId: "v_speech", transcript: "So I've had it on my heart to do this video for weeks now about the urgency…", wordCount: 1645, transcriptSource: TRANSCRIPT_SOURCE.subtitle, bucket: "anchor" },
        ],
      },
    });
    if ("error" in result) throw new Error(result.error);

    const profile = (await db.getCreatorProfileById(result.subjectId)) as any;
    const excerpts = profile.transcriptExcerpts as Array<any>;
    expect(excerpts).toHaveLength(2);

    // Speech transcript first, even though it has far fewer views.
    expect(excerpts[0].videoId).toBe("v_speech");
    expect(excerpts[0].sourceKind).toBe("speech");
    expect(excerpts[0].sourceLabel).toBe("Subtitle track");
    expect(excerpts[1].videoId).toBe("v_viral");
    expect(excerpts[1].sourceKind).toBe("caption");
    expect(excerpts[1].sourceLabel).toBe("Post caption");

    // The discovered pool is unchanged — still highest-view first.
    const pool = profile.discoveredVideoPoolJson as Array<any>;
    expect(pool[0].id).toBe("v_viral"); // 95.3M views leads the pool

    // The music round-trip array (fit.calculate input) is order-agnostic but must
    // still contain both, unaffected by the reorder.
    expect((profile.transcripts as Array<any>).map(t => t.videoId).sort()).toEqual(["v_speech", "v_viral"]);
  });

  // ── A3/A4/A5/A6/A8/A9: getRunDiagnostics richer + honest ────────────────────
  it("diagnostic returns coverage, confidence/velocity rationale, provenance, field-provenance, consequences, temperature", async () => {
    const runId = newRunId();
    let observationId = "";
    await withAnalysisRun(runId, async () => {
      // A failed search scrape (→ consequence) + a temperature-tagged LLM call.
      await db.insertScrapeEvent({
        platform: "tiktok", scrapeMethod: "tiktok_search_html", httpStatus: 200,
        silentFailureDetected: true, failureReason: "no results via XHR interception or HTML parse",
      });
      await db.insertLlmInvocation({
        purpose: "creator_profile_extraction", model: "gemini-2.5-flash",
        temperature: 0, status: "success", inputTokens: 6960, outputTokens: 477,
      });
      const result = await persistCreatorToV2({
        handle: "diag_creator", platform: "TikTok", displayName: "Diag Creator",
        extracted: { archetype: "The Sage" },
        researchData: {
          followerCount: 187200, videoCount: 322, // channel has 322; we capture 2
          culturalVelocity: "Insufficient Data",
          sociologicalFieldsComputed: true,
          rawKeywords: ["god", "jesus"],
          contentThemeLabels: ["Christian Prophecy"],
          topHashtags: ["#christiantiktok"],
          decodedSymbols: {
            identityClaims: [{ phrase: "as a Christian", meaning: "faith identity", informs: ["Archetype"] }],
            statusSignals: [], communityReferences: [], aspirationDrivers: [], symbolicSummary: "devout creator",
          },
          discoveredVideoPoolJson: [
            { id: "vd1", url: "u1", caption: "prophecy", createTime: 1690000000, views: 400000, likes: 1, comments: 0, saves: 0, shares: 0, musicOriginal: false, durationSec: 300 },
            { id: "vd2", url: "u2", caption: "viral", createTime: 1699000000, views: 95000000, likes: 1, comments: 0, saves: 0, shares: 0, musicOriginal: false, durationSec: 20 },
          ],
          transcripts: [
            { videoId: "vd1", transcript: "long prophecy transcript", wordCount: 1645, transcriptSource: TRANSCRIPT_SOURCE.subtitle, bucket: "anchor" },
            { videoId: "vd2", transcript: "short caption", wordCount: 20, transcriptSource: TRANSCRIPT_SOURCE.postCaption, bucket: "mid" },
          ],
          evidenceSummary: "EVIDENCE",
        },
        evidenceSnapshot: {
          inputsJson: JSON.stringify({ schemaVersion: 1, handleOrUrl: "diag_creator" }),
          promptText: "THE EXACT PROMPT THE MODEL RECEIVED",
          promptMeta: { systemPrompt: "SYS", model: "gemini-2.5-flash", purpose: "creator_profile_extraction", temperature: 0 },
        },
      });
      if ("error" in result) throw new Error(result.error);
      observationId = result.observationId;
    });

    const d = (await db.getRunDiagnostics(observationId))!;
    expect(d).toBeTruthy();

    // A4 coverage: 2 captured of 322 channel videos.
    expect(d.videos.channelVideoCount).toBe(322);
    expect(d.videos.coveragePct).toBeGreaterThan(0);
    expect(d.videos.coveragePct!).toBeLessThan(2);

    // A5 confidence rationale (2 transcripts → low, thresholds explained).
    expect(d.confidence.level).toBe("low");
    expect(d.confidence.transcriptCount).toBe(2);
    expect(d.confidence.rationale).toMatch(/< 3|low/);

    // A5 velocity rationale: Insufficient Data, recent bucket empty.
    expect(d.velocity?.value).toBe("Insufficient Data");
    expect(d.velocity?.rationale).toMatch(/recent/);

    // A6 provenance marker.
    expect(d.sociologicalFieldsProvenance).toBe("computed");

    // A8 field provenance: evidence-backed vs computed vs pure inference.
    const prov = Object.fromEntries(d.fields.provenance.map(p => [p.field, p.provenance]));
    expect(prov["contentThemes"]).toBe("evidence");
    expect(prov["decodedSymbols"]).toBe("evidence");
    expect(prov["parasocialBondStrength"]).toBe("computed");
    expect(prov["archetype"]).toBe("inferred");
    expect(prov["barthesMyth"]).toBe("inferred");
    expect(prov["followerCount"]).toBe("scraped");

    // A3 scrape consequence derived from the failed search method.
    expect(d.scrapes.consequences.some(c => /Search-based/.test(c))).toBe(true);

    // A9 temperature recorded + surfaced.
    const ext = d.llm.settings.find(s => s.purpose === "creator_profile_extraction");
    expect(ext?.temperature).toBe(0);

    // A7 evidence snapshot readable by observation.
    const snap = await db.getEvidenceSnapshotByObservation(observationId);
    const promptDoc = snap.find(x => x.documentType === "creator_extraction_prompt");
    expect(promptDoc?.contentText).toBe("THE EXACT PROMPT THE MODEL RECEIVED");
  });

  // ── Session 10: author-rejected pool count surfaces in diagnostics ──────────
  it("surfaces the author-rejected foreign-video count in _meta.pool + diagnostics", async () => {
    const runId = newRunId();
    let observationId = "";
    await withAnalysisRun(runId, async () => {
      const result = await persistCreatorToV2({
        handle: "pool_creator", platform: "TikTok", displayName: "Pool Creator",
        extracted: { archetype: "The Sage" },
        researchData: { followerCount: 1000, foreignVideosRejected: 7, sociologicalFieldsComputed: true },
      });
      if ("error" in result) throw new Error(result.error);
      observationId = result.observationId;
    });
    const d = (await db.getRunDiagnostics(observationId))!;
    expect(d.pool).toEqual({ authorRejected: 7 });
    const { rows } = await admin.query("select persistence_status from observations where id=$1", [observationId]);
    expect((rows[0].persistence_status as Record<string, any>)._meta.pool.authorRejected).toBe(7);
  });

  // ── Session 10 (Commit 2): duration computed when present; capture-gap label ─
  it("avg_video_duration computes when durations are present", async () => {
    const res = await persistCreatorToV2({
      handle: "dur_creator", platform: "TikTok", displayName: "Dur Creator",
      extracted: { archetype: "The Sage" },
      researchData: {
        followerCount: 1000,
        discoveredVideoPoolJson: [
          { id: "d1", url: "u1", caption: "c", createTime: 1700000000, views: 10, likes: 1, comments: 0, saves: 0, shares: 0, musicOriginal: false, durationSec: 20 },
          { id: "d2", url: "u2", caption: "c", createTime: 1700000001, views: 10, likes: 1, comments: 0, saves: 0, shares: 0, musicOriginal: false, durationSec: 40 },
        ],
      },
    });
    if ("error" in res) throw new Error(res.error);
    expect(res.persistence.avg_video_duration.status).toBe("success");
    const { rows } = await admin.query("select avg_video_duration from creator_observations where observation_id=$1", [res.observationId]);
    expect(Number(rows[0].avg_video_duration)).toBe(30); // (20+40)/2
  });

  it("avg_video_duration reports a CAPTURE GAP (not no-data) when videos have no duration", async () => {
    const res = await persistCreatorToV2({
      handle: "nodur_creator", platform: "TikTok", displayName: "NoDur Creator",
      extracted: { archetype: "The Hero" },
      researchData: {
        followerCount: 1000,
        discoveredVideoPoolJson: [
          { id: "n1", url: "u", caption: "c", createTime: 1700000000, views: 10, likes: 1, comments: 0, saves: 0, shares: 0, musicOriginal: false, durationSec: 0 },
        ],
      },
    });
    if ("error" in res) throw new Error(res.error);
    expect(res.persistence.avg_video_duration.status).toBe("skipped_not_attempted");
    expect(res.persistence.avg_video_duration.reason).toMatch(/capture gap/);
  });
});
