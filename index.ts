import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerCometapi } from "./src/provider.ts";

export default function (pi: ExtensionAPI) {
  registerCometapi(pi);
}
