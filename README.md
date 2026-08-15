# Aether

Desktop AI companion with the **Alya** mascot. Overlay on your screen, voice in and out, optional Composio app tools, and an OpenAI or local OpenAI-compatible brain.

## Install (Windows)

1. Open the latest [GitHub Release](https://github.com/QuarkOS/Aether/releases).
2. Download `Aether-Setup-*.exe` and run it.
3. The build is unsigned. If SmartScreen warns, choose More info, then Run anyway.
4. Complete onboarding in Settings (API keys are optional; offline replies work without them).

First voice use downloads embeddable Python and ffmpeg into your user data folder. Optional local Heretic model download is ~5.6 GB and also lands in user data, not in the installer.

Uninstall from Windows Settings removes the app. `%APPDATA%\Aether` may keep config, keys, and downloaded runtimes.

See [PRIVACY.md](PRIVACY.md) for what leaves the machine. License is [MIT](LICENSE).

## What V1 includes

- Transparent overlay + tray, PNG Alya expressions, dock text and mic
- Push-to-talk (global hotkey or dock mic) → local faster-whisper STT
- Speech via edge-tts (network). RVC Alya timbre exists in source but is off by default and not part of the installer ML path
- LLM: OpenAI, OpenAI-compatible base URL, or None. Windows Settings can install llama.cpp and Qwen3.5-9B ultra-uncensored heretic
- Composio toolkit connect with live status when you set a Composio key
- Secrets stored with OS encryption in Settings (env vars still override)

## What V1 does not ship

- Signed installer / auto-update
- macOS or Linux Release artifacts
- Bundled GGUF weights or torch/RVC in the NSIS payload
- Live2D as the default mascot (optional path remains in Settings)

## Develop from source

Needs Node.js >= 20 and, for local voice without the packaged bootstrap, Python >= 3.10 plus ffmpeg on PATH.

```bash
npm install
npm run build --workspace @aether/shared

python -m venv services/voice/.venv
services\voice\.venv\Scripts\activate
pip install -r services/voice/requirements.txt
deactivate

npm run dev
```

Keys can live in Settings or in the environment (`OPENAI_API_KEY`, `COMPOSIO_API_KEY`).

### Scripts

- `npm run dev` — Electron app (starts the voice sidecar)
- `npm run build` — shared + desktop build
- `npm run typecheck` / `npm run lint`
- `npm run package:win` — Windows NSIS installer under `apps/desktop/release/`

Packaging smoke checklist: [docs/plans/01-v1-release/packaging-smoke.md](docs/plans/01-v1-release/packaging-smoke.md).

## Architecture

- `apps/desktop` — Electron + Vite + React. Main process runs the agent; renderer draws Alya and plays audio.
- `services/voice` — Python FastAPI sidecar for STT and TTS.
- `packages/shared` — shared TypeScript contracts.

V1 release plan: [docs/plans/01-v1-release/overview.md](docs/plans/01-v1-release/overview.md).
