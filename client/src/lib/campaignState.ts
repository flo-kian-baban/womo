/**
 * WHAT A CAMPAIGN ACTUALLY IS, read from its ledger rows.
 *
 * ─── Why this exists at all ─────────────────────────────────────────────────
 * The server's `deriveCampaignState` projects the whole ledger onto FIVE values
 * — queued / running / parked / complete / failed. That projection is lossy in
 * one place that matters enormously: it maps FOUR materially different outcomes
 * onto `complete`.
 *
 *   committed, clean            an observation was saved, nothing was missing
 *   committed WITH GAPS         saved, but a phase was still blocked when the
 *                               retry ladder ran out (scheduler "exhausted")
 *   committed, PARTIAL SAVE     the observation exists but a component failed
 *                               to persist — data was lost
 *   REFUSED, nothing saved      genuine_empty: either the subject is confirmed
 *                               empty, or the frozen min-data gate declined to
 *                               extract. `observationId` is null. NOTHING was
 *                               produced.
 *
 * Rendering a refusal as a green tick reading "Complete" is the single most
 * dishonest thing this surface could do. A refusal is the system CORRECTLY
 * declining to fabricate; it is not a success, and it is not a failure either.
 *
 * ─── This is a REFINEMENT, never a contradiction ────────────────────────────
 * Every display state below maps onto exactly one server state (see
 * `SERVER_STATE_OF`), and this module NEVER overrides the server. It reads the
 * same `phases` array the server shaped from `analysis_phase_state` and asks a
 * narrower question of it. `serverState` is carried through verbatim on every
 * result so the refinement can always be audited against its origin.
 *
 * ─── Nothing here is inferred ───────────────────────────────────────────────
 * Every field is a ledger column or a mark the scheduler durably banked
 * (`parkReason`, `blockedGap`). There is no timer, no estimate, no smoothing and
 * no second definition of anything the server already defines. Where a fact is
 * not in the payload it is reported as null and rendered as unknown — see the
 * KNOWN GAPS note at the foot of this file.
 */
import type { RouterOutputs } from "@/lib/trpc";

/** INFERRED from the router. Never hand-redeclared — see RouterOutputs. */
export type Campaign = RouterOutputs["creator"]["queueStatus"]["campaigns"][number];
export type Phase = Campaign["phases"][number];
export type PhaseName = Phase["phase"];

/**
 * The ten states an analyst can actually distinguish, against the five the
 * server projects onto. Read the second column as "this is a refinement of".
 */
export type DisplayState =
  /** ← queued */
  | "queued"
  /** ← running */
  | "running"
  /** ← parked. A real gate with a real time; it WILL resume by itself. */
  | "parked"
  /**
   * ← failed. The scheduler's structural park: "retrying a changed/removed path
   * is futile; parked for a human". It has no retry time BY DESIGN — a timer
   * cannot fix a changed page shape — and `scanReadyWork` excludes it, so it
   * will never resume on its own. It is the ONE state that requires a person,
   * and `resumeRun` is exactly its rescue.
   */
  | "parked_for_human"
  /** ← complete, saved: full, no gaps. The only clean success. */
  | "complete"
  /** ← complete. Committed DESPITE a phase that was still blocked. */
  | "committed_with_gaps"
  /** ← complete. Committed, but a component did not persist. Data was lost. */
  | "partial_persistence"
  /** ← complete. The subject is confirmed empty. Nothing saved. */
  | "refused_empty"
  /** ← complete. The frozen min-data gate declined to extract. Nothing saved. */
  | "refused_min_data"
  /** ← failed. A terminal failure with an honest message. */
  | "failed";

/** Which server state each display state refines. The audit trail of the map. */
export const SERVER_STATE_OF: Record<DisplayState, Campaign["state"]> = {
  queued: "queued",
  running: "running",
  parked: "parked",
  parked_for_human: "failed",
  complete: "complete",
  committed_with_gaps: "complete",
  partial_persistence: "complete",
  refused_empty: "complete",
  refused_min_data: "complete",
  failed: "failed",
};

/**
 * Where a state belongs in the list.
 *
 * `attention` is deliberately narrow: it means A PERSON MUST DO SOMETHING. A
 * parked campaign retries itself, so it is still in flight and NOT attention —
 * putting it there would cry wolf on every rate-limit. A refusal is a settled,
 * correct outcome and needs noticing, not acting on.
 */
export type DisplayGroup = "attention" | "flight" | "finished";

export const GROUP_OF: Record<DisplayState, DisplayGroup> = {
  parked_for_human: "attention",
  failed: "attention",
  queued: "flight",
  running: "flight",
  parked: "flight",
  complete: "finished",
  committed_with_gaps: "finished",
  partial_persistence: "finished",
  refused_empty: "finished",
  refused_min_data: "finished",
};

/**
 * ─── B1: the queue sheds finished work ──────────────────────────────────────
 * The Analyze pages were doing two jobs — submission and archive — with 44
 * finished campaigns under the input box. The queue is now a live-work surface;
 * the Profile Library is the destination.
 *
 * LEAVES the page immediately: `complete` only. A clean commit's profile is in
 * the library; the queue owes the analyst nothing further about it.
 *
 * STAYS until acknowledged — everything that needs a person to at least see it:
 *   refused_empty / refused_min_data  no library entry exists; leaving the page
 *                                     would erase the only record the analyst
 *                                     ever sees
 *   failed / parked_for_human         same, plus these may warrant a requeue
 *   partial_persistence               a library entry EXISTS but data was lost
 *                                     on the way in — per the B1 order, stays
 *   committed_with_gaps               a library entry exists, but the library
 *                                     ROW cannot show the gap today (the row
 *                                     ships nothing from the ledger, and a
 *                                     client-side join against queueStatus
 *                                     would silently miss campaigns older than
 *                                     its window — an old gapped profile would
 *                                     render indistinguishable from clean). Per
 *                                     ruling: stays until B2 ships a gap marker
 *                                     on the library row.
 *
 * Acknowledged rows leave too — see lib/acknowledgements, which is explicit
 * that the list is per-machine, per-analyst, and touches nothing in the ledger.
 */
export const LEAVES_ON_SIGHT: ReadonlySet<DisplayState> = new Set<DisplayState>(["complete"]);

export function staysUntilAcknowledged(state: DisplayState): boolean {
  return GROUP_OF[state] === "attention"
    || state === "refused_empty" || state === "refused_min_data"
    || state === "partial_persistence" || state === "committed_with_gaps";
}

/**
 * A phase's contribution to the campaign's honesty, as one of five marks.
 *
 * `reduced` is the fix for the audit's finding at PHASE level. A `partial` with
 * no blocked gap used to render as a dimmer green tick, which read as "basically
 * fine". It is not: it is usable output that is LESS than the phase wanted — a
 * budget-bailed transcribe, or a brand's Instagram phase that was never
 * attempted because no handle was supplied. Neutral, never green.
 */
export type PhaseMark = "done" | "gap" | "reduced" | "working" | "waiting"
  | "refused" | "broken" | "unstarted";

export function phaseMark(p: Phase | undefined): PhaseMark {
  if (!p) return "unstarted";
  if (p.status === "complete") return "done";
  if (p.status === "partial") return p.blockedGap ? "gap" : "reduced";
  if (p.status === "running") return "working";
  if (p.status === "genuine_empty") return "refused";
  if (p.status === "failed" || p.status === "blocked") return "broken";
  if (p.status === "pending") return "waiting";
  return "unstarted";
}

/**
 * The phase spine a subject OWES, decided by subject kind rather than by which
 * rows happen to exist yet.
 *
 * Reading it from row presence — as this surface used to — meant a brand showed
 * five marks until `channel_instagram` was reached and then grew a sixth
 * mid-run, so a brand in flight was shaped exactly like a creator. The kind is
 * knowable from `platform` on the first render, so use that.
 */
export const CREATOR_PHASES: PhaseName[] = [
  "capture", "augment", "transcribe", "derive", "extract_commit",
];
export const BRAND_PHASES: PhaseName[] = [
  "capture", "augment", "transcribe", "channel_instagram", "derive", "extract_commit",
];

/** Brand is not a platform — see BRAND_PSEUDO_PLATFORM in the phase contract. */
export function isBrandCampaign(c: { platform: string }): boolean {
  return c.platform.trim().toLowerCase() === "brand";
}

export function phaseSpineFor(c: { platform: string }): PhaseName[] {
  return isBrandCampaign(c) ? BRAND_PHASES : CREATOR_PHASES;
}

/** Dates cross tRPC as Date via superjson; be tolerant of a string anyway. */
function asDate(v: Date | string | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export interface CampaignView {
  state: DisplayState;
  group: DisplayGroup;
  /** The server's own five-value verdict, verbatim, so this can be audited. */
  serverState: Campaign["state"];
  /** Did a run actually reach a saved observation? */
  committed: boolean;
  /** The one-line WHY, in the ledger's own words. Null when there is nothing to say. */
  reason: string | null;
  /** A live, future retry gate. Null when nothing is gated. */
  retryAt: Date | null;
  /** The phase holding the gate, when one is. */
  gatedPhase: PhaseName | null;
  /** Every phase that committed despite being blocked. A record, never a score. */
  gaps: Array<NonNullable<Phase["blockedGap"]>>;
  /** Most recent ledger write across the campaign's phases. */
  lastActivityAt: Date | null;
  /**
   * FINDING 4 — the server's projection and the rows disagree, and BOTH are
   * shown rather than either being overridden.
   *
   * `deriveCampaignState` checks `genuine_empty → complete` BEFORE it checks for
   * a live park, so a campaign whose transcribe is parked with a real retry time
   * AND whose gate then refused with PRECONDITION_FAILED reports `complete`.
   * This flags that disagreement for display; it does not resolve it. Resolving
   * it is a server change and is reported as a server finding.
   */
  conflict: string | null;
}

/**
 * Classify one campaign from its ledger rows.
 *
 * PURE. No clock beyond `now` (injected so this is testable and so a list of
 * twenty rows classifies against ONE instant rather than twenty).
 */
export function classifyCampaign(c: Campaign, now: number = Date.now()): CampaignView {
  const phases = c.phases;
  const commit = phases.find(p => p.phase === "extract_commit");

  // Facts, gathered before any decision is taken.
  const gatedPhaseRow = phases.find(p => {
    const at = asDate(p.nextEarliestAt);
    return at !== null && at.getTime() > now;
  });
  const retryAt = asDate(gatedPhaseRow?.nextEarliestAt ?? null);
  const gaps = phases.map(p => p.blockedGap).filter((g): g is NonNullable<Phase["blockedGap"]> => Boolean(g));
  const lastActivityAt = phases
    .map(p => asDate(p.updatedAt))
    .filter((d): d is Date => d !== null)
    .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

  /**
   * The scheduler's structural park, distinguished from a plain terminal
   * failure by the ONE thing that separates them in the ledger: the scheduler
   * merges a `parkReason` into the phase's durable output when it parks, and
   * `recordTerminalFailure` does not. Both carry failureClass `structural`.
   */
  const humanParked = phases.find(p => p.failureClass === "structural" && p.parkReason);

  /** A phase — not the commit row — that confirmed the subject itself is empty. */
  const emptyPhase = phases.find(p => p.phase !== "extract_commit" && p.status === "genuine_empty");

  const committed = Boolean(c.observationId)
    || commit?.status === "complete" || commit?.status === "partial";

  const state = decide({
    serverState: c.state,
    commitStatus: commit?.status,
    emptyPhase: Boolean(emptyPhase),
    humanParked: Boolean(humanParked),
    hasGaps: gaps.length > 0,
  });

  return {
    state,
    group: GROUP_OF[state],
    serverState: c.state,
    committed,
    reason: reasonFor(state, { campaign: c, gatedPhaseRow, humanParked, gaps }),
    retryAt,
    gatedPhase: gatedPhaseRow?.phase ?? null,
    gaps,
    lastActivityAt,
    conflict:
      retryAt && c.state !== "parked" && c.state !== "running"
        ? `A phase is still gated to retry — the queue's own state for this campaign is "${c.state}".`
        : null,
  };
}

/**
 * The decision itself, isolated so the precedence is readable in one screen.
 *
 * PRECEDENCE, and why:
 *   1. The server's non-`complete` states are refined but never re-litigated.
 *   2. Within `complete`, a REFUSAL outranks everything — nothing was saved, so
 *      no statement about gaps or persistence applies.
 *   3. A confirmed-empty SUBJECT outranks a min-data refusal: when both rows
 *      exist, the empty subject is the cause and the gate is the consequence.
 *   4. A partial SAVE outranks a blocked-capture gap: losing a component is
 *      losing data, whereas a gap is evidence that was never gathered. Both are
 *      still listed in full on the row — precedence picks the headline only.
 */
function decide(f: {
  serverState: Campaign["state"];
  commitStatus: string | undefined;
  emptyPhase: boolean;
  humanParked: boolean;
  hasGaps: boolean;
}): DisplayState {
  if (f.serverState === "queued") return "queued";
  if (f.serverState === "running") return "running";
  if (f.serverState === "parked") return "parked";
  if (f.serverState === "failed") return f.humanParked ? "parked_for_human" : "failed";

  // serverState === "complete" — the four-way split this module exists for.
  if (f.emptyPhase) return "refused_empty";
  if (f.commitStatus === "genuine_empty") return "refused_min_data";
  if (f.commitStatus === "partial") return "partial_persistence";
  if (f.hasGaps) return "committed_with_gaps";
  return "complete";
}

/** The ledger's own words for why a campaign is where it is. Never invented. */
function reasonFor(
  state: DisplayState,
  ctx: {
    campaign: Campaign;
    gatedPhaseRow: Phase | undefined;
    humanParked: Phase | undefined;
    gaps: Array<NonNullable<Phase["blockedGap"]>>;
  },
): string | null {
  switch (state) {
    case "parked":
      return ctx.gatedPhaseRow?.parkReason ?? ctx.campaign.message ?? null;
    case "parked_for_human":
      return ctx.humanParked?.parkReason ?? ctx.campaign.message ?? null;
    case "committed_with_gaps":
      return ctx.gaps[0]?.detail ?? ctx.gaps[0]?.reason ?? null;
    case "refused_empty":
    case "refused_min_data":
    case "partial_persistence":
    case "failed":
      // `message` is the gate's or the terminal writer's own text, banked on the
      // extract_commit row. It is the real reason, not a code.
      return ctx.campaign.message ?? null;
    default:
      return null;
  }
}

/** How long ago, in words. A FACT from `updatedAt` — never a health verdict. */
export function agoLabel(at: Date | null, now: number = Date.now()): string | null {
  if (!at) return null;
  const s = Math.max(0, Math.round((now - at.getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}

/** How long until, in words. A park has a real timestamp, so show the real time. */
export function untilLabel(at: Date | string | null, now: number = Date.now()): string | null {
  const d = asDate(at);
  if (!d) return null;
  const ms = d.getTime() - now;
  if (ms <= 0) return "now";
  const s = Math.round(ms / 1000);
  if (s < 60) return `in ${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `in ${m}m ${s % 60}s` : `in ${Math.floor(m / 60)}h ${m % 60}m`;
}

/**
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║ KNOWN GAPS — facts an honest view wants that the payload does not carry.  ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 * Each is rendered as UNKNOWN rather than guessed. Closing any of them is a
 * server change (`shapeCampaign` / a new read), deliberately not made here.
 *
 *   A  capture health for a campaign that has not committed. It is computed and
 *      stored per run in `pipeline_runs.error_log.captureHealth`, but the only
 *      reader is `getDiagnostics(observationId)`, which needs an observation.
 *   B  capture health for a LIST. `getDiagnostics` measured at ~426ms per
 *      campaign (mean of 8, shared Supabase); 49 committed rows behind a 3s
 *      poll is not viable, so health is loaded on expand only.
 *   C  `isRunnableSubject` — the client cannot tell that a legacy-platform
 *      campaign will never run, so it renders as queued forever.
 *   D  brand `extras` (which channels were requested) — decoded server-side by
 *      `decodeSubject`, then dropped by `shapeCampaign`.
 *   E  phase `createdAt` — selected in SQL, dropped by `shapeCampaign`. So
 *      "how long has this been QUEUED" is unanswerable; only `updatedAt` (last
 *      activity) survives.
 *   F  `STALE_RUNNING_MS` — the client can show "last activity 14m ago" from
 *      `updatedAt` but cannot state that a run is presumed dead.
 *   G  `skippedReason` — a brand's `channel_instagram` banks
 *      `partial` + "no Instagram handle supplied" when nothing was attempted,
 *      but only `parkReason`/`blockedGap` are lifted out of `output`. A phase
 *      deliberately not attempted is therefore indistinguishable from one that
 *      half-succeeded; both render as `reduced`.
 *
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║ B2 WORK LIST — recorded here because B2 starts in this file.              ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 *   B2-1  FIRST ITEM (accepted as a known gap when B1 shipped): a committed
 *         run's phase-level account — spine, retries, park history,
 *         retryHistory — is unreachable from every surface, because B1 sheds
 *         committed campaigns from the queue and no /campaign/:runId route
 *         exists. The DATA IS ALREADY SHIPPED: the library row carries `runId`
 *         and `observationId`, both currently unused by the UI.
 *   B2-2  The library ROW cannot show committed-with-gaps (server item: ship a
 *         gap marker on listCreatorProfiles rows). Until then gaps stay in the
 *         queue — see staysUntilAcknowledged.
 *   B2-3  Server items logged from B1: `acknowledged_at` on the ledger for
 *         cross-machine acknowledgement; listCreatorProfiles ordered by latest
 *         observation date (subjects.createdAt today, so re-analyses never
 *         resurface) + ship `observedAt`; the library's silent `limit 50`.
 */
