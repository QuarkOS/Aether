import { app, BrowserWindow } from "electron";
import type { AppConfig } from "@aether/shared";

import { loadConfig } from "./config.js";
import { broadcast } from "./controller.js";
import { registerPushToTalk, unregisterAll } from "./hotkeys.js";
import { registerIpc } from "./ipc.js";
import { createTray, rebuildMenu } from "./tray.js";
import { ensureVoiceService, stopVoiceService, waitForVoiceReady } from "./voiceService.js";
import { createOverlayWindow, getOverlayWindow } from "./windows.js";

let quitting = false;

function doQuit(): void {
  quitting = true;
  unregisterAll();
  stopVoiceService();
  app.quit();
}

function applyHotkeys(config: AppConfig): void {
  registerPushToTalk(config.input.pushToTalkHotkey, () => {
    // Toggle listening in the overlay; the renderer captures audio and submits it.
    const win = getOverlayWindow();
    if (!win) return;
    if (!win.isVisible()) win.show();
    win.webContents.send("hotkey:push-to-talk");
  });
}

async function bootstrap(): Promise<void> {
  const config = loadConfig();

  void ensureVoiceService();

  registerIpc(
    (next) => {
      applyHotkeys(next);
      rebuildMenu(doQuit);
    },
    doQuit,
  );

  createOverlayWindow(config);
  createTray(doQuit);
  applyHotkeys(config);

  try {
    app.setLoginItemSettings({ openAtLogin: config.startOnLogin });
  } catch {
    /* not supported on all platforms */
  }

  // Report voice readiness to the renderer once the sidecar is up.
  void waitForVoiceReady().then((ok) => {
    broadcast({ type: "state", state: "idle" });
    if (!ok) {
      broadcast({
        type: "error",
        message: "Voice service is not responding. Text chat still works; check the voice service logs.",
      });
    }
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const win = getOverlayWindow();
    if (win) {
      win.show();
      win.focus();
    }
  });

  app.whenReady().then(bootstrap);

  // Tray app: keep running when all windows are closed.
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin" && quitting) app.quit();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createOverlayWindow(loadConfig());
  });

  app.on("before-quit", () => {
    quitting = true;
    stopVoiceService();
  });
}
