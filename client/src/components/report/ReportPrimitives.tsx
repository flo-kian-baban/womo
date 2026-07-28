/**
 * THE REPORT PRIMITIVES — one shared home (M3).
 *
 * Section / Disclosure / Note / Pill were defined locally in CreatorReport
 * (B2a–B2d) and copied into BrandReport (B3). The match report is the third
 * surface that needs them, and a third copy is how PROVENANCE_STYLES ended up
 * with two treatments of the same data for three sessions. These are the
 * B2c/B2d definitions, verbatim in behavior; CreatorReport and BrandReport
 * still carry their local copies — migrating them here is a logged follow-up,
 * not a silent rewrite of two verified surfaces.
 */
import { useState } from "react";
import { ChevronDown, ChevronUp, AlertTriangle, Info } from "lucide-react";
import {
  T_SECTION, T_SUB, T_DETAIL,
  PANEL, PANEL_OPEN, PANEL_HEAD, PANEL_BODY, EASE_EXPO,
} from "@/lib/reportType";

/**
 * One numbered section. Separated by heading, spacing and rule — never by a
 * background tint (the old match surfaces were a stack of glowing cards).
 */
export function Section({
  n, title, blurb, icon: Icon, children,
}: {
  n: number; title: string; blurb: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <section className="pt-7 first:pt-0 border-t border-border/40 first:border-0">
      <div className="flex items-baseline gap-2.5 mb-4">
        <span className="text-xs font-mono tabular-nums text-muted-foreground/40">{n}</span>
        <Icon className="w-3.5 h-3.5 text-muted-foreground/50 self-center" />
        <h2 className={T_SECTION}>{title}</h2>
        <span className={`${T_DETAIL} hidden sm:inline`}>{blurb}</span>
      </div>
      {children}
    </section>
  );
}

/** A disclosure whose collapsed state always says what it holds (B2d panel). */
export function Disclosure({
  label, summary, children, defaultOpen = false,
}: { label: string; summary: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`${open ? PANEL_OPEN : PANEL} ${EASE_EXPO} overflow-hidden`}>
      <button onClick={() => setOpen(v => !v)} className={PANEL_HEAD}>
        <span className={T_SUB}>{label}</span>
        <span className={`${T_DETAIL} tabular-nums`}>{summary}</span>
        {open ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground/50 ml-auto" />
              : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/50 ml-auto" />}
      </button>
      {open && <div className={PANEL_BODY}>{children}</div>}
    </div>
  );
}

/**
 * One qualifying line, typed by what it asks of the reader (B2c):
 *   WARNING  something is wrong and wants a decision — keeps amber
 *   CAVEAT   a number on this page means less than it appears — neutral rule
 *   CONTEXT  a fact about how the thing was assembled — quiet prose
 */
export function Note({ kind, children }: { kind: "warning" | "caveat" | "context"; children: React.ReactNode }) {
  if (kind === "context") return <p className={`${T_DETAIL} pl-3`}>{children}</p>;
  const warn = kind === "warning";
  return (
    <div className={`flex items-start gap-2.5 pl-3 border-l-2 ${warn ? "border-amber-400/60" : "border-border/60"}`}>
      {warn
        ? <AlertTriangle className="w-3.5 h-3.5 text-amber-400/90 flex-shrink-0 mt-0.5" />
        : <Info className="w-3.5 h-3.5 text-muted-foreground/50 flex-shrink-0 mt-0.5" />}
      <p className={`text-xs leading-relaxed ${warn ? "text-amber-400/90 font-medium" : "text-foreground/70"}`}>
        {children}
      </p>
    </div>
  );
}

export function Pill({ tone, children, title }: { tone: string; children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex w-fit items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] font-medium ${tone}`}>
      {children}
    </span>
  );
}

// ─── The ordinal tones (B-series values, one definition) ─────────────────────

export const TONE_NEUTRAL = "text-foreground/75 border-border/60 bg-secondary/50";
export const TONE_AMBER = "text-amber-400 border-amber-400/35 bg-amber-400/10";
export const TONE_RED = "text-red-400 border-red-400/35 bg-red-400/10";

export const CONFIDENCE_TONE: Record<string, string> = {
  high: TONE_NEUTRAL,
  medium: TONE_AMBER,
  low: TONE_RED,
};

/** The verdict is ordinal: quiet end neutral, decision end coloured. */
export const VERDICT_TONE: Record<string, string> = {
  "Green Light": TONE_NEUTRAL,
  "Proceed with Caution": TONE_AMBER,
  "Do Not Proceed": TONE_RED,
};
