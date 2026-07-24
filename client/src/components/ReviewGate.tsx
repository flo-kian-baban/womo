/**
 * Review gate UI (womo_0006) — analyst-facing components for the analysis
 * review workflow:
 *  - ReviewStatusBadge: unmistakable pending/declined marking (accepted is the
 *    quiet default state).
 *  - PendingRerunNotice: shown when a newer pending run exists while the
 *    previously accepted profile is displayed.
 *  - ReviewGatePanel: factual run diagnostics + Accept / Decline actions.
 * Facts and counts only in the diagnostics — no derived quality metrics.
 */

import { useState } from "react";
import {
  AlertTriangle, Archive, CheckCircle2, ChevronDown, Clock, Cpu,
  FileText, Globe, ShieldQuestion, XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { classifyTranscriptSource } from "@shared/transcriptSource";
import { toast } from "sonner";

// ─── Status badge ────────────────────────────────────────────────────────────

export function ReviewStatusBadge({ status, className = "" }: { status: string | null | undefined; className?: string }) {
  if (status === "pending") {
    return (
      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-amber-400/60 bg-amber-400/15 text-amber-300 text-[11px] font-bold uppercase tracking-wider ${className}`}>
        <Clock className="w-3.5 h-3.5" />
        Pending Review
      </span>
    );
  }
  if (status === "declined") {
    return (
      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-red-400/50 bg-red-400/10 text-red-300 text-[11px] font-bold uppercase tracking-wider ${className}`}>
        <Archive className="w-3.5 h-3.5" />
        Archived (Declined)
      </span>
    );
  }
  return null; // accepted = the quiet default state
}

/** Full-width banner — the unmistakable treatment for pending profiles. */
export function PendingReviewBanner({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-3 rounded-lg border-2 border-amber-400/60 bg-amber-400/10 px-4 py-3 ${className}`}>
      <AlertTriangle className="w-5 h-5 text-amber-300 flex-shrink-0" />
      <div>
        <div className="text-[13px] font-bold text-amber-200 uppercase tracking-wide">Pending review — not vetted</div>
        <div className="text-[11px] text-amber-200/70 mt-0.5">
          This analysis run has not been reviewed. It is excluded from matching until an analyst accepts it.
        </div>
      </div>
    </div>
  );
}

/** Session 5 note fix: displayed profile is the previously accepted run. */
export function PendingRerunNotice({ pendingObservedAt, className = "" }: { pendingObservedAt?: string | Date | null; className?: string }) {
  return (
    <div className={`flex items-center gap-3 rounded-lg border border-amber-400/40 bg-amber-400/5 px-4 py-2.5 ${className}`}>
      <Clock className="w-4 h-4 text-amber-300 flex-shrink-0" />
      <div className="text-[12px] text-amber-200/90">
        A newer analysis run{pendingObservedAt ? ` from ${new Date(pendingObservedAt).toLocaleString()}` : ""} is <span className="font-bold uppercase">pending review</span>.
        {" "}The profile shown below is the <span className="font-semibold">previously accepted run</span> — it stays authoritative until the new run is accepted.
      </div>
    </div>
  );
}

// ─── Diagnostics rendering helpers ───────────────────────────────────────────

function SectionTitle({ icon: Icon, children }: { icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mt-4 mb-2">
      <Icon className="w-3.5 h-3.5" />
      {children}
    </div>
  );
}

function OutcomeChip({ tone, children }: { tone: "ok" | "fail" | "noData" | "notAttempted"; children: React.ReactNode }) {
  const styles = {
    ok: "text-green-400 bg-green-400/10 border-green-400/30",
    fail: "text-red-300 bg-red-400/15 border-red-400/50 font-semibold",
    noData: "text-slate-400 bg-slate-400/10 border-slate-400/30",
    notAttempted: "text-amber-300 bg-amber-400/10 border-amber-400/40",
  }[tone];
  return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10.5px] ${styles}`}>{children}</span>;
}

function msFmt(ms: number | null | undefined): string {
  if (ms == null) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`;
}

// Session 9 (A8): color a field chip by PROVENANCE (not presence). Marks how a
// value was arrived at — evidence-backed vs scraped vs model inference — never
// quality.
const PROVENANCE_STYLES: Record<string, { cls: string; tag: string; title: string }> = {
  evidence:  { cls: "text-emerald-400 bg-emerald-400/10 border-emerald-400/30", tag: "✓",    title: "backed by a stored evidence signal (signals / decoded symbols)" },
  scraped:   { cls: "text-sky-400 bg-sky-400/10 border-sky-400/30",             tag: "raw",  title: "scraped directly from the platform" },
  derived:   { cls: "text-sky-400 bg-sky-400/10 border-sky-400/30",             tag: "calc", title: "computed from scraped stats" },
  computed:  { cls: "text-teal-300 bg-teal-400/10 border-teal-400/30",          tag: "calc", title: "computed from engagement signals (TikTok)" },
  estimated: { cls: "text-amber-300 bg-amber-400/10 border-amber-400/40",       tag: "est",  title: "estimated by the model (no engagement signals)" },
  inferred:  { cls: "text-violet-300 bg-violet-400/10 border-violet-400/30",    tag: "AI",   title: "model inference — no backing evidence signal is stored" },
};

function FieldProvenanceChip({ field, provenance }: { field: string; provenance: string }) {
  const s = PROVENANCE_STYLES[provenance] ?? { cls: "text-slate-400 bg-slate-400/10 border-slate-400/30", tag: provenance, title: provenance };
  return (
    <span title={`${field}: ${s.title}`} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10.5px] cursor-help ${s.cls}`}>
      {field}<span className="opacity-50 text-[8.5px] uppercase">{s.tag}</span>
    </span>
  );
}

/** A7: lazily fetch and show the exact evidence prompt the model received. */
function EvidenceSnapshotView({ observationId }: { observationId: string }) {
  const [open, setOpen] = useState(false);
  const { data, isLoading } = trpc.creator.getEvidenceSnapshot.useQuery(
    { observationId }, { enabled: open },
  );
  const prompt = data?.find(x => x.documentType === "creator_extraction_prompt");
  return (
    <div>
      <button
        className="text-[10.5px] text-muted-foreground/60 hover:text-foreground inline-flex items-center gap-1"
        onClick={() => setOpen(v => !v)}
      >
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`} />
        {open ? "Hide" : "Show"} the exact prompt the model received
      </button>
      {open && (
        <div className="mt-1 max-h-72 overflow-auto rounded border border-border/40 bg-secondary/30 p-2">
          {isLoading
            ? <div className="text-[10.5px] text-muted-foreground animate-pulse">Loading…</div>
            : prompt
              ? <pre className="text-[10px] whitespace-pre-wrap break-words text-muted-foreground/80 font-mono">{prompt.contentText}</pre>
              : <div className="text-[10.5px] text-muted-foreground">No evidence snapshot stored for this run.</div>}
        </div>
      )}
    </div>
  );
}

/** Pure renderer for the RunDiagnostics payload. */
export function RunDiagnosticsView({ d }: { d: any }) {
  const [showScrapeEvents, setShowScrapeEvents] = useState(false);

  return (
    <div className="text-[12px]">
      {/* Factual summary */}
      <div className="rounded-lg bg-secondary/40 border border-border/40 px-4 py-3">
        <ul className="space-y-1">
          {d.summary.map((line: string, i: number) => (
            <li key={i} className="text-foreground/90 font-mono text-[11.5px]">· {line}</li>
          ))}
        </ul>
        {!d.exactRunLinkage && (
          <div className="mt-2 text-[10.5px] text-amber-300/80">
            This observation predates run tagging — scrape/LLM data below is linked by observation id and may be incomplete.
          </div>
        )}
      </div>

      {/* Persistence components */}
      <SectionTitle icon={ShieldQuestion}>Persistence components</SectionTitle>
      {d.enrichments.raw == null ? (
        <div className="text-muted-foreground text-[11px]">No outcome map (predates tracking).</div>
      ) : (
        <div className="space-y-1.5">
          {d.enrichments.failed.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {d.enrichments.failed.map((f: any) => (
                <OutcomeChip key={f.component} tone="fail">
                  <XCircle className="w-3 h-3" /> {f.component}{f.reason ? ` — ${f.reason}` : ""}
                </OutcomeChip>
              ))}
            </div>
          )}
          {d.enrichments.skippedNotAttempted.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {d.enrichments.skippedNotAttempted.map((s: any) => (
                <OutcomeChip key={s.component} tone="notAttempted">
                  {s.component} — not attempted{s.reason ? ` (${s.reason})` : ""}
                </OutcomeChip>
              ))}
            </div>
          )}
          {d.enrichments.skippedNoData.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {d.enrichments.skippedNoData.map((s: any) => (
                <OutcomeChip key={s.component} tone="noData">
                  {s.component} — no data on subject
                </OutcomeChip>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-1.5">
            {d.enrichments.succeeded.map((c: string) => (
              <OutcomeChip key={c} tone="ok"><CheckCircle2 className="w-3 h-3" /> {c}</OutcomeChip>
            ))}
          </div>
        </div>
      )}

      {/* Scrapes */}
      <SectionTitle icon={Globe}>Scrapes ({d.scrapes.total} attempts, {d.scrapes.failed} failed)</SectionTitle>
      {d.scrapes.byPlatform.length === 0 ? (
        <div className="text-muted-foreground text-[11px]">No scrape events recorded for this run.</div>
      ) : (
        <div className="space-y-1">
          {d.scrapes.byPlatform.map((p: any) => (
            <div key={p.platform} className="flex items-center gap-3 font-mono text-[11px]">
              <span className="w-24 text-foreground/80">{p.platform}</span>
              <span className="text-green-400">{p.succeeded} ok</span>
              {p.failed > 0
                ? <span className="text-red-300 font-semibold">{p.failed} failed</span>
                : <span className="text-muted-foreground/40">0 failed</span>}
            </div>
          ))}
          <button
            className="text-[10.5px] text-muted-foreground/60 hover:text-foreground inline-flex items-center gap-1 mt-1"
            onClick={() => setShowScrapeEvents(v => !v)}
          >
            <ChevronDown className={`w-3 h-3 transition-transform ${showScrapeEvents ? "rotate-180" : ""}`} />
            {showScrapeEvents ? "Hide" : "Show"} per-event detail
          </button>
          {showScrapeEvents && (
            <div className="mt-1 max-h-64 overflow-y-auto rounded border border-border/40 bg-secondary/30 p-2 space-y-1">
              {d.scrapes.byPlatform.flatMap((p: any) => p.events.map((e: any, i: number) => (
                <div key={`${p.platform}-${i}`} className={`font-mono text-[10.5px] ${e.failureReason || e.silentFailure || (e.httpStatus != null && e.httpStatus >= 400) ? "text-red-300" : "text-muted-foreground/70"}`}>
                  [{p.platform}] {e.method} · {e.httpStatus ?? "—"} · {msFmt(e.durationMs)}
                  {e.silentFailure ? " · SILENT FAILURE" : ""}
                  {e.failureReason ? ` · ${e.failureReason}` : ""}
                </div>
              )))}
            </div>
          )}
        </div>
      )}

      {/* Scrape-failure consequences (A3) */}
      {d.scrapes.consequences.length > 0 && (
        <div className="mt-2 space-y-1">
          {d.scrapes.consequences.map((c: string, i: number) => (
            <div key={i} className="text-[10.5px] text-amber-300/80 flex gap-1.5">
              <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-0.5" /> {c}
            </div>
          ))}
        </div>
      )}

      {/* Videos — funnel + coverage (A1/A2/A4). One partition, stated once. */}
      <SectionTitle icon={FileText}>Videos</SectionTitle>
      <div className="font-mono text-[11px] text-foreground/80 space-y-0.5">
        <div>
          {d.videos.total} captured
          {d.videos.channelVideoCount != null && (
            <span className="text-muted-foreground">
              {" "}of {d.videos.channelVideoCount} on channel
              {d.videos.coveragePct != null ? ` · ${d.videos.coveragePct}% coverage` : ""}
            </span>
          )}
        </div>
        <div className="text-muted-foreground/80">
          {/* Session 10 (3a): the source breakdown attaches to the WITH-transcript
              group it describes — no longer trailing after "metadata-only". */}
          ↳ {d.videos.withTranscript} with transcript
          {d.videos.withTranscript > 0 && Object.keys(d.videos.transcriptSources).length > 0 &&
            ` (${Object.entries(d.videos.transcriptSources)
              .map(([src, n]) => `${n as number}× ${classifyTranscriptSource(src).label}`)
              .join(", ")})`}
          {`, ${d.videos.withoutTranscript} metadata-only`}
        </div>
        {d.videos.coveragePct != null && d.videos.coveragePct < 100 && (
          <div className="text-amber-300/70 text-[10.5px]">
            Derived stats (engagement, avg views) reflect the {d.videos.total} captured videos, not the full channel.
          </div>
        )}
        {d.pool && d.pool.authorRejected > 0 && (
          <div className="text-emerald-300/70 text-[10.5px]">
            {d.pool.authorRejected} foreign video{d.pool.authorRejected === 1 ? "" : "s"} excluded — author mismatch (not this creator).
          </div>
        )}
      </div>

      {/* Confidence & provenance (A5/A6) */}
      <SectionTitle icon={ShieldQuestion}>Confidence &amp; provenance</SectionTitle>
      <div className="font-mono text-[11px] text-foreground/80 space-y-0.5">
        <div>
          confidence: <span className="uppercase font-semibold">{d.confidence.level ?? "n/a"}</span>
          <span className="text-muted-foreground"> — {d.confidence.rationale}</span>
        </div>
        {d.velocity && (
          <div>
            velocity: {d.velocity.value}
            <span className="text-muted-foreground"> — {d.velocity.rationale}</span>
          </div>
        )}
        {d.sociologicalFieldsProvenance && (
          <div>
            sociological fields (parasocial / audience / capital / remix):{" "}
            {d.sociologicalFieldsProvenance === "computed"
              ? <span className="text-teal-300">computed from engagement signals</span>
              : <span className="text-amber-300">estimated by the model — no engagement signals</span>}
          </div>
        )}
      </div>

      {/* LLM */}
      <SectionTitle icon={Cpu}>LLM calls</SectionTitle>
      <div className="font-mono text-[11px] text-foreground/80">
        {d.llm.calls} calls{d.llm.failed > 0 ? <span className="text-red-300 font-semibold"> · {d.llm.failed} failed</span> : " · all succeeded"}
        {" · "}{d.llm.totalTokens.toLocaleString()} tokens ({d.llm.inputTokens.toLocaleString()} in / {d.llm.outputTokens.toLocaleString()} out)
        {" · "}{d.llm.costUsd > 0 ? `$${d.llm.costUsd.toFixed(4)}` : "unpriced"} · {d.llm.model}
      </div>
      {d.llm.settings.length > 0 && (
        <div className="font-mono text-[10.5px] text-muted-foreground/60 mt-0.5">
          temperature: {d.llm.settings.map((s: { purpose: string; temperature: number | null }) =>
            `${s.purpose.replace(/^creator_/, "").replace(/_/g, " ")}=${s.temperature ?? "default"}`).join(" · ")}
        </div>
      )}
      {d.llm.failures.length > 0 && (
        <div className="mt-1.5 space-y-1">
          {d.llm.failures.map((f: any, i: number) => (
            <div key={i} className="font-mono text-[10.5px] text-red-300">
              ✗ {f.purpose} · {msFmt(f.durationMs)}{f.errorMessage ? ` · ${f.errorMessage.slice(0, 160)}` : ""}
            </div>
          ))}
        </div>
      )}

      {/* Field presence */}
      <SectionTitle icon={FileText}>Extracted fields</SectionTitle>
      {d.fields.missing.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-1.5">
          {d.fields.missing.map((f: string) => (
            <OutcomeChip key={f} tone="fail"><XCircle className="w-3 h-3" /> {f} missing</OutcomeChip>
          ))}
        </div>
      )}
      {/* A8: provenance, not mere presence — evidence-backed vs model inference. */}
      <div className="flex flex-wrap gap-1.5">
        {d.fields.provenance.map((p: { field: string; provenance: string }) => (
          <FieldProvenanceChip key={p.field} field={p.field} provenance={p.provenance} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5 text-[9.5px] text-muted-foreground/60">
        <span><span className="text-emerald-400">■</span> evidence-backed</span>
        <span><span className="text-sky-400">■</span> scraped / derived</span>
        <span><span className="text-teal-300">■</span> computed</span>
        <span><span className="text-amber-300">■</span> estimated</span>
        <span><span className="text-violet-300">■</span> model inference</span>
      </div>
      <div className="font-mono text-[10.5px] text-muted-foreground/60 mt-1.5">
        {d.fields.counts.keywords} keywords · {d.fields.counts.contentThemes} themes · {d.fields.counts.hashtags} hashtags ·{" "}
        {d.fields.counts.decodedSignals} decoded signals · {d.fields.counts.contentItems} content items ·{" "}
        {d.fields.counts.transcripts} transcripts · {d.fields.counts.temporalBuckets} temporal buckets
      </div>

      {/* Evidence the model received (A7) */}
      <SectionTitle icon={FileText}>Evidence the model received</SectionTitle>
      <EvidenceSnapshotView observationId={d.observationId} />
    </div>
  );
}

// ─── Review panel: diagnostics + Accept / Decline ────────────────────────────

const ANALYST_NAME_KEY = "womo_analyst_name";

export function ReviewGatePanel({
  observationId,
  reviewStatus,
  reviewedAt,
  reviewedBy,
  onReviewed,
}: {
  observationId: string;
  reviewStatus: string | null | undefined;
  reviewedAt?: string | Date | null;
  reviewedBy?: string | null;
  onReviewed?: () => void;
}) {
  const [analystName, setAnalystName] = useState(() => localStorage.getItem(ANALYST_NAME_KEY) ?? "");
  const [confirmingDecline, setConfirmingDecline] = useState(false);

  const { data: diagnostics, isLoading, error } = trpc.creator.getDiagnostics.useQuery(
    { observationId },
    { enabled: !!observationId },
  );

  const utils = trpc.useUtils();
  const finishReview = (verb: string) => {
    toast.success(`Run ${verb}`);
    utils.creator.invalidate();
    onReviewed?.();
  };
  const acceptMutation = trpc.creator.acceptObservation.useMutation({
    onSuccess: () => finishReview("accepted — profile is now in the corpus"),
    onError: (e) => toast.error(`Accept failed: ${e.message}`),
  });
  const declineMutation = trpc.creator.declineObservation.useMutation({
    onSuccess: () => finishReview("declined — archived with full provenance (never deleted)"),
    onError: (e) => toast.error(`Decline failed: ${e.message}`),
  });

  const busy = acceptMutation.isPending || declineMutation.isPending;
  const requireName = () => {
    const name = analystName.trim();
    if (!name) {
      toast.error("Enter your analyst name first");
      return null;
    }
    localStorage.setItem(ANALYST_NAME_KEY, name);
    return name;
  };

  return (
    <div className="fit-card rounded-xl border border-border/60 px-5 py-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5">
          <span className="text-[13px] font-semibold text-foreground">Run diagnostics</span>
          <ReviewStatusBadge status={reviewStatus} />
          {reviewStatus !== "pending" && reviewedAt && (
            <span className="text-[10.5px] text-muted-foreground/60">
              reviewed {new Date(reviewedAt).toLocaleString()}{reviewedBy ? ` by ${reviewedBy}` : ""}
            </span>
          )}
        </div>

        {reviewStatus === "pending" && (
          <div className="flex items-center gap-2">
            <Input
              value={analystName}
              onChange={e => setAnalystName(e.target.value)}
              placeholder="Analyst name"
              className="h-8 w-36 text-[12px]"
            />
            <Button
              size="sm"
              className="h-8 bg-green-600 hover:bg-green-500 text-white gap-1.5"
              disabled={busy}
              onClick={() => {
                const name = requireName();
                if (name) acceptMutation.mutate({ observationId, reviewedBy: name });
              }}
            >
              <CheckCircle2 className="w-3.5 h-3.5" /> Accept
            </Button>
            {confirmingDecline ? (
              <Button
                size="sm"
                variant="destructive"
                className="h-8 gap-1.5"
                disabled={busy}
                onClick={() => {
                  const name = requireName();
                  if (name) {
                    declineMutation.mutate({ observationId, reviewedBy: name });
                    setConfirmingDecline(false);
                  }
                }}
                onBlur={() => setConfirmingDecline(false)}
              >
                <Archive className="w-3.5 h-3.5" /> Confirm archive
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 border-red-400/40 text-red-300 hover:bg-red-400/10"
                disabled={busy}
                onClick={() => setConfirmingDecline(true)}
              >
                <XCircle className="w-3.5 h-3.5" /> Decline
              </Button>
            )}
          </div>
        )}
      </div>
      {reviewStatus === "pending" && confirmingDecline && (
        <div className="text-[10.5px] text-red-300/80 mt-1.5">
          Declining archives this run — it is hidden from the library and matching but retained with full provenance. Nothing is deleted.
        </div>
      )}

      <div className="mt-3">
        {isLoading && <div className="text-[11px] text-muted-foreground animate-pulse">Loading diagnostics…</div>}
        {error && <div className="text-[11px] text-destructive">Failed to load diagnostics: {error.message}</div>}
        {diagnostics && <RunDiagnosticsView d={diagnostics} />}
      </div>
    </div>
  );
}
