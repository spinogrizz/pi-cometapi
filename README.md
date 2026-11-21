# pi-cometapi

One CometAPI key, one provider in pi, and the whole CometAPI catalog (about 456 models across Claude, Gemini, GPT and others) working as it should.

## Why not just add it as a custom provider

The obvious route is to add CometAPI to `models.json` as a generic OpenAI-compatible custom provider. Three things break that way:

1. **Claude thinking.** Over the generic OpenAI-compatible route, `--thinking` does nothing for Claude. Adaptive thinking only engages over Anthropic's native protocol. This extension routes Claude there, so thinking levels work.
2. **Gemini tool calling.** Over the same generic route CometAPI does not deliver tools to Gemini: the model says it has no tools, or writes fake tool-call JSON as text and never runs anything. This extension routes Gemini through Google's native protocol, so tool calls actually execute.
3. **The manual model list.** A static `models.json` means hand-maintaining hundreds of entries with stale limits and missing new models. This extension discovers the live catalog with correct per-model metadata, so new models show up on their own, with no duplicated entries, and a failed fetch never wipes the provider.

The root cause is simple: one generic OpenAI-compatible entry cannot say that different models need different protocols. This extension routes each model to the protocol that works, under one provider and one key.

## Install

Get an API key at cometapi.com, then:

```
git clone https://github.com/spinogrizz/pi-cometapi.git
mkdir -p ~/.pi/agent/extensions/cometapi
cp -r pi-cometapi/index.ts pi-cometapi/src pi-cometapi/package.json ~/.pi/agent/extensions/cometapi/
```

Start pi, run `/login CometAPI`, paste the key. The repo root is the extension folder and pi loads it directly, no build step.

## Verify

```
pi --list-models | grep CometAPI
pi -p --provider CometAPI --model claude-sonnet-5-5 --thinking high "Reply with exactly: OK"
pi -p --provider CometAPI --model gemini-4-carbon "Use your tools to list the files in the current working directory, then reply with just the file names."
```

The first command should list hundreds of models. The last one must return a real directory listing produced by an executed tool call, not a claim that it listed something.

## Caveat

The first pi invocation right after start may need a retry while the catalog loads. CometAPI's Gemini relay occasionally returns a transient error or stalls, and a retry succeeds.