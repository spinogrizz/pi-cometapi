import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { RefreshModelsContext } from "@earendil-works/pi-ai";
import { getBuiltinModels } from "@earendil-works/pi-ai/providers/all";

const MODELS_URL = "https://api.cometapi.com/v1/models";
// The Anthropic SDK appends /v1/messages itself, so the Claude route must NOT include /v1.
const ANTHROPIC_BASE_URL = "https://api.cometapi.com";
const FETCH_TIMEOUT_MS = 15_000;

// Official Anthropic catalog (cost, context limits, thinking map, compat) reused as-is.
const OFFICIAL = new Map(
  getBuiltinModels("anthropic").map((model) => [model.id, model as (typeof model)]),
);

// CometAPI proxies Google's native Gemini surface. The pi google client hardcodes
// apiVersion "" whenever a baseUrl is set, so the version must live in the path.
const GOOGLE_BASE_URL = "https://api.cometapi.com/v1beta";
const GOOGLE_OFFICIAL = new Map(
  getBuiltinModels("google").map((model) => [model.id, model as (typeof model)]),
);
// Carbon accepts only LOW/MEDIUM/HIGH; null mappings make pi clamp instead of
// emitting MINIMAL or thinking_budget, both of which return HTTP 400.
const GEMINI_THINKING = {
  off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: null, max: null,
} as const;
// pi uses discrete thinkingLevel exactly for ids matching this pattern; older
// gemini ids use thinkingBudget, which this string map does not describe, so they
// stay on the OpenAI-compatible route.
const GEMINI_LEVEL_ID = /gemini-(?:[4-9]|[1-9]\d)/;

// Unknown claude-* ids still route via anthropic-messages; CometAPI relays Anthropic
// models on that endpoint, so we guess conservatively rather than mis-label limits.
const UNKNOWN_CLAUDE = {
  contextWindow: 200_000,
  maxTokens: 64_000,
  thinkingLevelMap: {
    off: null, minimal: null, low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max",
  } as const,
};

type Definition = Record<string, unknown> & { id: string };

function definitionFor(id: string): Definition {
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
  // Gemini 4+ goes through CometAPI's Google-native surface: the OpenAI-compat
  // route silently drops tools for gemini ids. The google client ignores compat.
  if (GEMINI_LEVEL_ID.test(id)) {
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

// Last-good catalog: a failed refresh must never publish [], which the composer
// treats as a valid (empty) model list and would wipe the provider.
let lastGood: Definition[] = [];

async function refreshModels(context: RefreshModelsContext): Promise<Definition[]> {
  try {
    const apiKey = context.credential?.type === "api_key" ? context.credential.key : undefined;
    if (!apiKey) throw new Error("no CometAPI credential configured");
    const response = await fetch(MODELS_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.any([context.signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)]),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    const payload: any = await response.json();
    const ids: string[] = Array.isArray(payload?.data)
      ? payload.data.flatMap((entry: any) =>
        entry && typeof entry.id === "string" && entry.id.length > 0 ? [entry.id] : [])
      : [];
    if (ids.length === 0) throw new Error("model catalog returned no models");
    const models = ids.map(definitionFor);
    lastGood = models;
    return models;
  } catch (error) {
    if (lastGood.length > 0 && !context.signal.aborted) {
      console.warn(`[cometapi] refresh failed (${error instanceof Error ? error.message : error}); keeping last-good catalog`);
      return lastGood;
    }
    // First-load failure: throwing keeps the previous snapshot untouched instead
    // of publishing an empty catalog; pi reports it in the refresh result errors.
    throw error;
  }
}

export default function (pi: ExtensionAPI) {
  pi.registerProvider("CometAPI", {
    baseUrl: "https://api.cometapi.com/v1",
    api: "openai-completions",
    refreshModels,
  });
}
