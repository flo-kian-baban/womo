/**
 * ONE CAMPAIGN, AS ONE SCANNABLE ROW.
 *
 * ─── Three rules this component exists to keep ──────────────────────────────
 *
 * 1. NOTHING IS ESTIMATED. Every mark is a row in `analysis_phase_state` or a
 *    field the server computed from one. No timer, no simulated progress, no
 *    interpolation between phases. What replaced the old fake progress bar must
 *    not creep back in as "smoothing".
 *
 * 2. UNKNOWN IS SHOWN AS UNKNOWN. Capture health and token cost exist only once
 *    a campaign has committed an observation. For anything in flight or refused
 *    they are stated as unavailable — never blank, never zero, which would read
 *    as "0 scrapes" rather than "not knowable yet".
 *
 * 3. A REFUSAL IS NOT A SUCCESS. Four outcomes the server projects onto
 *    `complete` are rendered as four different things — see lib/campaignState.
 *    A refusal is the system correctly declining to fabricate: neutral, neither
 *    green nor red.
 *
 * ─── Why a row and not a card ───────────────────────────────────────────────
 * The card was ~120px of chrome per campaign in a single column. An analyst
 * running twenty campaigns unattended has to SCAN — what is running, what needs
 * attention, what completed thin, what failed — and a stack of cards makes that
 * a scroll instead of a glance. Same design system, same tokens, one third the
 * height, and the full detail is still one click away.
 */
import { useState } from "react";
import {
  CheckCircle2, Loader2, AlertTriangle, Clock, PauseCircle, XCircle,
  ChevronRight, ArrowRight, Circle, CircleDashed, CircleDot, Ban, Wrench,
  ShieldX, CircleSlash, RotateCw, Check,
} from "lucide-react";
import { Link } from "wouter";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { PlatformMark, platformLabel } from "@/components/PlatformMark";
import { acknowledge } from "@/lib/acknowledgements";
import {
  classifyCampaign, phaseMark, phaseSpineFor, agoLabel, untilLabel,
  staysUntilAcknowledged,
  type Campaign, type CampaignView, type DisplayState, type PhaseMark, type PhaseName,
} from "@/lib/campaignState";

export type { Campaign } from "@/lib/campaignState";

/**
 * Subject-neutral phase wording. The ledger is the source of STATUS; this only
 * supplies ordering and names, so a phase not yet reached still has a label.
 */
const PHASE_LABEL: Record<PhaseName, { label: string; hint: string }> = {
  capture: { label: "Capture", hint: "the subject and its recent content" },
  augment: { label: "Augment", hint: "widening the sample" },
  transcribe: { label: "Transcribe", hint: "spoken content across the sample" },
  channel_instagram: { label: "Instagram channel", hint: "the subject's own posts" },
  derive: { label: "Derive", hint: "themes and symbols" },
  extract_commit: { label: "Extract & commit", hint: "cultural profile, saved" },
};

/**
 * State presentation. Ten states, ten distinct SHAPES — colour alone would not
 * survive a monochrome screenshot or a red-green-blind analyst.
 *
 * The colour semantics are deliberate and narrow:
 *   green       clean success, and nothing else
 *   amber       committed but something is missing, or waiting on a gate
 *   red         a genuine failure
 *   neutral     a refusal — correct behaviour, not an outcome to celebrate or
 *               to alarm about
 */
const STATE: Record<DisplayState, {
  icon: typeof Clock; cls: string; label: string; qualifier?: string; spin?: boolean;
}> = {
  queued: { icon: Clock, cls: "text-muted-foreground", label: "Queued" },
  running: { icon: Loader2, cls: "text-indigo-400", label: "Running", spin: true },
  parked: { icon: PauseCircle, cls: "text-amber-400", label: "Parked" },
  parked_for_human: { icon: Wrench, cls: "text-amber-300", label: "Needs a human", qualifier: "won't retry" },
  complete: { icon: CheckCircle2, cls: "text-green-400", label: "Complete" },
  committed_with_gaps: { icon: AlertTriangle, cls: "text-amber-400", label: "Committed", qualifier: "with gaps" },
  partial_persistence: { icon: CircleSlash, cls: "text-orange-400", label: "Committed", qualifier: "partial save" },
  refused_empty: { icon: Ban, cls: "text-muted-foreground/80", label: "Refused", qualifier: "empty subject" },
  refused_min_data: { icon: ShieldX, cls: "text-muted-foreground/80", label: "Refused", qualifier: "too little data" },
  failed: { icon: XCircle, cls: "text-destructive", label: "Failed" },
};

/**
 * Phase pips — FILLED/EMPTY marks, not coloured ones (B1 colour discipline).
 *
 * A phase that went normally is a filled neutral pip; one that has not run is a
 * hollow one. Colour appears only where a phase genuinely needs attention (gap,
 * broken) or is the page's single live accent (working, indigo). Six green
 * ticks per row × twenty rows was decoration pretending to be information —
 * "done" is the expected outcome, and the expected outcome renders quiet.
 */
const MARK: Record<PhaseMark, { icon: typeof Clock; cls: string; spin?: boolean; word: string }> = {
  done: { icon: Circle, cls: "text-foreground/50 fill-current", word: "complete" },
  /** Committed DESPITE a block — evidence is missing. Genuine attention. */
  gap: { icon: AlertTriangle, cls: "text-amber-400", word: "committed with a gap" },
  /**
   * Usable, but less than the phase wanted — a budget-bailed transcribe, or a
   * brand Instagram phase with no handle supplied. A half-filled pip: present,
   * visibly less than full, and not a warning.
   */
  reduced: { icon: CircleDot, cls: "text-foreground/40", word: "partial" },
  working: { icon: Loader2, cls: "text-indigo-400", spin: true, word: "running" },
  waiting: { icon: Circle, cls: "text-muted-foreground/30", word: "pending" },
  refused: { icon: Ban, cls: "text-muted-foreground/80", word: "genuine empty" },
  broken: { icon: AlertTriangle, cls: "text-destructive", word: "failed" },
  unstarted: { icon: CircleDashed, cls: "text-muted-foreground/20", word: "not started" },
};

const HEALTH_TONE: Record<string, string> = {
  clean: "border-green-400/30 text-green-400/90 bg-green-400/5",
  degraded: "border-amber-400/30 text-amber-400/90 bg-amber-400/5",
  thin: "border-amber-400/30 text-amber-400/90 bg-amber-400/5",
};

/**
 * Capture health for the ROW, from cache only — `enabled: false` never fetches.
 *
 * MEASURED, not assumed: `getDiagnostics` costs ~426ms per campaign (mean of 8
 * against the shared database) and 49 of the 50 campaigns in the real queue
 * have committed. Behind the 3s poll that is tens of heavy queries a tick, so
 * the row does not fetch it — it displays it once the expanded panel has
 * populated the very same react-query key, and says "unknown" until then.
 */
function useCachedCaptureHealth(observationId: string | null) {
  const q = trpc.creator.getDiagnostics.useQuery(
    { observationId: observationId ?? "" },
    { enabled: false, staleTime: Infinity, retry: false },
  );
  return observationId ? (q.data?.captureHealth ?? null) : null;
}

export function CampaignRow({
  campaign, now, onAcknowledged,
}: { campaign: Campaign; now: number; onAcknowledged?: () => void }) {
  const [open, setOpen] = useState(false);
  const view = classifyCampaign(campaign, now);
  const s = STATE[view.state];
  const Icon = s.icon;

  const byPhase = new Map(campaign.phases.map(p => [p.phase, p]));
  // The spine a SUBJECT owes, from its kind — not from which rows exist yet.
  const spine = phaseSpineFor(campaign);
  const health = useCachedCaptureHealth(campaign.observationId);

  const attention = view.group === "attention";

  return (
    <div className={attention ? "border-l-2 border-amber-400/50" : "border-l-2 border-transparent"}>
      <div className="flex items-center gap-2 pr-2">
        <button
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          className="flex-1 min-w-0 text-left px-3 py-2 flex items-center gap-3 hover:bg-secondary/40 transition-colors"
        >
          {/* State — the first thing read, so it is first in the row. */}
          <span className={`flex items-center gap-1.5 text-xs whitespace-nowrap w-[186px] flex-shrink-0 ${s.cls}`}>
            <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${s.spin ? "animate-spin" : ""}`} />
            <span className="font-medium">{s.label}</span>
            {s.qualifier && <span className="text-muted-foreground/60 truncate">{s.qualifier}</span>}
          </span>

          {/* Subject */}
          <span className="flex items-center gap-1.5 min-w-0 flex-1 basis-[220px]">
            <PlatformMark platform={campaign.platform} className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="text-sm truncate">{campaign.handle}</span>
            <span className="text-[10px] text-muted-foreground/40 uppercase tracking-wide flex-shrink-0 hidden sm:inline">
              {platformLabel(campaign.platform)}
            </span>
          </span>

          {/* The phase spine — one mark per phase this subject owes. */}
          <span className="flex items-center gap-1 flex-shrink-0">
            {spine.map(name => {
              const p = byPhase.get(name);
              const m = MARK[phaseMark(p)];
              const M = m.icon;
              return (
                <M key={name} className={`w-3 h-3 ${m.cls} ${m.spin ? "animate-spin" : ""}`}
                   aria-label={`${PHASE_LABEL[name].label}: ${m.word}`}>
                  <title>{`${PHASE_LABEL[name].label}: ${m.word}`}</title>
                </M>
              );
            })}
          </span>

          {/* Capture health — shown when known, "—" when not. Never inferred. */}
          <span className="w-[74px] flex-shrink-0 text-right hidden md:block">
            {health
              ? <span className={`text-[10px] px-1.5 py-0.5 rounded border ${HEALTH_TONE[health.status] ?? ""}`}>
                  {health.status}
                </span>
              : <span className="text-[10px] text-muted-foreground/25 italic" title="Capture health is recorded on commit — open the campaign to load it.">—</span>}
          </span>

          {/* A live gate reads as a countdown; everything else as last activity. */}
          <span className="w-[86px] flex-shrink-0 text-right text-[10px] font-mono">
            {view.retryAt
              ? <span className="text-amber-400">{untilLabel(view.retryAt, now)}</span>
              : <span className="text-muted-foreground/40">{agoLabel(view.lastActivityAt, now) ?? "—"}</span>}
          </span>

          <span className="text-[10px] font-mono text-muted-foreground/25 w-[62px] flex-shrink-0 hidden lg:block">
            {campaign.runId.slice(0, 8)}
          </span>

          <ChevronRight className={`w-3.5 h-3.5 text-muted-foreground/40 transition-transform flex-shrink-0 ${open ? "rotate-90" : ""}`} />
        </button>

        {/* Actions live OUTSIDE the expander button — nested buttons are invalid. */}
        <RequeueAction view={view} runId={campaign.runId} />
        {/*
          ACKNOWLEDGE — removes the row from THIS MACHINE'S attention list and
          nothing else. The ledger row, the refusal, the failure class are all
          untouched and other analysts' lists are unaffected; the tooltip says
          so because an ack that LOOKED shared would misinform whoever runs
          their own copy against the same database.
        */}
        {staysUntilAcknowledged(view.state) && onAcknowledged && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { acknowledge(campaign.runId); onAcknowledged(); }}
            title="Remove from this machine's attention list. The campaign and its ledger are untouched; other analysts' lists are unaffected."
            className="h-7 px-2 text-[11px] text-muted-foreground/70 hover:text-foreground flex-shrink-0"
          >
            <Check className="w-3 h-3 mr-1" />Acknowledge
          </Button>
        )}
      </div>

      {/* The one-line why, when the ledger has one. Truncated, full text on expand. */}
      {!open && view.reason && (
        <p className={`px-3 pb-2 -mt-1 text-[11px] leading-snug truncate ${
          view.state === "failed" ? "text-destructive/70" : "text-muted-foreground/60"
        }`}>
          {view.reason}
        </p>
      )}

      {open && <CampaignDetail campaign={campaign} view={view} spine={spine} now={now} />}
    </div>
  );
}

/**
 * The rescue for a campaign that will not resume itself.
 *
 * `resumeRun` clears the failure class and the backoff gate so the next drain
 * picks the campaign up — see `requeueCampaignNow`, which documents why CLEARING
 * the class is the fix rather than teaching the scan about it. It is offered
 * exactly where it means something: a structural park (which never retries), a
 * terminal failure, and a live park where the analyst does not want to wait.
 *
 * It is NOT offered on a committed or refused campaign. Re-running those is what
 * "Re-analyze" is for, and it would be a different operation on a different
 * subject — this only un-sticks the run that already exists.
 */
function RequeueAction({ view, runId }: { view: CampaignView; runId: string }) {
  const utils = trpc.useUtils();
  const resume = trpc.creator.resumeRun.useMutation({
    onSuccess: () => {
      toast.success("Requeued — the next drain will pick it up");
      void utils.creator.queueStatus.invalidate();
    },
    onError: (e) => toast.error(e.message),
  });

  const offer = view.state === "parked_for_human" || view.state === "failed" || view.state === "parked";
  if (!offer) return null;

  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={resume.isPending}
      onClick={() => resume.mutate({ runId })}
      title={
        view.state === "parked"
          ? "Clear the backoff gate and offer this campaign to the next drain"
          : "Clear the failure class and gates so the queue will offer this campaign again"
      }
      className="h-7 px-2 text-[11px] text-muted-foreground/70 hover:text-foreground flex-shrink-0"
    >
      {resume.isPending
        ? <Loader2 className="w-3 h-3 animate-spin" />
        : <><RotateCw className="w-3 h-3 mr-1" />{view.state === "parked" ? "Run now" : "Requeue"}</>}
    </Button>
  );
}

/** The full account, one click down. Everything here is a ledger column. */
function CampaignDetail({
  campaign, view, spine, now,
}: { campaign: Campaign; view: CampaignView; spine: PhaseName[]; now: number }) {
  const byPhase = new Map(campaign.phases.map(p => [p.phase, p]));

  return (
    <div className="px-3 pb-4 pt-3 space-y-3 border-t border-border/40 bg-secondary/20">
      {/*
        FINDING 4 — the server's five-value projection and the ledger rows
        disagree. BOTH are shown. `deriveCampaignState` checks
        `genuine_empty → complete` before it checks for a live park, so a
        campaign can carry a real future retry time and still report `complete`.
        This surface does not override the server; it reports the disagreement.
      */}
      {view.conflict && (
        <div className="text-[11px] rounded-lg bg-amber-400/5 border border-amber-400/25 p-2.5">
          <div className="text-amber-400/80 uppercase tracking-wide text-[9px] font-semibold mb-1">
            The ledger and the queue's own state disagree
          </div>
          <p className="text-amber-400/90 leading-relaxed">
            {view.conflict} Retry gate: {untilLabel(view.retryAt, now)}
            {view.gatedPhase && <> on <span className="font-mono">{view.gatedPhase}</span></>}.
          </p>
        </div>
      )}

      <div className="space-y-1.5">
        {spine.map(name => {
          const p = byPhase.get(name);
          const m = MARK[phaseMark(p)];
          const M = m.icon;
          const gate = p?.nextEarliestAt && new Date(p.nextEarliestAt).getTime() > now
            ? p.nextEarliestAt : null;
          const { label, hint } = PHASE_LABEL[name];
          return (
            <div key={name} className="flex items-start gap-2 text-xs">
              <M className={`w-3 h-3 mt-0.5 flex-shrink-0 ${m.cls} ${m.spin ? "animate-spin" : ""}`} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={m.cls}>{label}</span>
                  <span className="text-muted-foreground/40">{hint}</span>
                  {/* Every badge below is a ledger column, verbatim. */}
                  {p && p.attemptCount > 1 && (
                    <span className="text-[10px] text-amber-400/90">attempt {p.attemptCount}</span>
                  )}
                  {p?.failureClass && (
                    <span className="text-[10px] font-mono text-destructive/80">{p.failureClass}</span>
                  )}
                  {gate && (
                    <span className="text-[10px] text-amber-400">retries {untilLabel(gate, now)}</span>
                  )}
                  {p?.blockedGap && (
                    <span className="text-[10px] text-amber-400">
                      committed with a gap · {p.blockedGap.attempts} attempts
                    </span>
                  )}
                </div>
                {/* WHY it parked. Without this the queue can only say "parked",
                    never "parked because it was rate-limited". */}
                {p?.parkReason && (
                  <p className="text-[10px] text-amber-400/70 mt-0.5 leading-snug">{p.parkReason}</p>
                )}
                {/* WHY it retried — banked by the scheduler, so a phase that
                    took three attempts says what the first two hit without
                    anyone having watched the console. */}
                {p?.retryHistory?.map((r, i) => (
                  <p key={i} className="text-[10px] text-muted-foreground/60 mt-0.5 leading-snug">
                    attempt {r.attempt}: {r.detail ?? r.reason}
                  </p>
                ))}
                {p?.blockedGap && (
                  <p className="text-[10px] text-amber-400/70 mt-0.5 leading-snug">
                    {p.blockedGap.detail ?? p.blockedGap.reason}
                  </p>
                )}
              </div>
              <span className="text-[10px] text-muted-foreground/35 font-mono flex-shrink-0">
                {p?.status ?? "—"}
              </span>
            </div>
          );
        })}
      </div>

      {campaign.message && <ReportedReason view={view} message={campaign.message} />}

      <div className="pt-1">
        <div className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground/40 mb-1.5">
          Strategy attempts
        </div>
        <StrategyBreakdown runId={campaign.runId} />
      </div>

      <div className="pt-1">
        <div className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground/40 mb-1.5">
          Capture health &amp; cost
        </div>
        <CommittedFacts campaign={campaign} />
      </div>

      {campaign.subjectId && (
        <Link href={`/creator/${campaign.subjectId}`}>
          <Button variant="ghost" size="sm" className="h-7 text-xs px-2">
            Open profile <ArrowRight className="w-3 h-3 ml-1" />
          </Button>
        </Link>
      )}
    </div>
  );
}

/**
 * The campaign's own reported text, framed by what it actually MEANS here.
 *
 * The same field carries three different things, and the frame is the only
 * honest way to tell them apart. A parked campaign's message is its LAST
 * ATTEMPT's gate verdict — `recordTerminalFailure` writes a terminal row even
 * when a collection phase is merely parked — so rendering it in the same red
 * "Reported reason" box as a terminal failure said "nothing was saved" about a
 * campaign that was going to retry in four minutes.
 */
function ReportedReason({ view, message }: { view: CampaignView; message: string }) {
  const refused = view.state === "refused_empty" || view.state === "refused_min_data";
  const provisional = view.state === "parked" || view.state === "parked_for_human";

  const tone = refused
    ? { box: "bg-secondary/60 border-border", head: "text-muted-foreground/70", body: "text-foreground/75" }
    : provisional
      ? { box: "bg-amber-400/5 border-amber-400/25", head: "text-amber-400/80", body: "text-amber-400/90" }
      : { box: "bg-destructive/5 border-destructive/20", head: "text-destructive/70", body: "text-destructive/90" };

  const heading = refused
    ? "Why this was refused"
    : provisional
      ? "What the last attempt reported"
      : "Reported reason";

  return (
    <div className={`text-[11px] rounded-lg border p-2.5 ${tone.box}`}>
      <div className={`uppercase tracking-wide text-[9px] font-semibold mb-1 ${tone.head}`}>{heading}</div>
      <p className={`leading-relaxed ${tone.body}`}>{message}</p>
      {refused && (
        <p className="text-[10px] text-muted-foreground/50 mt-1.5 italic">
          Nothing was saved. This is the system declining to extract from evidence it judged
          unfit — not a scraping failure.
        </p>
      )}
    </div>
  );
}

/** Capture health + cost. Only fetched once an observation exists to key them on. */
function CommittedFacts({ campaign }: { campaign: Campaign }) {
  const { observationId, subjectId } = campaign;

  const diagnostics = trpc.creator.getDiagnostics.useQuery(
    { observationId: observationId! },
    { enabled: Boolean(observationId), staleTime: 60_000, retry: false },
  );
  const metrics = trpc.creator.getPipelineMetrics.useQuery(
    { subjectId: subjectId! },
    { enabled: Boolean(subjectId), staleTime: 60_000, retry: false },
  );

  // THE HONEST BRANCH: these facts are keyed on a committed observation. A
  // campaign in flight, refused, or failed before committing has nothing to key
  // on — say so, rather than rendering zeros that read as measurements.
  if (!observationId) {
    return (
      <p className="text-[11px] text-muted-foreground/50 italic">
        Capture health and cost are recorded when a campaign commits — not available for this one.
      </p>
    );
  }

  const d = diagnostics.data;
  const m = metrics.data;
  const health = d?.captureHealth;

  return (
    <div className="space-y-2">
      {/* The server's OWN capture assessment — not recomputed here. */}
      {health && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-[10px] px-1.5 py-0.5 rounded border ${HEALTH_TONE[health.status] ?? ""}`}>
            capture {health.status}
          </span>
          {health.thinEvidence && (
            <span className="text-[10px] text-amber-400/80">evidence just above the floor</span>
          )}
          {health.failedPathMethods.length > 0 && (
            <span className="text-[10px] text-muted-foreground/60 font-mono truncate">
              failed: {health.failedPathMethods.join(", ")}
            </span>
          )}
        </div>
      )}

      {/* Plain-language consequences, as the server derived them. */}
      {d?.scrapes.consequences?.map((c, i) => (
        <p key={i} className="text-[11px] text-amber-400/80 leading-relaxed">{c}</p>
      ))}

      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
        <Fact label="Scrapes" loading={diagnostics.isLoading}
          value={d ? String(d.scrapes.total) : null} />
        <Fact label="Failed scrapes" loading={diagnostics.isLoading}
          value={d ? String(d.scrapes.failed) : null}
          tone={d?.scrapes.failed ? "text-amber-400" : undefined} />
        <Fact label="Superseded attempts" loading={diagnostics.isLoading}
          value={health ? String(health.supersededAttempts) : null} />
        <Fact label="Transcripts" loading={diagnostics.isLoading}
          value={d ? String(d.confidence.transcriptCount) : null} />
        <Fact label="LLM calls" loading={metrics.isLoading}
          value={m ? String(m.llmCalls) : null} />
        <Fact label="Tokens" loading={metrics.isLoading}
          value={m?.totalTokens ? m.totalTokens.toLocaleString() : null} />
      </div>

      {/* Pre-run_id observations linked scrape/LLM rows by observation_id, so
          their diagnostics are inherently incomplete. Say so. */}
      {d && !d.exactRunLinkage && (
        <p className="text-[10px] text-muted-foreground/50 italic">
          This observation predates run tagging — scrape and cost figures may be incomplete.
        </p>
      )}
    </div>
  );
}

/**
 * PER-STRATEGY OUTCOMES — what the phase summary cannot tell you.
 *
 * A phase reports ONE outcome, so a chain whose middle strategy contributes
 * nothing looks exactly like one where it works. `subtitle_browser` reached 227
 * attempts with 0 successes unnoticed for that reason. The attempt events were
 * always being recorded; no surface read them back. This is that surface.
 */
function StrategyBreakdown({ runId }: { runId: string }) {
  const q = trpc.creator.strategyBreakdown.useQuery({ runId }, { staleTime: 30_000, retry: false });
  const rows = q.data?.rows ?? [];

  if (q.isLoading) return <p className="text-[11px] text-muted-foreground/40">…</p>;
  if (rows.length === 0) {
    return (
      <p className="text-[11px] text-muted-foreground/50 italic">
        No per-attempt records for this run — the chains that emit them may not have run.
      </p>
    );
  }

  // kind → strategy → outcome → attempts
  const byKind = new Map<string, Map<string, Record<string, number>>>();
  for (const r of rows) {
    const k = byKind.get(r.kind) ?? new Map<string, Record<string, number>>();
    const s = k.get(r.strategy) ?? {};
    s[r.outcome] = (s[r.outcome] ?? 0) + r.attempts;
    k.set(r.strategy, s);
    byKind.set(r.kind, k);
  }

  return (
    <div className="space-y-2">
      {Array.from(byKind.entries()).map(([kind, strategies]) => (
        <div key={kind}>
          <div className="text-[9px] uppercase tracking-wide text-muted-foreground/40 mb-1">{kind}</div>
          <div className="space-y-1">
            {Array.from(strategies.entries()).map(([strategy, outcomes]) => {
              const ok = outcomes.success ?? 0;
              const attempted = Object.entries(outcomes)
                .filter(([o]) => o !== "skipped")
                .reduce((n, [, v]) => n + (v as number), 0);
              const skipped = outcomes.skipped ?? 0;
              // THE SIGNAL THIS EXISTS FOR: really tried, never once worked.
              const deadWeight = ok === 0 && attempted > 0;
              return (
                <div key={strategy} className="flex items-baseline gap-2 text-[11px]">
                  <span className={`font-mono ${deadWeight ? "text-destructive/80" : "text-foreground/70"}`}>
                    {strategy}
                  </span>
                  <span className="flex-1 border-b border-dashed border-border/30" />
                  <span className="font-mono whitespace-nowrap">
                    <span className={ok > 0 ? "text-green-400" : "text-muted-foreground/40"}>{ok}✓</span>
                    <span className="text-muted-foreground/30"> / </span>
                    <span className={attempted - ok > 0 ? "text-amber-400/80" : "text-muted-foreground/40"}>
                      {attempted - ok}✗
                    </span>
                    {skipped > 0 && <span className="text-muted-foreground/40"> · {skipped} skipped</span>}
                  </span>
                  {deadWeight && (
                    <span className="text-[9px] text-destructive/70 whitespace-nowrap">never succeeded</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/** A single fact. `null` value renders as "unknown", never as 0 or blank. */
function Fact({
  label, value, loading, tone,
}: { label: string; value: string | null; loading?: boolean; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-muted-foreground/50">{label}</span>
      {loading
        ? <span className="text-muted-foreground/30">…</span>
        : value === null
          ? <span className="text-muted-foreground/30 italic">unknown</span>
          : <span className={`font-mono ${tone ?? "text-foreground/80"}`}>{value}</span>}
    </div>
  );
}
