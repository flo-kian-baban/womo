/**
 * PROJECTED VERSUS RECEIVED — how much of a brand profile is the brand
 * describing itself, and how much is the audience describing it.
 *
 * ─── Why this exists ────────────────────────────────────────────────────────
 * Brand evidence has two faces and they are not interchangeable. The website
 * crawl, the brand's own channel posts and its taglines are the brand SPEAKING;
 * reviews and mentions are the audience ANSWERING. The pipeline has always
 * known the difference — the assembled evidence literally carries the headings
 * "BRAND-AUTHORED TEXT" and "WHAT CUSTOMERS ACTUALLY SAY" — but the report
 * rendered both as undifferentiated blocks, so an analyst could not see that a
 * profile was built almost entirely from a brand's own marketing copy.
 *
 * ─── What this is NOT ───────────────────────────────────────────────────────
 * PRESENTATION ONLY. Nothing here reweights anything, changes what the model
 * reads, or computes a new measure. It groups fields the pipeline already
 * labelled and prints the counts that were already stored.
 *
 * ─── Two rules that keep it honest ──────────────────────────────────────────
 * 1. THE RAW COUNTS ARE PRINTED BESIDE THE RATIO. A bare "1.26:1" reads as a
 *    score — as though the balance had been assessed. It has not: it is a
 *    proportion of two counts, and showing "2,411 words · 5 pages" against
 *    "40 reviews · 0 mentions" states what is actually being counted, so the
 *    reader can disagree with the framing rather than trust a number.
 * 2. AN ABSENT SIDE READS AS ABSENT. A zero-width segment leaves a full-looking
 *    bar and reads as "all projected" when the truth is "nothing was received".
 *    An empty side renders as a labelled `none` instead.
 */
import { T_MICRO, T_DETAIL } from "@/lib/reportType";

type Brand = Record<string, any>;

export interface EvidenceSide {
  /** Units of this side's evidence, for the bar's proportion. */
  weight: number;
  /** What was actually counted, printed verbatim beside the bar. */
  parts: string[];
}

/**
 * PROJECTED — the brand's own words: the website crawl and the copy derived
 * from it, plus the brand's own channel presence.
 *
 * The bar's proportion uses WORDS of brand copy, because that is what the
 * model actually reads, and it is the only projected quantity stored as a
 * magnitude rather than a flag.
 */
export function projectedSide(p: Brand): EvidenceSide {
  const words = Number(p.semanticWordCount ?? 0);
  const pages = Number(p.crawledPagesCount ?? 0);
  const parts: string[] = [];
  if (words > 0) parts.push(`${words.toLocaleString()} words`);
  if (pages > 0) parts.push(`${pages} page${pages === 1 ? "" : "s"}`);
  const channels: string[] = [];
  if (p.tiktokChannelUrl) channels.push("TikTok");
  if (p.instagramHandle) channels.push("Instagram");
  if (channels.length) parts.push(`${channels.join(" + ")} channel`);
  return { weight: words, parts };
}

/**
 * RECEIVED — what the audience said: reviews and mentions.
 *
 * Weighted by reviews + mentions, each being one authored utterance about the
 * brand. Deliberately NOT weighted by word count: a review and a page of
 * marketing copy are not comparable units, and pretending they are is how a
 * long About page would drown out forty customers.
 */
export function receivedSide(p: Brand): EvidenceSide {
  /**
   * WEIGHTED BY REVIEWS INGESTED, NOT FOUND (brand audit, 2026-07-29).
   *
   * `totalReviews` is the place's headline count; the pipeline holds a
   * handful of excerpts. autorama read "86% received" from 3,248 — on NINE
   * review texts. The bar is a claim about how much evidence exists, so it
   * has to count evidence that exists. `reviewsIngested` is what was actually
   * ingested; the headline is still PRINTED beside it (rule 1 above), because
   * "9 of 3,248 reviews" is the honest sentence and neither number alone is.
   *
   * Falls back to the headline only when a profile predates the ingested
   * count, where the old reading is still the best available.
   */
  const found = Number(p.totalReviews ?? 0);
  const ingested = p.reviewsIngested == null ? null : Number(p.reviewsIngested);
  const reviews = ingested ?? found;
  const mentions = Number(p.mentionTotalCount ?? 0);
  const authors = Number(p.mentionUniqueAuthors ?? 0);
  const parts: string[] = [];
  if (reviews > 0) {
    parts.push(ingested != null && found > ingested
      ? `${ingested.toLocaleString()} of ${found.toLocaleString()} reviews`
      : `${reviews.toLocaleString()} review${reviews === 1 ? "" : "s"}`);
  }
  if (mentions > 0) {
    parts.push(`${mentions.toLocaleString()} mention${mentions === 1 ? "" : "s"}`
      + (authors > 0 ? ` from ${authors} author${authors === 1 ? "" : "s"}` : ""));
  }
  return { weight: reviews + mentions, parts };
}

/**
 * The strip. Glanceable, no interaction, and readable without opening
 * anything — which is the requirement it exists to meet.
 */
export function EvidenceBalance({ profile, compact = false }: { profile: Brand; compact?: boolean }) {
  const projected = projectedSide(profile);
  const received = receivedSide(profile);

  const hasP = projected.parts.length > 0;
  const hasR = received.parts.length > 0;

  // Proportion for the bar. When one side is empty the other takes the full
  // width — but the empty side still renders its `none`, so the bar is never
  // mistaken for a balanced one.
  const total = projected.weight + received.weight;
  const pPct = total > 0 ? Math.round((projected.weight / total) * 100) : 50;

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className={T_MICRO}>Evidence balance</span>
        <span className={`${T_DETAIL} tabular-nums`}>
          {/* States WHAT IS COUNTED — never a bare ratio, which would read as
              an assessed score rather than a proportion of two tallies. */}
          {hasP && hasR
            ? `${pPct}% brand-authored · ${100 - pPct}% audience`
            : hasP
              ? "brand-authored only — no audience evidence"
              : hasR
                ? "audience only — no brand copy captured"
                : "no evidence captured"}
        </span>
      </div>

      {/* The bar. One border around both segments — the nesting rule: a
          container inside a container insets, it does not repeat the border. */}
      <div className="flex h-1.5 rounded-full overflow-hidden border border-border/50 bg-secondary/30">
        {hasP && <div className="bg-foreground/45" style={{ width: hasR ? `${pPct}%` : "100%" }} />}
        {hasR && <div className="bg-foreground/25" style={{ width: hasP ? `${100 - pPct}%` : "100%" }} />}
      </div>

      <div className={`grid ${compact ? "grid-cols-1 gap-1" : "grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1"}`}>
        <Side label="Projected" sublabel="the brand describing itself" side={projected} dot="bg-foreground/45" />
        <Side label="Received" sublabel="the audience describing it" side={received} dot="bg-foreground/25" />
      </div>

      {/*
        THE UNITS, SAID OUT LOUD. The two sides are counted differently — words
        of copy on one, authored utterances on the other — because those are the
        only magnitudes the pipeline stores for each. A percentage across two
        units is indicative, not a measurement, and a strip that shows one
        without saying so is presenting a score.
      */}
      {hasP && hasR && (
        <p className={T_DETAIL}>
          Counted in different units — words of brand copy against authored utterances about the
          brand. The split is indicative; the figures beside each side are the measurement.
        </p>
      )}
    </div>
  );
}

function Side({
  label, sublabel, side, dot,
}: { label: string; sublabel: string; side: EvidenceSide; dot: string }) {
  const empty = side.parts.length === 0;
  return (
    <div className="flex items-baseline gap-2">
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 translate-y-[-1px] ${empty ? "bg-muted-foreground/25" : dot}`} />
      <span className="text-xs font-medium text-foreground/80 w-[74px] flex-shrink-0">{label}</span>
      <span className={`${T_DETAIL} tabular-nums min-w-0`}>
        {/* `none`, never a silent gap — an absent side must read as absent. */}
        {empty
          ? <span className="italic text-muted-foreground/50">none — {sublabel} is missing</span>
          : side.parts.join(" · ")}
      </span>
    </div>
  );
}
