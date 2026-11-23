import { getBuiltinModels } from "@earendil-works/pi-ai/providers/all";
import { ANTHROPIC_BASE_URL, GOOGLE_BASE_URL } from "./config.ts";

// Official Anthropic catalog (cost, context limits, thinking map, compat) reused as-is.
const OFFICIAL = new Map(
  getBuiltinModels("anthropic").map((model) => [model.id, model as (typeof model)]),
);

const GOOGLE_OFFICIAL = new Map(
  getBuiltinModels("google").map((model) => [model.id, model as (typeof model)]),
);
// CometAPI's Google surface rejects MINIMAL and unsupported thinking_budget
// values with HTTP 400 (confirmed on Carbon); null mappings make pi clamp
// instead of emitting them, applied conservatively to all gemini ids.
const GEMINI_THINKING = {
  off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: null, max: null,
} as const;
// Unknown claude-* ids still route via anthropic-messages; CometAPI relays Anthropic
// models on that endpoint, so we guess conservatively rather than mis-label limits.
const UNKNOWN_CLAUDE = {
  contextWindow: 200_000,
  maxTokens: 64_000,
  thinkingLevelMap: {
    off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max",
  } as const,
};

export type Definition = Record<string, unknown> & { id: string };

export function definitionFor(id: string): Definition {
  if (id.startsWith("claude")) {
    const official: any = OFFICIAL.get(id);
    return {
      id,
      name: official?.name ?? id,
      api: "anthropic-messages",
      baseUrl: ANTHROPIC_BASE_URL,
      reasoning: true,
      input: ["text", "image"],
      cost: official?.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: official?.contextWindow ?? UNKNOWN_CLAUDE.contextWindow,
      maxTokens: official?.maxTokens ?? UNKNOWN_CLAUDE.maxTokens,
      ...(official?.thinkingLevelMap
        ? { thinkingLevelMap: { ...official.thinkingLevelMap } }
        : { thinkingLevelMap: { ...UNKNOWN_CLAUDE.thinkingLevelMap } }),
      // Adaptive thinking is only consumed when forceAdaptiveThinking is set on an
      // anthropic-messages model, so it is required on every claude definition.
      compat: official?.api === "anthropic-messages"
        ? { ...official.compat }
        : { forceAdaptiveThinking: true },
    };
  }
  // All gemini ids go through CometAPI's Google-native surface: the OpenAI-compat
  // route silently drops tools for gemini ids. pi picks thinkingLevel vs
  // thinkingBudget per id itself. The google client ignores compat.
  if (id.startsWith("gemini")) {
    const official: any = GOOGLE_OFFICIAL.get(id);
    return {
      id,
      name: official?.name ?? id,
      api: "google-generative-ai",
      baseUrl: GOOGLE_BASE_URL,
      reasoning: true,
      input: ["text", "image"],
      // Only Carbon's CometAPI list price is confirmed; other gemini prices unknown.
      cost: id === "gemini-4-carbon"
        ? { input: 1.6, output: 8, cacheRead: 0, cacheWrite: 0 }
        : { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: official?.contextWindow ?? 1_048_576,
      maxTokens: official?.maxTokens ?? 32_768,
      thinkingLevelMap: { ...GEMINI_THINKING },
    };
  }
  // Everything else takes the provider defaults (openai-completions, /v1 baseUrl).
  return {
    id,
    name: id,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 4_096,
  };
}
