# Decisions

## 2026-08-15. Delivery cadence

Stack every V1 phase as its own PR. Merge the contiguous verified stack together. Set up this PC after `main` has the stack, not from half-landed branches.

## 2026-08-15. Local models

Use any OpenAI-compatible HTTP server via `llm.baseUrl` + model name (`openai-compatible` provider). Do not add Anthropic/Gemini native SDKs in V1. Do not bundle Ollama or weights in the installer.
