/**
 * LLM pricing table — single source of truth for cost display/diagnostics.
 * USD per 1M tokens. Extracted from CreatorProfileCard.tsx (Session 6) so the
 * server-side run diagnostics and the client pipeline-metrics card compute the
 * same figures. Unknown models cost 0 (shown as unpriced, not guessed).
 */

export const MODEL_PRICING: Record<string, { input: number; output: number; label: string }> = {
  "gemini-2.5-flash": { input: 0.15, output: 0.60, label: "Gemini 2.5 Flash" },
  "gemini-2.5-pro": { input: 1.25, output: 10.00, label: "Gemini 2.5 Pro" },
  "gemini-2.0-flash": { input: 0.10, output: 0.40, label: "Gemini 2.0 Flash" },
  "gemini-1.5-flash": { input: 0.075, output: 0.30, label: "Gemini 1.5 Flash" },
  "gemini-1.5-pro": { input: 1.25, output: 5.00, label: "Gemini 1.5 Pro" },
};

/** Cost in USD for a token count under a given model; 0 for unknown models. */
export function computeLlmCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return 0;
  return (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;
}
