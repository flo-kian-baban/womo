/**
 * Session 9 — transcript-source normalization (Part B1).
 *
 * Locks the classifier that both writers (normalized values) and readers
 * (old + new values) rely on, and the speech-vs-caption distinction that the
 * read-model ordering, diagnostic, and UI depend on.
 */
import { describe, it, expect } from "vitest";
import {
  TRANSCRIPT_SOURCE,
  classifyTranscriptSource,
  isSpeechTranscript,
} from "@shared/transcriptSource";

describe("transcript source normalization", () => {
  it("the look-alike legacy pair maps to OPPOSITE kinds", () => {
    // The whole point: "captions" (speech) and "caption" (not speech) were one
    // character apart and meant opposite things.
    expect(classifyTranscriptSource("captions").kind).toBe("speech");
    expect(classifyTranscriptSource("caption").kind).toBe("caption");
  });

  it("classifies every legacy value correctly", () => {
    expect(classifyTranscriptSource("captions").normalized).toBe(TRANSCRIPT_SOURCE.subtitle);
    expect(classifyTranscriptSource("playwright-webvtt").normalized).toBe(TRANSCRIPT_SOURCE.subtitle);
    expect(classifyTranscriptSource("playwright-xhr").normalized).toBe(TRANSCRIPT_SOURCE.subtitle);
    expect(classifyTranscriptSource("whisper").normalized).toBe(TRANSCRIPT_SOURCE.speechToText);
    expect(classifyTranscriptSource("gemini-2.5-flash").normalized).toBe(TRANSCRIPT_SOURCE.speechToText);
    expect(classifyTranscriptSource("caption").normalized).toBe(TRANSCRIPT_SOURCE.postCaption);
  });

  it("classifies the normalized values (round-trips)", () => {
    expect(classifyTranscriptSource(TRANSCRIPT_SOURCE.subtitle)).toMatchObject({ kind: "speech", label: "Subtitle track" });
    expect(classifyTranscriptSource(TRANSCRIPT_SOURCE.speechToText)).toMatchObject({ kind: "speech", label: "Speech-to-text" });
    expect(classifyTranscriptSource(TRANSCRIPT_SOURCE.postCaption)).toMatchObject({ kind: "caption", label: "Post caption" });
  });

  it("treats unknown/absent values conservatively as NON-speech", () => {
    expect(isSpeechTranscript(undefined)).toBe(false);
    expect(isSpeechTranscript(null)).toBe(false);
    expect(isSpeechTranscript("")).toBe(false);
    expect(isSpeechTranscript("something-new-2027")).toBe(false);
    expect(classifyTranscriptSource("something-new-2027").normalized).toBe("unknown");
  });

  it("isSpeechTranscript matches the historical `!== \"caption\"` gate for real TikTok sources", () => {
    // The min-data gate used `t.transcriptSource !== "caption"`. Over the sources
    // the TikTok multipath actually emits, isSpeechTranscript must produce the
    // identical set (only the post-caption fallback excluded).
    for (const legacy of ["captions", "playwright-webvtt", "playwright-xhr"]) {
      expect(isSpeechTranscript(legacy)).toBe(true);
    }
    expect(isSpeechTranscript("caption")).toBe(false);
  });

  it("is case/whitespace tolerant", () => {
    expect(classifyTranscriptSource("  CAPTIONS ").kind).toBe("speech");
    expect(classifyTranscriptSource("Caption").kind).toBe("caption");
  });
});
