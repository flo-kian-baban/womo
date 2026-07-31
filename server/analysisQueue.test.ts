/**
 * The queue as the single entry point — S3b, Part 2.
 *
 * ─── The architectural rule under test ──────────────────────────────────────
 * Every creator analysis is enqueued first and enters the pipeline from the
 * queue. No synchronous bypass, no "run now" shortcut, no direct-to-pipeline
 * path. A single creator is a queue of one.
 *
 * That rule is worth enforcing mechanically rather than by review, because the
 * failure it prevents already happened: analyze, reanalyze and bulkAnalyze were
 * three copies of the same orchestration, and bulkAnalyze drifted until it had
 * no timeout, no memory tracker, no terminal telemetry, no extraction retry and
 * no followingCount. One entry point cannot drift from itself.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { deriveCampaignState, firstFailedComponentReason } from "./queue/analysisQueue";

const routersSrc = readFileSync(path.join(import.meta.dirname, "routers.ts"), "utf8");

/**
 * Just the creator router. The brand router is OUT OF SCOPE this session — it
 * has no phase model, no toolset and no ledger, so it keeps its own synchronous
 * `analyze` until S5 builds one. Scoping the assertions here is the difference
 * between enforcing the rule and asserting brand does not exist.
 */
const creatorRouterSrc = routersSrc.slice(
  routersSrc.indexOf("creator: router({"),
  routersSrc.indexOf("brand: router({"),
);

const phase = (
  p: string,
  status: string,
  over: Partial<{ nextEarliestAt: Date | null; attemptCount: number; failureClass: string | null }> = {},
) => ({
  phase: p as never, status, attemptCount: 1, failureClass: null,
  nextEarliestAt: null, updatedAt: new Date(), ...over,
});

describe("NO BYPASS — the pipeline is unreachable except through the queue", () => {
  it("routers.ts never calls the campaign runner directly", () => {
    // creatorCampaignDeps is DEFINED here (that is the injection point), but
    // runCreatorCampaign must only ever be invoked by the queue worker.
    const calls = routersSrc.match(/\brunCreatorCampaign\s*\(/g) ?? [];
    expect(calls).toHaveLength(0);
  });

  it("routers.ts no longer calls researchCreator — collection is the campaign's job", () => {
    const calls = routersSrc.match(/\bresearchCreator\s*\(/g) ?? [];
    expect(calls).toHaveLength(0);
  });

  it("routers.ts persists a creator from exactly ONE place — the injected dep", () => {
    // persistCreatorToV2 is DEFINED and exported here for the integration
    // suites. What must not exist is a second CALL SITE driving it from an
    // endpoint. `persistCreatorToV2({` matches calls only; the definition reads
    // `persistCreatorToV2(params: {`.
    const callSites = routersSrc.match(/persistCreatorToV2\(\{/g) ?? [];
    expect(callSites).toHaveLength(1);
  });

  it("the retired bulk machinery is gone, not merely unrouted", () => {
    // The module itself is deleted, so the import cannot resolve; assert on the
    // import and call forms rather than the bare name, which still appears in
    // the comment recording the removal.
    expect(routersSrc).not.toContain('from "./bulkAnalysisJobs"');
    expect(routersSrc).not.toContain("createBulkCreatorJob(");
    expect(routersSrc).not.toContain("getJobProgress: publicProcedure");
    expect(routersSrc).not.toContain("bulkAnalyze: publicProcedure");
  });

  it("submit is the only creator analysis mutation", () => {
    expect(creatorRouterSrc).toContain("submit: publicProcedure");
    // The old synchronous entry point must not exist under any spelling.
    expect(creatorRouterSrc).not.toMatch(/^\s*analyze: publicProcedure/m);
    // reanalyze survives as a NAME, but only as a submission.
    expect(creatorRouterSrc).toContain("submitCampaigns([{ handle:");
  });
});

describe("deriveCampaignState — the queue view IS the ledger", () => {
  it("a campaign with no rows yet reads queued", () => {
    expect(deriveCampaignState([])).toBe("queued");
  });

  it("pending rows read queued", () => {
    expect(deriveCampaignState([phase("capture", "pending")])).toBe("queued");
  });

  it("any running phase reads running", () => {
    expect(deriveCampaignState([
      phase("capture", "complete"), phase("augment", "running"),
    ])).toBe("running");
  });

  it("a committed extract_commit reads complete", () => {
    expect(deriveCampaignState([
      phase("capture", "complete"), phase("extract_commit", "complete"),
    ])).toBe("complete");
  });

  it("a PARTIAL commit still reads complete — the observation exists", () => {
    expect(deriveCampaignState([phase("extract_commit", "partial")])).toBe("complete");
  });

  it("genuine_empty reads complete, not failed — it is a fact, not our error", () => {
    expect(deriveCampaignState([phase("capture", "genuine_empty")])).toBe("complete");
  });

  it("a BLOCKED refusal reads failed, not complete — we never saw the account", () => {
    /*
      The counterpart to the test above, and the reason the distinction exists.
      A min-data refusal we could not confirm is now banked `blocked`, so it
      lands here rather than in the branch above. It must NOT read complete: an
      analyst looking at a campaign the platform blocked should see a failure
      they can requeue, not a finished, empty account.
    */
    expect(deriveCampaignState([phase("extract_commit", "blocked")])).toBe("failed");
  });

  it("a future backoff gate reads parked", () => {
    expect(deriveCampaignState([
      phase("capture", "failed", { nextEarliestAt: new Date(Date.now() + 300_000) }),
    ])).toBe("parked");
  });

  it("a gate that has already passed is NOT parked — it is ready again", () => {
    expect(deriveCampaignState([
      phase("capture", "failed", { nextEarliestAt: new Date(Date.now() - 1_000) }),
    ])).toBe("failed");
  });

  it("a failure with no gate left reads failed", () => {
    expect(deriveCampaignState([
      phase("capture", "complete"), phase("augment", "failed"),
    ])).toBe("failed");
  });

  it("running wins over a parked sibling — the campaign is moving", () => {
    expect(deriveCampaignState([
      phase("capture", "failed", { nextEarliestAt: new Date(Date.now() + 300_000) }),
      phase("augment", "running"),
    ])).toBe("running");
  });

  it("a commit outranks everything — a finished campaign is never 'failed'", () => {
    // A phase that failed and was retried into success must not leave the
    // campaign reading failed after the commit landed.
    expect(deriveCampaignState([
      phase("capture", "failed"), phase("extract_commit", "complete"),
    ])).toBe("complete");
  });
});

/**
 * BRAND ADMISSION — the same rule, applied to the second subject kind (S5).
 *
 * Brand now has a queue entry point and a campaign runner. What this block
 * enforces is the part that matters architecturally: the RUNNER is reachable
 * only from the queue, exactly as the creator runner is.
 *
 * ─── The count is now ZERO ──────────────────────────────────────────────────
 * `brand.analyze` is deleted and `brand.reanalyze` enqueues, so no path reaches
 * the brand pipeline without going through the queue. The count is kept as an
 * assertion rather than a comment because that is what stops it climbing back:
 * a new inline endpoint fails this file on the day it is written, not on the
 * day someone audits it.
 */
const brandRouterSrc = routersSrc.slice(routersSrc.indexOf("brand: router({"));

describe("brand admission — the runner is queue-only", () => {
  it("routers.ts never calls runBrandCampaign directly", () => {
    // brandCampaignDeps is DEFINED there (that is the injection point), but the
    // runner must only ever be invoked by the queue worker.
    expect(routersSrc.match(/\brunBrandCampaign\s*\(/g) ?? []).toHaveLength(0);
  });

  it("runBrandCampaign is invoked from exactly one place — the queue worker", () => {
    const queueSrc = readFileSync(
      path.join(import.meta.dirname, "queue", "analysisQueue.ts"), "utf8",
    );
    expect(queueSrc.match(/\brunBrandCampaign\s*\(/g) ?? []).toHaveLength(1);
  });

  it("brand.submit enqueues rather than running anything", () => {
    const submit = brandRouterSrc.slice(
      brandRouterSrc.indexOf("submit: publicProcedure"),
      brandRouterSrc.indexOf("reanalyze: publicProcedure"),
    );
    expect(submit).toContain("submitCampaigns(");
    expect(submit).not.toMatch(/researchBrand\s*\(/);
    expect(submit).not.toMatch(/persistBrandToV2\s*\(/);
  });

  it("the subject's locators travel as EXTRAS, not as a flattened handle", () => {
    // They live in the shared builder now, which is the point — one place, so
    // submit and reanalyze cannot describe the same subject differently.
    const builder = routersSrc.slice(
      routersSrc.indexOf("export function brandSubmitRequest"),
      routersSrc.indexOf("/** The dependency set every brand campaign runs with. */"),
    );
    expect(builder).toContain("extras:");
    for (const locator of ["googleMapsUrl", "tiktokChannelUrl", "instagramHandle"]) {
      expect(builder, `${locator} not threaded through the subject descriptor`).toContain(locator);
    }
  });

  /**
   * ZERO inline brand endpoints. The tripwire, not an audit note: a new inline
   * path fails here the day it is written.
   */
  it("NO path reaches the brand pipeline without enqueueing", () => {
    expect(brandRouterSrc.match(/\bresearchBrand\s*\(/g) ?? [],
      "an inline brand research path appeared").toHaveLength(0);
    expect(brandRouterSrc.match(/\bpersistBrandToV2\s*\(/g) ?? [],
      "an inline brand persist appeared").toHaveLength(0);
    // The synchronous endpoint is gone, not renamed.
    expect(brandRouterSrc).not.toMatch(/^\s*analyze: publicProcedure/m);
  });

  it("brand.reanalyze enqueues instead of running the pipeline", () => {
    const reanalyze = brandRouterSrc.slice(brandRouterSrc.indexOf("reanalyze: publicProcedure"));
    expect(reanalyze).toContain("submitCampaigns(");
    expect(reanalyze).toContain("brandSubmitRequest(");
  });

  /**
   * ONE builder, both doors. Two hand-written submission descriptors is the
   * drift shape that cost the creator side `followingCount`; brand carried two
   * copies of the entire orchestration until this session.
   */
  it("submit and reanalyze share one submission builder", () => {
    expect((brandRouterSrc.match(/brandSubmitRequest\(/g) ?? []).length).toBe(2);
    // And neither hand-rolls the descriptor beside it.
    expect(brandRouterSrc).not.toMatch(/platform:\s*"Brand"/);
  });
});

describe("firstFailedComponentReason — a partial save must ship its why", () => {
  /**
   * CORPUS-REBUILD FINDING: vnillalondon saved with
   * failedComponents=["platform_handle"], a precise per-component reason in the
   * component map, and persistence.error=null — so the queue shipped `message:
   * null` and the analyst saw "Committed · partial save" with no why. The
   * component map was in the ledger the whole time; only `error` was read.
   */
  it("surfaces the first failed component's own reason", () => {
    expect(firstFailedComponentReason({
      failedComponents: ["platform_handle"],
      components: {
        identity_core: { status: "success", reason: null },
        platform_handle: {
          status: "failed",
          reason: "@vnillalondon on Instagram is already owned by subject fb6716a2 — handles are globally unique per platform",
        },
      },
    })).toBe("platform_handle: @vnillalondon on Instagram is already owned by subject fb6716a2 — handles are globally unique per platform");
  });

  it("names the component even when the map carries no reason — a name beats silence", () => {
    expect(firstFailedComponentReason({ failedComponents: ["decoded_signals"], components: null }))
      .toBe('component "decoded_signals" failed to persist');
  });

  it("a clean save explains nothing", () => {
    expect(firstFailedComponentReason({ failedComponents: [], components: {} })).toBeNull();
    expect(firstFailedComponentReason(undefined)).toBeNull();
  });
});

// ─── Idle backoff (egress incident, 2026-07-28) ──────────────────────────────
// The drain cadence must stretch when the queue is quiet — a flat 5s poll reads
// the ledger ~17,000×/day against a metered database — and must snap back the
// moment work arrives. The ladder is pure; the snap-back is a source-level
// contract: both entry points that CREATE ready work must kick the worker,
// or a submit waits out the idle clock.

import { nextPollDelayMs, POLL_MS, IDLE_AFTER_EMPTY_DRAINS, IDLE_POLL_MS_MAX } from "./queue/analysisQueue";

describe("IDLE BACKOFF — quiet stretches the cadence, work snaps it back", () => {
  it("holds the working cadence until the streak reaches the threshold", () => {
    for (let n = 0; n < IDLE_AFTER_EMPTY_DRAINS; n++) {
      expect(nextPollDelayMs(n)).toBe(POLL_MS);
    }
  });

  it("doubles per empty drain past the threshold, capped at the ceiling", () => {
    expect(nextPollDelayMs(IDLE_AFTER_EMPTY_DRAINS)).toBe(10_000);
    expect(nextPollDelayMs(IDLE_AFTER_EMPTY_DRAINS + 1)).toBe(20_000);
    expect(nextPollDelayMs(IDLE_AFTER_EMPTY_DRAINS + 2)).toBe(40_000);
    expect(nextPollDelayMs(IDLE_AFTER_EMPTY_DRAINS + 3)).toBe(IDLE_POLL_MS_MAX);
    expect(nextPollDelayMs(1_000)).toBe(IDLE_POLL_MS_MAX);
  });

  it("a reset streak is back on the working cadence — the kick works", () => {
    expect(nextPollDelayMs(0)).toBe(POLL_MS);
  });

  const queueSrc = readFileSync(path.join(import.meta.dirname, "queue", "analysisQueue.ts"), "utf8");

  it("submitCampaigns kicks the worker — a submit never waits out the idle clock", () => {
    const body = queueSrc.slice(
      queueSrc.indexOf("export async function submitCampaigns"),
      queueSrc.indexOf("export async function requeueCampaignNow"),
    );
    expect(body).toContain("kickQueueNow()");
  });

  it("requeueCampaignNow kicks the worker — 'picks it up immediately' stays true", () => {
    const body = queueSrc.slice(
      queueSrc.indexOf("export async function requeueCampaignNow"),
      queueSrc.indexOf("// ─── Status"),
    );
    expect(body).toContain("kickQueueNow()");
  });
});
