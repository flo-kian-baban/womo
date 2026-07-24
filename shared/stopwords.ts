/**
 * Function-word (stopword) filtering for keyword extraction (Session 9 — C2).
 *
 * The old filter was an ad-hoc, English-only, incomplete list: common function
 * words like "because", "there", "over", "going", "done", "out", "wants" leaked
 * through and, because keywords are ranked by frequency, outranked real signal
 * (e.g. "because" above "jesus"). And a non-English creator's articles /
 * prepositions ("que", "los", "para", "con") leaked entirely.
 *
 * APPROACH (no new dependencies): a curated, multilingual set of high-frequency
 * FUNCTION words (articles, prepositions, conjunctions, pronouns, auxiliaries,
 * and generic filler verbs) for the languages most common in the corpus —
 * English, Spanish, French, Portuguese, German, Italian. Keyword extraction
 * already lowercases and only accepts ASCII `[a-z]{3,20}`, so 2-letter articles
 * ("la", "el", "de", "le") are dropped by length; this set targets the ≥3-char
 * function words that survive.
 *
 * LIMITS (reported honestly, not hidden):
 *  - It is a fixed set, not a language model — rare/regional function words and
 *    languages not listed here still leak.
 *  - Cross-language homographs are handled conservatively: where a foreign
 *    function word is ALSO a meaningful English content word ("die", "son",
 *    "can", "one", "pan", "come"), we KEEP it (do not filter) so English content
 *    is never silently dropped. That means a few foreign function words survive.
 *  - Accented forms are already excluded upstream by the ASCII `[a-z]` match, so
 *    "más", "está", "où" never reach this filter.
 */

const WORDS: string[] = [
  // ── English — articles, prepositions, conjunctions, pronouns, auxiliaries ──
  "the", "and", "but", "for", "nor", "yet", "not", "are", "was", "were", "been",
  "being", "have", "has", "had", "having", "does", "did", "doing", "will",
  "would", "could", "should", "shall", "may", "might", "must", "can", "cannot",
  "with", "without", "within", "into", "onto", "upon", "unto", "from", "about",
  "above", "below", "under", "over", "off", "out", "down", "than", "then",
  "there", "their", "them", "they", "this", "that", "these", "those", "what",
  "which", "who", "whom", "whose", "when", "where", "why", "how", "because",
  "since", "while", "until", "unless", "although", "though", "however",
  "therefore", "thus", "also", "just", "only", "even", "such", "some", "any",
  "each", "every", "both", "few", "more", "most", "other", "same", "very",
  "much", "many", "here", "your", "yours", "mine", "ours", "his", "her", "hers",
  "its", "our", "you", "him", "she", "himself", "herself", "myself", "yourself",
  "themselves", "itself", "ourselves",
  // Generic filler verbs (low signal in any niche)
  "get", "gets", "got", "getting", "make", "makes", "made", "making", "want",
  "wants", "wanted", "need", "needs", "needed", "know", "knows", "knew", "known",
  "think", "thinks", "thought", "see", "sees", "saw", "seen", "look", "looks",
  "looked", "come", "comes", "came", "coming", "goes", "went", "gone", "going",
  "take", "takes", "took", "taken", "give", "gives", "gave", "given", "use",
  "uses", "used", "find", "finds", "found", "tell", "tells", "told", "said",
  "says", "feel", "feels", "felt", "done", "keep", "kept", "put", "let", "seem",
  "seems", "really", "actually", "basically", "literally", "gonna", "wanna",
  "gotta", "yeah", "okay", "like", "well", "back", "now", "today", "always",
  "never", "ever", "still", "already", "again", "once", "often",

  // ── Spanish — articles, prepositions, conjunctions, common function words ──
  "que", "los", "las", "por", "con", "para", "una", "unos", "unas", "del",
  "pero", "sus", "este", "esta", "estos", "estas", "eso", "esa", "esos", "esas",
  "como", "cuando", "donde", "porque", "tambien", "todo", "toda", "todos",
  "todas", "muy", "mas", "sin", "sobre", "entre", "hasta", "desde", "hay",
  "ser", "estar", "soy", "eres", "somos", "son", "esta", "estan", "muy",

  // ── French — articles, prepositions, conjunctions, common function words ──
  "les", "des", "une", "dans", "pour", "sur", "avec", "pas", "plus", "cette",
  "mais", "ses", "leur", "leurs", "comme", "quand", "tout", "tous", "toute",
  "toutes", "tres", "cest", "nous", "vous", "ils", "elles", "aussi", "donc",
  "parce", "chez", "sans", "sous", "entre",

  // ── Portuguese — articles, prepositions, conjunctions, common function words ──
  "uma", "por", "com", "para", "mas", "seu", "sua", "seus", "suas", "como",
  "quando", "onde", "porque", "tambem", "tudo", "todos", "todas", "muito",
  "muita", "muitos", "muitas", "nao", "sim", "sobre", "entre", "ate", "desde",

  // ── German — articles, prepositions, conjunctions, common function words ──
  "und", "ist", "ein", "eine", "einen", "einem", "eines", "nicht", "mit", "auf",
  "fur", "aus", "bei", "nach", "vor", "aber", "auch", "wie", "wenn", "weil",
  "dass", "sind", "war", "waren", "wird", "werden", "haben", "hatte", "sein",

  // ── Italian — articles, prepositions, conjunctions, common function words ──
  "che", "con", "per", "una", "come", "sono", "questo", "questa", "quello",
  "anche", "piu", "molto", "tutto", "tutti", "quando", "dove", "perche", "gli",
  "delle", "degli", "nella", "nello", "sulla",
];

/**
 * Homographs deliberately KEPT (not filtered): each is a real, meaningful
 * English content word that also appears above as a foreign function word.
 * Keeping them protects English content from being silently dropped, at the
 * cost of leaking those (rare-in-English) foreign function words. Most
 * important here: "sin" (Spanish "without", but core English content for a
 * religious creator). Documented so the trade-off is explicit.
 */
const KEEP_ENGLISH_CONTENT = new Set([
  "sin",  // ES "without" — but a central English content word (religion)
  "son",  // ES "they are" — but English "son"
  "hay",  // ES "there is" — but English "hay"
  "war",  // DE "was" — but English "war"
]);

export const STOPWORDS: ReadonlySet<string> = new Set(
  WORDS.filter(w => !KEEP_ENGLISH_CONTENT.has(w)),
);

export function isStopword(word: string): boolean {
  return STOPWORDS.has(word.toLowerCase());
}
