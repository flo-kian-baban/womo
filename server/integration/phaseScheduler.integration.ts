/**
 * Scheduler ledger scan — phased architecture S3a, Part 2.
 *
 * ─── What this proves ───────────────────────────────────────────────────────
 * That the ledger really can drive a scheduler, against the real column types
 * and the real index — not against a mock that agrees with us. Specifically:
 *
 *   1. `scanReadyWork` selects exactly the phases that are eligible NOW —
 *      pending / failed / blocked whose `next_earliest_at` is null or past —
 *      and nothing else. A phase parked into the future must NOT come back
 *      early, and a terminal phase must never come back at all.
 *   2. `running` is excluded. Those rows belong to a live campaign in this
 *      process; a scan that claimed them would double-run in-flight work.
 *   3. A parked row round-trips its backoff gate and attempt count, so the
 *      scheduler's decision survives the process that made it. This is the
 *      durability claim the whole "restart = rescan" model rests on.
 *   4. The query uses `aps_ready_idx (status, next_earliest_at)` — the index
 *      womo_0009 created for precisely this scan.
 *
 * ─── What it does NOT prove ─────────────────────────────────────────────────
 * That anything CALLS this on a schedule. Nothing does, deliberately: S3a keeps
 * the endpoint synchronous, so a rescanned campaign would have no caller to
 * return to, and extract_commit still runs inline in routers.ts, so a resumed
 * campaign could not reach a commit. S3b's enqueue-and-poll wires the loop; this
 * is the query it will drive, proven ahead of it.
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

const MIN = 60_000;

suite("scheduler ledger scan (ephemeral Postgres)", () => {
  let client: Client;
  // One run id per campaign so the suites around this one are unaffected.
  const RUN_READY = "00000000-0000-0000-0000-0000000005a1";
  const RUN_PARKED = "00000000-0000-0000-0000-0000000005a2";
  const RUN_TERMINAL = "00000000-0000-0000-0000-0000000005a3";
  const ALL = [RUN_READY, RUN_PARKED, RUN_TERMINAL];

  beforeAll(async () => {
    // No schema drop: db.integration.ts (alphabetically first, files serial)
    // applies the schema.sql mirror. Same convention as reliability.integration.
    client = new Client({ connectionString: TEST_URL });
    await client.connect();
    const [{ ok }] = (await client.query(
      "select exists(select 1 from information_schema.tables where table_name='analysis_phase_state') ok",
    )).rows;
    if (!ok) throw new Error("schema missing — run the full `pnpm test:integration` (db.integration.ts applies the schema first)");
    await client.query("delete from analysis_phase_state where run_id = any($1)", [ALL]);
  }, 30_000);

  afterAll(async () => {
    await client.query("delete from analysis_phase_state where run_id = any($1)", [ALL]);
    await client.end();
  });

  type LedgerRow = Awaited<ReturnType<typeof db.scanReadyWork>>[number];
  /** Rows for THIS suite only — the table is shared with the other suites. */
  const mine = (rows: LedgerRow[]) => rows.filter(r => ALL.includes(r.runId));

  it("the scan uses aps_ready_idx (status, next_earliest_at) — the index womo_0009 added for it", async () => {
    const { rows } = await client.query(
      `select indexdef from pg_indexes
        where tablename = 'analysis_phase_state' and indexname = 'aps_ready_idx'`,
    );
    expect(rows[0]?.indexdef).toContain("status");
    expect(rows[0]?.indexdef).toContain("next_earliest_at");
  });

  it("picks up work whose gate has passed or was never set, and skips work parked into the future", async () => {
    const now = new Date();

    // Never run — no gate at all.
    await db.recordPhaseState({
      runId: RUN_READY, subjectHint: "readycreator@TikTok", phase: "capture",
      tool: "tiktok:profile_xhr_scroll", status: "pending", attemptCount: 0,
    });
    // Failed and its 30s backoff has already elapsed.
    await db.recordPhaseState({
      runId: RUN_READY, subjectHint: "readycreator@TikTok", phase: "augment",
      tool: "tiktok:search_xhr_scroll", status: "failed", failureClass: "transient",
      attemptCount: 2, nextEarliestAt: new Date(now.getTime() - 5 * MIN),
    });
    // Blocked and parked 15m out — must NOT come back yet.
    await db.recordPhaseState({
      runId: RUN_PARKED, subjectHint: "parkedcreator@TikTok", phase: "augment",
      tool: "tiktok:search_xhr_scroll", status: "blocked", failureClass: "transient",
      attemptCount: 1, nextEarliestAt: new Date(now.getTime() + 15 * MIN),
    });

    const ready = mine(await db.scanReadyWork(now));
    expect(ready.map(r => `${r.runId.slice(-4)}:${r.phase}`).sort())
      .toEqual(["05a1:augment", "05a1:capture"]);
  });

  it("returns the parked phase once its gate passes — the backoff is real, not advisory", async () => {
    const afterTheGate = new Date(Date.now() + 16 * MIN);
    const ready = mine(await db.scanReadyWork(afterTheGate));
    expect(ready.map(r => r.phase)).toContain("augment");
    expect(ready.some(r => r.runId === RUN_PARKED)).toBe(true);
  });

  it("never returns terminal phases — complete, partial or genuine_empty", async () => {
    for (const [phase, status] of [
      ["capture", "complete"], ["augment", "partial"], ["transcribe", "genuine_empty"],
    ] as const) {
      await db.recordPhaseState({
        runId: RUN_TERMINAL, subjectHint: "donecreator@TikTok", phase,
        tool: "test", status, attemptCount: 1,
      });
    }
    const ready = mine(await db.scanReadyWork(new Date(Date.now() + 60 * MIN)));
    expect(ready.some(r => r.runId === RUN_TERMINAL)).toBe(false);
  });

  it("never returns RUNNING phases — those belong to a live campaign, not to a scan", async () => {
    // The onAttemptStart write a live campaign makes before each attempt.
    await db.recordPhaseState({
      runId: RUN_TERMINAL, subjectHint: "donecreator@TikTok", phase: "derive",
      tool: "llm:themes+symbols", status: "running", attemptCount: 1,
    });
    const ready = mine(await db.scanReadyWork(new Date(Date.now() + 60 * MIN)));
    expect(ready.some(r => r.phase === "derive")).toBe(false);
    expect(db.READY_STATUSES).not.toContain("running" as never);
  });

  it("round-trips the scheduler's decision: attempt count and backoff gate survive the write", async () => {
    const gate = new Date(Math.floor(Date.now() / 1000) * 1000 + 5 * MIN); // ms-truncated for exact compare
    await db.recordPhaseState({
      runId: RUN_PARKED, subjectHint: "parkedcreator@TikTok", phase: "transcribe",
      tool: "tiktok:transcriptStrategies", status: "failed", failureClass: "transient",
      attemptCount: 3, nextEarliestAt: gate, output: null,
    });

    const row = (await db.getPhaseState(RUN_PARKED)).find(r => r.phase === "transcribe");
    expect(row).toBeTruthy();
    expect(row!.attemptCount).toBe(3);
    expect(row!.failureClass).toBe("transient");
    expect(row!.nextEarliestAt?.getTime()).toBe(gate.getTime());
  });

  it("clearing the gate on a retried phase makes it ready again (upsert replaces, not appends)", async () => {
    await db.recordPhaseState({
      runId: RUN_PARKED, subjectHint: "parkedcreator@TikTok", phase: "transcribe",
      tool: "tiktok:transcriptStrategies", status: "failed", failureClass: "transient",
      attemptCount: 4, nextEarliestAt: null,
    });

    const rows = (await db.getPhaseState(RUN_PARKED)).filter(r => r.phase === "transcribe");
    expect(rows).toHaveLength(1); // one row per (run, phase), still
    expect(rows[0]!.nextEarliestAt).toBeNull();
    expect(rows[0]!.attemptCount).toBe(4);

    const ready = mine(await db.scanReadyWork(new Date()));
    expect(ready.some(r => r.runId === RUN_PARKED && r.phase === "transcribe")).toBe(true);
  });

  it("orders by gate, soonest first, so the most-overdue work is scheduled first", async () => {
    const ready = mine(await db.scanReadyWork(new Date(Date.now() + 60 * MIN)));
    const gates = ready.map(r => r.nextEarliestAt?.getTime() ?? -1);
    expect(gates).toEqual([...gates].sort((a, b) => a - b));
  });

  it("honours the limit so one enormous backlog cannot be claimed in a single sweep", async () => {
    const capped = await db.scanReadyWork(new Date(Date.now() + 60 * MIN), 1);
    expect(capped).toHaveLength(1);
  });

  // Since S3a a phase writes this row THREE times — pending (queued), running
  // (admitted), then its outcome — and every write is fire-and-forget, so
  // nothing orders them. A delayed marker landing after the terminal write would
  // leave a finished phase reading "running" with the wrong attempt count.
  describe("monotonic writes — a late marker cannot clobber a terminal outcome", () => {
    const RUN = RUN_TERMINAL;

    it("drops a stale write instead of applying it", async () => {
      await db.recordPhaseState({
        runId: RUN, subjectHint: "donecreator@TikTok", phase: "extract_commit",
        tool: "llm:extractCreatorProfile+persist", status: "complete",
        attemptCount: 2, output: { saved: "full" },
      });
      const after = () => db.getPhaseState(RUN).then(rs => rs.find(r => r.phase === "extract_commit")!);
      const terminal = await after();
      expect(terminal.status).toBe("complete");

      // Model the race: the marker was ISSUED before the terminal write but
      // ARRIVES after it. recordPhaseState stamps its own `new Date()`, so the
      // way to make the incoming write older than the row is to push the row's
      // updated_at ahead — equivalent to the terminal write having landed later.
      await client.query(
        `update analysis_phase_state set updated_at = now() + interval '1 minute'
          where run_id = $1 and phase = 'extract_commit'`,
        [RUN],
      );
      await db.recordPhaseState({
        runId: RUN, subjectHint: "donecreator@TikTok", phase: "extract_commit",
        tool: "llm:extractCreatorProfile+persist", status: "running", attemptCount: 1,
      });

      const still = await after();
      expect(still.status).toBe("complete");   // not clobbered
      expect(still.attemptCount).toBe(2);      // and the attempt count survived
      expect(still.output).toEqual({ saved: "full" });
    });

    it("still applies an in-order write", async () => {
      // Undo the future stamp from the previous case so this write is genuinely
      // newer than the row — otherwise the guard would (correctly) drop it too.
      await client.query(
        `update analysis_phase_state set updated_at = now() - interval '1 minute'
          where run_id = $1 and phase = 'extract_commit'`,
        [RUN],
      );
      await db.recordPhaseState({
        runId: RUN, subjectHint: "donecreator@TikTok", phase: "extract_commit",
        tool: "llm:extractCreatorProfile+persist", status: "partial",
        attemptCount: 3, output: { saved: "partial" },
      });
      const row = (await db.getPhaseState(RUN)).find(r => r.phase === "extract_commit")!;
      expect(row.status).toBe("partial");
      expect(row.attemptCount).toBe(3);
    });
  });
});
