/**
 * Voice transcription helper using OpenAI Whisper API (direct)
 *
 * Phase 1 change: calls OpenAI Whisper directly via OPENAI_API_KEY
 * instead of routing through the Forge proxy. Same payload format,
 * same response structure.
 *
 * Known limitation: TikTok playAddr downloads will still fail
 * intermittently (pre-existing issue — not a Phase 1 blocker).
 *
 * Frontend implementation guide:
 * 1. Capture audio using MediaRecorder API
 * 2. Upload audio to storage (e.g., S3) to get URL
 * 3. Call transcription with the URL
 * 
 * Example usage:
 * ```tsx
 * // Frontend component
 * const transcribeMutation = trpc.voice.transcribe.useMutation({
 *   onSuccess: (data) => {
 *     console.log(data.text); // Full transcription
 *     console.log(data.language); // Detected language
 *     console.log(data.segments); // Timestamped segments
 *   }
 * });
 * 
 * // After uploading audio to storage
 * transcribeMutation.mutate({
 *   audioUrl: uploadedAudioUrl,
 *   language: 'en', // optional
 *   prompt: 'Transcribe the meeting' // optional
 * });
 * ```
 */
import { ENV } from "./env";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * WHICH ENGINE IS ACTUALLY RUNNING.
 *
 * `transcribeAudioInner` routes to Gemini whenever OPENAI_API_KEY is absent,
 * and it has been absent — so every Instagram transcript in the corpus came
 * from Gemini audio while the telemetry said `whisper` and its failures read
 * "transcript whisper: FILE_TOO_LARGE". The label named a path that was not
 * running.
 *
 * The `scrape_method` ENUM value stays `whisper_transcription` — it is a
 * database enum covering both variants, and this module's contract has always
 * been that provenance detail lives in the failure reason and the URL. This is
 * what lets a caller put the real engine there.
 */
export type TranscriptionEngine = "whisper" | "gemini_audio";

export function activeTranscriptionEngine(): TranscriptionEngine {
  return ENV.openaiApiKey ? "whisper" : "gemini_audio";
}

// ─── Audio extraction ────────────────────────────────────────────────────────
//
// WHY: Instagram reels are sent to the model as the WHOLE MP4. Measured
// 2026-07-30 across five creators: 6 of 26 transcription attempts were refused
// at 15.7–57.0 MB against a 15 MB ceiling — AFTER the file had been fully
// downloaded (294 MB of reel video pulled in one run). The video track is
// ~99% of those bytes and the model only ever listens to the audio.
//
// HOW, and what it costs: the system `ffmpeg`, spawned, no npm dependency
// added. 16 kHz mono MP3 at 64 kbps — the canonical speech-to-text input, and
// roughly 0.5 MB per minute of reel against tens of MB of video. The Gemini
// path base64-encodes its payload inline (+33%), so this cuts the upload by
// about two orders of magnitude as well as clearing the ceiling.
//
// IT IS OPTIONAL BY CONSTRUCTION. If ffmpeg is absent, or the demux fails, or
// it produces nothing, this returns null and the caller sends what it already
// had — exactly today's behaviour. That matters twice over: this repo is
// heading for a packaged Electron app, where a system ffmpeg is NOT guaranteed
// (see electron/README.md), and a transcription path must never become
// dependent on a binary that may not ship.
const FFMPEG_TIMEOUT_MS = 30_000;

/**
 * ─── Resolving the binary, including inside a packaged app ──────────────────
 *
 * `ffmpeg-static` is a DEPENDENCY, not a system assumption: the extraction has
 * to work on every machine that runs this, and "the analyst happened to brew
 * install ffmpeg" is not a property we can rely on.
 *
 * THE PACKAGING TRAP, solved here rather than when the .dmg is built.
 * electron-builder packs `node_modules` into `app.asar`, and `ffmpeg-static`
 * resolves its path at runtime by joining `__dirname` — so in a packaged app it
 * hands back `…/app.asar/node_modules/ffmpeg-static/ffmpeg`. asar is a virtual
 * archive: a path inside it can be READ by Electron's patched fs, but it is not
 * a real file on disk and `spawn` cannot execute it. This is the same class as
 * the Playwright unpacking already on the packaging list (electron/README.md).
 *
 * Two halves, and BOTH are required:
 *   1. HERE — rewrite `app.asar` → `app.asar.unpacked` in the resolved path.
 *   2. PACKAGING — `asarUnpack` must include ffmpeg-static so that directory
 *      actually exists. Recorded in electron/README.md next to Playwright's.
 *
 * The system binary remains a fallback for a dev machine with no install step,
 * and null (extraction skipped, whole video sent) remains the floor. A
 * transcription path must never harden into a dependency on a binary that may
 * not ship.
 */
let ffmpegPathResolved: string | null | undefined;

async function resolveFfmpeg(): Promise<string | null> {
  if (ffmpegPathResolved !== undefined) return ffmpegPathResolved;

  const candidates: string[] = [];
  try {
    const mod = await import("ffmpeg-static");
    const raw = ((mod as { default?: unknown }).default ?? mod) as unknown;
    if (typeof raw === "string" && raw.length > 0) {
      // The asar rewrite. Harmless when unpacked — no `app.asar` in the path.
      candidates.push(raw.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`));
      if (!candidates.includes(raw)) candidates.push(raw);
    }
  } catch {
    // Module absent — fall through to the system binary.
  }
  candidates.push("ffmpeg"); // PATH lookup, the dev-machine fallback

  for (const candidate of candidates) {
    const works = await new Promise<boolean>((resolve) => {
      try {
        const p = spawn(candidate, ["-version"], { stdio: "ignore" });
        p.on("error", () => resolve(false));
        p.on("close", (code) => resolve(code === 0));
      } catch { resolve(false); }
    });
    if (works) {
      ffmpegPathResolved = candidate;
      console.log(`[voiceTranscription] ffmpeg: ${candidate === "ffmpeg" ? "system binary on PATH" : candidate}`);
      return ffmpegPathResolved;
    }
  }

  ffmpegPathResolved = null;
  console.warn("[voiceTranscription] no usable ffmpeg — reels will be sent as whole video files");
  return null;
}

/**
 * Strip everything but the speech. Returns null when extraction is not possible,
 * which the caller must treat as "send the original".
 *
 * A temp FILE rather than a stdin pipe on purpose: an MP4 whose `moov` atom sits
 * at the end is not demuxable from a non-seekable stream, and Instagram's CDN
 * does not guarantee faststart. A pipe would work most of the time, which is the
 * worst property a fallback can have.
 */
export async function extractAudioTrack(
  video: Buffer,
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const ffmpeg = await resolveFfmpeg();
  if (!ffmpeg) return null;

  let dir: string | null = null;
  try {
    dir = await mkdtemp(path.join(tmpdir(), "womo-audio-"));
    const inPath = path.join(dir, "in.mp4");
    const outPath = path.join(dir, "out.mp3");
    await writeFile(inPath, video);

    const ok = await new Promise<boolean>((resolve) => {
      const p = spawn(ffmpeg, [
        "-nostdin", "-loglevel", "error", "-y",
        "-i", inPath,
        "-vn",                    // drop the video track — the whole point
        "-ac", "1",               // mono
        "-ar", "16000",           // 16 kHz: what speech models want
        "-b:a", "64k",
        "-f", "mp3", outPath,
      ], { stdio: "ignore" });
      const timer = setTimeout(() => { try { p.kill("SIGKILL"); } catch { /* */ } resolve(false); }, FFMPEG_TIMEOUT_MS);
      p.on("error", () => { clearTimeout(timer); resolve(false); });
      p.on("close", (code) => { clearTimeout(timer); resolve(code === 0); });
    });
    if (!ok) return null;

    const audio = await readFile(outPath);
    // A silent or video-only reel yields a near-empty file; that is not an
    // extraction we should send, and the caller's own empty check would only
    // see it after paying for the upload.
    if (audio.length < 1024) return null;
    return { buffer: audio, mimeType: "audio/mpeg" };
  } catch (err) {
    console.warn(`[voiceTranscription] audio extraction failed: ${(err as Error).message}`);
    return null;
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => { /* temp dir */ });
  }
}

/**
 * fetch() with an AbortController timeout so a stalled download or transcription
 * request can't hang the reel batch forever. Default 60s. On timeout the abort
 * surfaces as a rejected fetch, which the callers already catch and map to a
 * TranscriptionError.
 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 60_000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export type TranscribeOptions = {
  audioUrl: string; // URL to the audio file (e.g., S3 URL)
  language?: string; // Optional: specify language code (e.g., "en", "es", "zh")
  prompt?: string; // Optional: custom prompt for the transcription
  audioBuffer?: Buffer; // Optional: pre-downloaded audio data (skips URL fetch)
  mimeType?: string; // Optional: MIME type when audioBuffer is provided
};

// Native Whisper API segment format
export type WhisperSegment = {
  id: number;
  seek: number;
  start: number;
  end: number;
  text: string;
  tokens: number[];
  temperature: number;
  avg_logprob: number;
  compression_ratio: number;
  no_speech_prob: number;
};

// Native Whisper API response format
export type WhisperResponse = {
  task: "transcribe";
  language: string;
  duration: number;
  text: string;
  segments: WhisperSegment[];
};

export type TranscriptionResponse = WhisperResponse; // Return native Whisper API response directly

export type TranscriptionError = {
  error: string;
  code: "FILE_TOO_LARGE" | "INVALID_FORMAT" | "TRANSCRIPTION_FAILED" | "UPLOAD_FAILED" | "SERVICE_ERROR";
  details?: string;
};

/**
 * Transcribe audio to text using the internal Speech-to-Text service
 *
 * @param options - Audio data and metadata
 * @returns Transcription result or error
 */
export async function transcribeAudio(
  options: TranscribeOptions
): Promise<TranscriptionResponse | TranscriptionError> {
  /*
    ─── This used to emit a scrape_event of its own. It was a DUPLICATE ───────
    Every Instagram transcription was logged twice: once here with a null
    platform and the raw CDN URL, and once by the caller
    (`transcribeInstagramReels`) with the platform, the reel id and the
    `#transcribe=speech:<outcome>` attempt fragment — 2 ms apart, with identical
    `duration_ms`. Measured: 52 rows for 26 attempts, doubling every per-method
    count anyone tried to read.

    The caller's row is the one kept: it is the only one that knows WHICH reel
    and WHICH platform, and it carries the attempt-class prefix `deriveCaptureHealth`
    reads. What this layer knows and the caller does not — which engine ran — is
    published as `activeTranscriptionEngine()` instead, so the surviving row can
    name it. One attempt, one event.
  */
  return transcribeAudioInner(options);
}

async function transcribeAudioInner(
  options: TranscribeOptions
): Promise<TranscriptionResponse | TranscriptionError> {
  try {
    // Step 1: Validate environment configuration
    if (!ENV.openaiApiKey && !ENV.geminiApiKey) {
      return {
        error: "Voice transcription service is not configured",
        code: "SERVICE_ERROR",
        details: "Neither OPENAI_API_KEY nor GEMINI_API_KEY is set"
      };
    }

    // If OpenAI is not available but Gemini is, use Gemini transcription
    if (!ENV.openaiApiKey && ENV.geminiApiKey) {
      return transcribeWithGemini(options);
    }

    // Step 2: Download audio from URL
    let audioBuffer: Buffer;
    let mimeType: string;
    try {
      const response = await fetchWithTimeout(options.audioUrl);
      if (!response.ok) {
        return {
          error: "Failed to download audio file",
          code: "INVALID_FORMAT",
          details: `HTTP ${response.status}: ${response.statusText}`
        };
      }
      
      audioBuffer = Buffer.from(await response.arrayBuffer());
      mimeType = response.headers.get('content-type') || 'audio/mpeg';
      
      // Check file size (16MB limit)
      const sizeMB = audioBuffer.length / (1024 * 1024);
      if (sizeMB > 16) {
        return {
          error: "Audio file exceeds maximum size limit",
          code: "FILE_TOO_LARGE",
          details: `File size is ${sizeMB.toFixed(2)}MB, maximum allowed is 16MB`
        };
      }
    } catch (error) {
      return {
        error: "Failed to fetch audio file",
        code: "SERVICE_ERROR",
        details: error instanceof Error ? error.message : "Unknown error"
      };
    }

    // Step 3: Create FormData for multipart upload to Whisper API
    const formData = new FormData();
    
    // Create a Blob from the buffer and append to form
    const filename = `audio.${getFileExtension(mimeType)}`;
    const audioBlob = new Blob([new Uint8Array(audioBuffer)], { type: mimeType });
    formData.append("file", audioBlob, filename);
    
    formData.append("model", "whisper-1");
    formData.append("response_format", "verbose_json");
    
    // Add prompt - use custom prompt if provided, otherwise generate based on language
    const prompt = options.prompt || (
      options.language 
        ? `Transcribe the user's voice to text, the user's working language is ${getLanguageName(options.language)}`
        : "Transcribe the user's voice to text"
    );
    formData.append("prompt", prompt);

    // Step 4: Call the OpenAI Whisper API directly
    const fullUrl = "https://api.openai.com/v1/audio/transcriptions";

    const response = await fetchWithTimeout(fullUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${ENV.openaiApiKey}`,
        "Accept-Encoding": "identity",
      },
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      return {
        error: "Transcription service request failed",
        code: "TRANSCRIPTION_FAILED",
        details: `${response.status} ${response.statusText}${errorText ? `: ${errorText}` : ""}`
      };
    }

    // Step 5: Parse and return the transcription result
    const whisperResponse = await response.json() as WhisperResponse;
    
    // Validate response structure
    if (!whisperResponse.text || typeof whisperResponse.text !== 'string') {
      return {
        error: "Invalid transcription response",
        code: "SERVICE_ERROR",
        details: "Transcription service returned an invalid response format"
      };
    }

    return whisperResponse; // Return native Whisper API response directly

  } catch (error) {
    // Handle unexpected errors
    return {
      error: "Voice transcription failed",
      code: "SERVICE_ERROR",
      details: error instanceof Error ? error.message : "An unexpected error occurred"
    };
  }
}

/**
 * Helper function to get file extension from MIME type
 */
function getFileExtension(mimeType: string): string {
  const mimeToExt: Record<string, string> = {
    'audio/webm': 'webm',
    'audio/mp3': 'mp3',
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
    'audio/wave': 'wav',
    'audio/ogg': 'ogg',
    'audio/m4a': 'm4a',
    'audio/mp4': 'm4a',
  };
  
  return mimeToExt[mimeType] || 'audio';
}

/**
 * Helper function to get full language name from ISO code
 */
function getLanguageName(langCode: string): string {
  const langMap: Record<string, string> = {
    'en': 'English',
    'es': 'Spanish',
    'fr': 'French',
    'de': 'German',
    'it': 'Italian',
    'pt': 'Portuguese',
    'ru': 'Russian',
    'ja': 'Japanese',
    'ko': 'Korean',
    'zh': 'Chinese',
    'ar': 'Arabic',
    'hi': 'Hindi',
    'nl': 'Dutch',
    'pl': 'Polish',
    'tr': 'Turkish',
    'sv': 'Swedish',
    'da': 'Danish',
    'no': 'Norwegian',
    'fi': 'Finnish',
  };
  
  return langMap[langCode] || langCode;
}

/**
 * Example tRPC procedure implementation:
 * 
 * ```ts
 * // In server/routers.ts
 * import { transcribeAudio } from "./_core/voiceTranscription";
 * 
 * export const voiceRouter = router({
 *   transcribe: protectedProcedure
 *     .input(z.object({
 *       audioUrl: z.string(),
 *       language: z.string().optional(),
 *       prompt: z.string().optional(),
 *     }))
 *     .mutation(async ({ input, ctx }) => {
 *       const result = await transcribeAudio(input);
 *       
 *       // Check if it's an error
 *       if ('error' in result) {
 *         throw new TRPCError({
 *           code: 'BAD_REQUEST',
 *           message: result.error,
 *           cause: result,
 *         });
 *       }
 *       
 *       // Optionally save transcription to database
 *       await db.insert(transcriptions).values({
 *         userId: ctx.user.id,
 *         text: result.text,
 *         duration: result.duration,
 *         language: result.language,
 *         audioUrl: input.audioUrl,
 *         createdAt: new Date(),
 *       });
 *       
 *       return result;
 *     }),
 * });
 * ```
 */

// ─── Gemini Audio Transcription (fallback when OpenAI is unavailable) ──────────

async function transcribeWithGemini(
  options: TranscribeOptions
): Promise<TranscriptionResponse | TranscriptionError> {
  try {
    // Step 1: Get audio data (use pre-downloaded buffer or fetch from URL)
    let audioBuffer: Buffer;
    let mimeType: string;

    if (options.audioBuffer) {
      // Pre-downloaded buffer provided — skip network fetch
      audioBuffer = options.audioBuffer;
      mimeType = options.mimeType || "video/mp4";
      const rawMB = audioBuffer.length / (1024 * 1024);
      console.log(`[voiceTranscription] Gemini: using pre-downloaded buffer (${rawMB.toFixed(1)}MB, ${mimeType})`);

      /*
        STRIP THE VIDEO BEFORE THE SIZE CHECK, not after it refuses.
        The model listens to audio; the video track is ~99% of the bytes and
        100% of the reason 6 of 26 attempts were refused over the ceiling. When
        ffmpeg is unavailable this returns null and everything below behaves
        exactly as it did.
      */
      if (mimeType.startsWith("video/")) {
        const extracted = await extractAudioTrack(audioBuffer);
        if (extracted) {
          audioBuffer = extracted.buffer;
          mimeType = extracted.mimeType;
          console.log(
            `[voiceTranscription] Gemini: extracted audio ${rawMB.toFixed(1)}MB video → ` +
            `${(audioBuffer.length / (1024 * 1024)).toFixed(2)}MB ${mimeType}`,
          );
        }
      }

      const sizeMB = audioBuffer.length / (1024 * 1024);
      if (sizeMB > 15) {
        return { error: "Audio file too large", code: "FILE_TOO_LARGE", details: `${sizeMB.toFixed(1)}MB exceeds 15MB limit` };
      }
      if (sizeMB < 0.001) {
        return { error: "Audio file empty", code: "INVALID_FORMAT", details: "Downloaded file is empty" };
      }
    } else {
      try {
        console.log(`[voiceTranscription] Gemini: downloading audio from ${options.audioUrl.slice(0, 100)}...`);
        const response = await fetchWithTimeout(options.audioUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15",
            "Accept": "*/*",
            "Referer": "https://www.instagram.com/",
          },
        });
        if (!response.ok) {
          console.log(`[voiceTranscription] Gemini: download failed — HTTP ${response.status}`);
          return { error: "Failed to download audio file", code: "INVALID_FORMAT", details: `HTTP ${response.status}: ${response.statusText}` };
        }
        audioBuffer = Buffer.from(await response.arrayBuffer());
        mimeType = response.headers.get("content-type") || "audio/mpeg";
        if (mimeType.includes("video/mp4")) mimeType = "video/mp4";
        if (mimeType.includes("octet-stream")) mimeType = "video/mp4";
        console.log(`[voiceTranscription] Gemini: downloaded ${(audioBuffer.length / (1024 * 1024)).toFixed(1)}MB, mimeType=${mimeType}`);
        // Same strip as the pre-downloaded branch — see the note there.
        if (mimeType.startsWith("video/")) {
          const extracted = await extractAudioTrack(audioBuffer);
          if (extracted) { audioBuffer = extracted.buffer; mimeType = extracted.mimeType; }
        }
        const sizeMB = audioBuffer.length / (1024 * 1024);
        if (sizeMB > 15) {
          return { error: "Audio file too large", code: "FILE_TOO_LARGE", details: `${sizeMB.toFixed(1)}MB exceeds 15MB limit` };
        }
        if (sizeMB < 0.001) {
          return { error: "Audio file empty", code: "INVALID_FORMAT", details: "Downloaded file is empty" };
        }
      } catch (error) {
        console.log(`[voiceTranscription] Gemini: download error — ${(error as Error).message}`);
        return { error: "Failed to fetch audio", code: "SERVICE_ERROR", details: (error as Error).message };
      }
    }

    // Step 2: Convert to base64
    const base64Audio = audioBuffer.toString("base64");

    // Step 3: Call Gemini API with inline audio
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${ENV.geminiApiKey}`;

    const payload = {
      contents: [{
        parts: [
          {
            inlineData: {
              mimeType,
              data: base64Audio,
            }
          },
          {
            text: "Transcribe ALL spoken words in this audio precisely. Output ONLY the raw transcript text with no labels, timestamps, or formatting. If there are no spoken words, respond with exactly: [NO_SPEECH]"
          }
        ]
      }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 4096,
      }
    };

    const response = await fetchWithTimeout(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      console.log(`[voiceTranscription] Gemini API error: ${response.status} — ${errText.slice(0, 300)}`);
      return { error: "Gemini transcription failed", code: "TRANSCRIPTION_FAILED", details: `${response.status}: ${errText.slice(0, 200)}` };
    }

    const geminiResult = await response.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };

    const text = geminiResult.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "";

    if (!text || text === "[NO_SPEECH]" || text.length < 5) {
      return { error: "No speech detected", code: "TRANSCRIPTION_FAILED", details: "Gemini detected no spoken words" };
    }

    // Remove any markdown/formatting Gemini might add
    const cleanText = text
      .replace(/^```[a-z]*\n?/gm, "")
      .replace(/```$/gm, "")
      .replace(/^\*\*.*?\*\*\s*/gm, "")
      .trim();

    console.log(`[voiceTranscription] Gemini transcribed ${cleanText.split(/\s+/).length} words`);

    // Return in same shape as Whisper response
    return {
      task: "transcribe",
      language: options.language || "en",
      duration: 0, // Gemini doesn't return duration
      text: cleanText,
      segments: [], // Gemini doesn't return segments
    };

  } catch (error) {
    return { error: "Gemini transcription failed", code: "SERVICE_ERROR", details: (error as Error).message };
  }
}
