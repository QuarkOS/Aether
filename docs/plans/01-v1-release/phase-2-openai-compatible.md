# Phase 2. OpenAI-compatible local models

Back to [overview](overview.md).

## Goal

Run the assistant brain against any OpenAI-compatible HTTP server (Ollama, LM Studio, llama.cpp, vLLM) by setting a base URL and model name in Settings. Cloud OpenAI and offline None stay as they are.

## Changes

- [`packages/shared/src/index.ts`](../../../packages/shared/src/index.ts). Extend `llm.provider` with `"openai-compatible"`. Add `llm.baseUrl: string` (empty for cloud OpenAI).
- [`apps/desktop/src/main/agent/agent.ts`](../../../apps/desktop/src/main/agent/agent.ts). Use `createOpenAI` with `baseURL` when provider is `openai-compatible`. Prefer `.chat(model)` for local servers. `hasLlm` for compatible mode requires a non-empty `baseUrl`; API key optional (env key or a local placeholder).
- [`SettingsApp.tsx`](../../../apps/desktop/src/renderer/src/settings/SettingsApp.tsx). Provider option for OpenAI-compatible. Show base URL field when that provider is selected. Hint with Ollama example `http://127.0.0.1:11434/v1`.
- [`offline.ts`](../../../apps/desktop/src/main/agent/offline.ts). Point users at OpenAI key or a local compatible endpoint, not fiction.
- Onboarding copy in later phases should mention local models.

## Data structures

```
llm: {
  provider: "openai" | "openai-compatible" | "none"
  model: string
  baseUrl: string  // e.g. http://127.0.0.1:11434/v1
}
```

Default `baseUrl` is `""`. Switching to `openai-compatible` in the UI may seed `http://127.0.0.1:11434/v1` if empty.

## Verification

**Static.** `npm run typecheck`, `npm run lint`.

**Runtime.** With Ollama (or any compatible server) running, set provider to OpenAI-compatible, base URL, and a pulled model. Text chat streams a local reply without `OPENAI_API_KEY`. Cloud OpenAI path unchanged when provider is OpenAI and a key is set. Provider None still uses offline rules.
