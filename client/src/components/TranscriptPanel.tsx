/**
 * TranscriptPanel
 *
 * Renders two sections:
 *   1. Transcript Excerpts — collapsible entries with inline entity/claim highlighting
 *   2. Decoded Cultural Signals — structured anthropological signals from the Symbol Decoder
 *
 * All transcript highlighting is done client-side from profile fields (no extra API calls).
 * Decoded signals come from the server-side Symbol Decoder stored in profile.decodedSymbols.
 */

import { useMemo, useState } from "react";
import {
  Mic, ChevronDown, ChevronUp, MapPin, Utensils, Sparkles, User,
  Fingerprint, TrendingUp, Users, Heart, BookOpen,
} from "lucide-react";

// Flattened creator profile as returned by getCreatorProfileById in db.ts.
type CreatorProfile = Record<string, any> & { id: string };

// ─── Decoded Symbols Types ────────────────────────────────────────────────────

interface DecodedSignal {
  phrase: string;
  meaning: string;
  informs: string[];
}

interface DecodedSymbols {
  identityClaims: DecodedSignal[];
  statusSignals: DecodedSignal[];
  communityReferences: DecodedSignal[];
  aspirationDrivers: DecodedSignal[];
  symbolicSummary: string;
}

// ─── Transcript Highlight Types ───────────────────────────────────────────────

type HighlightType = "place" | "entity" | "claim" | "person";

interface Segment {
  text: string;
  type: HighlightType | null;
  tooltip?: string;
}

interface TranscriptEntry {
  label: string;
  text: string;
  segments: Segment[];
  // Session 9 (B2): what this evidence actually IS — the creator's speech
  // (subtitle/audio) or their written post caption. Set from the read model.
  sourceKind?: "speech" | "caption";
  sourceLabel?: string;
}

// ─── Highlight Config ─────────────────────────────────────────────────────────

/**
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║ THESE FOUR HUES STAY. Do not "fix" them in a later colour pass.           ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 * Everywhere else on these pages, categorical values render neutral because the
 * hue carried nothing the label did not. Here it is the reverse: hue IS the
 * encoding. Four entity kinds are marked INSIDE a running paragraph, where
 * there is no room for a label beside each mark, and the legend sits directly
 * above the text that uses it. Neutralising these would delete the distinction
 * rather than relocate it — the one legitimate categorical use of colour on
 * this surface.
 *
 * What did change (B2b): filled chips became underline-with-tint. A paragraph
 * carrying eight filled marks read as a ransom note; an underline marks the
 * span without stopping the prose.
 *
 * ─── `bg-transparent` is LOAD-BEARING (B2c) ─────────────────────────────────
 * These spans render in a <mark>, and the UA stylesheet gives <mark> a yellow
 * background with black text. Tailwind's preflight does not reset it. So B2b's
 * underline-with-tint shipped as pale tinted text sitting on browser yellow —
 * the mark obscured the word instead of indicating it, and every highlighted
 * entity was unreadable. The tint and the underline are the whole treatment;
 * the background must stay out of the way. Do not drop this class.
 */
const HIGHLIGHT_STYLES: Record<HighlightType, string> = {
  place:  "bg-transparent text-amber-200 decoration-amber-400/70 underline decoration-2 underline-offset-2",
  entity: "bg-transparent text-teal-200 decoration-teal-400/70 underline decoration-2 underline-offset-2",
  claim:  "bg-transparent text-violet-200 decoration-violet-400/70 underline decoration-2 underline-offset-2",
  person: "bg-transparent text-sky-200 decoration-sky-400/70 underline decoration-2 underline-offset-2",
};

/** The same four hues as swatches, for the legend and the entity chips. */
const HIGHLIGHT_SWATCH: Record<HighlightType, string> = {
  place:  "bg-amber-400/70",
  entity: "bg-teal-400/70",
  claim:  "bg-violet-400/70",
  person: "bg-sky-400/70",
};

const LEGEND_ITEMS: { type: HighlightType; label: string; icon: React.ElementType }[] = [
  { type: "place",  label: "Place / Venue",    icon: MapPin    },
  { type: "entity", label: "Food / Product",   icon: Utensils  },
  { type: "claim",  label: "Cultural Claim",   icon: Sparkles  },
  { type: "person", label: "Person / Name",    icon: User      },
];

// ─── Signal Category Config ───────────────────────────────────────────────────

/**
 * The four signal kinds.
 *
 * ─── B2b: no per-category colour ────────────────────────────────────────────
 * These were tinted rose / amber / sky / violet across text, chip, border and
 * background. They are KINDS of signal — an aspiration driver is not better or
 * worse than a status signal — so the hue encoded nothing and spent the warning
 * palette on category. The amber group sat next to genuine warnings and read
 * like one. The label and the sublabel carry the meaning; the sublabel is the
 * part that matters, because it names which analysed fields the group informs.
 */
const SIGNAL_CATEGORIES: {
  key: keyof Omit<DecodedSymbols, "symbolicSummary">;
  label: string;
  sublabel: string;
  icon: React.ElementType;
}[] = [
  { key: "identityClaims",      label: "Identity claims",      sublabel: "informs Archetype · NicheTopicNode",            icon: Fingerprint },
  { key: "statusSignals",       label: "Status signals",       sublabel: "informs CulturalCapital · RogersAdoptionStage", icon: TrendingUp },
  { key: "communityReferences", label: "Community references", sublabel: "informs ParasocialBond · AudienceRelationshipType", icon: Users },
  { key: "aspirationDrivers",   label: "Aspiration drivers",   sublabel: "informs BarthesMyth · StuartHallDecoding",      icon: Heart },
];

// ─── Known entity lists ───────────────────────────────────────────────────────

const KNOWN_CITIES = [
  "Toronto", "New York", "NYC", "Los Angeles", "LA", "London", "Dubai",
  "Paris", "Chicago", "Miami", "Houston", "Atlanta", "Montreal", "Vancouver",
  "Sydney", "Melbourne", "Calgary", "Ottawa", "Edmonton", "Winnipeg",
  "Brooklyn", "Nashville", "Austin", "Seattle", "Denver", "Boston",
  "Philadelphia", "Dallas", "San Francisco", "SF", "Washington",
  "Mississauga", "Scarborough", "Brampton", "Etobicoke", "Markham",
  "Richmond Hill", "Vaughan", "Oakville", "Burlington", "Hamilton",
  "Dundas Square", "Kensington Market", "Chinatown", "Little Italy",
  "Little Portugal", "Distillery District", "Queen West",
];

const KNOWN_FOOD_ENTITIES = [
  "shawarma", "pho", "ramen", "sushi", "tacos", "burrito", "pizza", "burger",
  "banh mi", "dumplings", "dim sum", "biryani", "curry", "kebab", "falafel",
  "hummus", "pasta", "risotto", "steak", "chicken", "salmon", "tuna",
  "mukbang", "halal", "vegan", "gluten-free", "keto", "brunch", "brunch spot",
  "food court", "food truck", "street food", "fine dining", "omakase",
  "matcha", "boba", "bubble tea", "espresso", "latte", "croissant",
  "fried chicken", "hot pot", "Korean BBQ", "KBBQ", "beef bacon",
];

// ─── Core highlighting engine ─────────────────────────────────────────────────

function buildEntityMap(profile: CreatorProfile): {
  places: string[];
  entities: string[];
  claims: string[];
  persons: string[];
} {
  const themes = (profile.contentThemeLabels as string[] | null) ?? [];
  const keywords = (profile.rawKeywords as string[] | null) ?? [];
  const recurringThemes = (profile.recurringThemes as string[] | null) ?? [];

  const places = [...KNOWN_CITIES];
  if (profile.location) places.push(profile.location);

  const stopwords = new Set(["this", "that", "with", "from", "have", "been", "they", "their",
    "what", "when", "where", "which", "will", "your", "just", "like", "more", "also",
    "then", "than", "some", "into", "over", "after", "before", "about", "would", "could",
    "should", "there", "these", "those", "here", "very", "much", "many", "most", "only",
    "even", "back", "good", "great", "best", "really", "actually", "basically"]);

  const entities: string[] = [...KNOWN_FOOD_ENTITIES];
  for (const kw of keywords) {
    if (kw.length >= 4 && !stopwords.has(kw.toLowerCase()) && !entities.includes(kw.toLowerCase())) {
      entities.push(kw);
    }
  }

  const claims: string[] = [];
  if (profile.nicheTopicNode) {
    (profile.nicheTopicNode as string).split(/[\s,/]+/).forEach((w: string) => {
      if (w.length >= 4 && !stopwords.has(w.toLowerCase())) claims.push(w);
    });
  }
  for (const t of [...themes, ...recurringThemes]) {
    t.split(/[\s,/]+/).forEach(w => {
      if (w.length >= 4 && !stopwords.has(w.toLowerCase())) claims.push(w);
    });
  }
  if (profile.barthesMyth) {
    const mythWords = (profile.barthesMyth as string).split(/\s+/).filter((w: string) => w.length >= 5 && !stopwords.has(w.toLowerCase()));
    claims.push(...mythWords.slice(0, 6));
  }

  const persons: string[] = [];
  if (profile.displayName) {
    const nameParts = (profile.displayName as string).split(/\s+/).filter((p: string) => p.length >= 3 && /^[A-Z]/.test(p));
    persons.push(...nameParts);
  }

  return {
    places: Array.from(new Set(places)),
    entities: Array.from(new Set(entities)),
    claims: Array.from(new Set(claims)),
    persons: Array.from(new Set(persons)),
  };
}

function tokenize(text: string, entityMap: ReturnType<typeof buildEntityMap>): Segment[] {
  interface Match { start: number; end: number; type: HighlightType; tooltip: string }
  const matches: Match[] = [];

  const addMatches = (terms: string[], type: HighlightType, tooltipPrefix: string) => {
    for (const term of terms) {
      if (!term || term.length < 3) continue;
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`\\b${escaped}\\b`, "gi");
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        matches.push({ start: m.index, end: m.index + m[0].length, type, tooltip: `${tooltipPrefix}: ${term}` });
      }
    }
  };

  addMatches(entityMap.places,   "place",  "Location");
  addMatches(entityMap.persons,  "person", "Person");
  addMatches(entityMap.entities, "entity", "Food/Product");
  addMatches(entityMap.claims,   "claim",  "Cultural signal");

  if (matches.length === 0) return [{ text, type: null }];

  const PRIORITY: Record<HighlightType, number> = { place: 0, person: 1, entity: 2, claim: 3 };
  matches.sort((a, b) => a.start - b.start || PRIORITY[a.type] - PRIORITY[b.type]);

  const resolved: Match[] = [];
  let cursor = 0;
  for (const m of matches) {
    if (m.start >= cursor) { resolved.push(m); cursor = m.end; }
  }

  const segments: Segment[] = [];
  let pos = 0;
  for (const m of resolved) {
    if (m.start > pos) segments.push({ text: text.slice(pos, m.start), type: null });
    segments.push({ text: text.slice(m.start, m.end), type: m.type, tooltip: m.tooltip });
    pos = m.end;
  }
  if (pos < text.length) segments.push({ text: text.slice(pos), type: null });
  return segments;
}

function parseExcerpts(raw: string, profile: CreatorProfile): TranscriptEntry[] {
  const entityMap = buildEntityMap(profile);
  const blocks = raw.split("\n\n").filter(Boolean);
  return blocks.map((block, i) => {
    const colonIdx = block.indexOf("]: ");
    const label = colonIdx > 0 ? block.slice(1, colonIdx) : `Video ${i + 1}`;
    const text = colonIdx > 0 ? block.slice(colonIdx + 3) : block;
    return { label, text, segments: tokenize(text, entityMap) };
  });
}

// ─── Segment renderer ─────────────────────────────────────────────────────────

function HighlightedText({ segments }: { segments: Segment[] }) {
  return (
    <span>
      {segments.map((seg, i) =>
        seg.type ? (
          <mark key={i} title={seg.tooltip} className={`cursor-help not-italic ${HIGHLIGHT_STYLES[seg.type]}`}>
            {seg.text}
          </mark>
        ) : (
          <span key={i}>{seg.text}</span>
        )
      )}
    </span>
  );
}

// ─── Decoded Signals Panel ────────────────────────────────────────────────────

/**
 * DECODED CULTURAL SIGNALS (rebuilt, B2b).
 *
 * ─── Density: groups collapse, signals open as a SET ────────────────────────
 * All four groups are collapsed by default and each states its own count and
 * what it informs. Opening a group reveals every signal in it at once —
 * deliberately NOT one claim at a time. A decoded signal is two short lines,
 * and their value is comparative: you read Identity Claims as a set to judge
 * whether the archetype reading is earned. Collapsing each would add fourteen
 * clicks to reach what one scroll shows, and hide the very thing being judged.
 *
 * (The transcript panel below answers the same question the OTHER way, and the
 * asymmetry is the point: an entry there is a paragraph read selectively, not a
 * line read comparatively. Collapse at the unit the analyst chooses between.)
 *
 * The previous default opened identityClaims and statusSignals and left the
 * other two shut, which silently privileged them. A uniform collapsed state
 * with counts is both shorter and honest.
 */
export function DecodedSignalsPanel({ decoded }: { decoded: DecodedSymbols }) {
  const totalSignals =
    decoded.identityClaims.length +
    decoded.statusSignals.length +
    decoded.communityReferences.length +
    decoded.aspirationDrivers.length;

  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const toggle = (key: string) => setOpen(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  return (
    <div className="mt-4">
      <div className="flex items-baseline gap-2 mb-2">
        <BookOpen className="w-3 h-3 text-muted-foreground/50 self-center" />
        <span className="text-[10px] font-semibold tracking-[0.12em] uppercase text-muted-foreground">
          Decoded cultural signals
        </span>
        <span className="text-[10px] text-muted-foreground/45 tabular-nums">
          {totalSignals} decoded
        </span>
      </div>

      {decoded.symbolicSummary && (
        <p className="text-[11px] text-muted-foreground/75 leading-relaxed italic mb-2 max-w-3xl">
          “{decoded.symbolicSummary}”
        </p>
      )}

      <div>
        {SIGNAL_CATEGORIES.map(({ key, label, sublabel, icon: Icon }) => {
          const signals = decoded[key] as DecodedSignal[];
          if (signals.length === 0) return null;
          const isOpen = open.has(key);
          return (
            <div key={key} className="border-t border-border/25 first:border-0">
              <button
                onClick={() => toggle(key)}
                className="w-full flex items-center gap-2 py-2 text-left"
              >
                <Icon className="w-3 h-3 text-muted-foreground/45 flex-shrink-0" />
                <span className="text-[11px] text-foreground/80">{label}</span>
                <span className="text-[10px] text-muted-foreground/45 tabular-nums">{signals.length}</span>
                {/* What this group FEEDS — the reason the grouping exists. */}
                <span className="text-[10px] text-muted-foreground/35 hidden sm:inline truncate">{sublabel}</span>
                {isOpen
                  ? <ChevronUp className="w-3 h-3 text-muted-foreground/40 ml-auto flex-shrink-0" />
                  : <ChevronDown className="w-3 h-3 text-muted-foreground/40 ml-auto flex-shrink-0" />}
              </button>

              {isOpen && (
                <div className="pb-2.5 space-y-1.5">
                  {signals.map((signal, i) => (
                    <div key={i} className="pl-5 text-[11px]">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="text-foreground/85">“{signal.phrase}”</span>
                        {signal.informs.length > 0 && (
                          <span className="ml-auto flex flex-wrap gap-1 flex-shrink-0">
                            {signal.informs.map((field, j) => (
                              <span key={j} className="text-[9px] font-mono px-1 py-0.5 rounded border border-border/50 bg-secondary/40 text-muted-foreground/60">
                                {field}
                              </span>
                            ))}
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-muted-foreground/65 leading-relaxed mt-0.5">
                        {signal.meaning}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface TranscriptPanelProps {
  profile: CreatorProfile;
  /**
   * B2b: the report renders decoded signals in section 2 (detailed analysis),
   * where they belong — they are a FINDING, not transcript evidence. This
   * suppresses the copy that would otherwise render again beneath the
   * transcripts. CreatorProfileCard (MatchReport's compact view) omits the prop
   * and keeps both, exactly as before.
   */
  showDecoded?: boolean;
}

export default function TranscriptPanel({ profile, showDecoded = true }: TranscriptPanelProps) {
  const transcriptCount = profile.transcriptCount ?? 0;
  const transcriptExcerpts = profile.transcriptExcerpts;

  const entries = useMemo(() => {
    if (!transcriptExcerpts) return [];
    // New format: array of objects from content_items
    if (Array.isArray(transcriptExcerpts)) {
      const entityMap = buildEntityMap(profile);
      return (transcriptExcerpts as Array<{ videoId?: string; caption?: string; transcriptText: string; sourceKind?: "speech" | "caption"; sourceLabel?: string }>)
        .filter(t => t.transcriptText)
        .map((t, i) => {
          const label = t.caption
            ? (t.caption.length > 50 ? t.caption.slice(0, 50) + "…" : t.caption)
            : `Video ${i + 1}`;
          return { label, text: t.transcriptText, segments: tokenize(t.transcriptText, entityMap), sourceKind: t.sourceKind, sourceLabel: t.sourceLabel };
        });
    }
    // Legacy format: concatenated string
    if (typeof transcriptExcerpts === "string") {
      return parseExcerpts(transcriptExcerpts, profile);
    }
    return [];
  }, [transcriptExcerpts, profile]);

  const decodedSymbols = useMemo((): DecodedSymbols | null => {
    const raw = profile.decodedSymbols as DecodedSymbols | null;
    if (!raw || typeof raw !== "object") return null;
    if (!Array.isArray(raw.identityClaims)) return null;
    return raw;
  }, [profile.decodedSymbols]);

  const [expanded, setExpanded] = useState<Set<number>>(() => new Set([0]));

  const toggleEntry = (i: number) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  };

  if (entries.length === 0 && !decodedSymbols) return null;

  const totalHighlights = entries.reduce((acc, e) => acc + e.segments.filter(s => s.type !== null).length, 0);
  // Session 9 (B2): only call it "spoken content / primary evidence" when at
  // least one entry is actually speech (subtitle/audio). A post caption is not.
  const hasSpeech = entries.some(e => e.sourceKind === "speech");

  return (
    <div className="space-y-0">
      {/* ── Transcript evidence ──────────────────────────────────────────────
          Panel shell, header and chevrons are NEUTRAL (B2b). The emerald
          wrapper made "we captured transcripts" look like a success state; the
          transcripts are the evidence, and whether they are trustworthy is what
          the source chip says. */}
      {entries.length > 0 && (
        <div>
          <div className="flex items-baseline gap-2 mb-1.5">
            <Mic className="w-3 h-3 text-muted-foreground/50 self-center" />
            <span className="text-[10px] font-semibold tracking-[0.12em] uppercase text-muted-foreground">
              Transcript evidence
            </span>
            <span className="text-[10px] text-muted-foreground/45 tabular-nums">
              {transcriptCount} video{transcriptCount !== 1 ? "s" : ""} · {totalHighlights} entities
            </span>
            {/*
              ORDINAL, and the most important trust signal on the page: did the
              model read SPEECH or typed text? It keeps a treatment — but not
              amber, which means warning here. A fact about evidence quality
              must not read as an error.
            */}
            {!hasSpeech && (
              <span
                title="Every excerpt below is a post caption — written text, not transcribed speech"
                className="text-[10px] px-1.5 py-0.5 rounded-full border border-border/60 bg-secondary/50 text-foreground/70"
              >
                captions only · no speech
              </span>
            )}
          </div>

          {/* Legend — sits directly above the marks it explains. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-2">
            {LEGEND_ITEMS.map(({ type, label, icon: Icon }) => (
              <div key={type} className="flex items-center gap-1">
                <span className={`w-2 h-0.5 rounded-full ${HIGHLIGHT_SWATCH[type]}`} />
                <Icon className="w-2.5 h-2.5 text-muted-foreground/40" />
                <span className="text-[9px] text-muted-foreground/50">{label}</span>
              </div>
            ))}
          </div>

          {/* Entries — collapsed individually, because an entry is a PARAGRAPH
              read selectively, not a line read comparatively (see the decoded
              panel, which collapses the other way and says why). */}
          <div>
            {entries.map((entry, i) => {
              const isOpen = expanded.has(i);
              const highlightCount = entry.segments.filter(s => s.type !== null).length;
              // The collapsed row must be identifiable WITHOUT opening it —
              // "Video 3" told the analyst nothing about what it contains.
              const preview = entry.text.replace(/\s+/g, " ").trim().slice(0, 90);
              return (
                <div key={i} className="border-t border-border/25 first:border-0">
                  <button
                    onClick={() => toggleEntry(i)}
                    className="w-full flex items-start gap-2 py-2 text-left"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[11px] text-foreground/80">{entry.label}</span>
                        {entry.sourceLabel && (
                          <span
                            title={entry.sourceKind === "speech"
                              ? "Transcribed speech — the creator's own words"
                              : "The post's written caption — not spoken content"}
                            className={`text-[9px] px-1.5 py-0.5 rounded-full border cursor-help ${
                              entry.sourceKind === "speech"
                                ? "border-border/60 bg-secondary/50 text-foreground/70"
                                : "border-border/60 bg-secondary/30 text-muted-foreground/70"
                            }`}
                          >
                            {entry.sourceLabel}{entry.sourceKind === "caption" ? " · not speech" : ""}
                          </span>
                        )}
                        {highlightCount > 0 && (
                          <span className="flex items-center gap-1">
                            {(["place", "entity", "claim", "person"] as HighlightType[]).map(type => {
                              const count = entry.segments.filter(s => s.type === type).length;
                              if (count === 0) return null;
                              return (
                                <span key={type} className="inline-flex items-center gap-0.5 text-[9px] text-muted-foreground/60 tabular-nums">
                                  <span className={`w-1.5 h-1.5 rounded-full ${HIGHLIGHT_SWATCH[type]}`} />
                                  {count}
                                </span>
                              );
                            })}
                          </span>
                        )}
                      </div>
                      {!isOpen && preview && (
                        <p className="text-[10px] text-muted-foreground/50 mt-0.5 truncate">{preview}…</p>
                      )}
                    </div>
                    {isOpen
                      ? <ChevronUp className="w-3 h-3 text-muted-foreground/40 flex-shrink-0 mt-1" />
                      : <ChevronDown className="w-3 h-3 text-muted-foreground/40 flex-shrink-0 mt-1" />}
                  </button>

                  {isOpen && (
                    <div className="pb-3 pl-0">
                      <p className="text-[11px] text-muted-foreground/85 leading-relaxed italic">
                        “<HighlightedText segments={entry.segments} />”
                      </p>
                      {highlightCount > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {entry.segments
                            .filter(s => s.type !== null)
                            .reduce<Segment[]>((acc, s) => {
                              if (!acc.some(a => a.text.toLowerCase() === s.text.toLowerCase() && a.type === s.type)) acc.push(s);
                              return acc;
                            }, [])
                            .map((s, j) => (
                              <span
                                key={j}
                                title={s.tooltip}
                                className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border border-border/50 bg-secondary/40 text-muted-foreground/80 cursor-help"
                              >
                                <span className={`w-1.5 h-1.5 rounded-full ${HIGHLIGHT_SWATCH[s.type!]}`} />
                                {s.text}
                              </span>
                            ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Decoded Cultural Signals Panel ────────────────────────────────── */}
      {showDecoded && decodedSymbols && <DecodedSignalsPanel decoded={decodedSymbols} />}
    </div>
  );
}
