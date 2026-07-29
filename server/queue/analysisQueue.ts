/**
 * The analysis queue — phased architecture S3b, Parts 2-3.
 *
 * ─── The architectural rule ─────────────────────────────────────────────────
 * THE QUEUE IS THE SINGLE ENTRY POINT FOR ALL ANALYSIS. Every creator — new or
 * re-analysed, one handle or twenty — is enqueued first and enters the pipeline
 * from here. There is no synchronous bypass and no "run now" shortcut. A single
 * creator is a queue of one; submission and queue submission are the same
 * operation, which is why `submitCampaigns` takes an array even for one handle.
 *
 * That is not ceremony. Every previous entry point was a separate copy of the
 * orchestration, and they drifted: bulkAnalyze had no timeout, no memory
 * tracker, no terminal telemetry, no extraction retry and no followingCount.
 * One entry point cannot drift from itself.
 *
 * ─── Durability model ───────────────────────────────────────────────────────
 * The ledger IS the queue. There is no in-memory job list to lose:
 *   - submit writes a `pending` capture row DURABLY (recordPhaseState, which
 *     throws) and fails the submission if that write fails — a campaign absent
 *     from the ledger does not exist;
 *   - the worker polls `scanReadyWork`, which is exactly the "what is ready
 *     now?" query womo_0009's aps_ready_idx was built for;
 *   - on boot it reclaims abandoned `running` rows (heartbeat-proven dead, not
 *     assumed) and resumes whatever the last process left behind.
 *
 * A restart therefore costs at most the phase that was in flight. Phases already
 * banked as usable are skipped by the runner, so a campaign killed after
 * collection re-runs only extract_commit — from banked evidence, no re-scraping.
 *
 * ─── Concurrency ────────────────────────────────────────────────────────────
 * NOT this module's business. S3a's per-resource admission already bounds the
 * work (browser 2 / llm 4, taken before any tool runs). The worker may hold
 * several campaigns in flight; their phases queue against those bounds. Adding a
 * second limiter here would silently re-cap what S3a deliberately tuned.
 */
import {
  recordRunOutcome,
  type RunOutcomeStatus,
  findIncompleteCampaigns,
  listRecentCampaigns,
  getPhaseStateForRuns,
  getPhaseState,
  heartbeatPhase,
  reclaimStaleRunning,
  recordPhaseState,
  recordRunInputs,
  getRunInputs,
  scanReadyWork,
  HEARTBEAT_MS,
} from "../db";
import { newRunId, withAnalysisRun } from "../_core/runContext";
import { encodeSubject, decodeSubject } from "../_core/subjectIdentity";
import { startRunMemoryTracker } from "../scraping/memoryTelemetry";
import { runCreatorCampaign, type CreatorCampaignDeps, type CampaignOutcome } from "../phases/creatorCampaign";
import { runBrandCampaign, type BrandCampaignDeps } from "../phases/brandCampaign";
import type { CampaignState, PhaseName, PhaseStateEntry } from "../_core/analysisPhase";
import { PHASE_NAMES, isPseudoPlatform } from "../_core/analysisPhase";

/**
 * Both subject kinds' dependencies, resolved once at boot.
 *
 * A single object rather than two workers: the drain, the reclaim, the
 * heartbeat, the in-flight set and the terminal telemetry are identical for
 * every subject, and a second worker would be a second copy of all of it — the
 * exact drift the single-entry-point rule exists to prevent.
 */
export interface QueueDeps {
  creator: CreatorCampaignDeps;
  brand: BrandCampaignDeps;
}

/** The creator fields the terminal telemetry reads; brand has neither. */
interface CreatorResearchLike {
  transcriptCount?: number;
  recentVideoTitles?: string[];
}

// ─── Submission ──────────────────────────────────────────────────────────────

export interface SubmitRequest {
  handle: string;
  platform: QueueablePlatform;
  /**
   * Subject-specific locators the platform's capture tool understands (S5).
   * Absent for every single-handle subject, which is what keeps their
   * `subject_hint` byte-identical — see _core/subjectIdentity.
   */
  extras?: Record<string, string>;
}

/**
 * What the queue can actually run. NOT the full PlatformName union: a platform
 * is queueable only once it has a registered toolset, and toolsetFor throws
 * loudly for the rest rather than producing an empty analysis.
 *
 * `"Brand"` is the odd one and deliberately so — it is not a platform, it is a
 * different KIND of subject occupying the platform slot. The value is
 * BRAND_PSEUDO_PLATFORM's; it is written literally here only because a `typeof`
 * on that constant widens to PlatformName and would defeat the narrowing this
 * union exists for. Brand resolves NO toolset: it brings its own phases and its
 * own gate, which is why it can be queueable without being registered.
 *
 * Read docs/BRAND_PSEUDO_PLATFORM.md before adding a second one.
 */
export type QueueablePlatform = "TikTok" | "Instagram" | "Brand";

/**
 * Can this subject actually be run by the worker?
 *
 * ONE rule, because it had become two. The boot loop resumes from the ledger,
 * which outlives any single release, so it can meet a campaign for a platform
 * that WAS supported when the row was written and is not any more (YouTube).
 * Refusing it here is what keeps a disabled platform from being resurrected by
 * resumption — and `creator.resumeRun` needs the identical answer, because an
 * endpoint that reports `requeued: true` for work the worker will silently skip
 * is telling the analyst something untrue.
 *
 * Brand passes without a toolset: it is not a platform, it brings its own phases
 * and its own gate. See BRAND_PSEUDO_PLATFORM.
 */
export function isRunnableSubject(platform: string): boolean {
  if (isPseudoPlatform(platform)) return true;
  return platform === "TikTok" || platform === "Instagram";
}

export interface SubmittedCampaign {
  runId: string;
  handle: string;
  platform: QueueablePlatform;
  state: "queued";
}

/**
 * Enqueue campaigns. Returns as soon as they are DURABLY recorded — never waits
 * for any of them to run.
 *
 * One handle or twenty is the same call and the same code path; the only
 * difference is the length of the array.
 */
export async function submitCampaigns(requests: SubmitRequest[]): Promise<SubmittedCampaign[]> {
  const submitted: SubmittedCampaign[] = [];
  for (const req of requests) {
    const runId = newRunId();
    // DURABLE — recordPhaseState throws. A campaign missing from the ledger
    // would be invisible to the worker and to the analyst, so a failed enqueue
    // must fail the submission rather than pretend.
    /*
      ─── INPUTS FIRST, and not in the identity key (womo_0013) ──────────────
      The locators used to be encoded INTO `subject_hint` and read back out of
      it at run time. That column is varchar(160); six brand runs truncated at
      exactly 160 chars, `decodeSubject`'s JSON.parse then failed, and its catch
      returned the subject with NO extras — silently. Every brand lost every
      locator before phase one, and persistence blamed the operator for not
      supplying handles the operator HAD supplied.

      So they are written to their own table, before the ledger row: a campaign
      that is visible to the worker but whose inputs were lost is the exact
      failure being fixed, and ordering it this way makes that state
      unreachable. Both writes throw.
    */
    if (req.extras && Object.keys(req.extras).length > 0) {
      await recordRunInputs(runId, {
        submittedSubject: req.handle,
        googleMapsUrl: req.extras.googleMapsUrl,
        instagramHandle: req.extras.instagramHandle,
        tiktokChannelUrl: req.extras.tiktokChannelUrl,
        brandName: req.extras.brandName,
      });
    }
    await recordPhaseState({
      runId,
      // NO EXTRAS. `subject_hint` is an identity key and carries identity only.
      subjectHint: encodeSubject({ handle: req.handle, platform: req.platform }),
      phase: "capture",
      status: "pending",
      attemptCount: 0,
    });
    submitted.push({ runId, handle: req.handle, platform: req.platform, state: "queued" });
    console.log(`[queue] enqueued ${req.handle}@${req.platform} as ${runId}`);
  }
  // Wake an idle-backoff worker immediately — a submit must never wait out
  // the stretched idle cadence.
  if (submitted.length > 0) kickQueueNow();
  return submitted;
}

/**
 * Clear a campaign's gates so the next drain picks it up immediately.
 *
 * The queue already resumes parked campaigns when `next_earliest_at` passes;
 * this is the analyst's "don't make me wait" nudge, not a second scheduling
 * mechanism. Durable — an ignored requeue would look like the queue is stuck.
 *
 * ─── It used to BE the ignored requeue it warns about ───────────────────────
 * This preserved `failure_class`, and BOTH reads that offer work to the worker
 * exclude `structural`:
 *
 *   scanReadyWork            `failure_class NOT IN ('structural','genuine_empty')`
 *   findIncompleteCampaigns  `terminated = … some(failureClass === 'structural')`
 *
 * So a requeue wrote `pending` and the campaign was still invisible — for
 * exactly the parked-by-a-structural-failure campaigns this function exists to
 * rescue. Observed live: six consecutive drains returned `drained=0` on a
 * campaign whose every collection phase was complete.
 *
 * ─── Why CLEARING the class is the fix, rather than teaching the scan ───────
 * Those two exclusions are correct and load-bearing: without them a permanently
 * failed phase reads as ready on every tick and the queue retries it forever.
 * That rule is about AUTOMATIC re-offering. A manual requeue is a human saying
 * "I have addressed the cause" — which is precisely the claim that the row is no
 * longer known-structural, so clearing the class states it in the field the
 * scan already reads. The alternative, an explicit `requeued_at` override
 * column, needs DDL and a second concept of readiness to keep in sync.
 *
 * `attemptCount` is PRESERVED. The scheduler's ladder restarts at 1 inside each
 * execution, so a banked count never blocks a retry; it is history, and a
 * requeue should not erase how much a campaign has already cost.
 */
export async function requeueCampaignNow(runId: string): Promise<void> {
  const rows = await getPhaseState(runId);
  for (const r of rows) {
    if (r.status === "complete" || r.status === "partial" || r.status === "genuine_empty") continue;
    await recordPhaseState({
      runId,
      subjectHint: r.subjectHint,
      phase: r.phase as PhaseName,
      tool: r.tool ?? undefined,
      status: "pending",
      attemptCount: r.attemptCount,
      // Cleared, not carried — see above. `recordPhaseState` writes
      // `failureClass ?? null`, so omitting it nulls the column.
      failureClass: undefined,
      nextEarliestAt: null,
      output: r.output,
    });
  }
  // "…picks it up immediately" — with idle backoff that promise needs a kick.
  kickQueueNow();
}

// ─── Status ──────────────────────────────────────────────────────────────────

export type CampaignRunState = "queued" | "running" | "parked" | "complete" | "failed";

export interface CampaignStatus {
  runId: string;
  handle: string;
  platform: string;
  state: CampaignRunState;
  /** The phase currently running, or the one that stopped the campaign. */
  currentPhase: PhaseName | null;
  phases: Array<{
    phase: PhaseName;
    status: string;
    attemptCount: number;
    failureClass: string | null;
    /** When a parked phase becomes eligible again. */
    nextEarliestAt: Date | null;
    /**
     * When this phase row was first written, and when it was last touched.
     *
     * BOTH, because one without the other cannot express duration. The report
     * page needs to say how long a phase took, and deriving that from the gap
     * between consecutive phases' `updatedAt` would fold the queue wait into
     * execution time and present an invented number as a measured one. The
     * row has carried `created_at` since womo_0008; it was simply never
     * shipped. (Note what the span MEANS: creation is when the phase was
     * enqueued, so a phase that waited for a permit shows that wait inside its
     * span — see the report page, which labels it accordingly.)
     */
    createdAt: Date | null;
    updatedAt: Date | null;
    /** Why it parked, in words — null unless it parked. */
    parkReason: string | null;
    /**
     * Set only when retries were spent and the phase was STILL blocked, so the
     * campaign committed anyway. A record, never an input to scoring.
     */
    blockedGap: {
      phase: string; attempts: number; failureClass: string | null;
      detail: string | null; reason: string;
    } | null;
    /**
     * Every in-process retry this phase took, banked by the scheduler with its
     * reason — so a success that took three attempts says why the first two
     * failed WITHOUT a live console. Null when it succeeded first try.
     */
    retryHistory: Array<{
      attempt: number; reason: string; detail: string | null;
      delayMs: number; at: string;
    }> | null;
  }>;
  subjectId: string | null;
  observationId: string | null;
  message: string | null;
}

/**
 * Derive a campaign's state from its ledger rows. Pure, so the state machine is
 * testable without a database — and so the client's view can never disagree with
 * the ledger, because it IS the ledger.
 */
export function deriveCampaignState(phases: CampaignStatus["phases"]): CampaignRunState {
  if (phases.length === 0) return "queued";
  const commit = phases.find(p => p.phase === "extract_commit");
  if (commit && (commit.status === "complete" || commit.status === "partial")) return "complete";
  // genuine_empty is a confirmed fact about the subject — terminal, and not a
  // failure of ours. It still ends the campaign.
  if (phases.some(p => p.status === "genuine_empty")) return "complete";
  if (phases.some(p => p.status === "running")) return "running";
  if (phases.some(p => p.nextEarliestAt && p.nextEarliestAt.getTime() > Date.now())) return "parked";
  if (phases.some(p => p.status === "failed" || p.status === "blocked")) {
    // Failed with no future gate and no attempts left = terminal failure.
    return "failed";
  }
  return "queued";
}

/**
 * Ledger rows → one campaign. PURE, and the single place the shape is built:
 * the by-runId read and the list read both go through here, so the list can be
 * batched without the two drifting apart.
 */
/**
 * The park/gap/retry marks a phase's banked output may carry.
 *
 * TWO SOURCES, one result (egress, 2026-07-29). When the row arrived with its
 * full `output` (the by-run full read, commit rows, and the extraction-failed
 * fallback), the marks are read off the parsed object exactly as always. When
 * the row arrived narrowed (the queue-view batch read), the marks come from
 * the SQL-extracted lexemes instead — parkRaw is a JSON string's content
 * (still escaped, so it re-enters JSON.parse wrapped in quotes), gapRaw and
 * retryRaw are the mark's own JSON lexeme. Same values either way; the
 * evidence bank no longer rides along to deliver them.
 */
function phaseMarks(row: {
  output: unknown;
  parkRaw?: string | null;
  gapRaw?: string | null;
  retryRaw?: string | null;
}): Pick<CampaignStatus["phases"][number], "parkReason" | "blockedGap" | "retryHistory"> {
  if (row.output != null) {
    const o = row.output as { parkReason?: string; blockedGap?: unknown; retryHistory?: unknown };
    return {
      parkReason: o?.parkReason ?? null,
      blockedGap: (o?.blockedGap ?? null) as CampaignStatus["phases"][number]["blockedGap"],
      retryHistory: (o?.retryHistory ?? null) as CampaignStatus["phases"][number]["retryHistory"],
    };
  }
  const parseLexeme = (raw: string | null | undefined): unknown => {
    if (raw == null) return null;
    try { return JSON.parse(raw); } catch (err) {
      // Should be unreachable — the SQL belt ships the full document whenever
      // extraction fails. Loud, and absent rather than wrong.
      console.error("[queue] extracted mark failed to parse — treating as absent:", err);
      return null;
    }
  };
  return {
    parkReason: (parseLexeme(row.parkRaw != null ? `"${row.parkRaw}"` : null) as string | null) ?? null,
    blockedGap: parseLexeme(row.gapRaw) as CampaignStatus["phases"][number]["blockedGap"],
    retryHistory: parseLexeme(row.retryRaw) as CampaignStatus["phases"][number]["retryHistory"],
  };
}

function shapeCampaign(
  runId: string,
  // The fields this shape actually reads, declared structurally — so the full
  // row read and the narrowed batch read (which omits `output` for every phase
  // but extract_commit) both satisfy it.
  rows: Array<{
    subjectHint: string;
    phase: string;
    status: string;
    attemptCount: number;
    failureClass: string | null;
    nextEarliestAt: Date | null;
    createdAt: Date | null;
    updatedAt: Date | null;
    output: unknown;
    /** SQL-extracted mark lexemes — present on the narrowed batch read. */
    parkRaw?: string | null;
    gapRaw?: string | null;
    retryRaw?: string | null;
  }>,
): CampaignStatus | null {
  if (rows.length === 0) return null;
  const { handle, platform } = decodeSubject(rows[0]!.subjectHint);
  const phases = rows.map(r => ({
    phase: r.phase as PhaseName,
    status: r.status,
    attemptCount: r.attemptCount,
    failureClass: r.failureClass,
    nextEarliestAt: r.nextEarliestAt,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    // Read in JS, not SQL: see getPhaseStateForRuns — Postgres JSON operators
    // reject the lone surrogates that live in some scraped captions.
    ...phaseMarks(r),
  }));
  const commit = rows.find(r => r.phase === "extract_commit");
  const out = commit?.output as {
    subjectId?: string; observationId?: string;
    persistence?: {
      error?: string | null;
      /** Which components failed, and each component's own account of why. */
      failedComponents?: string[];
      components?: Record<string, { status?: string; reason?: string | null }> | null;
    };
    /** `recordTerminalFailure` banks the honest text here. */
    message?: string | null;
  } | null;
  const running = phases.find(p => p.status === "running");
  const stopped = phases.find(p => p.status === "failed" || p.status === "blocked");

  return {
    runId,
    handle: handle ?? "",
    platform: platform ?? "TikTok",
    state: deriveCampaignState(phases),
    currentPhase: (running ?? stopped)?.phase ?? null,
    phases,
    subjectId: out?.subjectId ?? null,
    observationId: out?.observationId ?? null,
    // A partial-persistence error first (a campaign that committed but lost a
    // component), then the component map's own account, then the terminal
    // failure text. Before the first fallback a terminally-failed campaign
    // reported `null` while its own ledger row held the reason; before the
    // second, a PARTIAL save could ship null too — vnillalondon in the corpus
    // rebuild saved with failedComponents=["platform_handle"], a precise
    // per-component reason in `components`, and error=null, so the analyst saw
    // "partial save" and no why.
    message: out?.persistence?.error
      ?? firstFailedComponentReason(out?.persistence)
      ?? out?.message
      ?? null,
  };
}

/**
 * The first failed component's own reason, from the persistence component map.
 * Null when there is no failure to explain, or the map does not carry one.
 */
export function firstFailedComponentReason(
  persistence: {
    failedComponents?: string[];
    components?: Record<string, { status?: string; reason?: string | null }> | null;
  } | undefined,
): string | null {
  const failed = persistence?.failedComponents ?? [];
  if (failed.length === 0) return null;
  const name = failed[0]!;
  const reason = persistence?.components?.[name]?.reason;
  // The component name alone still beats silence when no reason was recorded.
  return reason ? `${name}: ${reason}` : `component "${name}" failed to persist`;
}

export async function getCampaignStatus(runId: string): Promise<CampaignStatus | null> {
  /*
    ─── NARROW READ (egress, 2026-07-29) ────────────────────────────────────
    This called getPhaseState — select() of every column, `output` included —
    to render six phase rows: ~100-200KB per report open for a shape that
    reads only identity fields, the three marks, and the commit row's keys.
    The narrowed batch read carries exactly those (marks SQL-extracted, commit
    output whole), so the by-run view now costs what it renders. Execution
    paths (loadBankedPhases, requeueCampaignNow, loadResumableBankedPhases)
    keep the full read — they genuinely consume `output`.
  */
  return shapeCampaign(runId, await getPhaseStateForRuns([runId]));
}

/**
 * The queue view's read. READ-PATH ONLY — nothing here enqueues, schedules or
 * mutates.
 *
 * `includeTerminal` picks the underlying question:
 *   false — "what is still in flight?" (`findIncompleteCampaigns`, the boot
 *           loop's query: excludes committed/terminated, bounded to 24h)
 *   true  — "what has this system done?" (`listRecentCampaigns`: every
 *           campaign, terminal included, no age bound)
 *
 * The default stays false so existing callers are unchanged.
 */
export async function listCampaigns(
  limit = 50,
  opts: { includeTerminal?: boolean } = {},
): Promise<CampaignStatus[]> {
  const runs = opts.includeTerminal
    ? await listRecentCampaigns(limit)
    : await findIncompleteCampaigns(limit);
  if (runs.length === 0) return [];

  // ONE query for every run's rows, then shape in memory. Fetching per-campaign
  // here was an N+1 that cost 11-17s for 43 campaigns on a 3s poll.
  const all = await getPhaseStateForRuns(runs.map(r => r.runId));
  const byRun = new Map<string, typeof all>();
  for (const row of all) {
    const list = byRun.get(row.runId) ?? [];
    list.push(row);
    byRun.set(row.runId, list);
  }

  // `runs` order is the display order (most recent activity first); preserve it.
  const out: CampaignStatus[] = [];
  for (const r of runs) {
    const status = shapeCampaign(r.runId, byRun.get(r.runId) ?? []);
    if (status) out.push(status);
  }
  return out;
}

// ─── Worker ──────────────────────────────────────────────────────────────────

let _deps: QueueDeps | null = null;
let _timer: ReturnType<typeof setTimeout> | null = null;
let _draining = false;
const _inFlight = new Set<string>();

/** Poll cadence while there is — or recently was — work. */
export const POLL_MS = 5_000;

// ─── Idle backoff (egress incident, 2026-07-28) ──────────────────────────────
// A flat 5s cadence polls the ledger ~17,000 times a day whether or not
// anything is queued, and every one of those reads crosses the wire to a
// metered database. After IDLE_AFTER_EMPTY_DRAINS consecutive drains that
// started nothing, the delay doubles per further empty drain — 10s, 20s, 40s —
// capped at IDLE_POLL_MS_MAX. A submit or manual requeue calls kickQueueNow(),
// which drains immediately and restores the 5s cadence, so an analyst never
// waits on the idle clock. The only latency this adds is to UNATTENDED
// transitions (a parked campaign's gate expiring while the queue is idle),
// which now wake within IDLE_POLL_MS_MAX rather than POLL_MS.

/** Consecutive empty drains before the cadence stretches (30s of quiet at 5s). */
export const IDLE_AFTER_EMPTY_DRAINS = 6;
/** Idle cadence ceiling. */
export const IDLE_POLL_MS_MAX = 60_000;

let _emptyDrains = 0;

/** Delay before the next drain, given the current empty-drain streak. Pure. */
export function nextPollDelayMs(emptyDrains: number = _emptyDrains): number {
  if (emptyDrains < IDLE_AFTER_EMPTY_DRAINS) return POLL_MS;
  const over = emptyDrains - IDLE_AFTER_EMPTY_DRAINS; // 0→10s, 1→20s, 2→40s, 3+→60s
  return Math.min(POLL_MS * 2 ** (over + 1), IDLE_POLL_MS_MAX);
}

/** Schedule the next drain of the running worker after `delayMs`. */
function scheduleDrain(delayMs: number): void {
  if (!_deps) return;
  if (_timer) clearTimeout(_timer);
  _timer = setTimeout(() => {
    void (async () => {
      try {
        const drained = await drainOnce(_deps!);
        _emptyDrains = drained > 0 ? 0 : _emptyDrains + 1;
      } catch (err) {
        console.error("[queue] drain failed:", err);
      }
      if (_timer) scheduleDrain(nextPollDelayMs());
    })();
  }, delayMs);
  if (typeof _timer === "object" && "unref" in _timer) (_timer as NodeJS.Timeout).unref();
}

/**
 * New work exists NOW — drain immediately and return to the 5s cadence.
 * Called by submitCampaigns and requeueCampaignNow; a no-op (beyond resetting
 * the idle streak) when no worker is running, e.g. under unit tests.
 */
export function kickQueueNow(): void {
  _emptyDrains = 0;
  if (_timer && _deps) scheduleDrain(0);
}

export function queueSnapshot(): { inFlight: number; runIds: string[]; running: boolean } {
  return { inFlight: _inFlight.size, runIds: Array.from(_inFlight), running: _timer !== null };
}

/** Rehydrate a campaign's banked state from the ledger for a resumed run. */
async function loadBankedPhases(runId: string): Promise<CampaignState["phases"]> {
  const rows = await getPhaseState(runId);
  const phases: CampaignState["phases"] = {};
  for (const r of rows) {
    if (!PHASE_NAMES.includes(r.phase as PhaseName)) continue;
    phases[r.phase as PhaseName] = {
      phase: r.phase as PhaseName,
      tool: r.tool,
      status: r.status as PhaseStateEntry["status"],
      attemptCount: r.attemptCount,
      failureClass: r.failureClass as PhaseStateEntry["failureClass"],
      nextEarliestAt: r.nextEarliestAt,
      output: r.output,
    };
  }
  return phases;
}

/**
 * Record that a campaign ended without committing, so it LEAVES the queue.
 *
 * ─── Why this is not optional ───────────────────────────────────────────────
 * A campaign is "unfinished" until extract_commit banks a usable outcome. If a
 * run ends any other way — a FROZEN evidence gate refusing to extract, a
 * collection throw, an exhausted retry ladder — and nothing is written, the
 * campaign stays unfinished forever: offered by findIncompleteCampaigns on
 * every drain and displayed to the analyst as "queued" indefinitely, with no
 * reason given. Found in ACCEPTANCE 1, where eight pre-S3b campaigns sat in the
 * queue view as permanently queued.
 *
 * The failure class matters. A min-data refusal is `genuine_empty`: a
 * deliberate, honest "we will not extract from this", terminal by definition and
 * never retried. Everything else is `structural` — parked for a human rather
 * than looped on, because a campaign that cannot succeed should stop asking.
 */
async function recordTerminalFailure(
  runId: string,
  subjectHint: string,
  phase: PhaseName | null,
  message: string | null,
  status: CampaignOutcome["status"],
): Promise<void> {
  const terminal = status === "min_data_rejection";
  try {
    await recordPhaseState({
      runId,
      subjectHint,
      phase: phase ?? "extract_commit",
      tool: "queue:terminal",
      status: terminal ? "genuine_empty" : "failed",
      failureClass: terminal ? "genuine_empty" : "structural",
      attemptCount: 1,
      output: { terminal: true, status, message },
    });
    console.warn(`[queue] ${runId} (${subjectHint}) ended without committing: ${status} — ${message ?? "no detail"}`);
  } catch (err) {
    // The campaign is already failing; a failed terminal write would leave it
    // spinning, so this is loud rather than swallowed.
    console.error(`[queue] ${runId}: could not record terminal failure — it will be retried:`, err);
  }
}

/**
 * Run one campaign to completion, beating its heartbeat so a live phase is never
 * mistaken for an abandoned one.
 */
async function processCampaign(
  runId: string,
  subjectHint: string,
  deps: QueueDeps,
): Promise<CampaignOutcome<unknown> | null> {
  const { handle, platform, extras: hintExtras } = decodeSubject(subjectHint);
  /*
    ─── Inputs come from run_inputs now (womo_0013) ──────────────────────────
    BACKWARD-COMPATIBILITY FALLBACK: rows enqueued BEFORE womo_0013 still carry
    their locators in the hint, and a campaign already in flight must resume
    with them rather than lose them mid-run. So run_inputs wins and the hint is
    the fallback.

    DELETE THE FALLBACK once no pre-migration run is resumable — i.e. once every
    ledger row older than the migration has reached a terminal status (the
    resumable window is RESUMABLE_AGE_MS = 24h, so a day after the migration
    nothing can still need it). At that point `hintExtras` and the `extras`
    field of SubjectIdentity have no readers left.
  */
  const stored = await getRunInputs(runId);
  const extras: Record<string, string> | undefined = stored
    ? Object.fromEntries(Object.entries({
        googleMapsUrl: stored.googleMapsUrl,
        instagramHandle: stored.instagramHandle,
        tiktokChannelUrl: stored.tiktokChannelUrl,
        brandName: stored.brandName,
      }).filter(([, v]) => v != null && v !== "")) as Record<string, string>
    : hintExtras;
  /**
   * Brand is a different KIND of subject, not another platform: it resolves no
   * toolset, brings its own five phases and supplies its own gate. So it is
   * admitted here rather than through the registry check below, which exists for
   * a different question entirely.
   */
  const isBrand = isPseudoPlatform(platform);
  if (!isRunnableSubject(platform)) {
    console.warn(`[queue] ${runId}: platform ${platform} has no registered phase toolset — skipping`);
    return null;
  }
  _inFlight.add(runId);

  // Heartbeat: proves this campaign is alive so another analyst's boot cannot
  // reclaim it. Unref'd so it never holds the process open.
  const beat = setInterval(() => {
    void (async () => {
      for (const phase of PHASE_NAMES) await heartbeatPhase(runId, phase);
    })();
  }, HEARTBEAT_MS);
  if (typeof beat === "object" && "unref" in beat) (beat as NodeJS.Timeout).unref();

  // Terminal run telemetry. runInstrumentedAnalysis used to own this on the
  // synchronous path; the queue does not use it (its Promise.race deadline is a
  // CLIENT deadline, and abandoning a campaign nobody is waiting for would just
  // let the next drain double-start it). The memory summary and the terminal
  // pipeline_runs row are what S3a's bounds are tuned against, so they are
  // written here rather than lost with the endpoint.
  const startedAt = new Date();
  const memTracker = startRunMemoryTracker();

  const runType = isBrand ? "brand_analysis" : "creator_analysis";

  try {
    const banked = await loadBankedPhases(runId);
    /**
     * RUN CORRELATION, for brand for the first time. `withAnalysisRun` is what
     * puts the run id in async-local storage, and it is what every scrape event,
     * LLM invocation and phase observation reads to stamp itself. Brand's
     * scraping and LLM calls were previously made inside an HTTP request with no
     * run context at all, so they wrote rows with a null run_id and could not be
     * traced to the analysis that caused them.
     */
    const outcome: CampaignOutcome<unknown> = await withAnalysisRun(runId, (): Promise<CampaignOutcome<unknown>> => (isBrand
      ? runBrandCampaign(
          { runId, handle: handle!, extras, initialPhases: banked },
          deps.brand,
        )
      : runCreatorCampaign(
          { runId, handle: handle!, platform: platform as "TikTok" | "Instagram", extras, initialPhases: banked },
          deps.creator,
        )));
    if (!outcome.committed) await recordTerminalFailure(runId, subjectHint, outcome.stoppedAt, outcome.message, outcome.status);

    await recordRunOutcome(runId, outcome.status as RunOutcomeStatus, {
      runType,
      startedAt,
      detail: {
        ...(outcome.message ? { message: outcome.message.slice(0, 300) } : {}),
        memory: memTracker.stop(),
      },
      // Creator counts transcripts and titles; a brand has neither, and
      // inventing a zero for it would read as "collected nothing" rather than
      // "this measure does not apply".
      ...(isBrand ? {} : {
        captureEvidence: {
          transcripts: (outcome.research as CreatorResearchLike | null)?.transcriptCount ?? 0,
          titles: (outcome.research as CreatorResearchLike | null)?.recentVideoTitles?.length ?? 0,
        },
      }),
    }).catch(err => console.warn(`[queue] ${runId}: run telemetry write failed:`, err));

    return outcome;
  } catch (err) {
    console.error(`[queue] ${runId} (${subjectHint}) threw:`, err);
    await recordTerminalFailure(runId, subjectHint, null, err instanceof Error ? err.message : String(err), "error");
    await recordRunOutcome(runId, "error", {
      runType,
      startedAt,
      detail: {
        message: (err instanceof Error ? err.message : String(err)).slice(0, 300),
        memory: memTracker.stop(),
      },
    }).catch(() => {});
    return null;
  } finally {
    memTracker.stop(); // idempotent — clears the sampler on every exit
    clearInterval(beat);
    _inFlight.delete(runId);
  }
}

/**
 * One drain pass: reclaim the dead, then run whatever is ready.
 *
 * Serialised by `_draining` so overlapping ticks cannot double-start a campaign.
 * Campaigns run concurrently within the pass; their PHASES are what S3a's
 * resource bounds gate, which is the right granularity.
 */
export async function drainOnce(deps: QueueDeps = _deps!): Promise<number> {
  if (_draining) return 0;
  _draining = true;
  try {
    await reclaimStaleRunning();

    // One entry per campaign — a campaign with several ready rows is still one
    // campaign, and the runner decides which phase comes next.
    const runs = new Map<string, string>();

    // (1) Rows whose backoff gate has expired, or that never ran.
    for (const r of await scanReadyWork(new Date(), 50)) {
      if (_inFlight.has(r.runId)) continue;
      if (!runs.has(r.runId)) runs.set(r.runId, r.subjectHint);
    }

    // (2) Campaigns that are UNFINISHED but have no ready row to advertise it.
    //     A campaign whose collection phases are all `complete` and which has no
    //     extract_commit row yet is exactly this: nothing is pending, nothing is
    //     parked, and the scan — which looks for pending/failed/blocked — sees
    //     nothing. Driving only from the scan would strand it forever.
    //
    //     The scan describes READY WORK; this describes UNFINISHED CAMPAIGNS.
    //     The queue needs both, because a campaign's readiness is not always
    //     representable as a row status.
    const now = Date.now();
    for (const c of await findIncompleteCampaigns(50)) {
      if (_inFlight.has(c.runId) || runs.has(c.runId)) continue;
      // Respect a live park: a phase waiting out a backoff is not ready.
      const parked = c.phases.some(p => p.nextEarliestAt && p.nextEarliestAt.getTime() > now);
      const running = c.phases.some(p => p.status === "running");
      if (parked || running) continue;
      runs.set(c.runId, c.subjectHint);
    }

    if (runs.size === 0) return 0;

    console.log(`[queue] draining ${runs.size} campaign(s)`);
    await Promise.all(
      Array.from(runs.entries()).map(([runId, hint]) => processCampaign(runId, hint, deps)),
    );
    return runs.size;
  } finally {
    _draining = false;
  }
}

/**
 * Start the worker. Called once at boot from _core/index.ts.
 *
 * The boot pass is not special-cased: reclaim + scan already resumes whatever
 * the last process left behind, because the ledger is the only state there is.
 */
export function startQueueWorker(deps: QueueDeps): void {
  if (_timer) return;
  _deps = deps;

  void (async () => {
    try {
      const stale = await reclaimStaleRunning();
      const incomplete = await findIncompleteCampaigns();
      console.log(
        `[queue] worker starting — reclaimed ${stale.length} stale phase(s), ` +
        `${incomplete.length} incomplete campaign(s) to resume`,
      );
      for (const c of incomplete) console.log(`[queue]   resume ${c.subjectHint} (${c.runId.slice(0, 8)})`);
    } catch (err) {
      console.error("[queue] boot scan failed:", err);
    }
  })();

  scheduleDrain(POLL_MS);
}

/** TEST-ONLY: stop the worker between cases. */
export function stopQueueWorker(): void {
  if (_timer) clearTimeout(_timer);
  _timer = null;
  _deps = null;
  _inFlight.clear();
  _draining = false;
  _emptyDrains = 0;
}
