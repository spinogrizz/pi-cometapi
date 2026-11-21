# pi-cometapi

pi-cometapi is a single-file TypeScript extension for the pi coding agent. It registers CometAPI (https://api.cometapi.com) as one provider, discovers the full model catalog at session start, and routes Claude models over the Anthropic-native protocol and Gemini 4+ models over the Google-native protocol, while other models use the OpenAI-compatible protocol. The extension is one file, `cometapi.ts`, about 100 lines.

## What it fixes

These problems were reproduced with pi-custom-providers 0.4.3 and pi 1.6.0 when CometAPI was configured through the generic custom provider extension. Each fix below corresponds to one of them.

**Catalog authentication.** CometAPI's `GET /v1/models` accepts only `Authorization: Bearer`. The anthropic-mode discovery in pi-custom-providers sends `x-api-key` instead, so the catalog request fails. This extension always fetches the catalog with a Bearer token.

**URL doubling.** pi-custom-providers appends `/v1/models` to a baseUrl that already ends in `/v1`, which produces `/v1/v1/models`. This extension requests the correct URL.

**Catalog wipe on a failed refresh.** pi core treats an empty array returned from `refreshModels` as a valid catalog and empties the provider, so one failed refresh in pi-custom-providers can erase every CometAPI model. This extension keeps the last successful list in memory and never returns an empty list on error. On a first-load failure it throws, and pi records that as a refresh error without wiping anything.

**Claude adaptive thinking.** pi's `compat.forceAdaptiveThinking` flag is read only by the anthropic-messages client; under openai-completions it has no effect. This extension routes every model id that starts with `claude` to anthropic-messages with baseUrl `https://api.cometapi.com` (no `/v1`, because the Anthropic SDK appends `/v1/messages` itself) and sets `forceAdaptiveThinking`. Known Claude ids take official metadata (cost, 1M context, 128K output, thinking levels) from pi's built-in Anthropic catalog, and unknown `claude` ids get conservative defaults of 200K context, 64K output, with adaptive thinking enabled.

**Mixed protocols under one provider.** Claude models use `/v1/messages`, so adaptive thinking works. Gemini 4 and newer models use CometAPI's Google-native `/v1beta` surface, so function calling works. All other models use `/v1/chat/completions`.

**Gemini tool calling.** CometAPI's OpenAI-compatible endpoint does not deliver the tool list to Gemini models: the model answers as if no tools exist. This extension routes Gemini 4 and newer ids through CometAPI's documented Google-native API (`google-generative-ai`, baseUrl `https://api.cometapi.com/v1beta`), where function calling is supported. Older Gemini ids stay on the OpenAI-compatible route.

## Requirements

pi coding agent, verified on pi 1.5.2 and 1.6.0, and a CometAPI API key.

## Setup

Place `cometapi.ts` in `~/.pi/agent/extensions/`. pi auto-loads TypeScript extensions from that directory.

```
mkdir -p ~/.pi/agent/extensions
cp cometapi.ts ~/.pi/agent/extensions/
```

Then start pi and run `/login CometAPI` to provide the key. The key is stored in pi's auth store and reaches the extension through the refresh context. No key is stored in the extension or in config files.

If CometAPI was already configured through pi-custom-providers (`custom-providers.json`) or through a static `providers.CometAPI` block in `models.json`, remove those entries so the extension is the sole owner of the provider.

## Verify

`pi --list-models` should show CometAPI with the full catalog, 450+ models at the time of writing. `claude-sonnet-5-5` and `claude-opus-5-5` should show 1M context, 128K output, and thinking support.

```
pi --list-models
```

Smoke test:

```
pi -p --provider CometAPI --model claude-sonnet-5-5 "Reply with exactly: OK"
```

Add `--thinking high` to test the thinking path:

```
pi -p --provider CometAPI --model claude-sonnet-5-5 --thinking high "Reply with exactly: OK"
```

## Known limitations

The very first pi invocation right after startup can run before the asynchronous catalog fetch finishes and report `Unknown provider "CometAPI"`. The next invocation, a few seconds later, works. This was observed on pi 1.5.2 and 1.6.0.

The catalog is not persisted yet. It is fetched at each session start, and the last-good cache lives in memory only.

Gemini ids older than 4.x remain on the OpenAI-compatible route, where CometAPI may not deliver tools.

The endpoints are hardcoded for CometAPI. This is a focused extension, not a generic relay framework.
