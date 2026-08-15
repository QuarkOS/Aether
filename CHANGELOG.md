# Changelog

## 1.0.4

Windows RVC / Alya-v2 one-click setup, realtime wake word and barge-in, sentence TTS, latency fixes (skip huge FAISS indexes, force fast voice mode), emotion-tag stripping, and Settings UI for Alya voice setup.

## 1.0.2

Fix Windows packaging for npm workspaces (pin and hoist Electron / electron-builder).

## 1.0.1

Fix Windows Release packaging so electron-builder resolves Electron 32.1.0 in the npm workspace.

## 1.0.0

First public Windows V1.

- Desktop Alya overlay with PNG mascot, dock text/mic, tray
- OpenAI, OpenAI-compatible local servers, and offline replies
- One-click Windows llama.cpp setup for Qwen3.5-9B ultra-uncensored heretic (Q4_K_M)
- Settings secrets via OS encryption
- First-run onboarding
- Composio toolkit connect with live status
- Packaged voice sidecar bootstrap for Windows
- NSIS installer via GitHub Releases (unsigned; SmartScreen may warn)
