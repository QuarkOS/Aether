# Testing for V1

Back to [overview](overview.md).

## Surfaces

- Electron overlay and Settings via the `control-ui` skill where available
- Packaged NSIS install on a clean Windows user profile (required for phases 8 through 10)
- Voice HTTP. `GET /health`, `POST /speak`, `POST /stt` against the bootstrapped sidecar
- Local OpenAI-compatible server (Ollama or LM Studio) for phase 2

## Per-phase minimum

| Phase | Must prove |
| --- | --- |
| 1 | Settings provider list is honest. Default hotkey works on Windows. |
| 2 | OpenAI-compatible base URL + model replies without `OPENAI_API_KEY`. Cloud OpenAI path unchanged. |
| 3 | Set up downloads llama-server + Qwen3.5-9B ultra-uncensored heretic GGUF (or skips if present), starts port 8765, Settings shows running. Text chat without `OPENAI_API_KEY`. Stop, then Start without re-download. |
| 4 | Keys survive restart. Absent from `aether-config.json`. Env override still wins. |
| 5 | First-run onboarding completes once and is re-openable. |
| 6 | Tray Quit works. Dock mic matches PTT listening UX. |
| 7 | Connect success and failure are visible. Tool call runs for one toolkit. |
| 8 | Packaged app bootstraps voice with no system Python. |
| 9 | NSIS install + uninstall. App launches from Start Menu. |
| 10 | Tag builds Release asset on Actions. |
| 11 | README-only install path works. |

## Release candidate checklist

1. Fresh Windows profile
2. Download Release exe
3. Install (accept SmartScreen "More info" if unsigned)
4. Finish onboarding
5. Save OpenAI key. Text "hi". Hear edge-tts. See lip-sync
6. Switch to OpenAI-compatible, point at a local server, text "hi" without a cloud key
7. PTT once (allow mic). First Whisper download may stall. Second utterance should be fast
8. Save Composio key. Connect GitHub or Gmail. Confirm connected in Settings
9. Ask Alya to use that toolkit. Confirm a tool event or a real side effect
10. Quit from tray. Relaunch. Keys and integration status still good
11. Uninstall

## Out of scope for V1 tests

- Automated Electron e2e in CI
- GPU / RVC
- macOS notarization
- Signed binary reputation
- Bundled local model weights
