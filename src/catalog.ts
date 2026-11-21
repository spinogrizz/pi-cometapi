import type { RefreshModelsContext } from "@earendil-works/pi-ai";
import { MODELS_URL, FETCH_TIMEOUT_MS } from "./config.ts";
import { definitionFor } from "./definitions.ts";
import type { Definition } from "./definitions.ts";

// Last-good catalog: a failed refresh must never publish [], which the composer
// treats as a valid (empty) model list and would wipe the provider.
let lastGood: Definition[] = [];

export async function refreshModels(context: RefreshModelsContext): Promise<Definition[]> {
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
