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
}

// ─── Highlight Config ─────────────────────────────────────────────────────────

const HIGHLIGHT_STYLES: Record<HighlightType, string> = {
  place:  "bg-amber-500/15 text-amber-300 border border-amber-500/30 rounded px-0.5",
  entity: "bg-teal-500/15 text-teal-300 border border-teal-500/30 rounded px-0.5",
  claim:  "bg-violet-500/15 text-violet-300 border border-violet-500/30 rounded px-0.5",
  person: "bg-sky-500/15 text-sky-300 border border-sky-500/30 rounded px-0.5",
};

const LEGEND_ITEMS: { type: HighlightType; label: string; icon: React.ElementType }[] = [
  { type: "place",  label: "Place / Venue",    icon: MapPin    },
  { type: "entity", label: "Food / Product",   icon: Utensils  },
  { type: "claim",  label: "Cultural Claim",   icon: Sparkles  },
  { type: "person", label: "Person / Name",    icon: User      },
];

// ─── Signal Category Config ───────────────────────────────────────────────────

const SIGNAL_CATEGORIES: {
  key: keyof Omit<DecodedSymbols, "symbolicSummary">;
  label: string;
  sublabel: string;
  icon: React.ElementType;
  color: string;
  chipColor: string;
  borderColor: string;
  bgColor: string;
}[] = [
  {
    key: "identityClaims",
    label: "Identity Claims",
    sublabel: "→ Archetype · NicheTopicNode",
    icon: Fingerprint,
    color: "text-rose-300",
    chipColor: "bg-rose-500/15 text-rose-300 border-rose-500/30",
    borderColor: "border-rose-500/20",
    bgColor: "bg-rose-950/20",
  },
  {
    key: "statusSignals",
    label: "Status Signals",
    sublabel: "→ CulturalCapital · RogersAdoptionStage",
    icon: TrendingUp,
    color: "text-amber-300",
    chipColor: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    borderColor: "border-amber-500/20",
    bgColor: "bg-amber-950/20",
  },
  {
    key: "communityReferences",
    label: "Community References",
    sublabel: "→ ParasocialBond · AudienceRelationshipType",
    icon: Users,
    color: "text-sky-300",
    chipColor: "bg-sky-500/15 text-sky-300 border-sky-500/30",
    borderColor: "border-sky-500/20",
    bgColor: "bg-sky-950/20",
  },
  {
    key: "aspirationDrivers",
    label: "Aspiration Drivers",
    sublabel: "→ BarthesMyth · StuartHallDecoding",
    icon: Heart,
    color: "text-violet-300",
    chipColor: "bg-violet-500/15 text-violet-300 border-violet-500/30",
    borderColor: "border-violet-500/20",
    bgColor: "bg-violet-950/20",
  },
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

function DecodedSignalsPanel({ decoded }: { decoded: DecodedSymbols }) {
  const totalSignals =
    decoded.identityClaims.length +
    decoded.statusSignals.length +
    decoded.communityReferences.length +
    decoded.aspirationDrivers.length;

  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    () => new Set(["identityClaims", "statusSignals"])
  );

  const toggleCategory = (key: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  return (
    <div className="rounded-xl border border-indigo-500/20 bg-indigo-950/20 overflow-hidden mt-3">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-indigo-500/15">
        <BookOpen className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0" />
        <span className="text-[10px] font-semibold tracking-[0.12em] uppercase text-indigo-400">
          Decoded Cultural Signals
        </span>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[10px] text-indigo-400/60">
            {totalSignals} signal{totalSignals !== 1 ? "s" : ""} decoded
          </span>
          <span className="text-[10px] text-indigo-400/50 italic">Symbolic analysis</span>
        </div>
      </div>

      {/* Symbolic Summary */}
      {decoded.symbolicSummary && (
        <div className="px-4 py-3 border-b border-indigo-500/10 bg-indigo-900/10">
          <p className="text-[11px] text-indigo-200/80 leading-relaxed italic">
            &ldquo;{decoded.symbolicSummary}&rdquo;
          </p>
        </div>
      )}

      {/* Signal categories */}
      <div className="divide-y divide-indigo-500/10">
        {SIGNAL_CATEGORIES.map(({ key, label, sublabel, icon: Icon, color, chipColor, borderColor, bgColor }) => {
          const signals = decoded[key] as DecodedSignal[];
          if (signals.length === 0) return null;
          const isOpen = expandedCategories.has(key);
          return (
            <div key={key} className={`${bgColor}`}>
              <button
                onClick={() => toggleCategory(key)}
                className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-white/5 transition-colors"
              >
                <Icon className={`w-3 h-3 ${color} flex-shrink-0`} />
                <div className="flex-1 min-w-0">
                  <span className={`text-[10px] font-semibold uppercase tracking-wide ${color}`}>
                    {label}
                  </span>
                  <span className="text-[9px] text-muted-foreground/50 ml-2">{sublabel}</span>
                </div>
                <span className={`text-[9px] px-1.5 py-0.5 rounded-full border ${chipColor} flex-shrink-0`}>
                  {signals.length}
                </span>
                {isOpen
                  ? <ChevronUp className={`w-3 h-3 ${color} opacity-50 flex-shrink-0`} />
                  : <ChevronDown className={`w-3 h-3 ${color} opacity-30 flex-shrink-0`} />
                }
              </button>

              {isOpen && (
                <div className="px-4 pb-3 space-y-2.5">
                  {signals.map((signal, i) => (
                    <div key={i} className={`rounded-lg border ${borderColor} bg-black/20 p-2.5`}>
                      {/* Phrase */}
                      <p className={`text-[11px] font-medium ${color} mb-1`}>
                        &ldquo;{signal.phrase}&rdquo;
                      </p>
                      {/* Meaning */}
                      <p className="text-[10px] text-muted-foreground/80 leading-relaxed mb-1.5">
                        {signal.meaning}
                      </p>
                      {/* Informs chips */}
                      {signal.informs.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {signal.informs.map((field, j) => (
                            <span
                              key={j}
                              className={`text-[9px] px-1.5 py-0.5 rounded border ${chipColor} font-mono`}
                            >
                              {field}
                            </span>
                          ))}
                        </div>
                      )}
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
}

export default function TranscriptPanel({ profile }: TranscriptPanelProps) {
  const transcriptCount = profile.transcriptCount ?? 0;
  const transcriptExcerpts = profile.transcriptExcerpts;

  const entries = useMemo(() => {
    if (!transcriptExcerpts) return [];
    // New format: array of objects from content_items
    if (Array.isArray(transcriptExcerpts)) {
      const entityMap = buildEntityMap(profile);
      return (transcriptExcerpts as Array<{ videoId?: string; caption?: string; transcriptText: string }>)
        .filter(t => t.transcriptText)
        .map((t, i) => {
          const label = t.caption
            ? (t.caption.length > 50 ? t.caption.slice(0, 50) + "…" : t.caption)
            : `Video ${i + 1}`;
          return { label, text: t.transcriptText, segments: tokenize(t.transcriptText, entityMap) };
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

  return (
    <div className="space-y-0">
      {/* ── Transcript Excerpts Panel ─────────────────────────────────────── */}
      {entries.length > 0 && (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-950/30 overflow-hidden">
          {/* Panel header */}
          <div className="flex items-center gap-2.5 px-4 py-3 border-b border-emerald-500/15">
            <Mic className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
            <span className="text-[10px] font-semibold tracking-[0.12em] uppercase text-emerald-400">
              Transcript Excerpts — Spoken Content
            </span>
            <div className="ml-auto flex items-center gap-2">
              <span className="text-[10px] text-emerald-400/60">
                {transcriptCount} video{transcriptCount !== 1 ? "s" : ""} · {totalHighlights} entities detected
              </span>
              <span className="text-[10px] text-emerald-400/50 italic">Primary evidence</span>
            </div>
          </div>

          {/* Legend */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-2.5 border-b border-emerald-500/10 bg-black/20">
            {LEGEND_ITEMS.map(({ type, label, icon: Icon }) => (
              <div key={type} className="flex items-center gap-1.5">
                <span className={`inline-block text-[10px] px-1.5 py-0 rounded ${HIGHLIGHT_STYLES[type]}`}>Aa</span>
                <Icon className="w-2.5 h-2.5 text-muted-foreground/50" />
                <span className="text-[10px] text-muted-foreground/60">{label}</span>
              </div>
            ))}
          </div>

          {/* Transcript entries */}
          <div className="divide-y divide-emerald-500/10">
            {entries.map((entry, i) => {
              const isOpen = expanded.has(i);
              const highlightCount = entry.segments.filter(s => s.type !== null).length;
              return (
                <div key={i} className="group">
                  <button
                    onClick={() => toggleEntry(i)}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-emerald-500/5 transition-colors"
                  >
                    <span className="text-[10px] font-semibold text-emerald-400/80 uppercase tracking-wide flex-1 truncate">
                      {entry.label}
                    </span>
                    {highlightCount > 0 && (
                      <span className="flex items-center gap-1 flex-shrink-0">
                        {(["place", "entity", "claim", "person"] as HighlightType[]).map(type => {
                          const count = entry.segments.filter(s => s.type === type).length;
                          if (count === 0) return null;
                          const dotColors: Record<HighlightType, string> = {
                            place: "bg-amber-400", entity: "bg-teal-400",
                            claim: "bg-violet-400", person: "bg-sky-400",
                          };
                          return (
                            <span key={type} className="inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded-full bg-black/30 text-muted-foreground/70">
                              <span className={`w-1.5 h-1.5 rounded-full ${dotColors[type]}`} />
                              {count}
                            </span>
                          );
                        })}
                      </span>
                    )}
                    {isOpen
                      ? <ChevronUp className="w-3 h-3 text-emerald-400/50 flex-shrink-0" />
                      : <ChevronDown className="w-3 h-3 text-emerald-400/30 flex-shrink-0" />
                    }
                  </button>

                  {isOpen && (
                    <div className="px-4 pb-4 pt-1">
                      <p className="text-xs text-muted-foreground leading-relaxed italic">
                        &ldquo;<HighlightedText segments={entry.segments} />&rdquo;
                      </p>
                      {highlightCount > 0 && (
                        <div className="mt-3 flex flex-wrap gap-1.5">
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
                                className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full cursor-help ${HIGHLIGHT_STYLES[s.type!]}`}
                              >
                                {s.type === "place"  && <MapPin   className="w-2.5 h-2.5" />}
                                {s.type === "entity" && <Utensils className="w-2.5 h-2.5" />}
                                {s.type === "claim"  && <Sparkles className="w-2.5 h-2.5" />}
                                {s.type === "person" && <User     className="w-2.5 h-2.5" />}
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
      {decodedSymbols && <DecodedSignalsPanel decoded={decodedSymbols} />}
    </div>
  );
}
