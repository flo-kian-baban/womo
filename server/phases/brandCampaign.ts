/**
 * THE BRAND CAMPAIGN (S5).
 *
 * Brand on the same spine every creator runs on: the same runner, scheduler,
 * ledger, retry policy, park and resume, and the same `runSubjectCampaign`
 * orchestration. What brand brings is a collection (five phases instead of
 * four) and an extract_commit spec — nothing else, and nothing shared learns
 * what a brand is.
 *
 * ─── Why extract_commit needs a spec at all ─────────────────────────────────
 * `persistCreatorToV2` and `persistBrandToV2` share nothing but a name. One
 * takes handle/platform/profileUrl/displayName/pronouns; the other takes
 * brandName/brandUrl/category/weights/reviewFields/tiktokMetadata/…. What IS
 * shared is the sequence around them — assemble, extract, snapshot, persist,
 * summarize — and the saved→outcome mapping, which is precisely the part a
 * second copy would let drift. So the spec supplies the differences and the
 * phase keeps the sequence.
 *
 * ─── Dependency injection, and why ──────────────────────────────────────────
 * `extractBrandProfile` and `persistBrandToV2` live in routers.ts, which imports
 * webResearch, which this module's collection uses. Injection keeps the cycle
 * out and makes a brand campaign runnable in tests without a database or an LLM
 * — the same reason the creator campaign injects.
 */
import { TRPCError } from "@trpc/server";
import { EvidenceGateRefusal } from "../webResearch";
import type { AnalysisPhase, CampaignState, PlatformName } from "../_core/analysisPhase";
import { NOT_READY, BRAND_PSEUDO_PLATFORM } from "../_core/analysisPhase";
import { makeExtractCommitPhase, type ExtractCommitOutput } from "./derivePhases";
import {
  assembleBrandCollection, buildBrandPersistParams, runBrandCollection,
  type BrandAugmentOutput, type BrandCaptureOutput, type BrandCollectionResult,
  type BrandDeriveOutput, type BrandInstagramChannelOutput, type BrandTranscribeOutput,
} from "./brandPhases";
import {
  runSubjectCampaign,
  type CampaignOutcome, type CreatorCampaignDeps,
} from "./creatorCampaign";

/** The subject's optional locators, as the campaign receives them. */
export interface BrandExtras {
  googleMapsUrl?: string;
  tiktokChannelUrl?: string;
  instagramHandle?: string;
}

/**
 * What a brand campaign needs beyond the shared deps.
 *
 * `weightsFor` is injected rather than imported because the brandType
 * VALIDATION that precedes it is router logic (P1-2: an LLM value outside
 * BRAND_WEIGHT_TABLE is mapped to the nearest key, or to the table-average
 * fallback). Extraction, validation and weighting are one decision, and they
 * stay together on the router's side of the seam.
 */
export interface BrandCampaignDeps extends CreatorCampaignDeps {
  weightsFor: (extracted: Record<string, unknown>) => {
    alpha: number; beta: number; gamma: number; priority: string;
  };
}

/**
 * A brand's collection failure, classified.
 *
 * Identical in shape to the creator's: PRECONDITION_FAILED is the min-data
 * refusal — a deliberate "we will not extract from this" — and everything else
 * is an error. The MESSAGES are the gate's and stay FROZEN.
 *
 * `confirmedEmpty` follows the same rule as the creator path, and `brandGate`
 * deliberately never claims it: its refusal reads "Please verify the brand URL
 * and try again", which is a statement about what we could reach, not a finding
 * that the brand has no presence. So a refused brand is recorded blocked and
 * stays requeueable.
 */
function classifyBrandCollectionFailure(
  err: unknown,
): { status: CampaignOutcome["status"]; message: string; confirmedEmpty: boolean | null } {
  if (err instanceof TRPCError) {
    const minData = err.code === "PRECONDITION_FAILED";
    return {
      status: minData ? "min_data_rejection" : "error",
      message: err.message,
      confirmedEmpty: minData
        ? (err instanceof EvidenceGateRefusal ? err.confirmedEmpty : false)
        : null,
    };
  }
  return {
    status: "error",
    message: err instanceof Error ? err.message : String(err),
    confirmedEmpty: null,
  };
}

/**
 * Rebuild the brand collection from banked ledger state.
 *
 * THE RESUME PATH, and the reason extract_commit can run alone. A campaign
 * killed after collection re-enters here and reassembles from what the ledger
 * holds — no re-crawl, no re-scrape, no second decoder call. It routes the
 * banked pieces through the SAME `assembleBrandCollection` the live path uses,
 * so a resumed run's evidence equals a live run's by construction rather than by
 * coincidence.
 *
 * Capture and augment are REQUIRED: they are what the base evidence and every
 * persisted review field come from. The two channels and derive are OPTIONAL by
 * design — each has a legitimate "produced nothing" outcome, and the router
 * analysed such a brand rather than refusing it.
 */
export function brandCollectionFromState(state: CampaignState): BrandCollectionResult | null {
  const capture = state.phases.capture?.output as BrandCaptureOutput | undefined;
  const augment = state.phases.augment?.output as BrandAugmentOutput | undefined;
  if (!capture || !augment) return null;

  return assembleBrandCollection({
    capture,
    augment,
    transcribe: (state.phases.transcribe?.output ?? null) as BrandTranscribeOutput | null,
    channelInstagram: (state.phases.channel_instagram?.output ?? null) as BrandInstagramChannelOutput | null,
    derive: (state.phases.derive?.output ?? null) as BrandDeriveOutput | null,
  });
}

/**
 * Brand's extract_commit: `extractBrandProfile` → `persistBrandToV2`.
 *
 * Exported so the harness can drive it without a database or an LLM.
 */
export function makeBrandExtractCommitPhase(
  platform: PlatformName,
  deps: BrandCampaignDeps,
  extras: BrandExtras,
): AnalysisPhase<{ handle: string; collection: BrandCollectionResult }, ExtractCommitOutput> {
  return makeExtractCommitPhase<
    { handle: string; collection: BrandCollectionResult },
    BrandCollectionResult
  >(
    platform,
    {
      extract: deps.extract,
      // Brand records NO womo_0007 evidence snapshot — `persistBrandToV2` has no
      // parameter for one and the router never built one. A creator-shaped
      // snapshot here would be work whose only destination is the floor.
      buildSnapshot: () => null,
      persist: deps.persist,
      summarize: deps.summarize,
    },
    {
      tool: "llm:extractBrandProfile+persist",
      readInputs: (state) => {
        const collection = brandCollectionFromState(state);
        return collection ? { handle: state.handle, collection } : NOT_READY;
      },
      assemble: (input) => ({
        ...input.collection,
        // The two fields the shared phase itself reads off the research object.
        evidenceSummary: input.collection.evidenceSummary,
        profileUrl: input.collection.capture.websiteUrl ?? undefined,
      }),
      persistParams: ({ research, extracted }) => buildBrandPersistParams({
        collection: research,
        extracted,
        weights: deps.weightsFor(extracted),
        // From what the SUBJECT asked for, never from what came back — the whole
        // distinction between skipped_not_attempted and skipped_no_data.
        requested: {
          tiktokChannelUrl: extras.tiktokChannelUrl,
          instagramHandle: extras.instagramHandle,
        },
      }),
    },
  );
}

/**
 * Run one brand campaign end to end. No HTTP request, no caller waiting.
 *
 * @param args.extras the subject's locators — googleMapsUrl, tiktokChannelUrl,
 *   instagramHandle. Carried through so the campaign banks under the SAME
 *   `subject_hint` the queue enqueued it as, and so the channel phases and the
 *   requested/not-attempted distinction both receive what they need.
 */
export async function runBrandCampaign(
  args: {
    runId: string;
    handle: string;
    extras?: Record<string, string>;
    deadlineAt?: number;
    initialPhases?: CampaignState["phases"];
  },
  deps: BrandCampaignDeps,
): Promise<CampaignOutcome<BrandCollectionResult>> {
  const extras = (args.extras ?? {}) as BrandExtras;
  return runSubjectCampaign<BrandCollectionResult>(
    { ...args, platform: BRAND_PSEUDO_PLATFORM },
    deps,
    {
      collect: ({ handle, initialPhases }) => runBrandCollection(handle, extras, initialPhases),
      classifyFailure: classifyBrandCollectionFailure,
      makeExtractCommit: ({ platform }) =>
        makeBrandExtractCommitPhase(platform, deps, extras) as never,
    },
  );
}
