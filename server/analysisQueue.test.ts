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
import { deriveCampaignState } from "./queue/analysisQueue";

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
 * ─── The honest part ────────────────────────────────────────────────────────
 * `brand.analyze` and `brand.reanalyze` still call researchBrand and
 * persistBrandToV2 inline. They are the pre-queue endpoints and removing them is
 * the router consolidation — a separate, deliberate step. Until then brand has
 * two ways in, and that is recorded here as a COUNT rather than described in a
 * comment: a third one cannot appear without failing this file, and the count
 * drops to zero the day the consolidation lands.
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
      brandRouterSrc.indexOf("analyze: publicProcedure"),
    );
    expect(submit).toContain("submitCampaigns(");
    expect(submit).not.toMatch(/researchBrand\s*\(/);
    expect(submit).not.toMatch(/persistBrandToV2\s*\(/);
  });

  it("the subject's locators travel as EXTRAS, not as a flattened handle", () => {
    const submit = brandRouterSrc.slice(
      brandRouterSrc.indexOf("submit: publicProcedure"),
      brandRouterSrc.indexOf("analyze: publicProcedure"),
    );
    expect(submit).toContain("extras:");
    for (const locator of ["googleMapsUrl", "tiktokChannelUrl", "instagramHandle"]) {
      expect(submit, `${locator} not threaded through the subject descriptor`).toContain(locator);
    }
  });

  /**
   * THE KNOWN BYPASSES, COUNTED. Not an endorsement — a tripwire. These two are
   * the deferred router consolidation; a THIRD inline brand entry point is a
   * regression and fails here.
   */
  it("exactly TWO inline brand endpoints remain — analyze and reanalyze", () => {
    const inlineResearch = brandRouterSrc.match(/\bresearchBrand\s*\(/g) ?? [];
    const inlinePersist = brandRouterSrc.match(/\bpersistBrandToV2\s*\(/g) ?? [];
    expect(inlineResearch, "a new inline brand path appeared").toHaveLength(2);
    expect(inlinePersist, "a new inline brand persist appeared").toHaveLength(2);
    // And they are the two we know about.
    expect(brandRouterSrc).toMatch(/^\s*analyze: publicProcedure/m);
    expect(brandRouterSrc).toMatch(/^\s*reanalyze: publicProcedure/m);
  });
});
