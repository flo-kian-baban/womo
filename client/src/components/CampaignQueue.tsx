/**
 * THE QUEUE, GROUPED BY WHAT AN ANALYST HAS TO DO ABOUT IT.
 *
 * ─── The question this layout answers ───────────────────────────────────────
 * An analyst running twenty campaigns unattended comes back to one question:
 * what needs me? So the top group is exactly that and nothing else — campaigns
 * that will NOT advance without a person. Everything the queue can still finish
 * by itself is in flight, including a parked campaign, because a park resumes on
 * its own and putting it under "attention" would cry wolf on every rate-limit.
 *
 * The finished group is counted by KIND rather than lumped, because "18
 * finished" hides the only thing worth knowing about them: how many actually
 * produced a clean profile, how many committed with evidence missing, and how
 * many the system refused outright.
 *
 * ─── Shared by both submit pages ────────────────────────────────────────────
 * Creator and brand watch the same ledger through the same component. They used
 * to carry a copy of this layout each, and the copies had already drifted — the
 * creator page listed BRAND campaigns because only the brand page filtered.
 */
import { useEffect, useState } from "react";
import { Inbox } from "lucide-react";
import { CampaignRow } from "@/components/CampaignRow";
import {
  classifyCampaign, GROUP_OF,
  type Campaign, type DisplayGroup, type DisplayState,
} from "@/lib/campaignState";

/**
 * One clock for the whole list, ticking so a real retry gate counts down.
 *
 * This is arithmetic on `next_earliest_at` — a timestamp the scheduler durably
 * wrote — not simulated progress. Nothing advances because time passed; a
 * countdown to a real deadline just stops being stale.
 */
function useNow(everyMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

/** The states an analyst is told about in each group's one-line summary. */
const SUMMARY_WORD: Record<DisplayState, string> = {
  queued: "queued",
  running: "running",
  parked: "parked",
  parked_for_human: "needs a human",
  /**
   * "complete", not "clean". A campaign can commit with full persistence and no
   * blocked gaps while a phase still banked `partial` — a budget-bailed
   * transcribe is the normal case, not a defect. Calling the group "clean" would
   * claim something about evidence depth that this count cannot know; the phase
   * spine and the capture-health chip are where thinness is actually reported.
   */
  complete: "complete",
  committed_with_gaps: "with gaps",
  partial_persistence: "partial save",
  refused_empty: "refused (empty)",
  refused_min_data: "refused (thin)",
  failed: "failed",
};

const GROUP_TITLE: Record<DisplayGroup, string> = {
  attention: "Needs attention",
  flight: "In flight",
  finished: "Finished",
};

const GROUP_NOTE: Record<DisplayGroup, string> = {
  attention: "these will not advance without you",
  flight: "the queue still owes you these",
  finished: "settled — nothing further will happen",
};

export interface CampaignQueueProps {
  campaigns: Campaign[];
  isLoading: boolean;
  /** What to say when there is nothing at all. Subject-specific wording. */
  emptyLabel: string;
}

export function CampaignQueue({ campaigns, isLoading, emptyLabel }: CampaignQueueProps) {
  // ONE instant for every row, so twenty rows cannot disagree about the clock.
  const now = useNow();

  const classified = campaigns.map(c => ({ campaign: c, view: classifyCampaign(c, now) }));
  const groups: Record<DisplayGroup, typeof classified> = {
    attention: classified.filter(x => GROUP_OF[x.view.state] === "attention"),
    flight: classified.filter(x => GROUP_OF[x.view.state] === "flight"),
    finished: classified.filter(x => GROUP_OF[x.view.state] === "finished"),
  };

  if (campaigns.length === 0) {
    return (
      <div className="fit-card rounded-xl p-8 text-center">
        <Inbox className="w-5 h-5 mx-auto text-muted-foreground/30" />
        <p className="text-sm text-muted-foreground/60 mt-2">
          {isLoading ? "Loading the queue…" : emptyLabel}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {(["attention", "flight", "finished"] as const).map(group => {
        const rows = groups[group];
        if (rows.length === 0) return null;

        // Counted by display state, so "18 finished" cannot hide 3 refusals.
        const tally = new Map<DisplayState, number>();
        for (const r of rows) tally.set(r.view.state, (tally.get(r.view.state) ?? 0) + 1);
        const summary = Array.from(tally.entries())
          .map(([state, n]) => `${n} ${SUMMARY_WORD[state]}`)
          .join(" · ");

        return (
          <section key={group} className="space-y-2">
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
              <div className="flex items-baseline gap-2">
                <span className={`text-xs font-semibold tracking-[0.12em] uppercase ${
                  group === "attention" ? "text-amber-400" : "text-muted-foreground"
                }`}>
                  {GROUP_TITLE[group]}
                </span>
                <span className="text-xs text-muted-foreground/40">({rows.length})</span>
                <span className="text-[10px] text-muted-foreground/35 hidden sm:inline">
                  {GROUP_NOTE[group]}
                </span>
              </div>
              <span className="text-[11px] text-muted-foreground/60 font-mono">{summary}</span>
            </div>

            <div className="fit-card rounded-xl divide-y divide-border/40 overflow-hidden">
              {rows.map(({ campaign }) => (
                <CampaignRow key={campaign.runId} campaign={campaign} now={now} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/**
 * Poll cadence, matched to whether anything is actually moving.
 *
 * MEASURED: `listCampaigns(50, includeTerminal)` takes ~1.8s against the shared
 * database. Re-asking that every 3 seconds when nothing is running is pure load
 * on a database every analyst shares. Work in flight still polls at 3s, because
 * that is when the answer changes.
 */
export function pollIntervalFor(campaigns: Campaign[] | undefined): number {
  if (!campaigns || campaigns.length === 0) return 5_000;
  const moving = campaigns.some(c => GROUP_OF[classifyCampaign(c).state] === "flight");
  return moving ? 3_000 : 15_000;
}
