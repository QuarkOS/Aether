# V1 release plan

## Context

Aether's product loop already works as a developer build. Overlay, PNG Alya, text and mic, offline and OpenAI agent, edge-tts, and a skeletal Composio path all exist. What does not exist is a Windows installer a stranger can download from GitHub and run without a terminal.

V1 closes that gap. Audience is a public Windows GitHub Release. Scope is Core plus OpenAI-compatible local models plus a finished Composio connect flow. Code signing and auto-update come after the first public tag.

**Delivery.** Stack one PR per phase. Do not merge until the contiguous stack is verified. Then set up this PC from the landed `main` build.

## Scope

**In**

- Windows NSIS installer published as a GitHub Release artifact
- PNG Alya mascot, dock text, push-to-talk, tray quit
- OpenAI cloud brain, OpenAI-compatible local servers (Ollama, LM Studio, llama.cpp, vLLM), or offline fallback
- Windows one-click llama.cpp auto-setup with default `Qwen3.5-9B-ultra-uncensored-heretic-v1` Q4_K_M (~5.6 GB into userData)
- edge-tts speech (internet required to speak)
- API keys entered in Settings, stored via Electron `safeStorage`
- First-run onboarding (keys, local base URL, mic, what works offline)
- Composio for a small fixed toolkit set with real connect status
- CI that typechecks, lints, and uploads the Windows package
- LICENSE, CHANGELOG, Windows-first README

**Out**

- Code signing / SmartScreen reputation (document the warning)
- Auto-update (`electron-updater`)
- macOS and Linux installers as release artifacts
- RVC / torch / GPU Alya voice (keep code path, default off, omit from installer ML extras)
- Live2D as a first-class ship (keep opt-in path, do not market it)
- Anthropic and Gemini native providers
- Wake word
- Chat history window
- Bundled Cubism core
- Bundling Ollama or GGUF weights inside the NSIS installer (auto-download to userData instead)

## Constraints

- Windows-first. Dev machines may still use Unix scripts, but the release path is NSIS.
- Secrets never land in `aether-config.json`. Keys go through `safeStorage` (or fail closed).
- Packaged voice must not depend on a system Python or a repo checkout.
- RVC stays optional later. V1 ships `requirements.txt` only.
- Fake Settings options come out before new Settings fields go in.
- Local models use the OpenAI-compatible HTTP API only (`baseUrl` + model). No native Ollama protocol.
- Version lands at `1.0.0` on the release tag.

## Alternatives considered

1. **Require system Python + ffmpeg.** Smallest packaging change. Fails for a public Windows audience.
2. **Freeze the voice sidecar with PyInstaller.** Clean runtime, heavier CI and slower iteration.
3. **Embed Python 3.11 + ffmpeg under `extraResources`, bootstrap a venv in `userData` on first launch.** Chosen for voice. Matches how the app already spawns the sidecar.
4. **Native Anthropic/Gemini SDKs.** Deferred. OpenAI-compatible covers local and many cloud proxies with one client.

## Applicable skills

- `how` before changing voice spawn, packaging, or Composio
- `architect` when secrets, voice bootstrap, or integration status cross process boundaries
- `interrogate` before locking secrets storage and voice bootstrap design
- `control-ui` for Electron runtime checks
- `/deslop` before each commit
- `unslop` on README, CHANGELOG, PR copy
- `show-me-your-work` for this multi-PR program
- Cursor babysit after each PR opens

## Phases

1. [phase-1-subtract-fiction](phase-1-subtract-fiction.md)
2. [phase-2-openai-compatible](phase-2-openai-compatible.md)
3. [phase-3-llama-cpp-autosetup](phase-3-llama-cpp-autosetup.md)
4. [phase-4-secrets](phase-4-secrets.md)
5. [phase-5-onboarding](phase-5-onboarding.md)
6. [phase-6-overlay-tray-ux](phase-6-overlay-tray-ux.md)
7. [phase-7-composio-status](phase-7-composio-status.md)
8. [phase-8-voice-runtime](phase-8-voice-runtime.md)
9. [phase-9-windows-installer](phase-9-windows-installer.md)
10. [phase-10-ci-release](phase-10-ci-release.md)
11. [phase-11-docs-legal](phase-11-docs-legal.md)

Shared verification notes live in [testing.md](testing.md).

## Verification (project-level)

```bash
npm run typecheck
npm run lint
npm run build
npm run package --workspace @aether/desktop
```

Runtime. Install the NSIS artifact on a clean Windows profile. Complete onboarding. Text chat with OpenAI and with a local OpenAI-compatible server. PTT once Whisper downloads. Connect one Composio toolkit and run a tool-backed turn. Confirm voice health without a system Python.

## Implementation guidance

- Run `how` on `voiceService.ts`, `composio.ts`, and the electron-builder config before editing them.
- Interrogate secrets + voice bootstrap designs before coding those phases.
- One PR per phase. Stack on the previous phase branch. Merge only when the full stack is verified.
- Prefer deletion in phase 1 over feature flags for dead providers.
- Keep a decision trail under `docs/plans/01-v1-release/decisions.md` as choices land.
- Do not arm signing or auto-update in this plan.

## Definition of done

A stranger can open the GitHub Release for `v1.0.0`, download `Aether Setup.exe`, install, choose OpenAI or one-click local Qwen3.5-9B ultra-uncensored heretic llama.cpp (or any OpenAI-compatible server), talk or type to Alya, hear edge-tts, and connect at least one Composio app with visible success or failure. No terminal required for the app install.
