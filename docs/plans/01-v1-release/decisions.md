# Decisions

## 2026-08-15. Delivery cadence

Stack every V1 phase as its own PR. Merge the contiguous verified stack together. Set up this PC after `main` has the stack, not from half-landed branches.

## 2026-08-15. Local models

Use any OpenAI-compatible HTTP server via `llm.baseUrl` + model name (`openai-compatible` provider). Do not add Anthropic/Gemini native SDKs in V1. Do not bundle Ollama or weights in the installer.

## 2026-08-15. llama.cpp auto-setup default

Default managed brain is `mradermacher/Qwen3.5-9B-ultra-uncensored-heretic-v1-GGUF` at `Q4_K_M` (~5.6 GB), served by a pinned Windows `llama-server` under `userData/local-llm/`. Vulkan build preferred, CPU fallback. Users can still point Settings at Ollama or LM Studio manually.
