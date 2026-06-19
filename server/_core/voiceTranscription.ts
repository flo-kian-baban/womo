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
      const response = await fetch(options.audioUrl);
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

    const response = await fetch(fullUrl, {
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
      const sizeMB = audioBuffer.length / (1024 * 1024);
      console.log(`[voiceTranscription] Gemini: using pre-downloaded buffer (${sizeMB.toFixed(1)}MB, ${mimeType})`);
      if (sizeMB > 50) {
        return { error: "Audio file too large", code: "FILE_TOO_LARGE", details: `${sizeMB.toFixed(1)}MB exceeds 50MB limit` };
      }
      if (sizeMB < 0.001) {
        return { error: "Audio file empty", code: "INVALID_FORMAT", details: "Downloaded file is empty" };
      }
    } else {
      try {
        console.log(`[voiceTranscription] Gemini: downloading audio from ${options.audioUrl.slice(0, 100)}...`);
        const response = await fetch(options.audioUrl, {
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
        const sizeMB = audioBuffer.length / (1024 * 1024);
        console.log(`[voiceTranscription] Gemini: downloaded ${sizeMB.toFixed(1)}MB, mimeType=${mimeType}`);
        if (sizeMB > 50) {
          return { error: "Audio file too large", code: "FILE_TOO_LARGE", details: `${sizeMB.toFixed(1)}MB exceeds 50MB limit` };
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

    const response = await fetch(geminiUrl, {
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
