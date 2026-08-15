# Phase 1. Subtract fiction

Back to [overview](overview.md).

## Goal

Make Settings and defaults tell the truth before V1 features land. Remove provider options that do nothing. Turn RVC off by default. Fix the Windows-hostile hotkey. Drop unused wake-word from the live config surface.

## Changes

- [`packages/shared/src/index.ts`](../../../packages/shared/src/index.ts). Narrow `llm.provider` to `"openai" | "none"`. Default `rvcEnabled` to `false`. Default PTT to a Windows-safe accelerator such as `CommandOrControl+Shift+Space`. Keep `wakeWordEnabled` out of Settings (leave field only if needed for config merge compatibility, otherwise delete).
- [`apps/desktop/src/renderer/src/settings/SettingsApp.tsx`](../../../apps/desktop/src/renderer/src/settings/SettingsApp.tsx). Provider select matches the narrowed type. Soften or hide RVC controls behind an "advanced / not in V1 installer" note, or leave them but default off with honest health copy.
- [`apps/desktop/src/main/agent/agent.ts`](../../../apps/desktop/src/main/agent/agent.ts) and [`offline.ts`](../../../apps/desktop/src/main/agent/offline.ts). Align copy with real Settings (keys will arrive in phase 2). Stop telling users to pick providers that do not exist.

## Data structures

- `AppConfig.llm.provider: "openai" | "none"`
- Config merge must accept old `"anthropic" | "gemini"` values and coerce to `"openai"` (or `"none"` if that is safer when only those were selected with no OpenAI key)

## Verification

**Static.** `npm run typecheck`, `npm run lint`.

**Runtime.** Open Settings. Only OpenAI and None appear. Default hotkey is not `Alt+Space`. Fresh config has RVC off. Offline catch-all copy does not promise Settings providers that are gone.
