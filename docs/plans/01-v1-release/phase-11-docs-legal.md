# Phase 11. Docs and legal

Back to [overview](overview.md).

## Goal

A stranger reading the repo or Release notes knows how to install on Windows, what data leaves the machine, and what V1 deliberately omits.

## Changes

- [`README.md`](../../../README.md). Windows-first install from Release. Dev setup second. Honest feature list (no Live2D/RVC marketing as defaults).
- `LICENSE` (pick and add. SPDX in package metadata).
- `CHANGELOG.md` with a `1.0.0` section.
- Short privacy note in README or `PRIVACY.md`. Mic audio goes to local Whisper. Text and tool calls go to OpenAI / Composio when configured. edge-tts sends text to Microsoft. Keys stay on device via `safeStorage`.
- [`AGENTS.md`](../../../AGENTS.md). Point agents at the V1 plan and the Windows packaged path.

## Data structures

None.

## Verification

**Static.** Links resolve. Version strings match `1.0.0`.

**Runtime.** Follow README only on a clean Windows machine. Install succeeds without reading AGENTS.md.
