/**
 * Transcript-reliability session — the strategy structure (C1) and the budget/
 * early-bail machinery it hosts (activated in C2).
 *
 * C1 behavior-neutrality pins: strategy ORDER is [subtitle_http,
 * subtitle_browser, caption_fallback]; with no options every cap is null
 * (uncapped) and the phase never gates — i.e. the orchestrator degenerates to
 * exactly the old sequential fallthrough. The decision rules that pick/refuse
 * transcripts (rehydration parse, caption >= 8 real words) are pinned verbatim.
 */
import { describe, it, expect } from "vitest";
import {
  defaultTranscriptStrategies,
  fetchVideoTranscript,
  createTranscriptPhase,
  captionFallbackDecision,
  extractSubtitleInfos,
  parseWebVTT,
  makeCaptionFallbackStrategy,
  type TranscriptStrategy,
  type TranscriptVideoInput,
  type TranscriptStrategyResult,
} from "./scraping/tiktok/transcriptStrategies";

const INPUT: TranscriptVideoInput = {
  handle: "testcreator", videoId: "v1",
  videoUrl: "https://www.tiktok.com/@testcreator/video/v1", caption: "",
};

function stub(
  name: string,
  scrapeMethod: TranscriptStrategy["scrapeMethod"],
  result: TranscriptStrategyResult | (() => Promise<TranscriptStrategyResult>),
  perVideoTimeoutMs: number | null = null,
): TranscriptStrategy & { calls: number } {
  const s = {
    name, scrapeMethod, perVideoTimeoutMs, calls: 0,
    async attempt() {
      s.calls++;
      return typeof result === "function" ? result() : result;
    },
  };
  return s;
}

const collectEmits = () => {
  const events: Array<{ scrapeMethod: string; urlRequested: string; failureReason?: string; durationMs: number }> = [];
  return { events, emit: (e: (typeof events)[number]) => { events.push(e); } };
};

describe("C1 neutrality pins", () => {
  it("default strategy list keeps the historical order and NO active caps", () => {
    const list = defaultTranscriptStrategies();
    expect(list.map(s => s.name)).toEqual(["subtitle_http", "subtitle_browser", "caption_fallback"]);
    expect(list.map(s => s.perVideoTimeoutMs)).toEqual([null, null, null]); // uncapped = pre-refactor
  });

  it("a phase created without options never gates any strategy", () => {
    const phase = createTranscriptPhase();
    const browser = stub("subtitle_browser", "tiktok_playwright", { outcome: "empty" });
    for (let i = 0; i < 50; i++) phase.noteOutcome(browser, "empty"); // no bail without N
    expect(phase.shouldRun(browser).ok).toBe(true);
    expect(phase.stats().browserDisabledAfterEmpties).toBe(false);
  });
});

describe("fetchVideoTranscript orchestrator", () => {
  it("returns the FIRST success and never runs later strategies", async () => {
    const { events, emit } = collectEmits();
    const a = stub("subtitle_http", "tiktok_desktop_http", {
      outcome: "success", transcript: { text: "hello world spoken", wordCount: 3, source: "subtitle" },
    });
    const b = stub("subtitle_browser", "tiktok_playwright", { outcome: "success", transcript: { text: "x", wordCount: 1, source: "subtitle" } });
    const hit = await fetchVideoTranscript(INPUT, [a, b], createTranscriptPhase(), emit);
    expect(hit?.strategy.name).toBe("subtitle_http");
    expect(hit?.result.transcript.text).toBe("hello world spoken");
    expect(a.calls).toBe(1);
    expect(b.calls).toBe(0); // fallthrough stops at first success — old behavior
    expect(events).toHaveLength(1);
  });

  it("falls through empty → error → caption exactly like the old chain", async () => {
    const a = stub("subtitle_http", "tiktok_desktop_http", { outcome: "empty", detail: "no subtitleInfos" });
    const b = stub("subtitle_browser", "tiktok_playwright", { outcome: "error", detail: "boom" });
    const c = stub("caption_fallback", "tiktok_desktop_http", {
      outcome: "success", transcript: { text: "caption words", wordCount: 2, source: "post_caption" },
    });
    const hit = await fetchVideoTranscript(INPUT, [a, b, c], createTranscriptPhase());
    expect(hit?.strategy.name).toBe("caption_fallback");
    expect([a.calls, b.calls, c.calls]).toEqual([1, 1, 1]);
  });

  it("emits ONE event per attempt: success rows carry the outcome in the URL fragment and NO failureReason; non-success rows carry the 'transcript ' prefix", async () => {
    const { events, emit } = collectEmits();
    const a = stub("subtitle_http", "tiktok_desktop_http", { outcome: "empty", detail: "no rehydration data in page" });
    const b = stub("subtitle_browser", "tiktok_playwright", {
      outcome: "success", transcript: { text: "found it here now", wordCount: 4, source: "subtitle" },
    });
    await fetchVideoTranscript(INPUT, [a, b], createTranscriptPhase(), emit);
    expect(events).toHaveLength(2);
    expect(events[0].urlRequested).toBe(`${INPUT.videoUrl}#transcript=subtitle_http:empty`);
    expect(events[0].failureReason).toMatch(/^transcript subtitle_http: empty/);
    expect(events[1].urlRequested).toBe(`${INPUT.videoUrl}#transcript=subtitle_browser:success`);
    expect(events[1].failureReason).toBeUndefined(); // successes are NOT failures
  });

  it("returns null when every strategy comes up empty (old 'all paths exhausted')", async () => {
    const a = stub("subtitle_http", "tiktok_desktop_http", { outcome: "empty" });
    const b = stub("subtitle_browser", "tiktok_playwright", { outcome: "empty" });
    const c = stub("caption_fallback", "tiktok_desktop_http", { outcome: "empty", detail: "caption too thin (0 real words)" });
    expect(await fetchVideoTranscript(INPUT, [a, b, c], createTranscriptPhase())).toBeNull();
  });

  it("gated strategies are SKIPPED with a visible record, and free strategies still run (C2 machinery)", async () => {
    const { events, emit } = collectEmits();
    const phase = createTranscriptPhase({ maxConsecutiveBrowserEmpties: 1 });
    const browser = stub("subtitle_browser", "tiktok_playwright", { outcome: "empty" });
    phase.noteOutcome(browser, "empty"); // trips N=1
    const a = stub("subtitle_http", "tiktok_desktop_http", { outcome: "empty" });
    const c = stub("caption_fallback", "tiktok_desktop_http", {
      outcome: "success", transcript: { text: "still works fine", wordCount: 3, source: "post_caption" },
    });
    const hit = await fetchVideoTranscript(INPUT, [a, browser, c], phase, emit);
    expect(hit?.strategy.name).toBe("caption_fallback"); // no video silently dropped
    expect(browser.calls).toBe(0);
    const skip = events.find(e => e.urlRequested.endsWith("#transcript=subtitle_browser:skipped"));
    expect(skip?.failureReason).toMatch(/^transcript subtitle_browser: skipped — early-bail/);
  });

  it("per-video cap converts a hung attempt into 'timeout' and the chain continues (C2 machinery)", async () => {
    const hung = stub("subtitle_browser", "tiktok_playwright",
      () => new Promise<TranscriptStrategyResult>(() => { /* never resolves */ }), 50);
    const c = stub("caption_fallback", "tiktok_desktop_http", {
      outcome: "success", transcript: { text: "cap saved the batch", wordCount: 4, source: "post_caption" },
    });
    const { events, emit } = collectEmits();
    const hit = await fetchVideoTranscript(INPUT, [hung, c], createTranscriptPhase(), emit);
    expect(hit?.strategy.name).toBe("caption_fallback");
    expect(events[0].failureReason).toMatch(/^transcript subtitle_browser: timeout — per-video cap 50ms exceeded/);
  });
});

describe("createTranscriptPhase — early-bail semantics (C2 machinery, pinned now)", () => {
  const browser = stub("subtitle_browser", "tiktok_playwright", { outcome: "empty" });
  const http = stub("subtitle_http", "tiktok_desktop_http", { outcome: "empty" });

  it("bails after N consecutive CLEAR empties, and only gates the browser path", () => {
    const phase = createTranscriptPhase({ maxConsecutiveBrowserEmpties: 4 });
    for (let i = 0; i < 4; i++) phase.noteOutcome(browser, "empty");
    expect(phase.shouldRun(browser).ok).toBe(false);
    expect(phase.shouldRun(browser).reason).toContain("early-bail");
    expect(phase.shouldRun(http).ok).toBe(true);            // free strategies never gated
    expect(phase.stats().browserDisabledAfterEmpties).toBe(true);
  });

  it("timeouts and errors do NOT count toward the bail (never sacrifice a possible success)", () => {
    const phase = createTranscriptPhase({ maxConsecutiveBrowserEmpties: 2 });
    phase.noteOutcome(browser, "empty");
    phase.noteOutcome(browser, "timeout");
    phase.noteOutcome(browser, "error");
    phase.noteOutcome(browser, "empty"); // consecutive count: timeout/error neither count nor reset → this is #2
    expect(phase.shouldRun(browser).ok).toBe(false);
    const phase2 = createTranscriptPhase({ maxConsecutiveBrowserEmpties: 3 });
    phase2.noteOutcome(browser, "timeout");
    phase2.noteOutcome(browser, "timeout");
    phase2.noteOutcome(browser, "timeout");
    expect(phase2.shouldRun(browser).ok).toBe(true); // timeouts alone never bail
  });

  it("a browser success RESETS the consecutive counter", () => {
    const phase = createTranscriptPhase({ maxConsecutiveBrowserEmpties: 2 });
    phase.noteOutcome(browser, "empty");
    phase.noteOutcome(browser, "success");
    phase.noteOutcome(browser, "empty");
    expect(phase.shouldRun(browser).ok).toBe(true); // 1, not 2
  });

  it("phase deadline gates the browser path only, and marks deadlineHit", () => {
    let t = 1_000_000;
    const phase = createTranscriptPhase({ phaseBudgetMs: 120_000, now: () => t });
    expect(phase.shouldRun(browser).ok).toBe(true);
    t += 120_001;
    expect(phase.shouldRun(browser).ok).toBe(false);
    expect(phase.shouldRun(browser).reason).toContain("budget exceeded");
    expect(phase.shouldRun(http).ok).toBe(true);
    expect(phase.stats().deadlineHit).toBe(true);
  });
});

describe("decision rules pinned verbatim", () => {
  it("caption rule: >= 8 real words admits; hashtags/mentions don't count", () => {
    expect(captionFallbackDecision("one two three four five six seven eight").ok).toBe(true);
    expect(captionFallbackDecision("one two three four five six seven #tag @person").ok).toBe(false); // 7 real
    expect(captionFallbackDecision("short").ok).toBe(false); // < 10 chars
    expect(captionFallbackDecision("").ok).toBe(false);
    const d = captionFallbackDecision("w1 w2 w3 w4 w5 w6 w7 w8 #a #b");
    expect(d).toMatchObject({ ok: true, realWordCount: 8, hashtagCount: 2 });
  });

  it("caption strategy returns the trimmed caption with FULL word count (incl. hashtags) — exactly the old entry shape", async () => {
    const s = makeCaptionFallbackStrategy();
    const r = await s.attempt({ ...INPUT, caption: "  w1 w2 w3 w4 w5 w6 w7 w8 #a  " });
    expect(r.outcome).toBe("success");
    expect(r.transcript).toEqual({ text: "w1 w2 w3 w4 w5 w6 w7 w8 #a", wordCount: 9, source: "post_caption" });
  });

  it("extractSubtitleInfos parses the rehydration scope exactly", () => {
    const html = `<html><script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify({
      __DEFAULT_SCOPE__: { "webapp.video-detail": { itemInfo: { itemStruct: { video: { subtitleInfos: [{ Url: "https://cdn/vtt", LanguageCodeName: "eng-US" }] } } } } },
    })}</script></html>`;
    const r = extractSubtitleInfos(html);
    expect(r.found).toBe(true);
    expect(r.subtitleInfos).toHaveLength(1);
    expect(extractSubtitleInfos("<html>no data</html>")).toEqual({ found: false, subtitleInfos: [] });
  });

  it("parseWebVTT strips headers/timestamps/cues and dedupes consecutive lines", () => {
    const vtt = "WEBVTT\n\n1\n00:00:00.000 --> 00:00:02.000\nhello there\nhello there\n\n2\n00:00:02.000 --> 00:00:04.000\ngeneral kenobi\n";
    expect(parseWebVTT(vtt)).toBe("hello there general kenobi");
  });
});
