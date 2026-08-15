# Phase 8. Voice runtime for packaged Windows

Back to [overview](overview.md).

## Goal

A packaged app starts STT and edge-tts without a system Python. First launch bootstraps a venv under `userData` using an embedded Python and pip-installs `requirements.txt`. ffmpeg ships beside the voice code. RVC extras stay out of the installer.

## Changes

- Add vendoring layout under `apps/desktop/resources/` (or a `scripts/` download step CI runs) for Windows embeddable Python 3.11 and a static ffmpeg binary. Document license attribution.
- [`voiceService.ts`](../../../apps/desktop/src/main/voiceService.ts). Packaged path. Prefer embedded Python. Create `userData/voice-venv` once. Install requirements. Spawn `run.py` with `AETHER_MODELS_DIR` under `userData`. Expose bootstrap progress/errors on health IPC.
- [`services/voice`](../../../services/voice) health endpoint. Report bootstrap state if useful, or keep desktop-side status.
- Exclude `.venv`, `models/`, and `__pycache__` from `extraResources` filters so developer machines cannot poison the NSIS payload.

## Data structures

```
VoiceRuntimeStatus {
  ready: boolean
  bootstrapping: boolean
  pythonPath?: string
  lastError?: string
  health?: VoiceHealth // existing
}
```

Marker file under `userData` records successful bootstrap hash of `requirements.txt`.

## Verification

**Static.** `npm run typecheck`, `npm run lint`.

**Runtime.** On a machine without Python on PATH, run the packaged app (or a staged `extraResources` layout). First launch bootstraps. `/health` shows TTS and STT ready. `/speak` returns WAV. Second launch skips pip. Broken bootstrap surfaces a Settings/health error instead of a silent toast.
