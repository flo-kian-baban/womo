/**
 * Transcript-source normalization (Session 9 — Part B1).
 *
 * content_items.transcript_source historically emitted look-alike, meaning-
 * OPPOSITE labels: "captions" (a WEBVTT subtitle track = the creator's actual
 * SPEECH, auto-transcribed) vs "caption" (the post's written caption used as a
 * last-resort fallback = NOT speech). One character apart, opposite evidentiary
 * weight. Plus per-method labels ("playwright-webvtt", "playwright-xhr") and
 * per-model labels ("whisper", "gemini-2.5-flash") that don't state what the
 * evidence IS.
 *
 * From Session 9, writers emit the normalized values in TRANSCRIPT_SOURCE.
 * classifyTranscriptSource() maps BOTH the new values AND every legacy value to
 * a stable {kind, label}, so existing rows need no backfill — the read model,
 * diagnostic, and UI all classify old and new values identically.
 *
 * This does NOT change what COUNTS as evidence (Jason's ruling): a caption-
 * sourced transcript is still stored and still counted exactly as before. It
 * only stops the pipeline from mislabeling a post caption as spoken content.
 */

/** What a transcript actually IS as evidence. */
export type TranscriptEvidenceKind = "speech" | "caption";

/** Normalized transcript_source values written from Session 9 onward. */
export const TRANSCRIPT_SOURCE = {
  /** WEBVTT / auto-caption subtitle track — the spoken audio, transcribed. */
  subtitle: "subtitle",
  /** Whisper / Gemini audio speech-to-text — the spoken audio, transcribed. */
  speechToText: "speech_to_text",
  /** The post's written caption, used when no spoken transcript is available. */
  postCaption: "post_caption",
} as const;

export type TranscriptSourceValue = (typeof TRANSCRIPT_SOURCE)[keyof typeof TRANSCRIPT_SOURCE];

export interface TranscriptSourceInfo {
  /** Is this the creator's actual speech, or their written post caption? */
  kind: TranscriptEvidenceKind;
  /** Human-readable, states what the evidence IS. */
  label: string;
  /** The normalized value this (possibly legacy) source maps to. */
  normalized: TranscriptSourceValue | "unknown";
}

/**
 * Classify any transcript_source value — new or legacy — into a stable
 * {kind, label, normalized}. Unrecognized/absent values are treated
 * conservatively as NON-speech, so we never over-claim spoken evidence for a
 * value we don't recognize.
 */
export function classifyTranscriptSource(source: string | null | undefined): TranscriptSourceInfo {
  switch ((source ?? "").trim().toLowerCase()) {
    // Subtitle tracks (WEBVTT / timedtext) — normalized + legacy variants.
    case "subtitle":
    case "captions":
    case "playwright-webvtt":
    case "playwright-xhr":
      return { kind: "speech", label: "Subtitle track", normalized: TRANSCRIPT_SOURCE.subtitle };
    // Audio speech-to-text — normalized + legacy variants.
    case "speech_to_text":
    case "whisper":
    case "gemini-2.5-flash":
      return { kind: "speech", label: "Speech-to-text", normalized: TRANSCRIPT_SOURCE.speechToText };
    // Post-caption fallback (NOT speech) — normalized + legacy variant.
    case "post_caption":
    case "caption":
      return { kind: "caption", label: "Post caption", normalized: TRANSCRIPT_SOURCE.postCaption };
    default:
      return {
        kind: "caption",
        label: source ? `Other (${source})` : "Unknown",
        normalized: "unknown",
      };
  }
}

/** True when the transcript captures the creator's actual speech (not a caption). */
export function isSpeechTranscript(source: string | null | undefined): boolean {
  return classifyTranscriptSource(source).kind === "speech";
}
