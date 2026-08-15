# Phase 7. Windows installer

Back to [overview](overview.md).

## Goal

Turn electron-builder from a stub into a shippable NSIS config for Windows-only public artifacts. Icons, artifact names, and resource filters match phase 6.

## Changes

- [`apps/desktop/package.json`](../../../apps/desktop/package.json) `build` block. Windows NSIS only for V1 publish. Real `appId`, copyright, artifact name `Aether-Setup-${version}.exe`. Icons under `build/`. Tighten `files` / `extraResources` so main-process dependencies resolve and voice runtime binaries are included.
- Prove packaged main deps (`ai`, `@ai-sdk/openai`, `@composio/core`, `zod`) land in the asar or `node_modules` electron-builder collects.
- Root script optional. `npm run package:win` for clarity.
- Smoke script or documented checklist that launches the built exe once locally before CI trusts it.

## Data structures

None. Packaging metadata only.

## Verification

**Static.** `npm run typecheck`, `npm run lint`, `npm run package --workspace @aether/desktop`.

**Runtime.** Install from the generated NSIS on a clean Windows profile. App starts, tray visible, voice bootstrap runs, text and speak work with a saved OpenAI key. Uninstall removes the app. `%APPDATA%` data may remain (document that).
