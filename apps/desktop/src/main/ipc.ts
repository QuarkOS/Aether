import { app, ipcMain } from "electron";
import type { AppConfig } from "@aether/shared";

import { connectToolkit, popularToolkits } from "./agent/composio.js";
import { loadConfig, updateConfig } from "./config.js";
import { broadcast, handleUserAudio, handleUserText } from "./controller.js";
import { getLocalLlmStatus, installLocalLlm, startLocalLlm, stopLocalLlm } from "./localLlm/status.js";
import {
  clearSecret,
  getSecretsStatus,
  isSecretId,
  setSecret,
  type SecretId,
} from "./secrets.js";
import { getHealth } from "./voiceService.js";
import {
  openExternal,
  openSettingsWindow,
  repositionOverlay,
  setOverlayClickThrough,
} from "./windows.js";

export function registerIpc(onConfigChange: (config: AppConfig) => void, onQuit: () => void): void {
  ipcMain.handle("config:get", () => loadConfig());

  ipcMain.handle("config:set", (_e, patch: Partial<AppConfig>) => {
    const next = updateConfig(patch);
    onConfigChange(next);
    if (patch.mascot?.anchor) repositionOverlay(next);
    if (patch.mascot && "clickThrough" in patch.mascot) {
      setOverlayClickThrough(next.mascot.clickThrough);
    }
    if ("startOnLogin" in patch) {
      try {
        app.setLoginItemSettings({ openAtLogin: next.startOnLogin });
      } catch (err) {
        console.error("[ipc] setLoginItemSettings failed:", err);
      }
    }
    return next;
  });

  ipcMain.handle("agent:text", async (_e, text: string) => {
    await handleUserText(text);
  });

  ipcMain.handle("agent:audio", async (_e, wav: ArrayBuffer) => {
    await handleUserAudio(Buffer.from(wav));
  });

  ipcMain.handle("agent:startListening", () => {
    broadcast({ type: "state", state: "listening" });
  });

  ipcMain.handle("agent:stopListening", () => {
    broadcast({ type: "state", state: "idle" });
  });

  ipcMain.handle("overlay:setClickThrough", (_e, enabled: boolean) => {
    setOverlayClickThrough(enabled);
  });

  // Toggle click-through based on whether the pointer is over the mascot's opaque region.
  ipcMain.handle("overlay:setInteractive", (_e, rect: { x: number; y: number; width: number; height: number } | null) => {
    const config = loadConfig();
    if (!config.mascot.clickThrough) return;
    // When an interactive region is present the window should capture clicks;
    // otherwise it should let them pass through.
    setOverlayClickThrough(rect === null);
  });

  ipcMain.handle("voice:health", () => getHealth());

  ipcMain.handle("localLlm:status", () => getLocalLlmStatus());
  ipcMain.handle("localLlm:install", () => installLocalLlm());
  ipcMain.handle("localLlm:start", () => startLocalLlm());
  ipcMain.handle("localLlm:stop", () => stopLocalLlm());

  ipcMain.handle("secrets:status", () => getSecretsStatus());
  ipcMain.handle("secrets:set", (_e, id: string, value: string) => {
    if (!isSecretId(id)) return { error: `Unknown secret id: ${id}` };
    return setSecret(id, value);
  });
  ipcMain.handle("secrets:clear", (_e, id: string) => {
    if (!isSecretId(id)) return;
    clearSecret(id as SecretId);
  });

  ipcMain.handle("settings:open", () => {
    openSettingsWindow();
  });

  ipcMain.handle("app:quit", () => onQuit());

  ipcMain.handle("integrations:connect", async (_e, toolkit: string) => {
    const result = await connectToolkit(loadConfig(), toolkit);
    if ("redirectUrl" in result) openExternal(result.redirectUrl);
    return result;
  });

  ipcMain.handle("integrations:list", () => popularToolkits());
}
