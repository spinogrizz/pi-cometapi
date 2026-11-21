# pi-cometapi

A pi extension that adds one provider, CometAPI, to pi. The provider is built from CometAPI's live model catalog, and every model id is routed to the protocol that actually works on CometAPI, with metadata that matches the model. The repo root is the extension folder.

## What CometAPI is

CometAPI is a third-party API relay at api.cometapi.com (website cometapi.com). It aggregates many model families behind one API key, including Claude, Gemini, GPT and others. Its model catalog endpoint, `GET https://api.cometapi.com/v1/models` with Bearer auth, currently lists about 456 models.

## What the extension does

It registers one provider named CometAPI in pi. At startup and on refresh it fetches `/v1/models` and auto-discovers the full catalog. Each model id is routed to the protocol that works on CometAPI, with correct context, output, reasoning, image and cost metadata. There is no `models.json` to maintain and no provider duplication. When CometAPI adds a model, it appears automatically on the next refresh.

## What it fixes

### Claude adaptive thinking

pi's `forceAdaptiveThinking` is only consumed on the anthropic-messages protocol. Over a plain OpenAI-compatible relay route, Claude thinking does not engage.

The extension routes every `claude*` id through CometAPI's Anthropic-native surface, with baseUrl `https://api.cometapi.com`; the Anthropic SDK appends `/v1/messages` itself. pi's builtin Anthropic catalog metadata is reused: `claude-sonnet-5-5` and `claude-opus-5-5` get 1M context, 128K output, reasoning and image input, official cost, and the builtin thinking level map. Unknown claude ids get conservative 200K context and 64K output with adaptive defaults.

With that routing, `--thinking` levels work on Claude through CometAPI.

### Gemini tool calling

CometAPI's OpenAI-compatible endpoint `/v1/chat/completions` does not deliver the tool list to Gemini models. The model answers as if no tools exist: it claims tools are not mounted, and it may invent fake tool-call JSON in the text instead of emitting a real tool call. pi sends a correct OpenAI tools array in that request, so the gap sits in CometAPI's relay compatibility.

CometAPI documents a Google-native Gemini surface for function calling. The extension routes Gemini ids matching `gemini-4` and newer (regex `gemini-(?:[4-9]|[1-9]\d)`) through pi's google-generative-ai protocol at baseUrl `https://api.cometapi.com/v1beta`. That produces `POST https://api.cometapi.com/v1beta/models/{id}:streamGenerateContent?alt=sse` with tools as `functionDeclarations` and `x-goog-api-key` auth, which CometAPI accepts. Real tool calls then execute end to end.

Gemini metadata is 1M context and 32768 output, which is pi's builtin floor; the documented streaming cap is 65536. Reasoning and image input are enabled.

For thinking, `gemini-4-carbon` accepts only LOW, MEDIUM and HIGH. MINIMAL and `thinking_budget` are rejected with HTTP 400, so the extension maps off, minimal, xhigh and max to null and lets pi clamp, and maps low, medium and high to discrete levels. Cost for `gemini-4-carbon` uses CometAPI's confirmed list price of $1.60 input and $8.00 output per 1M tokens. Other gemini ids carry zero cost because their pricing is unconfirmed.

Gemini ids older than 4.x stay on the OpenAI-compatible route.

### Catalog resilience

pi treats an empty model array as a valid catalog and wipes the provider. The extension keeps a last-good in-memory cache. A failed refresh returns the previous catalog with a console warning instead of an empty array. A first-load failure throws, so pi keeps its previous snapshot rather than publishing an empty provider. The extension never returns an empty list.

### Everything else

Model ids that are neither claude nor gemini-4+ use openai-completions at `https://api.cometapi.com/v1` with conservative defaults: 128K context, 4096 output, and no reasoning flag.

## Install from scratch

pi must already be installed.

First, get a CometAPI API key at cometapi.com.

Then clone the repo and copy the extension folder into pi's extensions directory. The repo root is the folder; do not copy `.git`:

```
git clone https://github.com/spinogrizz/pi-cometapi.git
mkdir -p ~/.pi/agent/extensions/cometapi
cp -r pi-cometapi/index.ts pi-cometapi/src pi-cometapi/package.json ~/.pi/agent/extensions/cometapi/
```

The SSH clone URL works the same way: `git@github.com:spinogrizz/pi-cometapi.git`.

Start pi and run `/login CometAPI`, then paste the API key. Credentials resolve per machine by the provider name CometAPI from pi's auth storage. The extension never syncs or shares `auth.json`.

pi auto-discovers extensions in `~/.pi/agent/extensions/`, so no `settings.json` entry is needed.

## Verify

Check discovery:

```
pi --list-models | grep CometAPI
```

Expect hundreds of rows. `claude-sonnet-5-5` shows 1M context and 128K output with thinking yes; `gemini-4-carbon` shows 1M context and 32.8K output with thinking yes.

Run the smoke tests:

```
pi -p --provider CometAPI --model claude-sonnet-5-5 "Reply with exactly: OK"
pi -p --provider CometAPI --model claude-sonnet-5-5 --thinking high "Reply with exactly: OK"
pi -p --provider CometAPI --model gemini-4-carbon "Use your tools to list the files in the current working directory, then reply with just the file names."
```

The third command must produce a real directory listing from an executed tool call. Text that claims tools are unavailable, or a listing the model invented, is a failed check.

## Layout

```
pi-cometapi/
  package.json        name pi-cometapi, version 1.0.0, type module, manifest {"pi":{"extensions":["./index.ts"]}}
  index.ts            entry point; default export calls registerCometapi(pi)
  src/config.ts       endpoint constants (MODELS_URL, ANTHROPIC_BASE_URL, GOOGLE_BASE_URL, OPENAI_BASE_URL) and FETCH_TIMEOUT_MS (15 s)
  src/definitions.ts  builtin Anthropic and Google catalog maps, thinking maps, gemini id regex, definitionFor(id) per-model routing and metadata
  src/catalog.ts      catalog fetch with Bearer auth, last-good cache, refreshModels(context)
  src/provider.ts     registerCometapi(pi): pi.registerProvider("CometAPI", {baseUrl, api, refreshModels})
  README.md
```

There is no build step. pi loads TypeScript directly through jiti and resolves relative `.ts` imports. This is pi's documented folder-extension layout in pi docs/extensions.md, the same convention used by pi's own extension packages. The extension loader is identical in pi 1.5.2 and pi 1.6.0, and the extension is verified on both.

## Known limitations

Startup race. The catalog fetch is asynchronous and there is no persistence yet. The first pi invocation right after start can report `Unknown provider "CometAPI"` or omit CometAPI rows. It self-heals on retry after a few seconds.

Gemini ids older than 4.x remain on the OpenAI-compatible route, where CometAPI may not deliver tools.

CometAPI's Gemini relay intermittently returns a transient HTTP 400 `upstream_error` ("Invalid request parameters") or stalls after a tool result, especially with large tool outputs. This is upstream relay behavior and a retry succeeds. Basic generation and tool mounting are unaffected.

`gemini-4-carbon` sometimes answers with a role-play claim that it has no local tools instead of calling them, even when tools are mounted. A directive prompt such as "Use your tools to ..." resolves it. This is model behavior, not dropped tools.

Endpoints are hardcoded to api.cometapi.com. To use another relay, adapt `src/config.ts`.

There is no catalog persistence across processes yet. Each pi process fetches the catalog live.

## Why use it

One provider and one key cover the entire CometAPI catalog. Claude thinking and Gemini tool calling actually work, and both are broken on the plain OpenAI-compatible route. The model list needs no manual maintenance. The catalog behavior never wipes the provider.