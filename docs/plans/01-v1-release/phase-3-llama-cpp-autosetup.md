# Phase 3. llama.cpp auto-setup

Back to [overview](overview.md).

## Goal

One Settings action downloads a Windows `llama-server` build and the Qwen3.5-9B ultra-uncensored heretic GGUF (~5.6 GB), starts an OpenAI-compatible server on localhost, and points Aether at it. No manual Ollama install required.

## Default model

- Repo: `mradermacher/Qwen3.5-9B-ultra-uncensored-heretic-v1-GGUF`
- File: `Qwen3.5-9B-ultra-uncensored-heretic-v1.Q4_K_M.gguf` (~5.6 GB)
- Alias served to the OpenAI client: `alya-heretic-9b`
- Why this one. User-locked ultra-uncensored Heretic Qwen3.5 9B GGUF. Text weights only (no mmproj).

## Changes

- New main-process module under `apps/desktop/src/main/localLlm/` for catalog, download, extract, spawn, status.
- Shared types + `AetherBridge` methods for status / install / start / stop.
- Settings. "Set up local Heretic brain" button with progress and errors.
- On success, set `llm.provider` to `openai-compatible`, `baseUrl` to the local server, `model` to the alias.
- Pin a `llama.cpp` Windows release asset (Vulkan preferred, CPU fallback). Store under `userData/local-llm/`, never inside the NSIS payload.

## Data structures

```
LocalLlmStatus {
  state: "missing" | "downloading" | "ready" | "starting" | "running" | "error"
  progress?: number
  message?: string
  baseUrl?: string
  modelId?: string
}
```

## Verification

**Static.** `npm run typecheck`, `npm run lint`.

**Runtime.** Click setup on a machine with ~8 GB free disk. Progress reaches ready/running. Text chat without `OPENAI_API_KEY`. Stop server from Settings. Restart app and Start again without re-download.
