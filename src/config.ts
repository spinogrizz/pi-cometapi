export const MODELS_URL = "https://api.cometapi.com/v1/models";
// The Anthropic SDK appends /v1/messages itself, so the Claude route must NOT include /v1.
export const ANTHROPIC_BASE_URL = "https://api.cometapi.com";
// CometAPI proxies Google's native Gemini surface. The pi google client hardcodes
// apiVersion "" whenever a baseUrl is set, so the version must live in the path.
export const GOOGLE_BASE_URL = "https://api.cometapi.com/v1beta";
export const OPENAI_BASE_URL = "https://api.cometapi.com/v1";
export const FETCH_TIMEOUT_MS = 15_000;
// Freshness window for the persisted catalog, mirroring pi-custom-providers.
export const CATALOG_TTL_MS = 7 * 24 * 60 * 60 * 1000;
