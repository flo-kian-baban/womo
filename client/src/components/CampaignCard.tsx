/**
 * ONE CAMPAIGN, AS THE LEDGER HAS IT.
 *
 * ─── Two rules this component exists to keep ────────────────────────────────
 *
 * 1. NOTHING IS ESTIMATED. Every mark below is a row in `analysis_phase_state`
 *    or a field the server computed from one. There is no timer, no simulated
 *    progress, no interpolation between phases. What replaced the old fake
 *    progress bar must not creep back in as "smoothing".
 *
 * 2. UNKNOWN IS SHOWN AS UNKNOWN. Capture health and token cost only exist once
 *    a campaign has committed an observation. For anything in flight or failed
 *    they are stated as unavailable — never as blank, and never as zero, which
 *    would read as "0 scrapes" rather than "not knowable yet".
 *
 * ─── Built on the PHASE CONTRACT, not on creators ───────────────────────────
 * The five phases are the contract's spine, shared by every subject type. The
 * descriptions are deliberately subject-neutral: brand campaigns arrive on the
 * same five phases in S5 with different tools inside, and this surface should
 * absorb them without a redesign. Platform is read from the campaign's own
 * field and resolved by PlatformMark — this file names no platform.
 */
import { useState } from "react";
import {
  CheckCircle2, Loader2, AlertTriangle, Clock, PauseCircle, XCircle,
  ChevronRight, ArrowRight, CircleDashed, Ban, MinusCircle,
} from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { PlatformMark, platformLabel } from "@/components/PlatformMark";

/** INFERRED from the router — see RouterOutputs. Never hand-redeclared. */
export type Campaign = RouterOutputs["creator"]["queueStatus"]["campaigns"][number];
type Phase = Campaign["phases"][number];

/**
 * The contract's five phases, in order, with subject-neutral descriptions.
 * The ledger is the source of status; this only supplies ordering and wording
 * so a phase that has not been reached yet still has a name.
 */
const PHASES: Array<{ name: Phase["phase"]; label: string; hint: string }> = [
  { name: "capture", label: "Capture", hint: "the subject and its recent content" },
  { name: "augment", label: "Augment", hint: "widening the sample" },
  { name: "transcribe", label: "Transcribe", hint: "spoken content across the sample" },
  { name: "channel_instagram", label: "Instagram channel", hint: "the subject's own posts" },
  { name: "derive", label: "Derive", hint: "themes and symbols" },
  { name: "extract_commit", label: "Extract & commit", hint: "cultural profile, saved" },
];

const STATE: Record<string, { icon: typeof Clock; cls: string; label: string; spin?: boolean }> = {
  queued: { icon: Clock, cls: "text-muted-foreground", label: "Queued" },
  running: { icon: Loader2, cls: "text-indigo-400", label: "Running", spin: true },
  parked: { icon: PauseCircle, cls: "text-amber-400", label: "Parked" },
  complete: { icon: CheckCircle2, cls: "text-green-400", label: "Complete" },
  failed: { icon: XCircle, cls: "text-destructive", label: "Failed" },
};

/** A park has a real timestamp, so show the real remaining time. */
function untilLabel(at: Date | string | null): string | null {
  if (!at) return null;
  const ms = new Date(at).getTime() - Date.now();
  if (ms <= 0) return "now";
  const s = Math.round(ms / 1000);
  if (s < 60) return `in ${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `in ${m}m ${s % 60}s` : `in ${Math.floor(m / 60)}h ${m % 60}m`;
}

function phaseTone(p: Phase | undefined, parked: boolean) {
  if (!p) return { cls: "text-muted-foreground/30", Icon: CircleDashed, spin: false };
  if (p.status === "complete") return { cls: "text-green-400", Icon: CheckCircle2, spin: false };
  /**
   * COMMITTED WITH A GAP gets its own mark, not a faded tick.
   *
   * `partial` is exactly where a blocked capture lands, and rendering it as a
   * dimmer green check read as "basically fine" — the single most misleading
   * thing on this card. A gap means evidence is MISSING for a known reason.
   */
  if (p.status === "partial") {
    return p.blockedGap
      ? { cls: "text-amber-400", Icon: AlertTriangle, spin: false }
      : { cls: "text-green-400/60", Icon: MinusCircle, spin: false };
  }
  if (p.status === "running") return { cls: "text-indigo-400", Icon: Loader2, spin: true };
  if (p.status === "genuine_empty") return { cls: "text-muted-foreground", Icon: Ban, spin: false };
  if (p.status === "failed" || p.status === "blocked") {
    return { cls: parked ? "text-amber-400" : "text-destructive", Icon: AlertTriangle, spin: false };
  }
  if (p.status === "pending") return { cls: "text-muted-foreground/50", Icon: Clock, spin: false };
  return { cls: "text-muted-foreground/30", Icon: CircleDashed, spin: false };
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
  // campaign in flight or one that failed before committing has nothing to key
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

const HEALTH_TONE: Record<string, string> = {
  clean: "border-green-400/30 text-green-400/90 bg-green-400/5",
  degraded: "border-amber-400/30 text-amber-400/90 bg-amber-400/5",
  thin: "border-amber-400/30 text-amber-400/90 bg-amber-400/5",
};

/**
 * PER-STRATEGY OUTCOMES — what the phase summary cannot tell you.
 *
 * A phase reports ONE outcome, so a chain whose middle strategy contributes
 * nothing looks exactly like one where it works. `subtitle_browser` reached 227
 * attempts with 0 successes unnoticed for that reason. The attempt events were
 * always being recorded; no surface read them back. This is that surface.
 *
 * Grouped by the marker's `kind` (profile / search / transcript / …), which is
 * whatever the emitting chain called itself. Nothing here knows a platform or a
 * strategy NAME — a new platform emitting the same `#kind=strategy:outcome`
 * convention shows up with no change to this file.
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

export function CampaignCard({ campaign }: { campaign: Campaign }) {
  const [open, setOpen] = useState(false);
  const s = STATE[campaign.state] ?? STATE.queued;
  const Icon = s.icon;

  const byPhase = new Map(campaign.phases.map(p => [p.phase, p]));
  /**
   * A subject only shows the phases it actually owes.
   *
   * `channel_instagram` is brand's; a creator never writes a row for it, and
   * rendering it greyed would invent work the campaign never had. Every other
   * phase is shown whether or not it has started, so a queued campaign still
   * displays what is coming.
   */
  const visiblePhases = PHASES.filter(
    ({ name }) => name !== "channel_instagram" || byPhase.has("channel_instagram"),
  );
  const parkedPhase = campaign.phases.find(
    p => p.nextEarliestAt && new Date(p.nextEarliestAt).getTime() > Date.now(),
  );

  return (
    <div className="fit-card rounded-xl">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full text-left p-4 flex items-start justify-between gap-3"
        aria-expanded={open}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <PlatformMark platform={campaign.platform} />
            <span className="font-medium truncate">@{campaign.handle}</span>
            <span className="text-[10px] text-muted-foreground/40 uppercase tracking-wide">
              {platformLabel(campaign.platform)}
            </span>
          </div>

          {/* The phase spine — five marks, one per contract phase. */}
          <div className="flex items-center gap-1 mt-2.5">
            {visiblePhases.map(({ name, label }) => {
              const p = byPhase.get(name);
              const { cls, Icon: PIcon, spin } = phaseTone(p, Boolean(parkedPhase));
              return (
                <span key={name} className={`flex items-center ${cls}`} title={`${label}: ${p?.status ?? "not started"}`}>
                  <PIcon className={`w-3 h-3 ${spin ? "animate-spin" : ""}`} />
                </span>
              );
            })}
            <span className="text-[10px] font-mono text-muted-foreground/35 ml-1.5">
              {campaign.runId.slice(0, 8)}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <div className={`flex items-center gap-1.5 text-xs whitespace-nowrap ${s.cls}`}>
            <Icon className={`w-3.5 h-3.5 ${s.spin ? "animate-spin" : ""}`} />
            {s.label}
            {parkedPhase && (
              <span className="text-muted-foreground/60">{untilLabel(parkedPhase.nextEarliestAt)}</span>
            )}
          </div>
          <ChevronRight className={`w-3.5 h-3.5 text-muted-foreground/40 transition-transform ${open ? "rotate-90" : ""}`} />
        </div>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-border/40 pt-3">
          <div className="space-y-1.5">
            {visiblePhases.map(({ name, label, hint }) => {
              const p = byPhase.get(name);
              const isParked = Boolean(p?.nextEarliestAt && new Date(p.nextEarliestAt!).getTime() > Date.now());
              const { cls, Icon: PIcon, spin } = phaseTone(p, isParked);
              return (
                <div key={name} className="flex items-start gap-2 text-xs">
                  <PIcon className={`w-3 h-3 mt-0.5 flex-shrink-0 ${cls} ${spin ? "animate-spin" : ""}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={cls}>{label}</span>
                      <span className="text-muted-foreground/40">{hint}</span>
                      {/* Every badge below is a ledger column, verbatim. */}
                      {p && p.attemptCount > 1 && (
                        <span className="text-[10px] text-amber-400/90">attempt {p.attemptCount}</span>
                      )}
                      {p?.status === "partial" && (
                        <span className="text-[10px] text-muted-foreground/60">partial</span>
                      )}
                      {p?.failureClass && (
                        <span className="text-[10px] font-mono text-destructive/80">{p.failureClass}</span>
                      )}
                      {isParked && (
                        <span className="text-[10px] text-amber-400">
                          retries {untilLabel(p!.nextEarliestAt)}
                        </span>
                      )}
                      {p?.blockedGap && (
                        <span className="text-[10px] text-amber-400">
                          committed with a gap · {p.blockedGap.attempts} attempts
                        </span>
                      )}
                    </div>
                    {/* WHY it parked. Without this the queue can only say
                        "parked", never "parked because it was rate-limited". */}
                    {p?.parkReason && (
                      <p className="text-[10px] text-amber-400/70 mt-0.5 leading-snug">{p.parkReason}</p>
                    )}
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

          {campaign.message && (
            <div className="text-[11px] rounded-lg bg-destructive/5 border border-destructive/20 p-2.5">
              <div className="text-destructive/70 uppercase tracking-wide text-[9px] font-semibold mb-1">
                Reported reason
              </div>
              <p className="text-destructive/90 leading-relaxed">{campaign.message}</p>
            </div>
          )}

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
      )}
    </div>
  );
}
