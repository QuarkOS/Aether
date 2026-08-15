# AGENTS.md

Aether is a desktop AI companion (mascot "Alya") with three parts:

- `apps/desktop` — Electron + Vite + React (via `electron-vite`). The main process runs the agent (LLM + Composio) and orchestration; the renderer draws the mascot, captures the mic, and plays/lip-syncs audio.
- `services/voice` — Python FastAPI sidecar: `faster-whisper` STT, `edge-tts` TTS, optional `rvc-python` for the Alya voice. Packaged Windows builds bootstrap embeddable Python + ffmpeg under userData. Dev builds prefer `services/voice/.venv`.
- `packages/shared` — shared TypeScript contracts. Build it (`npm run build --workspace @aether/shared`) before typechecking or running the desktop app.

Standard commands live in `README.md` and root `package.json` (`dev`, `build`, `typecheck`, `lint`, `package:win`). Prefer those.

V1 release work is planned under `docs/plans/01-v1-release/`. Windows public artifacts come from the NSIS path (`npm run package:win` and `.github/workflows/release-windows.yml`).

## Secrets

Settings can store OpenAI and Composio keys with Electron `safeStorage`. Environment variables still win when set: `OPENAI_API_KEY`, `COMPOSIO_API_KEY`. Never commit keys into config JSON.

## Cursor Cloud specific instructions

- System dependencies: the voice service needs `ffmpeg` (present in the base image) and the `python3-venv` module for `python3 -m venv` (install `python3.12-venv` via apt if `.cursor/environment.json`'s install step reports "ensurepip is not available"). The Node side of the app works even if the Python venv step fails.
- Running the Electron GUI needs an X display. On the cloud VM use the VNC display: launch with `DISPLAY=:1 ELECTRON_DISABLE_SANDBOX=1 npm run dev`. Without `ELECTRON_DISABLE_SANDBOX=1` the sandbox fails to start; the `bus.cc`/`GPU process`/DBus errors in the log are harmless VNC noise.
- Set `AETHER_PYTHON` to the venv python (e.g. `services/voice/.venv/bin/python`) when launching the desktop app so it spawns the sidecar with the right interpreter. The app skips spawning if a voice service already answers on the port (the `voice` terminal in `.cursor/environment.json`).
- RVC (the actual Alya voice) requires `services/voice/requirements-ml.txt` (`torch` + `rvc-python`) and realistically a GPU. `rvc-python`'s pinned NumPy fails to build on Python 3.12, so RVC is typically unavailable in the cloud VM; `/speak` then returns the base `edge-tts` voice and `/health` reports `rvcAvailable:false`. This is expected graceful degradation, not a bug. Install ML extras on a CUDA/MPS machine with a compatible Python for the real Alya timbre.
- The cloud VM has no audio output device, so `HTMLAudioElement` playback is silent and its `ended` event is unreliable. Lip-sync is therefore driven by the clip's decoded duration (parsed from the WAV header in `controller.ts`), not by audio playback events. Keep it that way.
- The overlay is an always-on-top window that never holds focus, so it must keep `webPreferences.backgroundThrottling: false`; otherwise Chromium throttles `requestAnimationFrame`/timers and the mascot's lip-sync, blink, and idle bob freeze.
- The global push-to-talk hotkey (`CommandOrControl+Shift+Space`) often fails to register under the VNC window manager (`[hotkeys] failed to register`); this is environment-specific. Use the dock's mic button or type in the dock to exercise the same STT/agent path.
