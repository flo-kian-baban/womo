/**
 * Queue durability — S3b, Part 3 (ephemeral Postgres).
 *
 * ─── What must hold ─────────────────────────────────────────────────────────
 * The ledger IS the queue. There is no in-memory job list, so everything below
 * is a claim about rows:
 *
 *   1. an enqueue is DURABLE and visible to the scan;
 *   2. a campaign killed mid-phase leaves a `running` row that is invisible to
 *      the scan — and is therefore LOST until reclaimed. That is the failure
 *      ACCEPTANCE 2 exists to catch, and the reason the reclaim exists;
 *   3. reclaim returns it to `pending` only once the heartbeat has been silent
 *      past the threshold — never while a colleague's campaign is still beating;
 *   4. a campaign whose collection phases are all complete but which has no
 *      extract_commit row is UNFINISHED even though nothing is ready. Driving
 *      the queue from the ready-scan alone strands it forever — a bug this
 *      suite exists to keep fixed;
 *   5. a parked phase resumes when its gate passes, not before.
 *
 * Runs against the DISPOSABLE Docker Postgres (never production):
 * `pnpm test:db:up` → `pnpm test:integration`.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import * as db from "../db";
import { submitCampaigns, getCampaignStatus, requeueCampaignNow } from "../queue/analysisQueue";

const TEST_URL = process.env.TEST_DATABASE_URL;
if (TEST_URL) process.env.DATABASE_URL = TEST_URL;

const suite = TEST_URL ? describe : describe.skip;
const MIN = 60_000;

suite("analysis queue durability (ephemeral Postgres)", () => {
  let client: Client;
  const runIds: string[] = [];

  const bankedComplete = async (runId: string, hint: string, phase: string, output: unknown) =>
    db.recordPhaseState({
      runId, subjectHint: hint, phase: phase as never, tool: "test",
      status: "complete", attemptCount: 1, output,
    });

  beforeAll(async () => {
    client = new Client({ connectionString: TEST_URL });
    await client.connect();
    const [{ ok }] = (await client.query(
      "select exists(select 1 from information_schema.tables where table_name='analysis_phase_state') ok",
    )).rows;
    if (!ok) throw new Error("schema missing — run the full `pnpm test:integration`");
  }, 30_000);

  afterAll(async () => {
    if (runIds.length) {
      await client.query("delete from analysis_phase_state where run_id = any($1)", [runIds]);
    }
    await client.end();
  });

  it("a submission is DURABLE and immediately visible to the ready scan", async () => {
    const [c] = await submitCampaigns([{ handle: "queue_fixture", platform: "TikTok" }]);
    runIds.push(c!.runId);

    const status = await getCampaignStatus(c!.runId);
    expect(status?.state).toBe("queued");
    expect(status?.handle).toBe("queue_fixture");

    const ready = (await db.scanReadyWork(new Date(), 200)).filter(r => r.runId === c!.runId);
    expect(ready).toHaveLength(1);
    expect(ready[0]!.phase).toBe("capture");
  });

  it("submission FAILS LOUDLY rather than pretending, if the ledger write cannot land", async () => {
    // A campaign absent from the ledger does not exist. recordPhaseState throws
    // (unlike recordPhaseObservation), which is what lets submit refuse.
    await expect(db.recordPhaseState({
      runId: "not-a-uuid", subjectHint: "x@TikTok", phase: "capture", status: "pending",
    })).rejects.toThrow();
  });

  it("a campaign killed mid-phase is INVISIBLE to the scan until reclaimed", async () => {
    const runId = crypto.randomUUID();
    runIds.push(runId);
    await db.recordPhaseState({
      runId, subjectHint: "killed@TikTok", phase: "capture",
      tool: "t", status: "running", attemptCount: 1,
    });

    // This is the lost-work shape: nothing pending, nothing parked, nothing the
    // scan will ever return.
    const ready = (await db.scanReadyWork(new Date(), 200)).filter(r => r.runId === runId);
    expect(ready).toHaveLength(0);

    // Still beating → not reclaimable. A colleague's live campaign on the shared
    // database must survive our boot.
    expect(await db.reclaimStaleRunning(new Date(), db.STALE_RUNNING_MS)).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ runId })]),
    );

    // Silent past the threshold → reclaimed.
    const reclaimed = await db.reclaimStaleRunning(new Date(Date.now() + 11 * MIN));
    expect(reclaimed).toEqual(expect.arrayContaining([expect.objectContaining({ runId, phase: "capture" })]));

    // …and it is ready again.
    const after = (await db.scanReadyWork(new Date(), 200)).filter(r => r.runId === runId);
    expect(after).toHaveLength(1);
  });

  it("an UNFINISHED campaign with no ready row is still found — the strand bug", async () => {
    // Collection all complete, extract_commit never written. Nothing is
    // pending, running, parked or failed: the ready-scan returns NOTHING, yet
    // the campaign is plainly unfinished. Driving the queue from the scan alone
    // stranded exactly this shape forever.
    const runId = crypto.randomUUID();
    runIds.push(runId);
    for (const p of ["capture", "augment", "transcribe", "derive"]) {
      await bankedComplete(runId, "stranded@TikTok", p, { ok: true });
    }

    const ready = (await db.scanReadyWork(new Date(), 200)).filter(r => r.runId === runId);
    expect(ready).toHaveLength(0); // the scan cannot see it…

    const incomplete = await db.findIncompleteCampaigns(200);
    expect(incomplete.map(c => c.runId)).toContain(runId); // …but this can.
  });

  it("a COMMITTED campaign is not resurrected as unfinished", async () => {
    const runId = crypto.randomUUID();
    runIds.push(runId);
    for (const p of ["capture", "augment", "transcribe", "derive"]) {
      await bankedComplete(runId, "done@TikTok", p, { ok: true });
    }
    await bankedComplete(runId, "done@TikTok", "extract_commit", { subjectId: "s", persistence: { saved: "full" } });

    const incomplete = await db.findIncompleteCampaigns(200);
    expect(incomplete.map(c => c.runId)).not.toContain(runId);

    const status = await getCampaignStatus(runId);
    expect(status?.state).toBe("complete");
  });

  it("a genuine_empty campaign is finished, not endlessly retried", async () => {
    // A confirmed fact about the subject. Retrying it forever would be the queue
    // arguing with reality.
    const runId = crypto.randomUUID();
    runIds.push(runId);
    await db.recordPhaseState({
      runId, subjectHint: "empty@TikTok", phase: "capture", tool: "t",
      status: "genuine_empty", failureClass: "genuine_empty", attemptCount: 1,
    });

    expect((await db.findIncompleteCampaigns(200)).map(c => c.runId)).not.toContain(runId);
    expect((await db.scanReadyWork(new Date(), 200)).filter(r => r.runId === runId)).toHaveLength(0);
    expect((await getCampaignStatus(runId))?.state).toBe("complete");
  });

  it("a STRUCTURAL failure is never rescanned — the infinite-retry bug", async () => {
    // The S1 contract's isRequeueable says structural never requeues. The scan
    // has to agree, or a permanently-failed phase reads as ready on every tick
    // and the queue retries it forever. Observed live during ACCEPTANCE 2: a
    // campaign whose banked output predated the current phase schema failed
    // structurally and was picked up again on every single drain.
    const runId = crypto.randomUUID();
    runIds.push(runId);
    await db.recordPhaseState({
      runId, subjectHint: "structural@TikTok", phase: "extract_commit", tool: "queue:terminal",
      status: "failed", failureClass: "structural", attemptCount: 1,
      output: { terminal: true, message: "shape changed" },
    });

    expect((await db.scanReadyWork(new Date(), 200)).filter(r => r.runId === runId)).toHaveLength(0);
    expect((await db.findIncompleteCampaigns(200)).map(c => c.runId)).not.toContain(runId);
    expect((await getCampaignStatus(runId))?.state).toBe("failed");
  });

  it("a TRANSIENT failure with no gate is still ready — retries must survive", async () => {
    // The guard above must not over-block: transient is the class that SHOULD
    // come back.
    const runId = crypto.randomUUID();
    runIds.push(runId);
    await db.recordPhaseState({
      runId, subjectHint: "transient@TikTok", phase: "capture", tool: "t",
      status: "failed", failureClass: "transient", attemptCount: 1,
    });
    expect((await db.scanReadyWork(new Date(), 200)).filter(r => r.runId === runId)).toHaveLength(1);
  });

  it("resumption is bounded by age — history is not in-flight work", async () => {
    // Phase outputs carry no schema version, so an old row is not safely
    // replayable with today's code. A pre-S2 campaign WAS resumed in
    // ACCEPTANCE 1 whose augment output still had the S1 shadow-bank shape
    // ({searchTitles: []} rather than {pool: {...}}), and the assembly died on
    // "Cannot read properties of undefined (reading 'videoTitles')".
    const runId = crypto.randomUUID();
    runIds.push(runId);
    await bankedComplete(runId, "ancient@TikTok", "capture", { ok: true });
    await client.query(
      `update analysis_phase_state set created_at = now() - interval '3 days' where run_id = $1`,
      [runId],
    );

    // Unfinished, but far too old to be what the last process was doing.
    expect((await db.findIncompleteCampaigns(200)).map(c => c.runId)).not.toContain(runId);
    // Widen the window and it reappears — the row is intact, only excluded.
    expect((await db.findIncompleteCampaigns(200, 7 * 24 * 60 * 60 * 1000)).map(c => c.runId))
      .toContain(runId);
  });

  it("a PARKED phase waits for its gate, then becomes ready", async () => {
    const runId = crypto.randomUUID();
    runIds.push(runId);
    await db.recordPhaseState({
      runId, subjectHint: "parked@TikTok", phase: "capture", tool: "t",
      status: "failed", failureClass: "transient", attemptCount: 2,
      nextEarliestAt: new Date(Date.now() + 5 * MIN),
    });

    expect((await getCampaignStatus(runId))?.state).toBe("parked");
    expect((await db.scanReadyWork(new Date(), 200)).filter(r => r.runId === runId)).toHaveLength(0);

    // Once the gate passes it is ready — no separate wake-up mechanism needed.
    const later = new Date(Date.now() + 6 * MIN);
    expect((await db.scanReadyWork(later, 200)).filter(r => r.runId === runId)).toHaveLength(1);
  });

  it("requeueCampaignNow clears the gate so an analyst need not wait out a park", async () => {
    const runId = crypto.randomUUID();
    runIds.push(runId);
    await db.recordPhaseState({
      runId, subjectHint: "nudge@TikTok", phase: "capture", tool: "t",
      status: "failed", failureClass: "transient", attemptCount: 2,
      nextEarliestAt: new Date(Date.now() + 15 * MIN),
    });
    expect((await getCampaignStatus(runId))?.state).toBe("parked");

    await requeueCampaignNow(runId);

    expect((await getCampaignStatus(runId))?.state).not.toBe("parked");
    expect((await db.scanReadyWork(new Date(), 200)).filter(r => r.runId === runId)).toHaveLength(1);
  });

  it("requeue does NOT disturb phases that already succeeded", async () => {
    // Clearing a gate must not cost a re-scrape of work already banked.
    const runId = crypto.randomUUID();
    runIds.push(runId);
    await bankedComplete(runId, "keep@TikTok", "capture", { pool: "banked" });
    await db.recordPhaseState({
      runId, subjectHint: "keep@TikTok", phase: "augment", tool: "t",
      status: "failed", failureClass: "transient", attemptCount: 1,
      nextEarliestAt: new Date(Date.now() + 5 * MIN),
    });

    await requeueCampaignNow(runId);

    const rows = await db.getPhaseState(runId);
    const capture = rows.find(r => r.phase === "capture")!;
    expect(capture.status).toBe("complete");
    expect(capture.output).toEqual({ pool: "banked" });
  });
});
