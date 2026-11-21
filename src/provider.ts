import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { OPENAI_BASE_URL } from "./config.ts";
import { refreshModels } from "./catalog.ts";

export function registerCometapi(pi: ExtensionAPI): void {
  pi.registerProvider("CometAPI", {
    baseUrl: OPENAI_BASE_URL,
    api: "openai-completions",
    refreshModels,
  });
}
