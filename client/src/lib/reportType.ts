/**
 * THE REPORT TYPE SCALE (B2c).
 *
 * ─── Why this exists ────────────────────────────────────────────────────────
 * B2a/B2b took colour out as a signal — correctly, since hue was decorating
 * categorical values rather than encoding them. But nothing replaced it, and
 * the page had been leaning on colour to separate a heading from a label from a
 * value. What was left ran at essentially one size: a survey of the report
 * found 9px, 10px and 11px accounting for almost every string on the page, with
 * `text-sm` appearing twice in eight hundred lines.
 *
 * Quiet is not the same as small. Colour was removed as a signal, so SIZE,
 * WEIGHT and SPACING have to carry the hierarchy now. Nothing here is louder in
 * colour; things are clearer in structure.
 *
 * ─── The scale ──────────────────────────────────────────────────────────────
 * Six levels, each visibly distinct in size AND weight, so an analyst can tell
 * what KIND of thing they are reading without reading it:
 *
 *   TITLE     24px semibold      the subject's name — one per page
 *   SECTION   14px semibold caps the five section headings
 *   SUB       12px semibold caps subsection + disclosure labels
 *   BODY      14px regular       values, prose, transcript text — the reading size
 *   LABEL     13px regular muted the name of a thing whose value sits beside it
 *   DETAIL    12px regular muted explanatory and secondary lines
 *   MICRO     10px caps tracked  units and captions under figures ONLY
 *
 * The rule that keeps it honest: MICRO is for a caption under a number, never
 * for content. If a string is a sentence an analyst must read, it is DETAIL or
 * larger. Most of what was 10px on this page was content.
 *
 * Figures carry `tabular-nums` everywhere so columns of numbers line up.
 */

/** The subject's name. One per page. */
export const T_TITLE = "text-2xl font-semibold tracking-tight text-foreground";

/** The five section headings. */
export const T_SECTION = "text-sm font-semibold tracking-[0.14em] uppercase text-foreground/85";

/** Subsection headings and disclosure labels. */
export const T_SUB = "text-xs font-semibold tracking-[0.1em] uppercase text-muted-foreground";

/** The reading size: values, prose, transcript text. */
export const T_BODY = "text-sm text-foreground/85 leading-relaxed";

/** The name of a thing whose value sits beside it. */
export const T_LABEL = "text-[13px] text-muted-foreground";

/** Explanatory and secondary lines — still readable prose, deliberately. */
export const T_DETAIL = "text-xs text-muted-foreground/75 leading-relaxed";

/** Units and captions under figures. NEVER for content. */
export const T_MICRO = "text-[10px] uppercase tracking-[0.08em] text-muted-foreground/50";

/** A figure. Always tabular so columns align. */
export const T_FIGURE = "text-lg font-semibold tabular-nums text-foreground";

/** A smaller figure, for dense grids. */
export const T_FIGURE_SM = "text-base font-semibold tabular-nums text-foreground/90";

/** Monospaced data — ids, tokens, timings. */
export const T_MONO = "font-mono tabular-nums text-xs text-muted-foreground/75";

/**
 * A bordered container for a group of related facts. Replaces free-floating
 * text where a set of figures needs to read as one object rather than as
 * sentences that happen to contain numbers.
 */
export const BOX = "rounded-lg border border-border/50 bg-secondary/25";
