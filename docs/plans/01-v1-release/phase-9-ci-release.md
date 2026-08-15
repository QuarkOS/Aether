# Phase 9. CI and GitHub Release

Back to [overview](overview.md).

## Goal

Every push to `main` proves typecheck and lint. Tags named `v*` build the Windows installer on GitHub Actions and attach it to a GitHub Release. Unsigned is acceptable for V1. Document SmartScreen.

## Changes

- `.github/workflows/ci.yml`. Node 22. `npm ci`, build shared, typecheck, lint.
- `.github/workflows/release-windows.yml`. On `v*` tags (or workflow_dispatch). Windows runner. Install Node. Fetch or cache embeddable Python + ffmpeg. `npm ci`, package, upload Release asset.
- Bump package versions to `1.0.0` on the release PR.
- No signing secrets required for V1. Leave commented hooks for later `CSC_*` vars.

## Data structures

None.

## Verification

**Static.** CI green on a dry-run PR.

**Runtime.** Push a pre-release tag (for example `v1.0.0-rc.1`). Confirm the Release has `Aether-Setup-*.exe`. Download and install on a clean machine. Full smoke from [testing.md](testing.md).
