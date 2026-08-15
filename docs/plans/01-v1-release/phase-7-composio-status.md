# Phase 7. Composio status

Back to [overview](overview.md).

## Goal

Treat integrations as a real domain object. Enable, connect, observe status, and fail clearly when the Composio key is missing. Stop implying a checkbox alone grants Gmail.

## Changes

- [`packages/shared/src/index.ts`](../../../packages/shared/src/index.ts). Add integration status types shared across main and Settings.
- [`composio.ts`](../../../apps/desktop/src/main/agent/composio.ts). After link/authorize, query connected accounts and return structured status per toolkit. Support disconnect if the SDK allows. Harden the "no key" path to a typed error.
- [`ipc.ts`](../../../apps/desktop/src/main/ipc.ts) + preload. Replace fire-and-forget connect notice with list/status/connect/disconnect methods.
- [`SettingsApp.tsx`](../../../apps/desktop/src/renderer/src/settings/SettingsApp.tsx). Per-toolkit row shows enabled, connected or not, last error. Connect disabled until Composio secret is configured. Keep the V1 toolkit list small and fixed (gmail, googlecalendar, github, slack, notion is enough. Cut the rest if status work gets noisy).
- Overlay. Optionally surface `tool-call` / `tool-result` as a short dock toast so a connected tool is visible in the core loop.

## Data structures

```
IntegrationToolkitStatus {
  slug: string
  enabled: boolean
  connected: boolean
  accountLabel?: string
  lastError?: string
}
```

Persist only `enabledToolkits` + `userId` as today. Status is fetched live.

## Verification

**Static.** `npm run typecheck`, `npm run lint`.

**Runtime.** Without Composio key, Connect explains the missing secret. With key, Connect opens the browser. After approve, Settings shows connected. A tool-backed OpenAI turn can call an enabled toolkit. Cancelled OAuth does not show success. Disconnect (if implemented) clears connected state.
