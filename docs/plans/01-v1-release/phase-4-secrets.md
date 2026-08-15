# Phase 4. Secrets

Back to [overview](overview.md).

## Goal

Let a Windows user paste `OPENAI_API_KEY` and `COMPOSIO_API_KEY` in Settings. Persist them with Electron `safeStorage`. Never write plaintext secrets into `aether-config.json`.

## Changes

- New small module under `apps/desktop/src/main/` (for example `secrets.ts`) that encrypts/decrypts via `safeStorage`, with a clear error when encryption is unavailable.
- [`apps/desktop/src/main/config.ts`](../../../apps/desktop/src/main/config.ts) and IPC in [`ipc.ts`](../../../apps/desktop/src/main/ipc.ts) / [`preload/index.ts`](../../../apps/desktop/src/preload/index.ts). Expose get/set/clear for the two keys without returning the full secret to the renderer after save (mask or "configured" boolean).
- [`SettingsApp.tsx`](../../../apps/desktop/src/renderer/src/settings/SettingsApp.tsx). Password-style fields, save, clear. Remove the "env vars only" dead end as the primary path. Env vars remain as a developer override that wins when set.
- [`agent.ts`](../../../apps/desktop/src/main/agent/agent.ts) and [`composio.ts`](../../../apps/desktop/src/main/agent/composio.ts). Resolve keys as `process.env.*` first, then `safeStorage`.

## Data structures

- `SecretId = "openai" | "composio"`
- On-disk blob under `userData` (separate from `aether-config.json`), contents opaque after `safeStorage.encryptString`
- IPC. `secrets:status` returns `{ openai: boolean; composio: boolean }`. `secrets:set` / `secrets:clear` take id + optional value

## Verification

**Static.** `npm run typecheck`, `npm run lint`.

**Runtime.** Save an OpenAI key in Settings. Quit and relaunch. Online agent path runs without env vars. Confirm `aether-config.json` has no key material. Clear key returns to offline replies. Repeat smoke for Composio "configured" status (full connect is phase 5).
