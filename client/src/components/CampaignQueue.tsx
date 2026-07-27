/**
 * THE QUEUE, AS A LIVE-WORK SURFACE (B1).
 *
 * ─── What this page is now ──────────────────────────────────────────────────
 * Input, live work, attention. Nothing else. The Analyze pages were doing two
 * jobs — submission and archive — with 44 finished campaigns stacked under the
 * input box. Finished work's home is the Profile Library:
 *
 *   `complete` leaves the page the moment it is seen — its profile is in the
 *   library, and the queue owes the analyst nothing further about it. A small
 *   completion metric (with a link) is all that remains of it here.
 *
 *   Attention states STAY until acknowledged: the refusals have no library
 *   entry at all — this page is the only record the analyst ever sees — and
 *   partial saves / gaps have an entry the library row cannot yet describe
 *   honestly (B2-2). Acknowledgement is per-machine, per-analyst, and touches
 *   nothing in the ledger — see lib/acknowledgements.
 *
 * ─── Still nothing estimated ────────────────────────────────────────────────
 * Every mark is a ledger row or arithmetic on one. The completion metric
 * counts campaigns whose commit the ledger recorded today; the countdown is a
 * timestamp the scheduler durably wrote.
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { ArrowRight, Inbox } from "lucide-react";
import { CampaignRow } from "@/components/CampaignRow";
import { acknowledgedRunIds } from "@/lib/acknowledgements";
import {
  classifyCampaign, staysUntilAcknowledged, GROUP_OF,
  type Campaign, type DisplayState,
} from "@/lib/campaignState";

/**
 * One clock for the whole list, ticking so a real retry gate counts down.
 * Arithmetic on `next_earliest_at` — never simulated progress.
 */
function useNow(everyMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

const SUMMARY_WORD: Record<DisplayState, string> = {
  queued: "queued",
  running: "running",
  parked: "parked",
  parked_for_human: "needs a human",
  complete: "complete",
  committed_with_gaps: "with gaps",
  partial_persistence: "partial save",
  refused_empty: "refused (empty)",
  refused_min_data: "refused (thin)",
  failed: "failed",
};

export interface CampaignQueueProps {
  campaigns: Campaign[];
  isLoading: boolean;
  /** What to say when there is no live work at all. Subject-specific wording. */
  emptyLabel: string;
}

export function CampaignQueue({ campaigns, isLoading, emptyLabel }: CampaignQueueProps) {
  // ONE instant for every row, so twenty rows cannot disagree about the clock.
  const now = useNow();
  // Re-read on every ack (bumping this state is the button's callback).
  const [ackVersion, setAckVersion] = useState(0);
  const acked = acknowledgedRunIds();
  void ackVersion;

  const classified = campaigns.map(c => ({ campaign: c, view: classifyCampaign(c, now) }));

  /**
   * The shed. `complete` never renders here; acknowledged attention rows leave
   * too. Everything remaining is either live or unacknowledged attention.
   */
  const attention = classified.filter(
    x => staysUntilAcknowledged(x.view.state) && !acked.has(x.campaign.runId),
  );
  const flight = classified.filter(x => GROUP_OF[x.view.state] === "flight");

  /**
   * The completion metric: campaigns the ledger committed TODAY (local day),
   * shed or not. `committed` + last ledger write today — facts, not estimates.
   */
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const committedToday = classified.filter(
    x => x.view.committed && x.view.lastActivityAt && x.view.lastActivityAt.getTime() >= today.getTime(),
  ).length;

  const empty = attention.length === 0 && flight.length === 0;

  return (
    <div className="space-y-5">
      {/* ─── Completion metric — all that remains of finished work here ───── */}
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[11px] text-muted-foreground/60 tabular-nums">
          {isLoading ? "…" : `${committedToday} committed today`}
        </span>
        <Link
          href="/library"
          className="text-[11px] text-muted-foreground/60 hover:text-foreground inline-flex items-center gap-1 transition-colors"
        >
          Profiles live in the Library <ArrowRight className="w-3 h-3" />
        </Link>
      </div>

      {empty ? (
        <div className="data-card rounded-xl p-8 text-center">
          <Inbox className="w-5 h-5 mx-auto text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground/60 mt-2">
            {isLoading ? "Loading the queue…" : emptyLabel}
          </p>
        </div>
      ) : (
        <>
          {attention.length > 0 && (
            <Section
              title="Needs attention"
              titleCls="text-amber-400"
              note="these will not advance without you"
              rows={attention}
              now={now}
              onAcknowledged={() => setAckVersion(v => v + 1)}
            />
          )}
          {flight.length > 0 && (
            <Section
              title="In flight"
              titleCls="text-muted-foreground"
              note="the queue still owes you these"
              rows={flight}
              now={now}
            />
          )}
        </>
      )}
    </div>
  );
}

function Section({
  title, titleCls, note, rows, now, onAcknowledged,
}: {
  title: string;
  titleCls: string;
  note: string;
  rows: Array<{ campaign: Campaign; view: ReturnType<typeof classifyCampaign> }>;
  now: number;
  onAcknowledged?: () => void;
}) {
  // Counted by display state, so a mixed group cannot hide its composition.
  const tally = new Map<DisplayState, number>();
  for (const r of rows) tally.set(r.view.state, (tally.get(r.view.state) ?? 0) + 1);
  const summary = Array.from(tally.entries())
    .map(([state, n]) => `${n} ${SUMMARY_WORD[state]}`)
    .join(" · ");

  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div className="flex items-baseline gap-2">
          <span className={`text-[11px] font-semibold tracking-[0.12em] uppercase ${titleCls}`}>
            {title}
          </span>
          <span className="text-[11px] text-muted-foreground/40 tabular-nums">({rows.length})</span>
          <span className="text-[10px] text-muted-foreground/35 hidden sm:inline">{note}</span>
        </div>
        <span className="text-[11px] text-muted-foreground/60 font-mono tabular-nums">{summary}</span>
      </div>

      <div className="data-card rounded-xl divide-y divide-border/40 overflow-hidden">
        {rows.map(({ campaign }) => (
          <CampaignRow
            key={campaign.runId}
            campaign={campaign}
            now={now}
            onAcknowledged={onAcknowledged}
          />
        ))}
      </div>
    </section>
  );
}

/**
 * Poll cadence, matched to whether anything is actually moving.
 * MEASURED: the list read costs ~1.8s against the shared database — see B0.
 */
export function pollIntervalFor(campaigns: Campaign[] | undefined): number {
  if (!campaigns || campaigns.length === 0) return 5_000;
  const moving = campaigns.some(c => GROUP_OF[classifyCampaign(c).state] === "flight");
  return moving ? 3_000 : 15_000;
}
