# 🚀 pi-cometapi

This package adds a CometAPI provider to pi and repairs the parts of CometAPI that break in practice.

## 🛠️ What it fixes

- Claude models use the Anthropic Messages path, so adaptive thinking works.
- Every gemini model uses the Google native API: tools are no longer dropped, and the unsupported thinking levels and budgets that caused HTTP 400 errors are gone.
- The catalog is fetched automatically and cached for 7 days, so no manual models.json is needed; all other models use the OpenAI compatible API.

## 📦 Install

```bash
pi install git:github.com/spinogrizz/pi-cometapi
```

Restart pi after install.

## 🔑 Login

Start pi, run `/login CometAPI`, and paste your CometAPI key when prompted.

## 🧩 Models

Run pi, open `/models`, and enable the `CometAPI/...` entries you need.

To force a catalog refresh:

```bash
pi update --models
```
