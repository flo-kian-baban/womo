/**
 * THE PARKED-CAMPAIGN RESCUE PATH (brand acceptance findings 1 and 2).
 *
 * ─── Why these two need a DATABASE harness ──────────────────────────────────
 * Both defects were invisible to unit tests because both live in the gap
 * between a write and a read:
 *
 *   FINDING 1 — `classifyPhaseError` tested for "timeout" while every timeout
 *     this system throws says "timed out". A transient failure was written to
 *     the ledger as `structural`.
 *   FINDING 2 — `requeueCampaignNow` preserved that class, and BOTH reads that
 *     offer work to the worker exclude `structural`. So the rescue tool wrote
 *     `pending` and the campaign stayed invisible. Six consecutive drains
 *     returned `drained=0` on a campaign whose collection was entirely complete.
 *
 * A unit test on either function alone passes while the pair is broken. What
 * matters is whether the ledger, after the write, ANSWERS the queries the worker
 * actually runs — which is what this file asserts.
 *
 * Gated on TEST_DATABASE_URL; disposable Docker Postgres, never production.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Client } from "pg";
import { recordPhaseState, scanReadyWork, findIncompleteCampaigns, getPhaseState } from "../db";
import { requeueCampaignNow } from "../queue/analysisQueue";
import { classifyPhaseError } from "../phases/collectionPhases";

const TEST_URL = process.env.TEST_DATABASE_URL;
if (TEST_URL) process.env.DATABASE_URL = TEST_URL;

const suite = TEST_URL ? describe : describe.skip;
const here = path.dirname(fileURLToPath(import.meta.url));

/** A run id per case, so cases cannot see each other's rows. */
const RUN = {
  timeout: "11111111-1111-4111-8111-111111111111",
  structural: "22222222-2222-4222-8222-222222222222",
  parked: "33333333-3333-4333-8333-333333333333",
  genuine: "44444444-4444-4444-8444-444444444444",
  committed: "55555555-5555-4555-8555-555555555555",
  unfinished: "66666666-6666-4666-8666-666666666666",
};

suite("parked-campaign rescue (ephemeral Postgres)", () => {
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
  }, 60_000);

  afterAll(async () => { await admin.end(); });

  /**
   * FINDING 1, at the ledger. The classifier's verdict is what gets written, and
   * the write is what decides whether the scan will ever offer the row again.
   */
  it("a Gemini timeout is banked TRANSIENT and stays scannable", async () => {
    const failureClass = classifyPhaseError(
      new Error("Gemini API request timed out after 60000ms (purpose: creator_symbol_decoding)"),
    );
    expect(failureClass, "the classifier still calls a timeout structural").toBe("transient");

    await recordPhaseState({
      runId: RUN.timeout, subjectHint: "someone@TikTok", phase: "derive",
      tool: "llm:themes+symbols", status: "failed", attemptCount: 1, failureClass,
    });

    const ready = await scanReadyWork(new Date(), 50);
    expect(ready.some(r => r.runId === RUN.timeout), "a transient failure must remain ready work").toBe(true);

    const incomplete = await findIncompleteCampaigns(50);
    expect(incomplete.some(c => c.runId === RUN.timeout)).toBe(true);
  });

  it("a genuinely structural failure is still excluded — the guard is intact", async () => {
    await recordPhaseState({
      runId: RUN.structural, subjectHint: "nobody@TikTok", phase: "capture",
      tool: "tiktok:profile_xhr_scroll", status: "failed", attemptCount: 3,
      failureClass: classifyPhaseError(new Error("[profileScraper] All scrape paths failed for @nobody")),
    });

    const ready = await scanReadyWork(new Date(), 50);
    expect(ready.some(r => r.runId === RUN.structural),
      "a structural failure must NOT be retried forever").toBe(false);
    const incomplete = await findIncompleteCampaigns(50);
    expect(incomplete.some(c => c.runId === RUN.structural)).toBe(false);
  });

  /**
   * FINDING 2. The exact live shape: every collection phase complete, the commit
   * parked structurally, and the analyst reaching for the rescue tool.
   */
  it("requeueCampaignNow genuinely re-offers a structurally parked campaign", async () => {
    const hint = "https://brand.example@Brand";
    for (const [phase, status] of [
      ["capture", "complete"], ["augment", "complete"], ["transcribe", "complete"],
      ["channel_instagram", "complete"], ["derive", "complete"],
    ] as const) {
      await recordPhaseState({
        runId: RUN.parked, subjectHint: hint, phase, status, attemptCount: 1,
        output: { ok: true },
      });
    }
    await recordPhaseState({
      runId: RUN.parked, subjectHint: hint, phase: "extract_commit",
      tool: "queue:terminal", status: "failed", attemptCount: 1, failureClass: "structural",
    });

    // BEFORE: invisible to both reads — this is the bug, asserted.
    expect((await scanReadyWork(new Date(), 50)).some(r => r.runId === RUN.parked)).toBe(false);
    expect((await findIncompleteCampaigns(50)).some(c => c.runId === RUN.parked)).toBe(false);

    const outcome = await requeueCampaignNow(RUN.parked);

    // It must SAY it reopened something, and name what will re-run. This used
    // to return void, which is why the endpoint could report success for a
    // campaign it had not touched.
    expect(outcome.rowsReset).toBe(1);
    expect(outcome.phasesReset).toEqual(["extract_commit"]);
    expect(outcome.noResetReason).toBeNull();

    // AFTER: offered by both, which is what "requeue" has always claimed to do.
    const rows = await getPhaseState(RUN.parked);
    const commit = rows.find(r => r.phase === "extract_commit")!;
    expect(commit.status).toBe("pending");
    expect(commit.failureClass, "the stale class is what made the requeue a no-op").toBeNull();

    expect((await scanReadyWork(new Date(), 50)).some(r => r.runId === RUN.parked),
      "requeue did not make the campaign ready work").toBe(true);
    expect((await findIncompleteCampaigns(50)).some(c => c.runId === RUN.parked),
      "requeue did not make the campaign incomplete-and-resumable").toBe(true);
  });

  it("requeue preserves banked output and attempt history", async () => {
    const rows = await getPhaseState(RUN.parked);
    const capture = rows.find(r => r.phase === "capture")!;
    // A requeue must not discard collection: the whole value of resuming is
    // re-running ONLY the phase that failed.
    expect(capture.status).toBe("complete");
    expect(capture.output).toEqual({ ok: true });
    // attemptCount is history, not a gate — the scheduler's ladder restarts at 1
    // inside each execution, so preserving it costs nothing and records cost.
    expect(rows.find(r => r.phase === "extract_commit")!.attemptCount).toBe(1);
  });

  it("a genuine_empty phase is NOT resurrected by a requeue", async () => {
    // The min-data refusal is a confirmed fact about the subject, terminal by
    // definition. Requeue must leave it alone or the queue re-asks a settled
    // question forever.
    await recordPhaseState({
      runId: RUN.genuine, subjectHint: "empty@TikTok", phase: "extract_commit",
      tool: "queue:terminal", status: "genuine_empty", attemptCount: 1,
      failureClass: "genuine_empty",
    });
    const outcome = await requeueCampaignNow(RUN.genuine);

    const rows = await getPhaseState(RUN.genuine);
    const commit = rows.find(r => r.phase === "extract_commit")!;
    expect(commit.status).toBe("genuine_empty");
    expect(commit.failureClass).toBe("genuine_empty");
    expect((await scanReadyWork(new Date(), 50)).some(r => r.runId === RUN.genuine)).toBe(false);

    // …and it must SAY it reopened nothing, and why. Reporting success here is
    // the defect: two live campaigns in exactly this state returned
    // `{requeued: true}` having moved nothing.
    expect(outcome.rowsReset).toBe(0);
    expect(outcome.phasesReset).toEqual([]);
    expect(outcome.noResetReason).toBe("confirmed_empty");
  });

  /*
    The other two zeroes. All three must be distinguishable, because "nothing
    happened" is the same observable for a settled campaign, a finished one and
    one that never needed rescuing — and an analyst needs a different thing to
    do in each case.
  */
  it("a COMMITTED campaign reports committed, not success", async () => {
    const hint = "committed@TikTok";
    for (const [phase, status] of [
      ["capture", "complete"], ["augment", "complete"], ["transcribe", "complete"],
      ["derive", "complete"], ["extract_commit", "complete"],
    ] as const) {
      await recordPhaseState({
        runId: RUN.committed, subjectHint: hint, phase, status, attemptCount: 1,
      });
    }
    const outcome = await requeueCampaignNow(RUN.committed);
    expect(outcome.rowsReset).toBe(0);
    expect(outcome.noResetReason).toBe("committed");
  });

  it("an UNFINISHED campaign with nothing parked reports already_advancing", async () => {
    // Collection all complete, no extract_commit row at all: nothing to reset,
    // and nothing wrong — findIncompleteCampaigns is what advances this shape.
    const hint = "unfinished@TikTok";
    for (const [phase, status] of [
      ["capture", "complete"], ["augment", "complete"], ["transcribe", "complete"],
      ["derive", "complete"],
    ] as const) {
      await recordPhaseState({
        runId: RUN.unfinished, subjectHint: hint, phase, status, attemptCount: 1,
      });
    }
    const outcome = await requeueCampaignNow(RUN.unfinished);
    expect(outcome.rowsReset).toBe(0);
    expect(outcome.noResetReason).toBe("already_advancing");
    // It really is advancing — the claim the message makes to the analyst.
    expect((await findIncompleteCampaigns(50)).some(c => c.runId === RUN.unfinished)).toBe(true);
  });
});
