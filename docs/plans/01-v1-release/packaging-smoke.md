# Packaging smoke (phase 9)

Run on a Windows machine before trusting a Release build.

```bash
npm ci
npm run package:win
```

Install `apps/desktop/release/Aether-Setup-*.exe`.

1. App appears in Start Menu as Aether.
2. First launch opens Settings onboarding when `onboardingCompleted` is false.
3. Tray icon shows; Quit works from Settings.
4. Voice health reaches ready after bootstrap (first run downloads Python + ffmpeg into `%APPDATA%`).
5. Uninstall removes the app from Start Menu. UserData under `%APPDATA%\Aether` may remain.
