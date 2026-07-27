/**
 * SECTION 5 — HOW THIS REPORT WAS PRODUCED.
 *
 * ─── What this closes ───────────────────────────────────────────────────────
 * B1 shed committed campaigns from the queue, which made a committed run's
 * phase-level account — the spine, retries, parks — unreachable from every
 * surface. The data was always shipped: the library row carries `runId`, and
 * `creator.queueStatus({ runId })` returns the campaign's ledger rows. This is
 * where that account lives now.
 *
 * ─── Two honesty rules this file exists to keep ─────────────────────────────
 *
 * 1. A PHASE SPAN IS NOT EXECUTION TIME. `created_at` is when the phase row was
 *    ENQUEUED, not when work began, so the span from creation to completion
 *    includes however long the phase waited for a resource permit. Measured on
 *    the corpus: capture spans ~50 minutes on a run whose later phases take
 *    seconds — that is a 20-campaign batch queueing against browser=2, not a
 *    50-minute scrape. It is labelled elapsed-since-enqueue everywhere, and
 *    the wait is shown separately where it can be derived (a phase's wait ends
 *    where the previous phase completed).
 *
 * 2. THE DOLLAR FIGURE IS COMPUTED HERE, NOT RECORDED. No cost is stored with a
 *    run. It is arithmetic over token counts and a rate table, so it is labelled
 *    an estimate, states its rates and their as-of date, and separates input
 *    from output. Wall-clock is reported as time and never converted to money.
 */
import { useState } from "react";
import { ChevronDown, ChevronUp, Timer, Cpu, RotateCw, PauseCircle, AlertTriangle } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { MODEL_PRICING, PRICING_AS_OF } from "@shared/llmPricing";

const PHASE_LABEL: Record<string, string> = {
  capture: "Capture",
  augment: "Augment",
  transcribe: "Transcribe",
  channel_instagram: "Instagram channel",
  derive: "Derive",
  extract_commit: "Extract & commit",
};

function secs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s % 60)}s`;
}

/** A dollar amount, never rounded to nothing. */
function usd(c: number): string {
  if (c === 0) return "$0";
  if (c < 0.0001) return "<$0.0001";
  return `$${c.toFixed(4)}`;
}

/**
 * Phase status → a neutral word plus, where it earns it, attention colour.
 * `complete` is the expected outcome and renders quiet.
 */
function statusTone(status: string, failureClass: string | null): string {
  if (status === "complete") return "text-muted-foreground/70";
  if (status === "partial") return "text-muted-foreground/70";
  if (status === "genuine_empty") return "text-muted-foreground/70";
  if (failureClass === "structural" || status === "failed") return "text-destructive";
  if (status === "blocked") return "text-amber-400";
  return "text-muted-foreground/70";
}

export function RunCostAndProcess({
  runId, observationId,
}: { runId: string | null | undefined; observationId: string }) {
  const [openPhases, setOpenPhases] = useState(false);
  const [openCalls, setOpenCalls] = useState(false);

  // The campaign's ledger rows — the B1 gap, reachable from the runId the
  // profile already carries. Skipped entirely for pre-queue observations.
  const campaign = trpc.creator.queueStatus.useQuery(
    { runId: runId ?? "" },
    { enabled: Boolean(runId), staleTime: 60_000, retry: false },
  );
  const diagnostics = trpc.creator.getDiagnostics.useQuery(
    { observationId }, { staleTime: 60_000, retry: false },
  );
  const provenance = trpc.creator.getProvenance.useQuery(
    { observationId }, { staleTime: 60_000, retry: false },
  );

  const phases = campaign.data?.campaigns[0]?.phases ?? [];
  const d = diagnostics.data;
  const calls = provenance.data?.llmCalls ?? [];

  // ── Wall-clock, from the ledger's own timestamps ──
  const stamps = phases.flatMap(p => [p.createdAt, p.updatedAt]).filter(Boolean).map(t => new Date(t as Date).getTime());
  const wallMs = stamps.length >= 2 ? Math.max(...stamps) - Math.min(...stamps) : null;

  // ── Cost, computed here from tokens × rates. Grouped by the model that
  //    actually ran each call, so a multi-model run cannot hide behind one rate.
  const byModel = new Map<string, { inTok: number; outTok: number; calls: number }>();
  for (const c of calls) {
    const m = c.model ?? "unknown";
    const e = byModel.get(m) ?? { inTok: 0, outTok: 0, calls: 0 };
    e.inTok += c.inputTokens ?? 0;
    e.outTok += c.outputTokens ?? 0;
    e.calls += 1;
    byModel.set(m, e);
  }
  // Fall back to the run-linked aggregate when per-call rows are unavailable.
  if (byModel.size === 0 && d && d.llm.calls > 0) {
    byModel.set(d.llm.model, { inTok: d.llm.inputTokens, outTok: d.llm.outputTokens, calls: d.llm.calls });
  }
  const rows = Array.from(byModel.entries()).map(([model, t]) => {
    const rate = MODEL_PRICING[model];
    return {
      model, ...t, rate,
      inCost: rate ? (t.inTok / 1_000_000) * rate.input : null,
      outCost: rate ? (t.outTok / 1_000_000) * rate.output : null,
    };
  });
  const priced = rows.every(r => r.rate);
  const estTotal = rows.reduce((s, r) => s + (r.inCost ?? 0) + (r.outCost ?? 0), 0);
  const totalTok = rows.reduce((s, r) => s + r.inTok + r.outTok, 0);

  return (
    <div className="space-y-5">
      {/* ── Headline facts ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-8 gap-y-3">
        <Fact label="Wall clock" value={wallMs != null ? secs(wallMs) : null}
          note={wallMs != null ? "first phase enqueued → last completed" : "no phase rows"} />
        <Fact label="Phases" value={phases.length ? String(phases.length) : null} />
        <Fact label="LLM calls" value={d ? String(d.llm.calls) : null} />
        <Fact label="Tokens" value={totalTok ? totalTok.toLocaleString() : null} />
      </div>

      {/* ── Phase timeline ───────────────────────────────────────────────── */}
      <div>
        <button
          onClick={() => setOpenPhases(v => !v)}
          className="w-full flex items-center gap-2 text-left py-1.5"
        >
          <Timer className="w-3.5 h-3.5 text-muted-foreground/50" />
          <span className="text-[10px] font-semibold tracking-[0.12em] uppercase text-muted-foreground">
            Phase by phase
          </span>
          <span className="text-[10px] text-muted-foreground/40 tabular-nums">
            {campaign.isLoading ? "…" : `${phases.length} phases`}
            {phases.some(p => p.attemptCount > 1) && " · retries"}
          </span>
          {openPhases ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground/40 ml-auto" />
                      : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/40 ml-auto" />}
        </button>

        {openPhases && (
          <div className="mt-2 space-y-1.5">
            {!runId && (
              <p className="text-[11px] text-muted-foreground/50 italic">
                This observation predates run tagging — it has no campaign ledger to show.
              </p>
            )}
            {runId && phases.length === 0 && !campaign.isLoading && (
              <p className="text-[11px] text-muted-foreground/50 italic">
                No phase rows found for this run.
              </p>
            )}
            {phases.map((p, i) => {
              const created = p.createdAt ? new Date(p.createdAt).getTime() : null;
              const updated = p.updatedAt ? new Date(p.updatedAt).getTime() : null;
              const span = created && updated ? updated - created : null;
              // A phase's wait ends where the PREVIOUS phase finished; the first
              // phase's wait is from submission, which is its own creation.
              const prevDone = i > 0 && phases[i - 1]!.updatedAt
                ? new Date(phases[i - 1]!.updatedAt as Date).getTime() : null;
              const ranMs = prevDone && updated ? updated - Math.max(prevDone, created ?? prevDone) : null;
              const waited = created && prevDone ? Math.max(0, prevDone - created) : null;
              const retries = p.retryHistory ?? null;

              return (
                <div key={p.phase} className="text-[11px] border-b border-border/25 last:border-0 pb-1.5">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-foreground/80 w-[128px] flex-shrink-0">
                      {PHASE_LABEL[p.phase] ?? p.phase}
                    </span>
                    <span className={`font-mono ${statusTone(p.status, p.failureClass)}`}>{p.status}</span>
                    {p.failureClass && (
                      <span className="font-mono text-[10px] text-destructive/80">{p.failureClass}</span>
                    )}
                    <span className="ml-auto font-mono tabular-nums text-muted-foreground/60">
                      {span != null ? secs(span) : "—"}
                      <span className="text-muted-foreground/35"> elapsed since enqueue</span>
                    </span>
                  </div>
                  {(waited != null && waited > 1000) || ranMs != null ? (
                    <div className="pl-[136px] text-[10px] text-muted-foreground/45 font-mono tabular-nums">
                      {waited != null && waited > 1000 && <>waited {secs(waited)}</>}
                      {waited != null && waited > 1000 && ranMs != null && " · "}
                      {ranMs != null && <>ran {secs(ranMs)}</>}
                    </div>
                  ) : null}

                  {/* Retries — the reasons where they were banked, and an honest
                      statement where the run predates the banking. */}
                  {p.attemptCount > 1 && (
                    <div className="pl-[136px] mt-0.5 space-y-0.5">
                      <div className="flex items-center gap-1.5 text-[10px] text-amber-400/80">
                        <RotateCw className="w-2.5 h-2.5" />
                        {p.attemptCount} attempts
                        {!retries && (
                          <span className="text-muted-foreground/50">
                            · reasons not recorded (run predates retry banking)
                          </span>
                        )}
                      </div>
                      {retries?.map((r, k) => (
                        <p key={k} className="text-[10px] text-muted-foreground/55 leading-snug">
                          attempt {r.attempt}: {r.detail ?? r.reason}
                        </p>
                      ))}
                    </div>
                  )}
                  {p.parkReason && (
                    <div className="pl-[136px] mt-0.5 flex items-start gap-1.5 text-[10px] text-amber-400/80">
                      <PauseCircle className="w-2.5 h-2.5 mt-0.5 flex-shrink-0" />
                      <span className="leading-snug">{p.parkReason}</span>
                    </div>
                  )}
                  {p.blockedGap && (
                    <div className="pl-[136px] mt-0.5 flex items-start gap-1.5 text-[10px] text-amber-400/80">
                      <AlertTriangle className="w-2.5 h-2.5 mt-0.5 flex-shrink-0" />
                      <span className="leading-snug">
                        committed with a gap after {p.blockedGap.attempts} attempts —{" "}
                        {p.blockedGap.detail ?? p.blockedGap.reason}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
            <p className="text-[10px] text-muted-foreground/40 italic pt-1">
              A phase's clock starts when it is ENQUEUED, so elapsed includes time spent waiting for a
              browser or LLM permit. "ran" is measured from the previous phase's completion.
            </p>
          </div>
        )}
      </div>

      {/* ── LLM cost ─────────────────────────────────────────────────────── */}
      <div>
        <button
          onClick={() => setOpenCalls(v => !v)}
          className="w-full flex items-center gap-2 text-left py-1.5"
        >
          <Cpu className="w-3.5 h-3.5 text-muted-foreground/50" />
          <span className="text-[10px] font-semibold tracking-[0.12em] uppercase text-muted-foreground">
            LLM cost — estimated
          </span>
          <span className="text-[10px] text-muted-foreground/40 tabular-nums">
            {priced && rows.length > 0 ? `~${usd(estTotal)}` : "unpriced"} · {calls.length || d?.llm.calls || 0} calls
          </span>
          {openCalls ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground/40 ml-auto" />
                     : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/40 ml-auto" />}
        </button>

        {openCalls && (
          <div className="mt-2 space-y-3">
            {/* NOT A RECORDED FACT — stated before the number, not after it. */}
            <p className="text-[10px] text-muted-foreground/55 leading-relaxed">
              No cost is recorded with a run. The figures below are computed from the token
              counts the pipeline logged and a published rate table — an <span className="text-foreground/70">estimate</span>,
              not a billed amount. Rates as of{" "}
              <span className="font-mono tabular-nums text-foreground/70">{PRICING_AS_OF}</span>.
            </p>

            {rows.length === 0 ? (
              <p className="text-[11px] text-muted-foreground/50 italic">No LLM calls recorded for this run.</p>
            ) : (
              <div className="space-y-2">
                {rows.map(r => (
                  <div key={r.model} className="text-[11px] space-y-0.5">
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-foreground/80">{r.rate?.label ?? r.model}</span>
                      <span className="text-muted-foreground/50 tabular-nums">{r.calls} calls</span>
                      {!r.rate && <span className="text-amber-400/80 text-[10px]">no published rate — unpriced</span>}
                    </div>
                    <div className="pl-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono tabular-nums text-[10px] text-muted-foreground/60">
                      <span>input</span>
                      <span>
                        {r.inTok.toLocaleString()} tokens
                        {r.rate && <> × ${r.rate.input}/1M = <span className="text-foreground/70">{usd(r.inCost!)}</span></>}
                      </span>
                      <span>output</span>
                      <span>
                        {r.outTok.toLocaleString()} tokens
                        {r.rate && <> × ${r.rate.output}/1M = <span className="text-foreground/70">{usd(r.outCost!)}</span></>}
                      </span>
                    </div>
                  </div>
                ))}
                {priced && (
                  <div className="text-[11px] font-mono tabular-nums text-foreground/80 pt-1 border-t border-border/25">
                    estimated total ~{usd(estTotal)}
                  </div>
                )}
              </div>
            )}

            {/* Per-call detail — reachable, and its existence stated by the count. */}
            {calls.length > 0 && (
              <div className="space-y-1 pt-1">
                <div className="text-[9px] uppercase tracking-wide text-muted-foreground/40">
                  Individual calls ({calls.length})
                </div>
                {calls.map((c, i) => (
                  <div key={i} className="font-mono text-[10px] text-muted-foreground/55 tabular-nums">
                    {c.purpose} · {c.model} · {((c.inputTokens ?? 0) + (c.outputTokens ?? 0)).toLocaleString()} tok ·{" "}
                    {c.durationMs ? `${(c.durationMs / 1000).toFixed(1)}s` : "—"}
                  </div>
                ))}
              </div>
            )}

            {/* Temperatures and failures — kept from the diagnostics panel. */}
            {d && d.llm.settings.length > 0 && (
              <div className="font-mono text-[10px] text-muted-foreground/50">
                temperature: {d.llm.settings.map(s => `${s.purpose.replace(/^creator_/, "").replace(/_/g, " ")}=${s.temperature ?? "default"}`).join(" · ")}
              </div>
            )}
            {d && d.llm.failures.length > 0 && (
              <div className="space-y-0.5">
                {d.llm.failures.map((f, i) => (
                  <div key={i} className="font-mono text-[10px] text-destructive/80">
                    ✗ {f.purpose}{f.errorMessage ? ` · ${f.errorMessage.slice(0, 160)}` : ""}
                  </div>
                ))}
              </div>
            )}
            <p className="text-[10px] text-muted-foreground/40 italic">
              Wall clock is reported above as time. It is deliberately not converted to money — machine
              time here is a laptop, not a metered service.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function Fact({ label, value, note }: { label: string; value: string | null; note?: string }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wide text-muted-foreground/40">{label}</div>
      <div className="text-sm font-semibold tabular-nums text-foreground/85">
        {value ?? <span className="text-muted-foreground/30 italic font-normal text-xs">unknown</span>}
      </div>
      {note && <div className="text-[9px] text-muted-foreground/35 mt-0.5">{note}</div>}
    </div>
  );
}
