import type { RefreshModelsContext } from "@earendil-works/pi-ai";
import { MODELS_URL, FETCH_TIMEOUT_MS, CATALOG_TTL_MS } from "./config.ts";
import { definitionFor, type Definition } from "./definitions.ts";

const PROVIDER_ID = "CometAPI";

// Last-good catalog, seeded from pi's persistent store so a fresh process is never empty.
let lastGood: Definition[] = [];

// Accept a stored entry only if it is ours and non-empty; metadata is always rebuilt
// from ids via definitionFor, so stale stored metadata (e.g. pi-custom-providers
// fallback) can never mis-route claude/gemini.
function storedIds(stored: any): string[] | undefined {
  if (!stored || !Array.isArray(stored.models) || stored.models.length === 0) return undefined;
  const ids: string[] = [];
  for (const m of stored.models) {
    if (!m || typeof m.id !== "string" || m.id.length === 0 || m.provider !== PROVIDER_ID) return undefined;
    ids.push(m.id);
  }
  return ids;
}

function fresh(stored: any): boolean {
  return typeof stored?.checkedAt === "number" && Date.now() - stored.checkedAt < CATALOG_TTL_MS;
}

function catalogStoreEntry(ids: readonly string[]) {
  // Persist ids only (metadata rebuilt on restore). Never persist [].
  return { checkedAt: Date.now(), models: ids.map((id) => ({ id, provider: PROVIDER_ID })) };
}

async function fetchLiveIds(apiKey: string, signal?: AbortSignal): Promise<string[]> {
  const response = await fetch(MODELS_URL, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(FETCH_TIMEOUT_MS)])
      : AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  const payload: any = await response.json();
  const ids: string[] = Array.isArray(payload?.data)
    ? payload.data.flatMap((entry: any) =>
        entry && typeof entry.id === "string" && entry.id.length > 0 ? [entry.id] : [])
    : [];
  if (ids.length === 0) throw new Error("model catalog returned no models");
  return ids;
}

// Shared discovery state (pi-custom-providers models.ts:233-290): one opportunistic
// fetch per process; overlapping cache-only refreshes await the same promise instead
// of racing and aborting each other.
let preScopeAttempted = false;
let preScopeRefresh: Promise<Definition[]> | undefined;

async function refresh(context: RefreshModelsContext, preScope = false): Promise<Definition[]> {
  const stored: any = context.stored;
  const ids = storedIds(stored);
  // Invalid/stale entry: clear it so it cannot linger (pi-custom-providers models.ts:236).
  if (stored !== undefined && ids === undefined) {
    await context.publish({ persist: null });
  }
  const cached = (ids ?? []).map(definitionFor);
  if (cached.length > 0) lastGood = cached;

  const apiKey = context.credential?.type === "api_key" ? context.credential.key : undefined;
  // Cache-only restore phase (awaited BEFORE enabledModels eval) serves the rebuilt
  // store catalog with NO network; preScope may proceed when there is no catalog or a
  // stale one (TTL/force respected).
  if (context.signal.aborted
      || !(context.allowNetwork || preScope)
      || (!context.force && ids !== undefined && fresh(stored))
      || !apiKey) {
    return cached;
  }

  try {
    // Discovery is shared across superseding cache-only generations, so the request
    // uses its own timeout while each generation still guards publication with its signal.
    const liveIds = await fetchLiveIds(apiKey, preScope ? undefined : context.signal);
    const models = liveIds.map(definitionFor);
    // A superseding cache-only generation can still publish this shared discovery result.
    if (context.signal.aborted) return preScope ? models : cached;
    const published = await context.publish({ persist: catalogStoreEntry(liveIds) });
    lastGood = models;
    return published || preScope ? models : cached;
  } catch (error) {
    if (lastGood.length > 0) {
      if (!context.signal.aborted) {
        console.warn(`[cometapi] refresh failed (${error instanceof Error ? error.message : error}); keeping last-good catalog`);
      }
      return lastGood;
    }
    // First-load failure with no cache: throw so pi keeps its previous snapshot; never wipe.
    throw error;
  }
}

export function refreshModels(context: RefreshModelsContext): Promise<Definition[]> {
  if (!context.allowNetwork && preScopeRefresh) {
    // Relay the in-flight shared discovery: a superseding cache-only refresh publishes
    // the shared result instead of starting a duplicate fetch.
    return preScopeRefresh.then(async (models) => {
      if (context.signal.aborted || models.length === 0) return [];
      const published = await context.publish({
        persist: catalogStoreEntry(models.map(({ id }) => id)),
      });
      // A failed publish means a superseding generation owns state; still return the
      // good models rather than an empty list.
      return models;
    });
  }
  const apiKey = context.credential?.type === "api_key" ? context.credential.key : undefined;
  if (!context.allowNetwork && !preScopeAttempted && apiKey
      && process.env.PI_OFFLINE === undefined && !context.signal.aborted) {
    preScopeAttempted = true;
    const promise = Promise.resolve()
      .then(() => refresh(context, true))
      // Discovery is opportunistic, so a failed fetch degrades to cache-only.
      .catch(() => refresh(context));
    preScopeRefresh = promise;
    promise
      .finally(() => { if (preScopeRefresh === promise) preScopeRefresh = undefined; })
      .catch(() => {});
    return promise;
  }
  return refresh(context);
}
