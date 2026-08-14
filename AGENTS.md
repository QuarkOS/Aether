# AGENTS.md

Aether is a desktop AI companion (mascot "Alya") with three parts:

- `apps/desktop` — Electron + Vite + React (via `electron-vite`). The main process runs the agent (LLM + Composio) and orchestration; the renderer draws the mascot, captures the mic, and plays/lip-syncs audio.
- `services/voice` — Python FastAPI sidecar: `faster-whisper` STT, `edge-tts` TTS, optional `rvc-python` for the Alya voice. The desktop app spawns it automatically (and reuses one that's already running on the port).
- `packages/shared` — shared TypeScript contracts. It must be built (`npm run build --workspace @aether/shared`) before typechecking/running the desktop app, because the main process bundles from its `dist`.

Standard commands live in `README.md` and `package.json` scripts (`dev`, `build`, `typecheck`, `lint`) and `services/voice/README.md`. Prefer those.

## Cursor Cloud specific instructions

- System dependencies: the voice service needs `ffmpeg` (present in the base image) and the `python3-venv` module for `python3 -m venv` (install `python3.12-venv` via apt if `.cursor/environment.json`'s install step reports "ensurepip is not available"). The Node side of the app works even if the Python venv step fails.
- Running the Electron GUI needs an X display. On the cloud VM use the VNC display: launch with `DISPLAY=:1 ELECTRON_DISABLE_SANDBOX=1 npm run dev`. Without `ELECTRON_DISABLE_SANDBOX=1` the sandbox fails to start; the `bus.cc`/`GPU process`/DBus errors in the log are harmless VNC noise.
- Set `AETHER_PYTHON` to the venv python (e.g. `services/voice/.venv/bin/python`) when launching the desktop app so it spawns the sidecar with the right interpreter. The app skips spawning if a voice service already answers on the port (the `voice` terminal in `.cursor/environment.json`).
- RVC (the actual Alya voice) requires `services/voice/requirements-ml.txt` (`torch` + `rvc-python`) and realistically a GPU. `rvc-python`'s pinned NumPy fails to build on Python 3.12, so RVC is typically unavailable in the cloud VM; `/speak` then returns the base `edge-tts` voice and `/health` reports `rvcAvailable:false`. This is expected graceful degradation, not a bug. Install ML extras on a CUDA/MPS machine with a compatible Python for the real Alya timbre.
- The cloud VM has no audio output device, so `HTMLAudioElement` playback is silent and its `ended` event is unreliable. Lip-sync is therefore driven by the clip's decoded duration (parsed from the WAV header in `controller.ts`), not by audio playback events. Keep it that way.
- The overlay is an always-on-top window that never holds focus, so it must keep `webPreferences.backgroundThrottling: false`; otherwise Chromium throttles `requestAnimationFrame`/timers and the mascot's lip-sync, blink, and idle bob freeze.
- The global push-to-talk hotkey (`Alt+Space`) often fails to register under the VNC window manager (`[hotkeys] failed to register`); this is environment-specific. Use the dock's mic button or type in the dock to exercise the same STT/agent path.
- Secrets are read from env vars, never stored in config: `OPENAI_API_KEY` (assistant brain; without it the app uses an offline rule-based reply so the voice + mascot pipeline still works) and `COMPOSIO_API_KEY` (app integrations / Connect flow).
