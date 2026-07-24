import { ENV } from "./env";
import { insertLlmInvocation } from "../db";

export type Role = "system" | "user" | "assistant" | "tool" | "function";

export type TextContent = {
  type: "text";
  text: string;
};

export type ImageContent = {
  type: "image_url";
  image_url: {
    url: string;
    detail?: "auto" | "low" | "high";
  };
};

export type FileContent = {
  type: "file_url";
  file_url: {
    url: string;
    mime_type?: "audio/mpeg" | "audio/wav" | "application/pdf" | "audio/mp4" | "video/mp4" ;
  };
};

export type MessageContent = string | TextContent | ImageContent | FileContent;

export type Message = {
  role: Role;
  content: MessageContent | MessageContent[];
  name?: string;
  tool_call_id?: string;
};

export type Tool = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
};

export type ToolChoicePrimitive = "none" | "auto" | "required";
export type ToolChoiceByName = { name: string };
export type ToolChoiceExplicit = {
  type: "function";
  function: {
    name: string;
  };
};

export type ToolChoice =
  | ToolChoicePrimitive
  | ToolChoiceByName
  | ToolChoiceExplicit;

export type InvokeParams = {
  messages: Message[];
  tools?: Tool[];
  toolChoice?: ToolChoice;
  tool_choice?: ToolChoice;
  maxTokens?: number;
  max_tokens?: number;
  temperature?: number;
  outputSchema?: OutputSchema;
  output_schema?: OutputSchema;
  responseFormat?: ResponseFormat;
  response_format?: ResponseFormat;
  /** Descriptive label for what this LLM call is doing (for logging) */
  purpose?: string;
  /** Subject UUID if available at call site */
  subjectId?: string;
  /** Observation UUID if available at call site */
  observationId?: string;
  /** Abort the request after this many ms (default 60_000). Prevents a hung call from blocking forever. */
  timeoutMs?: number;
};

export type ToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type InvokeResult = {
  id: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: Role;
      content: string | Array<TextContent | ImageContent | FileContent>;
      tool_calls?: ToolCall[];
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

export type JsonSchema = {
  name: string;
  schema: Record<string, unknown>;
  strict?: boolean;
};

export type OutputSchema = JsonSchema;

export type ResponseFormat =
  | { type: "text" }
  | { type: "json_object" }
  | { type: "json_schema"; json_schema: JsonSchema };

const ensureArray = (
  value: MessageContent | MessageContent[]
): MessageContent[] => (Array.isArray(value) ? value : [value]);

const normalizeContentPart = (
  part: MessageContent
): TextContent | ImageContent | FileContent => {
  if (typeof part === "string") {
    return { type: "text", text: part };
  }

  if (part.type === "text") {
    return part;
  }

  if (part.type === "image_url") {
    return part;
  }

  if (part.type === "file_url") {
    return part;
  }

  throw new Error("Unsupported message content part");
};

const normalizeMessage = (message: Message) => {
  const { role, name, tool_call_id } = message;

  if (role === "tool" || role === "function") {
    const content = ensureArray(message.content)
      .map(part => (typeof part === "string" ? part : JSON.stringify(part)))
      .join("\n");

    return {
      role,
      name,
      tool_call_id,
      content,
    };
  }

  const contentParts = ensureArray(message.content).map(normalizeContentPart);

  // If there's only text content, collapse to a single string for compatibility
  if (contentParts.length === 1 && contentParts[0].type === "text") {
    return {
      role,
      name,
      content: contentParts[0].text,
    };
  }

  return {
    role,
    name,
    content: contentParts,
  };
};

const normalizeToolChoice = (
  toolChoice: ToolChoice | undefined,
  tools: Tool[] | undefined
): "none" | "auto" | ToolChoiceExplicit | undefined => {
  if (!toolChoice) return undefined;

  if (toolChoice === "none" || toolChoice === "auto") {
    return toolChoice;
  }

  if (toolChoice === "required") {
    if (!tools || tools.length === 0) {
      throw new Error(
        "tool_choice 'required' was provided but no tools were configured"
      );
    }

    if (tools.length > 1) {
      throw new Error(
        "tool_choice 'required' needs a single tool or specify the tool name explicitly"
      );
    }

    return {
      type: "function",
      function: { name: tools[0].function.name },
    };
  }

  if ("name" in toolChoice) {
    return {
      type: "function",
      function: { name: toolChoice.name },
    };
  }

  return toolChoice;
};

const resolveApiUrl = () =>
  "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";

const assertApiKey = () => {
  if (!ENV.geminiApiKey) {
    throw new Error("GEMINI_API_KEY is not configured");
  }
};

const normalizeResponseFormat = ({
  responseFormat,
  response_format,
  outputSchema,
  output_schema,
}: {
  responseFormat?: ResponseFormat;
  response_format?: ResponseFormat;
  outputSchema?: OutputSchema;
  output_schema?: OutputSchema;
}):
  | { type: "json_schema"; json_schema: JsonSchema }
  | { type: "text" }
  | { type: "json_object" }
  | undefined => {
  const explicitFormat = responseFormat || response_format;
  if (explicitFormat) {
    if (
      explicitFormat.type === "json_schema" &&
      !explicitFormat.json_schema?.schema
    ) {
      throw new Error(
        "responseFormat json_schema requires a defined schema object"
      );
    }
    return explicitFormat;
  }

  const schema = outputSchema || output_schema;
  if (!schema) return undefined;

  if (!schema.name || !schema.schema) {
    throw new Error("outputSchema requires both name and schema");
  }

  return {
    type: "json_schema",
    json_schema: {
      name: schema.name,
      schema: schema.schema,
      ...(typeof schema.strict === "boolean" ? { strict: schema.strict } : {}),
    },
  };
};

export async function invokeLLM(params: InvokeParams): Promise<InvokeResult> {
  assertApiKey();

  const startTime = Date.now();
  const {
    messages,
    tools,
    toolChoice,
    tool_choice,
    outputSchema,
    output_schema,
    responseFormat,
    response_format,
    temperature,
    purpose,
    subjectId,
    observationId,
  } = params;

  const modelName = "gemini-2.5-flash";

  // Single fire-and-forget provenance path for success AND failure (womo_0005):
  // failed invocations record purpose, error, and duration — a failure that
  // took ~timeoutMs was a hang; one that took milliseconds was a bad request.
  const logInvocation = (outcome: {
    status: "success" | "failed";
    inputTokens?: number;
    outputTokens?: number;
    errorMessage?: string;
  }): void => {
    try {
      insertLlmInvocation({
        purpose: purpose ?? "unknown",
        model: modelName,
        promptVersion: "1.0",
        // Session 9: record the temperature actually sent so run config is
        // auditable. undefined/null = no temperature set → provider default.
        temperature: temperature ?? undefined,
        inputTokens: outcome.inputTokens,
        outputTokens: outcome.outputTokens,
        durationMs: Date.now() - startTime,
        subjectId: subjectId ?? undefined,
        observationId: observationId ?? undefined,
        status: outcome.status,
        errorMessage: outcome.errorMessage,
      }).catch(err => console.warn("[LLM] Invocation logging failed:", err));
    } catch (err) {
      console.warn("[LLM] Invocation logging failed:", err);
    }
  };

  try {
    return await invokeLLMInner();
  } catch (err) {
    logInvocation({
      status: "failed",
      errorMessage: (err instanceof Error ? err.message : String(err)).slice(0, 1000),
    });
    throw err;
  }

  async function invokeLLMInner(): Promise<InvokeResult> {
    const payload: Record<string, unknown> = {
      model: modelName,
      messages: messages.map(normalizeMessage),
    };

    if (tools && tools.length > 0) {
      payload.tools = tools;
    }

    const normalizedToolChoice = normalizeToolChoice(
      toolChoice || tool_choice,
      tools
    );
    if (normalizedToolChoice) {
      payload.tool_choice = normalizedToolChoice;
    }

    // Respect the caller's requested max output tokens; fall back to 32768.
    payload.max_tokens = params.maxTokens ?? params.max_tokens ?? 32768;
    if (temperature !== undefined) {
      payload.temperature = temperature;
    }

    const normalizedResponseFormat = normalizeResponseFormat({
      responseFormat,
      response_format,
      outputSchema,
      output_schema,
    });

    if (normalizedResponseFormat) {
      payload.response_format = normalizedResponseFormat;
    }

    // ─── Request with 429 retry ─────────────────────────────────────────────────
    // Gemini rate-limit responses (429) are retried with exponential backoff.
    // All other non-OK responses are thrown immediately.
    const RETRY_DELAYS_MS = [5_000, 15_000, 30_000];
    const timeoutMs = params.timeoutMs ?? 60_000;
    let response: Response | null = null;

    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      // Per-attempt AbortController so a hung Gemini socket can't block forever.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        response = await fetch(resolveApiUrl(), {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${ENV.geminiApiKey}`,
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
      } catch (err) {
        if (controller.signal.aborted) {
          throw new Error(
            `Gemini API request timed out after ${timeoutMs}ms` +
            (purpose ? ` (purpose: ${purpose})` : "")
          );
        }
        throw err;
      } finally {
        clearTimeout(timer);
      }

      if (response!.status === 429) {
        if (attempt < RETRY_DELAYS_MS.length) {
          const delayMs = RETRY_DELAYS_MS[attempt]!;
          console.warn(
            `[llm] Rate limited (429) — retry ${attempt + 1}/${RETRY_DELAYS_MS.length} in ${delayMs / 1000}s` +
            (purpose ? ` (purpose: ${purpose})` : "")
          );
          await new Promise(resolve => setTimeout(resolve, delayMs));
          continue;
        }
        // All retries exhausted
        throw new Error(
          "Gemini API rate limit exceeded. Please try again in a few minutes."
        );
      }

      // Not a 429 — break the retry loop (success or other error)
      break;
    }

    if (!response!.ok) {
      const errorText = await response!.text();
      throw new Error(
        `LLM invoke failed: ${response!.status} ${response!.statusText} – ${errorText}`
      );
    }

    const result = (await response!.json()) as InvokeResult;

    logInvocation({
      status: "success",
      inputTokens: result.usage?.prompt_tokens,
      outputTokens: result.usage?.completion_tokens,
    });

    return result;
  }
}
