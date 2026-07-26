/**
 * TikTok Transcript Strategies — the per-video transcript multipath as a uniform
 * strategy structure (transcript-reliability session, approved Part 0 design).
 *
 * Each real path is one named, individually-instrumented, individually-budgeted
 * unit behind one interface:
 *
 *   subtitle_http     — Path A:   fetch the video page over HTTP, parse the
 *                       rehydration JSON, download the WEBVTT subtitle.
 *   subtitle_browser  — Path B+C: ONE Playwright navigation serving both the
 *                       page.evaluate() subtitleInfos read and subtitle-XHR
 *                       interception (kept as one unit — one navigation, two
 *                       harvest mechanisms; splitting would be false abstraction).
 *   caption_fallback  — Path E:   the post caption, only if it carries >= 8 real
 *                       (non-hashtag/mention) words.
 *
 * A future STT path implements TranscriptStrategy and slots into the list before
 * caption_fallback — the orchestrator does not change.
 *
 * Telemetry: the orchestrator emits ONE scrape_event per attempt. The strategy
 * name + outcome ride url_requested as a `#transcript=<name>:<outcome>` fragment
 * (visible on success rows too); failure_reason is set ONLY for non-success
 * outcomes, prefixed "transcript " so the Run-panel consequence derivation can
 * distinguish per-video attempt records from real scrape-path failures.
 * scrape_method is a Postgres enum (no DDL): http attempts use
 * tiktok_desktop_http, browser attempts tiktok_playwright, and caption_fallback
 * (a local, zero-network computation) is recorded under tiktok_desktop_http with
 * the fragment disclosing what it really is.
 *
 * Budgets: perVideoTimeoutMs on each strategy (null = uncapped) and a shared
 * TranscriptPhase (deadline + early-bail) created once per 12-video batch. In the
 * structure commit both are INACTIVE (null caps, no phase limits) — behavior is
 * identical to the pre-refactor multipath; the budget commit activates them.
 */
import { fetchHtml, requestGovernor, recordScrapeEvent } from "../httpClient";
import { getContext } from "../browserClient";
import { TRANSCRIPT_SOURCE } from "@shared/transcriptSource";
import type { BrowserContext } from "playwright";

// ─── Types ────────────────────────────────────────────────────────────────────

export type TranscriptOutcome = "success" | "empty" | "timeout" | "error" | "skipped";

export interface TranscriptVideoInput {
  handle: string;
  videoId: string;
  videoUrl: string;
  caption: string;
  /** Shared Playwright context for browser-based strategies (batch-owned). */
  sharedContext?: BrowserContext;
}

export interface TranscriptStrategyResult {
  outcome: TranscriptOutcome;
  transcript?: { text: string; wordCount: number; source: string };
  detail?: string;
}

export interface TranscriptStrategy {
  name: "subtitle_http" | "subtitle_browser" | "caption_fallback" | string;
  /** Existing scrape_method enum label (no DDL) — see module header. */
  scrapeMethod: "tiktok_desktop_http" | "tiktok_playwright";
  /** Hard wall-clock cap for one attempt; null = uncapped. */
  perVideoTimeoutMs: number | null;
  attempt(input: TranscriptVideoInput): Promise<TranscriptStrategyResult>;
}

// ─── WEBVTT Parser (moved verbatim from webResearch.ts) ───────────────────────

/**
 * Parse a WEBVTT subtitle file into plain text.
 * Removes timestamps, cue IDs, and the WEBVTT header.
 * Deduplicates consecutive identical lines (common in TikTok WEBVTT).
 */
export function parseWebVTT(vtt: string): string {
  const lines = vtt.split("\n");
  const textLines: string[] = [];
  let lastLine = "";

  for (const rawLine of lines) {
    const line = rawLine.trim();
    // Skip: empty, WEBVTT header, timestamp lines (00:00:00.000 --> 00:00:02.000)
    if (!line) continue;
    if (line.startsWith("WEBVTT")) continue;
    if (/^\d{2}:\d{2}/.test(line) && line.includes("-->")) continue;
    // Skip pure numeric cue IDs
    if (/^\d+$/.test(line)) continue;
    // Skip HTML-like tags that sometimes appear
    if (line.startsWith("<") && line.endsWith(">")) continue;

    // Deduplicate consecutive identical lines
    if (line !== lastLine) {
      textLines.push(line);
      lastLine = line;
    }
  }

  return textLines.join(" ").replace(/\s+/g, " ").trim();
}

/**
 * Download a WEBVTT file and parse to plain text (moved verbatim; keeps its
 * Session-7 per-download telemetry — the new per-attempt event says which
 * strategy owned the attempt, this one says what the download itself did).
 */
export async function downloadWebVTT(url: string): Promise<{ transcript: string; wordCount: number } | null> {
  const dlStart = Date.now();
  try {
    const { default: axios } = await import("axios");
    const subResponse = await axios.get(url, {
      headers: {
        "Referer": "https://www.tiktok.com/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      timeout: 10000,
      responseType: "text",
    });

    const vttText = subResponse.data as string;
    const transcript = parseWebVTT(vttText);

    // Session 7 telemetry: subtitle downloads bypass fetchHtml (axios) — record
    // each attempt. Enum has no subtitle-specific method; tiktok_desktop_http
    // is the closest honest label (plain HTTP GET); the URL discloses the target.
    recordScrapeEvent({
      platform: "tiktok", scrapeMethod: "tiktok_desktop_http", urlRequested: url,
      httpStatus: subResponse.status, responseSizeBytes: vttText?.length,
      durationMs: Date.now() - dlStart,
      failureReason: !transcript || transcript.length < 10 ? "WEBVTT downloaded but parsed to empty/too-short transcript" : undefined,
    });

    if (!transcript || transcript.length < 10) return null;

    const wordCount = transcript.split(/\s+/).length;
    return { transcript, wordCount };
  } catch (err) {
    console.warn(`[transcript] WEBVTT download failed: ${(err as Error).message}`);
    recordScrapeEvent({
      platform: "tiktok", scrapeMethod: "tiktok_desktop_http", urlRequested: url,
      httpStatus: (err as { response?: { status?: number } }).response?.status,
      failureReason: (err as Error).message.slice(0, 500),
      durationMs: Date.now() - dlStart,
    });
    return null;
  }
}

/**
 * Download and parse a WEBVTT subtitle from a list of subtitleInfos.
 * Prefers English; falls back to first available. (Moved verbatim.)
 */
export async function downloadAndParseSubtitle(
  subtitleInfos: Array<Record<string, unknown>>,
): Promise<{ transcript: string; wordCount: number } | null> {
  const engSub = subtitleInfos.find(
    (s) => (s?.LanguageCodeName as string)?.startsWith("eng"),
  ) ?? subtitleInfos[0];

  const subtitleUrl = engSub?.Url as string;
  if (!subtitleUrl) return null;

  const transcript = await downloadWebVTT(subtitleUrl);
  return transcript;
}

// ─── Pure decision helpers (extracted for unit tests; logic verbatim) ─────────

/** Path A's rehydration parse: html → subtitleInfos array (empty when absent). */
export function extractSubtitleInfos(html: string): { found: boolean; subtitleInfos: Array<Record<string, unknown>> } {
  const rehydrationMatch = html.match(
    /<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/,
  );
  if (!rehydrationMatch) return { found: false, subtitleInfos: [] };
  const pageData = JSON.parse(rehydrationMatch[1]) as Record<string, unknown>;
  const defaultScope = (pageData?.["__DEFAULT_SCOPE__"] as Record<string, unknown>) ?? {};
  const videoDetail = (defaultScope?.["webapp.video-detail"] as Record<string, unknown>) ?? {};
  const itemStruct = (videoDetail?.itemInfo as Record<string, unknown>)?.itemStruct as Record<string, unknown> ?? {};
  const videoObj = (itemStruct?.video as Record<string, unknown>) ?? {};
  const subtitleInfos = (videoObj?.subtitleInfos as Array<Record<string, unknown>>) ?? [];
  return { found: true, subtitleInfos };
}

/** Path E's admission rule: >= 8 real (non-hashtag/mention) words. Verbatim. */
export function captionFallbackDecision(caption: string): { ok: boolean; realWordCount: number; hashtagCount: number; words: string[] } {
  if (!caption || caption.trim().length < 10) return { ok: false, realWordCount: 0, hashtagCount: 0, words: [] };
  const words = caption.trim().split(/\s+/);
  const hashtagCount = words.filter(w => w.startsWith('#') || w.startsWith('@')).length;
  const realWordCount = words.length - hashtagCount;
  return { ok: realWordCount >= 8, realWordCount, hashtagCount, words };
}

// ─── Strategies ───────────────────────────────────────────────────────────────

interface StrategyOptions {
  /** null = uncapped (structure-commit default; the budget commit passes numbers). */
  perVideoTimeoutMs?: number | null;
  /** fetchHtml tuning for subtitle_http (budget commit tightens; default = today's). */
  httpFetch?: { timeout?: number; maxRetries?: number };
}

export function makeSubtitleHttpStrategy(opts?: StrategyOptions): TranscriptStrategy {
  return {
    name: "subtitle_http",
    scrapeMethod: "tiktok_desktop_http",
    perVideoTimeoutMs: opts?.perVideoTimeoutMs ?? null,
    async attempt(input): Promise<TranscriptStrategyResult> {
      // ── PATH A: HTTP WEBVTT (fast path) — body verbatim ──
      try {
        const html = await fetchHtml(input.videoUrl, {
          extraHeaders: { Referer: "https://www.tiktok.com/" },
          ...(opts?.httpFetch ?? {}),
        });
        const { found, subtitleInfos } = extractSubtitleInfos(html);
        if (found) {
          console.log(`[transcript] ${input.videoId}: path-A attempted, subtitleInfos count: ${subtitleInfos.length}`);
          if (subtitleInfos.length > 0) {
            const transcript = await downloadAndParseSubtitle(subtitleInfos);
            if (transcript) {
              console.log(`[transcript] ${input.videoId}: path-A succeeded | ${transcript.wordCount} words`);
              return {
                outcome: "success",
                transcript: { text: transcript.transcript, wordCount: transcript.wordCount, source: TRANSCRIPT_SOURCE.subtitle },
              };
            }
            return { outcome: "empty", detail: "subtitleInfos present but WEBVTT download/parse yielded nothing" };
          }
          return { outcome: "empty", detail: "page fetched, no subtitleInfos" };
        }
        console.log(`[transcript] ${input.videoId}: path-A no rehydration data`);
        return { outcome: "empty", detail: "no rehydration data in page" };
      } catch (err) {
        console.warn(`[transcript] ${input.videoId}: path-A failed: ${(err as Error).message}`);
        return { outcome: "error", detail: (err as Error).message.slice(0, 200) };
      }
    },
  };
}

export function makeSubtitleBrowserStrategy(opts?: StrategyOptions): TranscriptStrategy {
  return {
    name: "subtitle_browser",
    scrapeMethod: "tiktok_playwright",
    perVideoTimeoutMs: opts?.perVideoTimeoutMs ?? null,
    async attempt(input): Promise<TranscriptStrategyResult> {
      // ── PATH B+C: Playwright combined (subtitle extraction + XHR interception)
      // — body verbatim; one navigation serves both harvest mechanisms ──
      try {
        await requestGovernor("tiktok");

        const context = input.sharedContext ?? (await getContext("desktop-chrome")).context;
        const page = await context.newPage();

        try {
          let capturedSubtitleText: string | null = null;
          let subtitleCaptured = false;

          await page.route(/\.(vtt|webvtt)(\?|$)|subtitle|subtitles/i, async (route) => {
            try {
              const url = route.request().url();
              if (url.includes("tiktokcdn.com") || url.includes("tiktokv.com") || url.includes("musical.ly") || url.includes("byteicdn.com") || url.includes("ibytedtos.com")) {
                const response = await route.fetch();
                const body = await response.text();
                if (body && (body.includes("WEBVTT") || body.includes("-->")) && body.length > 20) {
                  capturedSubtitleText = body;
                  subtitleCaptured = true;
                  console.log(`[transcript] ${input.videoId}: path-C XHR intercepted subtitle (${body.length} bytes)`);
                }
                await route.fulfill({ response });
              } else {
                await route.continue();
              }
            } catch {
              await route.continue().catch(() => { });
            }
          });

          await page.goto(input.videoUrl, { waitUntil: "networkidle", timeout: 15000 }).catch(() => {
            // networkidle may time out — page can still be usable
          });

          await page.waitForTimeout(2000);

          const subtitleUrls = await page.evaluate(() => {
            try {
              /**
               * READ THE SCRIPT ELEMENT'S TEXT. Never trust the window global.
               *
               * The payload lives in <script id="__UNIVERSAL_DATA_FOR_REHYDRATION__">,
               * and because that element carries an `id`, named element access
               * puts THE ELEMENT ITSELF on window under the same name. The
               * previous code read the global first and only fell back to
               * parsing when it was falsy — but an HTMLScriptElement is truthy,
               * so the fallback was unreachable, `__DEFAULT_SCOPE__` was always
               * undefined, and this returned [] on EVERY video. That is the
               * whole reason this strategy recorded 0 successes in 227 attempts
               * while the HTTP path was reading the same field successfully.
               *
               * The global is still accepted, but only after proving it is a
               * plain object that actually carries __DEFAULT_SCOPE__ — which an
               * element never does.
               */
              const win = window as any;
              const fromGlobal = win.__UNIVERSAL_DATA_FOR_REHYDRATION__;
              let rehydrationData =
                fromGlobal && typeof fromGlobal === "object" &&
                !(typeof Node !== "undefined" && fromGlobal instanceof Node) &&
                "__DEFAULT_SCOPE__" in fromGlobal
                  ? fromGlobal
                  : null;
              if (!rehydrationData) {
                const scriptEl = document.getElementById("__UNIVERSAL_DATA_FOR_REHYDRATION__");
                if (scriptEl?.textContent) {
                  rehydrationData = JSON.parse(scriptEl.textContent);
                }
              }
              if (!rehydrationData) return [];
              const scope = rehydrationData?.__DEFAULT_SCOPE__ ?? {};
              const videoDetail = scope?.["webapp.video-detail"] ?? {};
              const itemStruct = videoDetail?.itemInfo?.itemStruct ?? {};
              const video = itemStruct?.video ?? {};
              const subtitleInfos = video?.subtitleInfos ?? [];
              if (!Array.isArray(subtitleInfos) || subtitleInfos.length === 0) return [];
              return subtitleInfos.map((s: any) => ({
                url: s?.Url ?? s?.url ?? "",
                lang: s?.LanguageCodeName ?? s?.languageCodeName ?? "",
                format: s?.Format ?? s?.format ?? "",
              }));
            } catch {
              return [];
            }
          }) as Array<{ url: string; lang: string; format: string }>;

          console.log(`[transcript] ${input.videoId}: path-B page.evaluate() found ${subtitleUrls.length} subtitles`);

          if (subtitleUrls.length > 0) {
            const engSub = subtitleUrls.find(s => s.lang.startsWith("eng")) ?? subtitleUrls[0];
            if (engSub.url) {
              const transcript = await downloadWebVTT(engSub.url);
              if (transcript) {
                console.log(`[transcript] ${input.videoId}: path-B succeeded | ${transcript.wordCount} words`);
                await page.close().catch(() => { });
                return {
                  outcome: "success",
                  transcript: { text: transcript.transcript, wordCount: transcript.wordCount, source: TRANSCRIPT_SOURCE.subtitle },
                };
              }
            }
          }

          if (!subtitleCaptured) {
            await page.waitForTimeout(2000);
          }

          if (capturedSubtitleText) {
            const transcript = parseWebVTT(capturedSubtitleText);
            if (transcript && transcript.length >= 10) {
              const wordCount = transcript.split(/\s+/).length;
              console.log(`[transcript] ${input.videoId}: path-C succeeded | ${wordCount} words`);
              await page.close().catch(() => { });
              return {
                outcome: "success",
                transcript: { text: transcript, wordCount, source: TRANSCRIPT_SOURCE.subtitle },
              };
            }
          }

          console.log(`[transcript] ${input.videoId}: path-BC failed, no subtitles available`);
          await page.close().catch(() => { });
          return { outcome: "empty", detail: "navigated, no subtitles in page or XHR" };
        } catch (innerErr) {
          console.warn(`[transcript] ${input.videoId}: path-BC inner error: ${(innerErr as Error).message}`);
          await page.close().catch(() => { });
          return { outcome: "error", detail: (innerErr as Error).message.slice(0, 200) };
        }
      } catch (err) {
        console.warn(`[transcript] ${input.videoId}: path-BC failed: ${(err as Error).message}`);
        return { outcome: "error", detail: (err as Error).message.slice(0, 200) };
      }
    },
  };
}

export function makeCaptionFallbackStrategy(): TranscriptStrategy {
  return {
    name: "caption_fallback",
    // Local, zero-network computation; enum forces a label — the url fragment
    // (#transcript=caption_fallback:…) discloses what the row really is.
    scrapeMethod: "tiktok_desktop_http",
    perVideoTimeoutMs: null,
    async attempt(input): Promise<TranscriptStrategyResult> {
      // ── PATH E: Caption fallback — rule verbatim (>= 8 real words) ──
      const d = captionFallbackDecision(input.caption);
      if (d.ok) {
        console.log(`[transcript] ${input.videoId}: path-E caption fallback | ${d.realWordCount} real words (${d.hashtagCount} hashtags filtered)`);
        return {
          outcome: "success",
          transcript: { text: input.caption.trim(), wordCount: d.words.length, source: TRANSCRIPT_SOURCE.postCaption },
        };
      }
      if (input.caption && input.caption.trim().length >= 10) {
        console.log(`[transcript] ${input.videoId}: path-E rejected — caption too thin: ${d.realWordCount} real words, ${d.hashtagCount} hashtags`);
      }
      return { outcome: "empty", detail: `caption too thin (${d.realWordCount} real words)` };
    },
  };
}

/**
 * The production strategy list, in fallback order. Without options everything is
 * uncapped (the C1 structure-commit behavior, still used by tests).
 */
export function defaultTranscriptStrategies(opts?: {
  httpTimeoutMs?: number | null;
  httpFetch?: { timeout?: number; maxRetries?: number };
  browserTimeoutMs?: number | null;
}): TranscriptStrategy[] {
  return [
    makeSubtitleHttpStrategy({ perVideoTimeoutMs: opts?.httpTimeoutMs ?? null, httpFetch: opts?.httpFetch }),
    makeSubtitleBrowserStrategy({ perVideoTimeoutMs: opts?.browserTimeoutMs ?? null }),
    makeCaptionFallbackStrategy(),
  ];
}

// ─── Approved production budgets (C2) ─────────────────────────────────────────
// Rationale (approved Part 0 numbers) and the no-sacrifice consistency proof:
//   browser 20s  — nav timeout 15s + waits ~4-5s IS the current happy path; the
//                  race only kills hangs beyond it (evaluate/close stalls).
//   http 8s×2 + 12s race — today's worst case retried a blocked page for ~45s;
//                  a healthy page answers in ~0.4-1.5s.
//   phase 120s   — 12 videos × 20s cap ÷ pLimit(3) workers = 80s worst-case FULL
//                  browser coverage ≤ 120s, so the phase deadline mathematically
//                  cannot cut a within-cap attempt; it only bites when attempts
//                  exceed their own caps, which the per-video race prevents.
//   bail N=4     — 4 consecutive CLEAR "empty" browser results (navigated fine,
//                  zero subtitles). Browser attempts are conditioned on Path A
//                  having found nothing, so subtitle-rich creators rarely
//                  accumulate any; timeouts/errors never count (a slow page may
//                  still hold subtitles — real successes are never sacrificed).

export const TRANSCRIPT_BUDGETS = {
  browserPerVideoMs: 20_000,
  httpPerVideoMs: 12_000,
  httpFetch: { timeout: 8_000, maxRetries: 2 },
  phaseBudgetMs: 120_000,
  maxConsecutiveBrowserEmpties: 4,
} as const;

/** The strategy list with the approved production budgets applied. */
export function budgetedTranscriptStrategies(): TranscriptStrategy[] {
  return defaultTranscriptStrategies({
    httpTimeoutMs: TRANSCRIPT_BUDGETS.httpPerVideoMs,
    httpFetch: { ...TRANSCRIPT_BUDGETS.httpFetch },
    browserTimeoutMs: TRANSCRIPT_BUDGETS.browserPerVideoMs,
  });
}

/** The per-batch phase with the approved production budgets applied. */
export function budgetedTranscriptPhase(): TranscriptPhase {
  return createTranscriptPhase({
    phaseBudgetMs: TRANSCRIPT_BUDGETS.phaseBudgetMs,
    maxConsecutiveBrowserEmpties: TRANSCRIPT_BUDGETS.maxConsecutiveBrowserEmpties,
  });
}

// ─── Phase controller ─────────────────────────────────────────────────────────

export interface TranscriptPhaseStats {
  attempts: number;
  byStrategy: Record<string, Partial<Record<TranscriptOutcome, number>>>;
  browserDisabledAfterEmpties: boolean;
  deadlineHit: boolean;
}

export interface TranscriptPhase {
  /** May this strategy run right now? (deadline / early-bail gating) */
  shouldRun(strategy: TranscriptStrategy): { ok: boolean; reason?: string };
  /** Record an attempt outcome (drives the early-bail counter + stats). */
  noteOutcome(strategy: TranscriptStrategy, outcome: TranscriptOutcome): void;
  stats(): TranscriptPhaseStats;
}

/**
 * Shared per-batch state for the 12-video transcript phase.
 *
 * - phaseBudgetMs: once exceeded, expensive (browser) attempts stop; free
 *   strategies still run so no video is silently dropped.
 * - maxConsecutiveBrowserEmpties (early-bail N): after N consecutive CLEAR
 *   "empty" browser outcomes (navigated fine, zero subtitles) the browser path
 *   is disabled for the rest of the batch. Timeouts/errors deliberately do NOT
 *   count — a slow page might still have subtitles, and a real success must
 *   never be sacrificed for speed.
 *
 * Without options nothing ever gates (structure-commit neutrality).
 */
export function createTranscriptPhase(opts?: {
  phaseBudgetMs?: number;
  maxConsecutiveBrowserEmpties?: number;
  now?: () => number;
}): TranscriptPhase {
  const now = opts?.now ?? Date.now;
  const startedAt = now();
  const deadlineAt = opts?.phaseBudgetMs ? startedAt + opts.phaseBudgetMs : Infinity;
  const bailN = opts?.maxConsecutiveBrowserEmpties ?? Infinity;

  let consecutiveBrowserEmpties = 0;
  let browserDisabled = false;
  let deadlineHit = false;
  const byStrategy: TranscriptPhaseStats["byStrategy"] = {};
  let attempts = 0;

  return {
    shouldRun(strategy) {
      // Free strategies always run — budget gating is for the expensive path.
      if (strategy.scrapeMethod !== "tiktok_playwright") return { ok: true };
      if (browserDisabled) {
        return { ok: false, reason: `early-bail: ${bailN} consecutive subtitle-less browser results` };
      }
      if (now() > deadlineAt) {
        deadlineHit = true;
        return { ok: false, reason: "transcript-phase budget exceeded" };
      }
      return { ok: true };
    },
    noteOutcome(strategy, outcome) {
      attempts++;
      const s = (byStrategy[strategy.name] ??= {});
      s[outcome] = (s[outcome] ?? 0) + 1;
      if (strategy.scrapeMethod === "tiktok_playwright") {
        if (outcome === "empty") {
          consecutiveBrowserEmpties++;
          if (consecutiveBrowserEmpties >= bailN && !browserDisabled) {
            browserDisabled = true;
            console.log(`[transcript] early-bail: ${consecutiveBrowserEmpties} consecutive subtitle-less browser results — disabling the browser path for the rest of this batch`);
          }
        } else if (outcome === "success") {
          consecutiveBrowserEmpties = 0;
        }
        // timeouts/errors: neither count toward the bail nor reset it
      }
    },
    stats() {
      return { attempts, byStrategy, browserDisabledAfterEmpties: browserDisabled, deadlineHit };
    },
  };
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

/** Race an attempt against its per-video cap (no-op when uncapped). */
async function runWithCap(
  strategy: TranscriptStrategy,
  input: TranscriptVideoInput,
): Promise<TranscriptStrategyResult> {
  const capMs = strategy.perVideoTimeoutMs;
  if (!capMs) return strategy.attempt(input);
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<TranscriptStrategyResult>((resolve) => {
    timer = setTimeout(() => resolve({ outcome: "timeout", detail: `per-video cap ${capMs}ms exceeded` }), capMs);
  });
  try {
    // The loser keeps running to its own (inner) timeouts and cleans up its own
    // page — acceptable: the cap bounds BATCH progress, not process work.
    return await Promise.race([strategy.attempt(input), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export type EmitAttemptEvent = (event: {
  platform: "tiktok";
  scrapeMethod: TranscriptStrategy["scrapeMethod"];
  urlRequested: string;
  durationMs: number;
  failureReason?: string;
}) => void;

/**
 * Run the strategy chain for ONE video: first success wins; every attempt emits
 * exactly one telemetry event; skipped strategies (phase-gated) emit a "skipped"
 * record so fail-fast decisions stay visible in the run's evidence.
 */
export interface TranscriptSuccess {
  outcome: "success";
  transcript: NonNullable<TranscriptStrategyResult["transcript"]>;
  detail?: string;
}

export async function fetchVideoTranscript(
  input: TranscriptVideoInput,
  strategies: TranscriptStrategy[],
  phase: TranscriptPhase,
  emit: EmitAttemptEvent = recordScrapeEvent,
): Promise<{ result: TranscriptSuccess; strategy: TranscriptStrategy } | null> {
  for (const strategy of strategies) {
    const gate = phase.shouldRun(strategy);
    if (!gate.ok) {
      phase.noteOutcome(strategy, "skipped");
      emit({
        platform: "tiktok",
        scrapeMethod: strategy.scrapeMethod,
        urlRequested: `${input.videoUrl}#transcript=${strategy.name}:skipped`,
        durationMs: 0,
        failureReason: `transcript ${strategy.name}: skipped — ${gate.reason}`,
      });
      continue;
    }

    const started = Date.now();
    const result = await runWithCap(strategy, input);
    const durationMs = Date.now() - started;
    phase.noteOutcome(strategy, result.outcome);
    emit({
      platform: "tiktok",
      scrapeMethod: strategy.scrapeMethod,
      urlRequested: `${input.videoUrl}#transcript=${strategy.name}:${result.outcome}`,
      durationMs,
      // failure_reason ONLY on non-success, "transcript "-prefixed: the Run-panel
      // consequence derivation ignores these rows (they are per-video attempt
      // outcomes, not scrape-path failures).
      failureReason: result.outcome === "success"
        ? undefined
        : `transcript ${strategy.name}: ${result.outcome}${result.detail ? ` — ${result.detail}` : ""}`.slice(0, 500),
    });

    if (result.outcome === "success" && result.transcript) {
      return { result: { outcome: "success", transcript: result.transcript, detail: result.detail }, strategy };
    }
  }
  return null;
}
