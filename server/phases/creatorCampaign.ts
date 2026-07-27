/**
 * The creator campaign — phased architecture S3b, Part 1.
 *
 * ─── What changed ───────────────────────────────────────────────────────────
 * `extract_commit` used to run INLINE in routers.ts, after the endpoint had
 * already received the assembled evidence. The ledger therefore showed four
 * runner rows plus a shadow row written by hand, and a campaign could not
 * complete without an HTTP request driving it. It now runs through the same
 * runner, scheduler and ledger as the other four: five runner rows, and a
 * campaign that completes with nobody watching.
 *
 * That is what makes the queue possible — and it closes the lost-work class
 * properly. The old defence was in-race salvage: `Promise.race` does not cancel
 * the loser, so a timed-out run's extraction kept going and persisted
 * out-of-band. It worked, but only while the PROCESS survived. A crash between
 * extraction and commit lost the work outright. Now extract_commit is a ledger
 * phase like any other: a campaign killed after collection but before commit
 * comes back with capture/augment/transcribe/derive banked and re-runs ONLY
 * phase 5, from banked evidence, with no re-scraping.
 *
 * ─── Why the evidence gates still run between phase 4 and phase 5 ───────────
 * The quota gate, the no-data gate and the minimum-data threshold are FROZEN
 * interpretation. They decide whether the evidence is fit to extract from at
 * all, and they must run BEFORE extract_commit — a single five-phase pass would
 * happily persist a profile that the min-data gate exists to refuse. They live
 * where they always have (inside the collection half) and still throw; this
 * module turns that throw into a terminal campaign outcome carrying the same
 * message, because under a queue there is no caller to throw to.
 *
 * ─── Dependency injection, and why ──────────────────────────────────────────
 * extract_commit needs extractCreatorProfile / persistCreatorToV2 /
 * buildCreatorEvidenceSnapshotPayload, which live in routers.ts — and routers
 * imports webResearch, which this module uses. Injection keeps the cycle out
 * and makes a campaign runnable in tests without a database or an LLM.
 */
import { TRPCError } from "@trpc/server";
import type { CampaignState, PhaseName, PhaseStateEntry, PlatformName } from "../_core/analysisPhase";
import { runPhases, bankedOutput, type BankFn } from "./phaseRunner";
import { makeSchedulerExecute } from "./phaseScheduler";
import { makeExtractCommitPhase, type ExtractCommitOutput } from "./derivePhases";
import { runCollection } from "../webResearch";
import { NOT_READY } from "../_core/analysisPhase";
import { assembleFromPhases, type DerivePhaseOutput } from "./derivePhases";
import type {
  CapturePhaseOutput, AugmentPhaseOutput, TranscribePhaseOutput,
} from "./collectionPhases";
import { encodeSubject } from "../_core/subjectIdentity";
import type { CreatorResearchResult } from "../webResearch";

/** Everything the campaign needs from routers.ts, injected. */
export interface CreatorCampaignDeps {
  /**
   * Extraction WITH the one-retry policy the endpoint has always applied — a
   * transient LLM hiccup should not kill an otherwise-good run. The phase never
   * learns about the retry; it asks for an extraction and gets one.
   */
  extract: (handleOrUrl: string, platform: string, evidenceSummary: string) => Promise<Record<string, unknown>>;
  buildSnapshot: (handleOrUrl: string, platform: string, evidenceSummary: string | undefined, structured: unknown) => unknown;
  /** Maps a CreatorResearchResult into the researchData shape persistCreatorToV2 expects. */
  persist: (params: Record<string, unknown>) => Promise<Record<string, unknown>>;
  summarize: (result: unknown) => { saved: string };
  /** Ledger writer. Injected so the campaign is testable without a database. */
  bank: (entry: Parameters<BankFn>[0] & { subjectHint: string; runId: string }) => Promise<void> | void;
  /** Marks a phase pending/running for the queue view. Best-effort. */
  mark?: (entry: { runId: string; subjectHint: string; phase: PhaseName; tool: string; attempt: number; status: "pending" | "running" }) => void;
}

/**
 * The persistence summary's shape, declared structurally here rather than
 * imported: routers.ts owns `summarizePersistence`, and importing its type
 * would reintroduce the cycle this module's dependency injection exists to
 * avoid.
 */
export interface CampaignPersistenceSummary {
  saved: "full" | "partial" | "none";
  failedComponents: string[];
  error: string | null;
  components: Record<string, unknown> | null;
}

/**
 * The DEFAULT type parameter is what keeps this additive: every existing
 * reference to `CampaignOutcome` still means a creator outcome and compiles
 * unchanged. A subject with a different research shape names it explicitly
 * rather than the field widening to a union of every subject type.
 */
export interface CampaignOutcome<TResearch = CreatorResearchResult> {
  runId: string;
  handle: string;
  platform: PlatformName;
  /** Did the campaign reach a committed observation? */
  committed: boolean;
  subjectId: string | null;
  observationId: string | null;
  /** Terminal classification for pipeline_runs. */
  status: "success" | "partial" | "saved_none" | "min_data_rejection" | "error";
  /** The analyst-facing reason when the campaign did not commit. */
  message: string | null;
  /** Which phase stopped it, when it stopped early. */
  stoppedAt: PhaseName | null;
  research: TResearch | null;
  /** The persistence summary extract_commit produced, when it ran. */
  persistence: CampaignPersistenceSummary | null;
}

/**
 * Map a thrown evidence gate to a terminal campaign outcome.
 *
 * The gates are FROZEN and still throw TRPCErrors with their exact messages;
 * this only decides how a queue reports them. PRECONDITION_FAILED is the
 * min-data refusal — a deliberate, honest "we will not extract from this",
 * distinct from a failure.
 */
function classifyCollectionFailure(err: unknown): { status: CampaignOutcome["status"]; message: string } {
  if (err instanceof TRPCError) {
    return {
      status: err.code === "PRECONDITION_FAILED" ? "min_data_rejection" : "error",
      message: err.message,
    };
  }
  return { status: "error", message: err instanceof Error ? err.message : String(err) };
}

/**
 * Run one creator campaign end to end. No HTTP request required, and no caller
 * waiting: the queue worker calls this and the ledger records everything.
 *
 * @param initialPhases banked state from a previous attempt. A resumed campaign
 *   passes what the ledger holds, and any phase already banked as usable is
 *   skipped by the runner — which is how a crash between extraction and commit
 *   costs one LLM call instead of a full re-scrape.
 */
/**
 * THE SHARED CAMPAIGN ORCHESTRATION (S5 step A — extraction only, zero edits).
 *
 * Lifted VERBATIM out of `runCreatorCampaign`. Nothing about what it does
 * changed; only that it is now a separate unit, so step B can parameterise the
 * two creator-specific points inside it — the collection call and the research
 * result — instead of a second copy of all of this being written for brand.
 *
 * WHY EXTRACTION FIRST, ON ITS OWN. Campaign-level behaviour has no identity
 * harness: the evidence harnesses pin the assembled string, not the
 * orchestration around it. So the arbiter here is the diff — every removed line
 * must reappear — plus a live creator acceptance run before brand touches any
 * of it. A refactor with no automatic arbiter gets done in the smallest
 * provable steps available.
 */
export interface SubjectCampaignSpec<TResearch> {
  /**
   * Phases 1-4 plus the platform's FROZEN gates. Creator supplies
   * `runCollection`; brand supplies `runBrandCollection`. The runner never
   * learns which — it only needs banked phases back.
   */
  collect: (args: {
    handle: string;
    platform: PlatformName;
    extras?: Record<string, string>;
    initialPhases?: CampaignState["phases"];
  }) => Promise<{ research: TResearch; phases: CampaignState["phases"] }>;
  /** Map a thrown gate to a terminal outcome — the messages are FROZEN. */
  classifyFailure: (err: unknown) => { status: CampaignOutcome["status"]; message: string };
  /**
   * The extract_commit phase, when this subject builds its own (S5).
   *
   * Creator omits it and gets the creator phase below, unchanged. Brand supplies
   * one because it extracts a different profile, persists through a different
   * function with a different parameter shape, and reads different banked
   * phases — while the sequence, the retry policy and the saved→outcome mapping
   * stay shared, which is the whole point of the seam.
   */
  makeExtractCommit?: (args: {
    platform: PlatformName;
    deps: CreatorCampaignDeps;
  }) => Parameters<typeof runPhases>[0]["phases"][number];
}

export async function runSubjectCampaign<TResearch>(
  args: {
    runId: string;
    handle: string;
    platform: PlatformName;
    extras?: Record<string, string>;
    deadlineAt?: number;
    initialPhases?: CampaignState["phases"];
  },
  deps: CreatorCampaignDeps,
  spec: SubjectCampaignSpec<TResearch>,
): Promise<CampaignOutcome<TResearch>> {
  /**
   * ENCODED ONCE, by the module that owns the encoding.
   *
   * This used to rebuild the hint by hand. Harmless while every subject was a
   * bare handle, and a landmine the moment one carries extras: the queue
   * enqueues `name@Brand::{...}` while the campaign banks `name@Brand`, so a
   * campaign's ledger rows split across two subject hints and the queue's own
   * view reads a different subject than it submitted.
   */
  const subjectHint = encodeSubject({
    handle: args.handle, platform: args.platform, extras: args.extras,
  });
  const base = {
    runId: args.runId, handle: args.handle, platform: args.platform,
    committed: false, subjectId: null, observationId: null,
    stoppedAt: null, research: null, persistence: null,
  } as const;

  // ── Phases 1-4 + the FROZEN gates + the pure assembly ──
  let collected;
  try {
    collected = await spec.collect({
      handle: args.handle, platform: args.platform,
      extras: args.extras, initialPhases: args.initialPhases,
    });
  } catch (err) {
    const { status, message } = spec.classifyFailure(err);
    return { ...base, status, message };
  }

  // ── Phase 5: extract_commit, through the same runner ──
  const extractCommitPhase = spec.makeExtractCommit
    ? spec.makeExtractCommit({ platform: args.platform, deps })
    : makeExtractCommitPhase(
        args.platform,
        {
          extract: deps.extract,
          buildSnapshot: deps.buildSnapshot,
          persist: deps.persist,
          summarize: deps.summarize,
        },
        // The creator spec — VERBATIM what the phase used to do inline: the same
        // four banked reads, the same NOT_READY condition, the same assembly and
        // the same ledger tool name.
        {
          tool: "llm:extractCreatorProfile+persist",
          readInputs: (state) => {
            const capture = state.phases.capture?.output as CapturePhaseOutput | undefined;
            const augment = state.phases.augment?.output as AugmentPhaseOutput | undefined;
            const transcribe = state.phases.transcribe?.output as TranscribePhaseOutput | undefined;
            const derived = state.phases.derive?.output as DerivePhaseOutput | undefined;
            if (!capture || !augment || !transcribe || !derived) return NOT_READY;
            return { handle: state.handle, capture, augment, transcribe, derived };
          },
          assemble: (input) => assembleFromPhases(input.handle, args.platform, input, input.derived),
        },
      );

  const summary = await runPhases({
    runId: args.runId,
    handle: args.handle,
    platform: args.platform,
    phases: [extractCommitPhase] as never,
    // `collected.phases` is authoritative: it already merges the resumed ledger
    // state (passed into the collection above) with whatever this attempt ran.
    // Spreading args.initialPhases over it again would let a PRE-RUN snapshot —
    // where capture is still `pending` with a null output — mask the freshly
    // collected result, and extract_commit would read NOT_READY forever.
    initialPhases: collected.phases,
    execute: makeSchedulerExecute({
      deadlineAt: args.deadlineAt,
      onAttemptStart: (phase, attempt, status) =>
        deps.mark?.({ runId: args.runId, subjectHint, phase: phase.name, tool: phase.tool, attempt, status }),
    }),
    bank: (entry) => deps.bank({ ...entry, runId: args.runId, subjectHint }),
  });

  const out = bankedOutput<ExtractCommitOutput>(summary, "extract_commit");
  const entry = summary.state.phases.extract_commit as PhaseStateEntry | undefined;
  const persistence = (out?.persistence ?? null) as CampaignPersistenceSummary | null;

  if (!out || entry?.status === "failed") {
    return {
      ...base,
      research: collected.research,
      persistence,
      status: "error",
      stoppedAt: "extract_commit",
      message: persistence?.error
        ?? `Extraction or persistence failed for @${args.handle}. Nothing was saved.`,
    };
  }

  const saved = persistence?.saved;
  if (saved !== "full") {
    console.warn(`[campaign] @${args.handle}: persistence outcome ${saved}`, persistence?.error ?? "");
  }
  return {
    ...base,
    research: collected.research,
    persistence,
    committed: saved === "full" || saved === "partial",
    subjectId: out.subjectId,
    observationId: out.observationId,
    status: saved === "full" ? "success" : saved === "partial" ? "partial" : "saved_none",
    message: saved === "full" ? null : (persistence?.error ?? `Persistence outcome: ${saved ?? "unknown"}`),
  };
}

export async function runCreatorCampaign(
  args: {
    runId: string;
    handle: string;
    platform: PlatformName;
    /**
     * The subject's extra locators, carried through so this campaign banks
     * under the SAME `subject_hint` the queue enqueued it as (S5).
     */
    extras?: Record<string, string>;
    deadlineAt?: number;
    initialPhases?: CampaignState["phases"];
  },
  deps: CreatorCampaignDeps,
): Promise<CampaignOutcome> {
  return runSubjectCampaign(args, deps, {
    // Creator's collection and its frozen gate classification, unchanged.
    collect: ({ handle, platform, initialPhases }) => runCollection(handle, platform, initialPhases),
    classifyFailure: classifyCollectionFailure,
  });
}

