/**
 * TranscriptPanel
 *
 * Renders transcript excerpts with inline entity/claim highlighting.
 * All highlighting is done client-side from the already-extracted profile fields —
 * no extra API calls required.
 *
 * Highlight categories:
 *   PLACE     — named locations, cities, venues, restaurants (amber)
 *   ENTITY    — specific food items, products, brands (teal)
 *   CLAIM     — phrases that map to archetype, themes, or cultural myth (violet)
 *   PERSON    — proper names (sky blue)
 */

import { useMemo, useState } from "react";
import { Mic, ChevronDown, ChevronUp, MapPin, Utensils, Sparkles, User } from "lucide-react";
import type { CreatorProfile } from "../../../drizzle/schema";

// ─── Types ────────────────────────────────────────────────────────────────────

type HighlightType = "place" | "entity" | "claim" | "person";

interface Segment {
  text: string;
  type: HighlightType | null; // null = plain text
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

// ─── Known entity lists ───────────────────────────────────────────────────────

// Well-known cities and regions that commonly appear in food/lifestyle content
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

// Common food/dish entities
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

/**
 * Build an entity map from the extracted profile fields.
 * Returns arrays of terms per category.
 */
function buildEntityMap(profile: CreatorProfile): {
  places: string[];
  entities: string[];
  claims: string[];
  persons: string[];
} {
  const themes = (profile.contentThemeLabels as string[] | null) ?? [];
  const keywords = (profile.rawKeywords as string[] | null) ?? [];
  const recurringThemes = (profile.recurringThemes as string[] | null) ?? [];

  // Places: known cities + location from profile
  const places = [...KNOWN_CITIES];
  if (profile.location) places.push(profile.location);

  // Entities: known food + keywords that look like nouns (≥4 chars, not stopwords)
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

  // Claims: phrases from barthesMyth, recurringThemes, nicheTopicNode, themes
  const claims: string[] = [];
  if (profile.nicheTopicNode) {
    // Break niche into individual words ≥4 chars
    profile.nicheTopicNode.split(/[\s,/]+/).forEach(w => {
      if (w.length >= 4 && !stopwords.has(w.toLowerCase())) claims.push(w);
    });
  }
  for (const t of [...themes, ...recurringThemes]) {
    t.split(/[\s,/]+/).forEach(w => {
      if (w.length >= 4 && !stopwords.has(w.toLowerCase())) claims.push(w);
    });
  }
  // Extract key nouns from barthesMyth
  if (profile.barthesMyth) {
    const mythWords = profile.barthesMyth.split(/\s+/).filter(w => w.length >= 5 && !stopwords.has(w.toLowerCase()));
    claims.push(...mythWords.slice(0, 6));
  }

  // Persons: displayName parts
  const persons: string[] = [];
  if (profile.displayName) {
    const nameParts = profile.displayName.split(/\s+/).filter(p => p.length >= 3 && /^[A-Z]/.test(p));
    persons.push(...nameParts);
  }

  return {
    places: Array.from(new Set(places)),
    entities: Array.from(new Set(entities)),
    claims: Array.from(new Set(claims)),
    persons: Array.from(new Set(persons)),
  };
}

/**
 * Tokenize a transcript string into highlighted segments.
 * Processes in priority order: places → persons → entities → claims.
 * Overlapping matches are resolved by taking the first (highest-priority) match.
 */
function tokenize(text: string, entityMap: ReturnType<typeof buildEntityMap>): Segment[] {
  // Build a flat list of (start, end, type, tooltip) from all matches
  interface Match { start: number; end: number; type: HighlightType; tooltip: string }
  const matches: Match[] = [];

  const addMatches = (terms: string[], type: HighlightType, tooltipPrefix: string) => {
    for (const term of terms) {
      if (!term || term.length < 3) continue;
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`\\b${escaped}\\b`, "gi");
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        matches.push({
          start: m.index,
          end: m.index + m[0].length,
          type,
          tooltip: `${tooltipPrefix}: ${term}`,
        });
      }
    }
  };

  // Priority order: places first (most specific), then persons, entities, claims
  addMatches(entityMap.places,   "place",  "Location");
  addMatches(entityMap.persons,  "person", "Person");
  addMatches(entityMap.entities, "entity", "Food/Product");
  addMatches(entityMap.claims,   "claim",  "Cultural signal");

  if (matches.length === 0) {
    return [{ text, type: null }];
  }

  // Sort by start position, then by priority (place < person < entity < claim)
  const PRIORITY: Record<HighlightType, number> = { place: 0, person: 1, entity: 2, claim: 3 };
  matches.sort((a, b) => a.start - b.start || PRIORITY[a.type] - PRIORITY[b.type]);

  // Remove overlapping matches (keep first/highest-priority)
  const resolved: Match[] = [];
  let cursor = 0;
  for (const m of matches) {
    if (m.start >= cursor) {
      resolved.push(m);
      cursor = m.end;
    }
  }

  // Build segments
  const segments: Segment[] = [];
  let pos = 0;
  for (const m of resolved) {
    if (m.start > pos) {
      segments.push({ text: text.slice(pos, m.start), type: null });
    }
    segments.push({ text: text.slice(m.start, m.end), type: m.type, tooltip: m.tooltip });
    pos = m.end;
  }
  if (pos < text.length) {
    segments.push({ text: text.slice(pos), type: null });
  }
  return segments;
}

// ─── Parse raw transcriptExcerpts string ─────────────────────────────────────

function parseExcerpts(raw: string, profile: CreatorProfile): TranscriptEntry[] {
  const entityMap = buildEntityMap(profile);
  const blocks = raw.split("\n\n").filter(Boolean);
  return blocks.map((block, i) => {
    const colonIdx = block.indexOf("]: ");
    const label = colonIdx > 0 ? block.slice(1, colonIdx) : `Video ${i + 1}`;
    const text = colonIdx > 0 ? block.slice(colonIdx + 3) : block;
    return {
      label,
      text,
      segments: tokenize(text, entityMap),
    };
  });
}

// ─── Segment renderer ─────────────────────────────────────────────────────────

function HighlightedText({ segments }: { segments: Segment[] }) {
  return (
    <span>
      {segments.map((seg, i) =>
        seg.type ? (
          <mark
            key={i}
            title={seg.tooltip}
            className={`cursor-help not-italic ${HIGHLIGHT_STYLES[seg.type]}`}
          >
            {seg.text}
          </mark>
        ) : (
          <span key={i}>{seg.text}</span>
        )
      )}
    </span>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface TranscriptPanelProps {
  profile: CreatorProfile;
}

export default function TranscriptPanel({ profile }: TranscriptPanelProps) {
  const transcriptCount = profile.transcriptCount ?? 0;
  const transcriptExcerpts = profile.transcriptExcerpts ?? "";

  const entries = useMemo(
    () => (transcriptExcerpts ? parseExcerpts(transcriptExcerpts, profile) : []),
    [transcriptExcerpts, profile]
  );

  const [expanded, setExpanded] = useState<Set<number>>(() => new Set([0]));

  const toggleEntry = (i: number) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  if (entries.length === 0) return null;

  // Count highlights across all entries
  const totalHighlights = entries.reduce((acc, e) => acc + e.segments.filter(s => s.type !== null).length, 0);

  return (
    <div className="rounded-xl border border-emerald-500/20 bg-emerald-950/30 overflow-hidden">
      {/* ── Panel header ──────────────────────────────────────────────────── */}
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

      {/* ── Legend ────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-2.5 border-b border-emerald-500/10 bg-black/20">
        {LEGEND_ITEMS.map(({ type, label, icon: Icon }) => (
          <div key={type} className="flex items-center gap-1.5">
            <span className={`inline-block text-[10px] px-1.5 py-0 rounded ${HIGHLIGHT_STYLES[type]}`}>
              Aa
            </span>
            <Icon className="w-2.5 h-2.5 text-muted-foreground/50" />
            <span className="text-[10px] text-muted-foreground/60">{label}</span>
          </div>
        ))}
      </div>

      {/* ── Transcript entries ─────────────────────────────────────────────── */}
      <div className="divide-y divide-emerald-500/10">
        {entries.map((entry, i) => {
          const isOpen = expanded.has(i);
          const highlightCount = entry.segments.filter(s => s.type !== null).length;
          return (
            <div key={i} className="group">
              {/* Entry header — always visible */}
              <button
                onClick={() => toggleEntry(i)}
                className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-emerald-500/5 transition-colors"
              >
                <span className="text-[10px] font-semibold text-emerald-400/80 uppercase tracking-wide flex-1 truncate">
                  {entry.label}
                </span>
                {highlightCount > 0 && (
                  <span className="flex items-center gap-1 flex-shrink-0">
                    {/* Mini entity type pills */}
                    {(["place", "entity", "claim", "person"] as HighlightType[]).map(type => {
                      const count = entry.segments.filter(s => s.type === type).length;
                      if (count === 0) return null;
                      const dotColors: Record<HighlightType, string> = {
                        place:  "bg-amber-400",
                        entity: "bg-teal-400",
                        claim:  "bg-violet-400",
                        person: "bg-sky-400",
                      };
                      return (
                        <span
                          key={type}
                          className={`inline-flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded-full bg-black/30 text-muted-foreground/70`}
                        >
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

              {/* Entry body — collapsible */}
              {isOpen && (
                <div className="px-4 pb-4 pt-1">
                  <p className="text-xs text-muted-foreground leading-relaxed italic">
                    &ldquo;<HighlightedText segments={entry.segments} />&rdquo;
                  </p>

                  {/* Per-entry entity summary */}
                  {highlightCount > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {entry.segments
                        .filter(s => s.type !== null)
                        .reduce<Segment[]>((acc, s) => {
                          // Deduplicate by text+type
                          if (!acc.some(a => a.text.toLowerCase() === s.text.toLowerCase() && a.type === s.type)) {
                            acc.push(s);
                          }
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
  );
}
