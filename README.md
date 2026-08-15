# Aether

Aether is a desktop AI companion. The mascot **Alya** lives in the corner of your
screen (or hides in the tray), listens to voice commands, drives an LLM agent with
real app integrations via [Composio](https://composio.dev), and replies in Alya's
voice using an edge-tts → RVC voice pipeline.

## Features

- Transparent, always-on-top, click-through mascot overlay (Electron) with a tray/background mode.
- Built-in high-quality anime Alya mascot (transparent, head-and-shoulders portrait) with per-emotion expressions and a two-frame mouth flap for lip-sync; optionally point it at a Live2D `.model3.json` in Settings to use `pixi-live2d-display` instead.
- Voice in: push-to-talk global hotkey → `faster-whisper` STT. Text input also works.
- Voice out: `edge-tts` base speech re-timbred to Alya with RVC v2 (`rvc-python`).
- Agent brain: OpenAI, any OpenAI-compatible local server (Ollama, LM Studio, llama.cpp), or None for offline replies. On Windows, Settings can download Qwen3.5-9B ultra-uncensored heretic and start llama.cpp for you (~5.6 GB).
- App integrations: connect Gmail, Google Calendar, GitHub, Slack, Notion, and more through Composio.

## Architecture

- `apps/desktop` — Electron + Vite + React. Main process hosts the agent (LLM + Composio) and orchestration; the renderer draws the mascot, captures the mic, and plays/lip-syncs audio.
- `services/voice` — Python FastAPI sidecar for STT + edge-tts + RVC. Launched automatically by the desktop app.
- `packages/shared` — shared TypeScript contracts (config, agent events, IPC).

## Requirements

- Node.js >= 20, npm >= 10
- Python >= 3.10 with `ffmpeg` on PATH
- Optional: an NVIDIA (CUDA) or Apple Silicon (MPS) GPU for low-latency Alya voice (RVC)

## Getting started

```bash
npm install

# Voice service deps (base is enough to run; ML extras add the Alya RVC voice)
python3 -m venv services/voice/.venv
. services/voice/.venv/bin/activate
pip install -r services/voice/requirements.txt
# Optional, GPU recommended:
# pip install -r services/voice/requirements-ml.txt
deactivate

npm run dev   # launches the Electron app; it starts the voice sidecar automatically
```

Set API keys as environment variables before launching (never stored in config):

```bash
export OPENAI_API_KEY=...      # assistant brain (or set provider to "none")
export COMPOSIO_API_KEY=...    # app integrations
```

## Scripts

- `npm run dev` — run the desktop app (spawns the Python voice service).
- `npm run dev:voice` — run only the voice service.
- `npm run build` — type-check + build shared package and the Electron app.
- `npm run typecheck` — type-check all TypeScript.
- `npm run lint` — lint the repo.
- `npm run package --workspace @aether/desktop` — build installers (electron-builder).

## Configuration

Open **Settings** from the mascot dock or tray to choose the LLM provider/model,
base TTS voice, RVC model + pitch, push-to-talk hotkey, Whisper size, mascot model
(`placeholder` or a Live2D `.model3.json` path/URL), overlay corner, click-through,
and to connect Composio app integrations.
