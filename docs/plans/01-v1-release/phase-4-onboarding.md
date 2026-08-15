# Phase 4. Onboarding

Back to [overview](overview.md).

## Goal

First launch walks the user through what Alya can do, mic permission, and where keys go. Skip after completion. Re-openable from Settings.

## Changes

- New lightweight onboarding window or modal flow owned by main + a small renderer entry (keep it thin. Prefer one window over a second SPA if possible).
- [`index.ts`](../../../apps/desktop/src/main/index.ts). If `onboardingCompleted` is false, show onboarding before or beside the overlay.
- [`packages/shared/src/index.ts`](../../../packages/shared/src/index.ts). Add `onboardingCompleted: boolean` to `AppConfig` (default false).
- Copy covers. Text works without voice. Voice needs the sidecar. Speech uses the network (edge-tts). Keys live in Settings. Integrations need Composio.

## Data structures

- `AppConfig.onboardingCompleted: boolean`
- Optional transient `OnboardingStep` union in the renderer only (`welcome` | `mic` | `keys` | `done`)

## Verification

**Static.** `npm run typecheck`, `npm run lint`.

**Runtime.** Wipe config. First launch shows onboarding. Completing it sets the flag and does not show again. "Show onboarding" from Settings resets or reopens. Mic prompt is explained before first record.
