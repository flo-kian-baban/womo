/**
 * THE CREATOR REPORT — organised around the accept/decline decision (B2a).
 *
 * ─── Why it is five sections ────────────────────────────────────────────────
 * The page reported everything at one altitude: framework readings, transcripts,
 * scrape events and token counts sat in one column at the same weight, so the
 * question an analyst actually arrives with — do I accept this? — had to be
 * assembled by reading the whole thing. The order is now the order of that
 * decision:
 *
 *   1 EXECUTIVE   who this is and what was concluded — seconds
 *   2 ANALYSIS    every finding, in full
 *   3 TRUST       how far to believe it, and why
 *   4 SUPPORT     the evidence underneath
 *   5 COST        how the report was produced
 *
 * ─── NOTHING IS REMOVED ─────────────────────────────────────────────────────
 * This file changes what is surfaced FIRST, never what is reachable. Every item
 * on the previous page is here — surfaced or one click down — and every
 * disclosure states what it holds (a count, a label) so a collapsed section is
 * never a silent omission. The reusable pieces are IMPORTED from
 * CreatorProfileCard rather than reimplemented, because a copy is how a field
 * gets quietly dropped.
 *
 * ─── Colour ─────────────────────────────────────────────────────────────────
 * Categorical neutral, ordinal coloured. Framework values are positions, not
 * verdicts. Colour belongs to confidence, coverage, capture health, provenance
 * and review state — the things that inform the decision.
 */
import { useState } from "react";
import {
  ChevronDown, ChevronUp, ExternalLink, RefreshCw, Users, Heart, Play,
  TrendingUp, Video, Hash, Tag, Film, Shield, FileText, Layers, Receipt,
} from "lucide-react";
import { trpc } from "@/lib/trpc";
import TranscriptPanel from "./TranscriptPanel";
import FieldExplainer, { EXPLAINED_FIELD_KEYS } from "./FieldExplainer";
import { MetricTooltip } from "@/components/MetricTooltip";
import { PlatformMark, platformLabel } from "@/components/PlatformMark";
import { PendingReviewBanner, ReviewStatusBadge, RunDiagnosticsView } from "./ReviewGate";
import { RunCostAndProcess } from "./RunCostAndProcess";
import {
  FIELD_SECTIONS, BOOLEAN_FIELDS, FieldValue, VideoEvidenceTable,
  SupplementalVideoPanel, formatNum, CHIP_NEUTRAL, METRIC_TOOLTIPS,
} from "./CreatorProfileCard";

type Profile = Record<string, any> & { id: string };

// ─── Section frame ────────────────────────────────────────────────────────────

/**
 * One numbered section. Separated by heading, spacing and rule — never by a
 * background tint, which is what made the old page read as a stack of unrelated
 * cards.
 */
function Section({
  n, title, blurb, icon: Icon, children,
}: {
  n: number; title: string; blurb: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <section className="pt-7 first:pt-0 border-t border-border/40 first:border-0">
      <div className="flex items-baseline gap-2.5 mb-4">
        <span className="text-[10px] font-mono tabular-nums text-muted-foreground/35">{n}</span>
        <Icon className="w-3.5 h-3.5 text-muted-foreground/50 self-center" />
        <h2 className="text-[11px] font-semibold tracking-[0.14em] uppercase text-foreground/80">{title}</h2>
        <span className="text-[10px] text-muted-foreground/40 hidden sm:inline">{blurb}</span>
      </div>
      {children}
    </section>
  );
}

/** A disclosure whose collapsed state always says what it holds. */
function Disclosure({
  label, summary, children, defaultOpen = false,
}: { label: string; summary: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-border/25 first:border-0">
      <button onClick={() => setOpen(v => !v)} className="w-full flex items-center gap-2 py-2 text-left">
        <span className="text-[10px] font-semibold tracking-[0.12em] uppercase text-muted-foreground">{label}</span>
        <span className="text-[10px] text-muted-foreground/40 tabular-nums">{summary}</span>
        {open ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground/40 ml-auto" />
              : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/40 ml-auto" />}
      </button>
      {open && <div className="pb-3">{children}</div>}
    </div>
  );
}

// ─── Ordinal treatments — the only colour on the page ────────────────────────

const CONFIDENCE_TONE: Record<string, string> = {
  high: "text-foreground/75 border-border/60 bg-secondary/50",
  medium: "text-amber-400 border-amber-400/35 bg-amber-400/10",
  low: "text-red-400 border-red-400/35 bg-red-400/10",
};
const HEALTH_TONE: Record<string, string> = {
  clean: "text-foreground/75 border-border/60 bg-secondary/50",
  degraded: "text-amber-400 border-amber-400/35 bg-amber-400/10",
  thin: "text-amber-400 border-amber-400/35 bg-amber-400/10",
};
/** Coverage is ordinal: colour only once the shortfall would mislead. */
function coverageTone(pct: number | null): string {
  if (pct == null) return "text-muted-foreground/50 border-border/50 bg-secondary/40";
  if (pct >= 80) return "text-foreground/75 border-border/60 bg-secondary/50";
  if (pct >= 25) return "text-amber-400 border-amber-400/35 bg-amber-400/10";
  return "text-red-400 border-red-400/35 bg-red-400/10";
}

function Pill({ tone, children, title }: { tone: string; children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] font-medium ${tone}`}>
      {children}
    </span>
  );
}

// ─── The report ───────────────────────────────────────────────────────────────

export default function CreatorReport({
  profile, onReanalyze, isReanalyzing = false,
}: { profile: Profile; onReanalyze?: () => void; isReanalyzing?: boolean }) {
  const themes: string[] = profile.contentThemeLabels ?? [];
  const hashtags: string[] = profile.topHashtags ?? [];
  const keywords: string[] = profile.rawKeywords ?? [];
  const videoTitles: string[] = profile.recentVideoTitles ?? [];
  const transcripts = profile.transcriptExcerpts ?? [];
  const decoded = profile.decodedSymbols ?? null;
  const isPending = profile.reviewStatus === "pending";

  const diagnostics = trpc.creator.getDiagnostics.useQuery(
    { observationId: profile.observationId }, { staleTime: 60_000, retry: false },
  );
  const d = diagnostics.data;

  const decodedCount = decoded
    ? (decoded.identityClaims?.length ?? 0) + (decoded.statusSignals?.length ?? 0)
      + (decoded.communityReferences?.length ?? 0) + (decoded.aspirationDrivers?.length ?? 0)
    : 0;

  return (
    <div className="space-y-0">
      {isPending && <div className="mb-5"><PendingReviewBanner /></div>}

      {/* ══ 1 EXECUTIVE SUMMARY ══════════════════════════════════════════ */}
      <Section n={1} title="Executive summary" blurb="who this creator is, and what the analysis concluded" icon={Layers}>
        <div className="space-y-4">
          {/* Identity */}
          <div className="flex items-start gap-3 flex-wrap">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-semibold text-foreground">{profile.displayName || profile.handle}</h1>
                <ReviewStatusBadge status={profile.reviewStatus} />
              </div>
              <div className="flex items-center gap-2 mt-1 flex-wrap text-[11px] text-muted-foreground/60">
                <PlatformMark platform={String(profile.platform)} className="w-3.5 h-3.5" />
                <span>{platformLabel(String(profile.platform))}</span>
                <span className="text-muted-foreground/70">@{profile.handle}</span>
                {profile.pronouns && profile.pronouns !== "not specified" && <span>· {profile.pronouns}</span>}
                {profile.location && <span>· {profile.location}</span>}
                {profile.profileUrl && (
                  <a href={String(profile.profileUrl)} target="_blank" rel="noreferrer"
                     className="inline-flex items-center gap-1 hover:text-foreground transition-colors">
                    <ExternalLink className="w-3 h-3" /> profile
                  </a>
                )}
                {profile.observedAt && (
                  <span>· analysed {new Date(profile.observedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
                )}
              </div>
              {profile.bio && <p className="text-xs text-muted-foreground/70 mt-2 leading-relaxed max-w-2xl">{profile.bio}</p>}
            </div>
            {onReanalyze && (
              <button onClick={onReanalyze} disabled={isReanalyzing}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border text-[11px] text-muted-foreground hover:text-foreground transition-colors flex-shrink-0">
                <RefreshCw className={`w-3 h-3 ${isReanalyzing ? "animate-spin" : ""}`} />
                {isReanalyzing ? "Queueing…" : "Re-analyze"}
              </button>
            )}
          </div>

          {/* The headline reading + the trust flags that qualify it */}
          <div className="flex items-center gap-2 flex-wrap">
            {profile.archetype && (
              <span className={`inline-flex items-center px-2.5 py-1 rounded-full border text-xs font-medium ${CHIP_NEUTRAL}`}>
                {profile.archetype}
              </span>
            )}
            {profile.nicheTopicNode && (
              <span className="text-[11px] text-muted-foreground/70">{profile.nicheTopicNode}</span>
            )}
            <span className="ml-auto flex items-center gap-1.5 flex-wrap">
              {profile.dataConfidenceLevel && (
                <Pill tone={CONFIDENCE_TONE[String(profile.dataConfidenceLevel)] ?? CHIP_NEUTRAL}
                      title={d?.confidence.rationale}>
                  {String(profile.dataConfidenceLevel)} confidence
                </Pill>
              )}
              {d && (
                <Pill tone={HEALTH_TONE[d.captureHealth.status] ?? CHIP_NEUTRAL}
                      title="How the capture itself went — reporting only, never an input to scoring">
                  capture {d.captureHealth.status}
                </Pill>
              )}
              {d?.videos.coveragePct != null && (
                <Pill tone={coverageTone(d.videos.coveragePct)}
                      title={`${d.videos.total} captured of ${d.videos.channelVideoCount} on channel`}>
                  {d.videos.coveragePct}% coverage
                </Pill>
              )}
            </span>
          </div>

          {/* Themes — the headline content read */}
          {themes.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {themes.map((t, i) => (
                <span key={i} className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] ${CHIP_NEUTRAL}`}>{t}</span>
              ))}
            </div>
          )}

          {/* The conclusion, in the analyst's words */}
          {profile.aiSummary && (
            <p className="text-sm text-foreground/80 leading-relaxed max-w-3xl">{profile.aiSummary}</p>
          )}

          {/* Metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-6 gap-y-3 pt-1">
            <Metric icon={Users} label="Followers" value={profile.followerCount} tip="followerCount" />
            <Metric icon={Heart} label="Likes" value={profile.totalLikes} tip="totalLikes" />
            <Metric icon={Play} label="Views" value={profile.totalViews} tip="totalViews" />
            <Metric icon={TrendingUp} label="Avg views" value={profile.avgViews} tip="avgViews" />
            <Metric icon={Video} label="Posts" value={profile.videoCount} tip="videoCount" />
            <Metric icon={TrendingUp} label="Eng. rate" value={profile.engagementRate} suffix="%" tip="engagementRate" />
          </div>
        </div>
      </Section>

      {/* ══ 2 DETAILED ANALYSIS ══════════════════════════════════════════ */}
      <Section n={2} title="Detailed analysis" blurb="every framework reading, in full" icon={FileText}>
        <div className="space-y-5">
          {FIELD_SECTIONS.map(section => (
            <div key={section.title}>
              <div className="mb-2.5">
                <h3 className="text-[10px] font-semibold tracking-[0.12em] uppercase text-muted-foreground">{section.title}</h3>
                <p className="text-[10px] text-muted-foreground/50 mt-0.5">{section.subtitle}</p>
              </div>
              <div className="space-y-2.5">
                {section.fields.map(field => {
                  const value = profile[field.key];
                  return (
                    <div key={field.key} className="py-1.5 border-b border-border/25 last:border-0">
                      <div className="grid grid-cols-[1fr_1.5fr] gap-4 items-start">
                        <span className="text-[11px] text-muted-foreground pt-0.5">{field.label}</span>
                        <FieldValue fieldKey={field.key} value={value} type={field.type} />
                      </div>
                      {EXPLAINED_FIELD_KEYS.has(field.key) && (
                        <div className="mt-1">
                          <FieldExplainer fieldKey={field.key} value={value != null ? String(value) : null} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {section.title.includes("Three") && (
                <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {BOOLEAN_FIELDS.map(bf => {
                    const val = profile[bf.key] as boolean | null;
                    return (
                      <div key={bf.key} className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-secondary/40 border border-border/40">
                        <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${val ? "bg-foreground/55" : "bg-muted-foreground/25"}`} />
                        <span className="text-[10px] text-muted-foreground">{bf.label}</span>
                        <span className={`ml-auto text-[10px] font-medium tabular-nums ${val ? "text-foreground/75" : "text-muted-foreground/40"}`}>
                          {val ? "Yes" : "No"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}

          {/* Decoded signals — identity claims and the rest, with the summary. */}
          {(decodedCount > 0 || profile.symbolicSummary) && (
            <Disclosure label="Decoded signals" summary={`${decodedCount} phrases · symbolic summary`}>
              <div className="text-[11px] space-y-3">
                {profile.symbolicSummary && (
                  <p className="text-muted-foreground/75 leading-relaxed">{profile.symbolicSummary}</p>
                )}
                {decoded && ([
                  ["Identity claims", decoded.identityClaims],
                  ["Status signals", decoded.statusSignals],
                  ["Community references", decoded.communityReferences],
                  ["Aspiration drivers", decoded.aspirationDrivers],
                ] as const).map(([label, list]) => (
                  (list?.length ?? 0) > 0 && (
                    <div key={label}>
                      <div className="text-[9px] uppercase tracking-wide text-muted-foreground/45 mb-1">
                        {label} ({list!.length})
                      </div>
                      <div className="space-y-1">
                        {list!.map((s: any, i: number) => (
                          <div key={i} className="flex items-baseline gap-2">
                            <span className="font-mono text-foreground/75 flex-shrink-0">“{s.phrase}”</span>
                            <span className="text-muted-foreground/60">{s.meaning}</span>
                            {s.informs?.length > 0 && (
                              <span className="text-[9px] text-muted-foreground/35 ml-auto flex-shrink-0">
                                informs {s.informs.join(", ")}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                ))}
              </div>
            </Disclosure>
          )}
        </div>
      </Section>

      {/* ══ 3 TRUST ══════════════════════════════════════════════════════ */}
      <Section n={3} title="Trust" blurb="how far to believe it, and why" icon={Shield}>
        {diagnostics.isLoading ? (
          <p className="text-[11px] text-muted-foreground/40">Loading run diagnostics…</p>
        ) : !d ? (
          <p className="text-[11px] text-muted-foreground/50 italic">
            No run diagnostics available for this observation.
          </p>
        ) : (
          <div className="space-y-4">
            {/* The four judgements, stated plainly */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 text-[11px]">
              <TrustLine label="Confidence" tone={CONFIDENCE_TONE[String(d.confidence.level)] ?? CHIP_NEUTRAL}
                value={d.confidence.level ?? "n/a"} detail={d.confidence.rationale} />
              <TrustLine label="Capture health" tone={HEALTH_TONE[d.captureHealth.status] ?? CHIP_NEUTRAL}
                value={d.captureHealth.status}
                detail={d.captureHealth.failedPathMethods.length > 0
                  ? `failed paths: ${d.captureHealth.failedPathMethods.join(", ")}`
                  : "no path failures recorded"} />
              <TrustLine label="Coverage" tone={coverageTone(d.videos.coveragePct)}
                value={d.videos.coveragePct != null ? `${d.videos.coveragePct}%` : "unknown"}
                detail={d.videos.channelVideoCount != null
                  ? `${d.videos.total} captured of ${d.videos.channelVideoCount} on channel`
                  : `${d.videos.total} captured · channel total not recorded`} />
              <TrustLine label="Evidence reaching the model" tone={CHIP_NEUTRAL}
                value={`${d.videos.withTranscript} of ${d.videos.total} with transcript`}
                detail={Object.keys(d.videos.transcriptSources).length > 0
                  ? Object.entries(d.videos.transcriptSources).map(([s, n]) => `${n}× ${s}`).join(", ")
                  : `${d.videos.withoutTranscript} metadata-only`} />
            </div>

            {/* Consequences and caveats — the warnings that qualify the read */}
            {(d.scrapes.consequences.length > 0 || !d.exactRunLinkage
              || (d.videos.coveragePct != null && d.videos.coveragePct < 100)
              || (d.pool && d.pool.authorRejected > 0) || d.sociologicalFieldsProvenance) && (
              <div className="space-y-1.5">
                {d.scrapes.consequences.map((c, i) => (
                  <p key={i} className="text-[11px] text-amber-400/80 leading-relaxed">{c}</p>
                ))}
                {d.videos.coveragePct != null && d.videos.coveragePct < 100 && (
                  <p className="text-[11px] text-amber-400/80 leading-relaxed">
                    Derived stats (engagement, avg views) reflect the {d.videos.total} captured videos, not the full channel.
                  </p>
                )}
                {d.pool && d.pool.authorRejected > 0 && (
                  <p className="text-[11px] text-muted-foreground/60">
                    {d.pool.authorRejected} foreign video{d.pool.authorRejected === 1 ? "" : "s"} excluded — author mismatch.
                  </p>
                )}
                {d.sociologicalFieldsProvenance && (
                  <p className="text-[11px] text-muted-foreground/60">
                    Sociological fields (parasocial / audience / capital / remix):{" "}
                    {d.sociologicalFieldsProvenance === "computed"
                      ? "computed from engagement signals"
                      : <span className="text-amber-400/80">estimated by the model — no engagement signals</span>}
                  </p>
                )}
                {d.velocity && (
                  <p className="text-[11px] text-muted-foreground/60">
                    Velocity {d.velocity.value} — {d.velocity.rationale}
                  </p>
                )}
                {!d.exactRunLinkage && (
                  <p className="text-[11px] text-amber-400/80">
                    This observation predates run tagging — scrape and LLM figures are linked by observation id and may be incomplete.
                  </p>
                )}
              </div>
            )}

            {/* Provenance per field — one muted treatment, legend intact */}
            <Disclosure label="Provenance per field"
              summary={`${d.fields.provenance.length} fields${d.fields.missing.length > 0 ? ` · ${d.fields.missing.length} missing` : ""}`}>
              <div className="space-y-2">
                {d.fields.missing.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {d.fields.missing.map(f => (
                      <span key={f} className="px-1.5 py-0.5 rounded text-[9px] border border-destructive/30 text-destructive/80">
                        {f} missing
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex flex-wrap gap-1">
                  {d.fields.provenance.map(p => (
                    <span key={p.field} title={`${p.field}: ${p.provenance}`}
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] border border-border/50 bg-secondary/40 text-muted-foreground/75">
                      {p.field}
                      <span className="text-muted-foreground/45 uppercase text-[8px]">{p.provenance}</span>
                    </span>
                  ))}
                </div>
                <p className="text-[9px] text-muted-foreground/45 leading-relaxed">
                  Provenance is one muted treatment — the WORD carries the meaning. evidence-backed ·
                  scraped / derived · computed · estimated · model inference.
                </p>
                <div className="font-mono text-[10px] text-muted-foreground/55 tabular-nums">
                  {d.fields.counts.keywords} keywords · {d.fields.counts.contentThemes} themes ·{" "}
                  {d.fields.counts.hashtags} hashtags · {d.fields.counts.decodedSignals} decoded signals ·{" "}
                  {d.fields.counts.contentItems} content items · {d.fields.counts.transcripts} transcripts ·{" "}
                  {d.fields.counts.temporalBuckets} temporal buckets
                </div>
              </div>
            </Disclosure>

            {/* Persistence + scrape detail + evidence snapshot, verbatim. */}
            <Disclosure label="Full run diagnostics"
              summary={`${d.scrapes.total} scrapes · ${d.scrapes.failed} failed · persistence · evidence snapshot`}>
              <RunDiagnosticsView d={d} />
            </Disclosure>
          </div>
        )}
      </Section>

      {/* ══ 4 SUPPORT ════════════════════════════════════════════════════ */}
      <Section n={4} title="Support" blurb="the evidence underneath the findings" icon={Film}>
        <div className="space-y-0">
          <Disclosure label="Transcript excerpts" summary={`${transcripts.length} with transcript`} defaultOpen={transcripts.length > 0}>
            {transcripts.length > 0
              ? <TranscriptPanel profile={profile} />
              : <p className="text-[11px] text-muted-foreground/50 italic">No transcripts captured for this run.</p>}
          </Disclosure>

          <Disclosure label="Keywords & hashtags" summary={`${keywords.length} keywords · ${hashtags.length} hashtags`}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Hash className="w-3 h-3 text-muted-foreground/50" />
                  <span className="text-[9px] uppercase tracking-wide text-muted-foreground/45">Hashtags ({hashtags.length})</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {hashtags.map((t, i) => (
                    <span key={i} className="text-[10px] text-muted-foreground/70 bg-secondary/50 px-1.5 py-0.5 rounded border border-border/50">{t}</span>
                  ))}
                  {hashtags.length === 0 && <span className="text-[11px] text-muted-foreground/40 italic">none</span>}
                </div>
              </div>
              <div>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Tag className="w-3 h-3 text-muted-foreground/50" />
                  <span className="text-[9px] uppercase tracking-wide text-muted-foreground/45">Keywords ({keywords.length})</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {keywords.map((k, i) => (
                    <span key={i} className="text-[10px] text-muted-foreground/70 bg-secondary/50 px-1.5 py-0.5 rounded border border-border/50">{k}</span>
                  ))}
                  {keywords.length === 0 && <span className="text-[11px] text-muted-foreground/40 italic">none</span>}
                </div>
              </div>
            </div>
          </Disclosure>

          <Disclosure label="Sampled content" summary={`${videoTitles.length} post titles`}>
            <div className="space-y-1 max-h-72 overflow-y-auto">
              {videoTitles.map((t, i) => (
                <div key={i} className="flex items-start gap-2 text-[11px] text-muted-foreground/70">
                  <span className="text-muted-foreground/35 w-5 text-right flex-shrink-0 tabular-nums">{i + 1}.</span>
                  <span className="leading-relaxed">{t}</span>
                </div>
              ))}
              {videoTitles.length === 0 && <p className="text-[11px] text-muted-foreground/40 italic">No titles captured.</p>}
            </div>
          </Disclosure>

          <Disclosure label="Content items" summary={`${profile.discoveredVideoPoolJson?.length ?? 0} in the pool · full evidence table`}>
            <VideoEvidenceTable profile={profile} />
          </Disclosure>

          <Disclosure label="Add a supplemental video" summary="ingest one post by URL">
            <SupplementalVideoPanel profile={profile} />
          </Disclosure>
        </div>
      </Section>

      {/* ══ 5 COST AND PROCESS ═══════════════════════════════════════════ */}
      <Section n={5} title="Cost and process" blurb="how this report was produced" icon={Receipt}>
        <RunCostAndProcess runId={profile.runId} observationId={profile.observationId} />
      </Section>
    </div>
  );
}

function Metric({
  icon: Icon, label, value, suffix, tip,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string; value: unknown; suffix?: string; tip: string;
}) {
  const t = METRIC_TOOLTIPS[tip];
  const n = value == null ? null : Number(value);
  const shown = n == null || Number.isNaN(n)
    ? null
    : suffix === "%" ? `${n.toFixed(1)}%` : formatNum(n);
  return (
    <div>
      <div className="flex items-center gap-1 text-[9px] uppercase tracking-wide text-muted-foreground/40">
        <Icon className="w-2.5 h-2.5" />
        <span>{label}</span>
        {t && <MetricTooltip title={t.title} explanation={t.explanation} whyItMatters={t.whyItMatters} dataPoints={t.dataPoints} side="top" />}
      </div>
      <div className="text-sm font-semibold tabular-nums text-foreground/85 mt-0.5">
        {shown ?? <span className="text-muted-foreground/30 italic font-normal text-xs">unknown</span>}
      </div>
    </div>
  );
}

function TrustLine({
  label, value, detail, tone,
}: { label: string; value: string; detail?: string; tone: string }) {
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <span className="text-[9px] uppercase tracking-wide text-muted-foreground/45 w-[132px] flex-shrink-0">{label}</span>
        <Pill tone={tone}>{value}</Pill>
      </div>
      {detail && <p className="text-[10px] text-muted-foreground/55 mt-0.5 pl-[140px] leading-snug">{detail}</p>}
    </div>
  );
}
