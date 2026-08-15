# Phase 4. Overlay and tray UX

Back to [overview](overview.md).

## Goal

Make the always-visible controls trustworthy on Windows. Real tray icon, Quit discoverable, dock mic matches PTT, overlay picks up config changes that already apply in main.

## Changes

- [`tray.ts`](../../../apps/desktop/src/main/tray.ts). Replace the magenta-dot data URL with a real 16/32 px tray asset under `apps/desktop/resources/`.
- [`OverlayApp.tsx`](../../../apps/desktop/src/renderer/src/overlay/OverlayApp.tsx) and [`useRecorder.ts`](../../../apps/desktop/src/renderer/src/overlay/useRecorder.ts). Dock mic calls the same listen path as PTT (listening pill, error surfacing).
- Overlay config. Re-read or subscribe so mascot corner already handled in main stays consistent. Document or fix PNG scale no-op (either apply a CSS scale or hide the slider for `placeholder`).
- Optional. Expose Quit from Settings as well as tray.

## Data structures

No new persisted types. Reuse `AssistantState` and existing IPC.

## Verification

**Static.** `npm run typecheck`, `npm run lint`.

**Runtime.** Tray icon is visible in the Windows notification area. Hide/show and Quit work. Dock mic shows Listening and recovers from denied mic permission with a visible error. Corner change still moves the window. PNG mode does not show a lying scale control.
