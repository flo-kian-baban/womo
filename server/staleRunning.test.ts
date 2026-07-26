/**
 * Stale-`running` detection — S3b, Part 3.
 *
 * A crash or force-quit leaves phase rows stuck in `running`, and a `running`
 * row is deliberately invisible to `scanReadyWork` (it belongs to a live
 * campaign). Without reclamation those campaigns are lost forever — the exact
 * failure ACCEPTANCE 2 exists to catch.
 *
 * THE TEMPTING FIX IS WRONG, and this file exists partly to record why. "This
 * process just booted, so every running row is dead" is true for one machine —
 * but the database is the SHARED cloud Supabase and several analysts run
 * locally against it. Boot-reclaiming indiscriminately would let one analyst's
 * restart steal a colleague's in-flight campaign mid-scrape. Liveness is
 * therefore proven by heartbeat, not assumed from process lifetime.
 */
import { describe, expect, it } from "vitest";
import { HEARTBEAT_MS, STALE_RUNNING_MS, isStaleRunning } from "./db";

const NOW = new Date("2026-07-26T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

describe("the threshold itself", () => {
  it("clears the longest legitimate phase by a wide margin", () => {
    // transcribe is budgeted at 120s (transcriptStrategies phase budget). The
    // threshold must exceed that comfortably or a slow-but-alive phase gets
    // stolen mid-scrape by another analyst's boot.
    const LONGEST_PHASE_MS = 120_000;
    expect(STALE_RUNNING_MS).toBeGreaterThanOrEqual(LONGEST_PHASE_MS * 4);
  });

  it("beats far more often than the threshold, so a live phase is never quiet", () => {
    expect(HEARTBEAT_MS).toBeLessThan(STALE_RUNNING_MS / 10);
  });
});

describe("isStaleRunning", () => {
  it("never reclaims a row that is not running", () => {
    for (const status of ["pending", "complete", "partial", "failed", "blocked", "genuine_empty"]) {
      expect(isStaleRunning({ status, updatedAt: ago(STALE_RUNNING_MS * 100) }, NOW)).toBe(false);
    }
  });

  it("leaves a freshly-beating phase alone", () => {
    expect(isStaleRunning({ status: "running", updatedAt: ago(1_000) }, NOW)).toBe(false);
  });

  it("leaves a slow-but-alive phase alone — a 2-minute transcribe is normal", () => {
    expect(isStaleRunning({ status: "running", updatedAt: ago(120_000) }, NOW)).toBe(false);
  });

  it("reclaims a phase that has gone quiet past the threshold", () => {
    expect(isStaleRunning({ status: "running", updatedAt: ago(STALE_RUNNING_MS + 1) }, NOW)).toBe(true);
  });

  it("does not reclaim exactly AT the threshold — strictly older only", () => {
    // The boundary matters: a heartbeat landing right on the edge must not lose
    // its campaign to a race with the reaper.
    expect(isStaleRunning({ status: "running", updatedAt: ago(STALE_RUNNING_MS) }, NOW)).toBe(false);
  });

  it("treats a running row with no heartbeat at all as dead", () => {
    // Cannot be live: a live phase beats. A row in this state predates the
    // heartbeat or was written by a process that died immediately.
    expect(isStaleRunning({ status: "running", updatedAt: null }, NOW)).toBe(true);
  });

  it("honours an injected threshold, so tests need no wall-clock waiting", () => {
    const row = { status: "running", updatedAt: ago(5_000) };
    expect(isStaleRunning(row, NOW, 10_000)).toBe(false);
    expect(isStaleRunning(row, NOW, 1_000)).toBe(true);
  });

  it("a colleague's live campaign survives our boot — the multi-analyst case", () => {
    // The shared cloud database means "our process just started" says nothing
    // about whose campaign this is. Only silence does.
    const colleagueMidScrape = { status: "running", updatedAt: ago(45_000) };
    expect(isStaleRunning(colleagueMidScrape, NOW)).toBe(false);
  });
});
