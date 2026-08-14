import { nativeImage, Menu, Tray } from "electron";

import { loadConfig, updateConfig } from "./config.js";
import {
  getOverlayWindow,
  openSettingsWindow,
  setOverlayClickThrough,
  toggleOverlayVisibility,
} from "./windows.js";

let tray: Tray | null = null;

/** 16x16 transparent PNG with a small magenta dot, encoded to avoid shipping asset files. */
const TRAY_ICON_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAWklEQVR42mNgGAWjYBSMglEwCkbBKBgFo2AUjIJRMApGwSgYBaNgFIyCUTAKRsEoGAWjYBSMglEwCkbBKBgFo2AUjIJRMApGwSgYBaNgFIyCUTAKRsEoAAB3lgGBj2Q9wAAAABJRU5ErkJggg==";

export function createTray(onQuit: () => void): Tray {
  if (tray) return tray;
  const icon = nativeImage.createFromDataURL(TRAY_ICON_DATA_URL);
  tray = new Tray(icon);
  tray.setToolTip("Aether — Alya assistant");
  rebuildMenu(onQuit);
  tray.on("click", () => toggleOverlayVisibility());
  return tray;
}

export function rebuildMenu(onQuit: () => void): void {
  if (!tray) return;
  const config = loadConfig();
  const overlay = getOverlayWindow();
  const menu = Menu.buildFromTemplate([
    {
      label: overlay?.isVisible() ? "Hide mascot" : "Show mascot",
      click: () => {
        toggleOverlayVisibility();
        rebuildMenu(onQuit);
      },
    },
    {
      label: "Click-through overlay",
      type: "checkbox",
      checked: config.mascot.clickThrough,
      click: (item) => {
        updateConfig({ mascot: { ...config.mascot, clickThrough: item.checked } });
        setOverlayClickThrough(item.checked);
      },
    },
    { type: "separator" },
    { label: "Settings…", click: () => openSettingsWindow() },
    { type: "separator" },
    { label: "Quit Aether", click: onQuit },
  ]);
  tray.setContextMenu(menu);
}
