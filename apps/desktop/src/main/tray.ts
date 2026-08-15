import { nativeImage, Menu, Tray } from "electron";
import { join } from "node:path";

import { loadConfig, updateConfig } from "./config.js";
import {
  getOverlayWindow,
  openSettingsWindow,
  setOverlayClickThrough,
  toggleOverlayVisibility,
} from "./windows.js";

let tray: Tray | null = null;

function loadTrayIcon(): Electron.NativeImage {
  const fromFile = nativeImage.createFromPath(join(__dirname, "../../resources/tray-icon.png"));
  if (!fromFile.isEmpty()) return fromFile.resize({ width: 16, height: 16 });
  return nativeImage.createFromDataURL(
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMUlEQVR42mNgGAWjYBSMAjIB/xkwACkgGgYYjYpRMApGwSgYBaNgFIyCUTAKRsEoGAVDAQCVxgGBj2Q9wAAAAABJRU5ErkJggg==",
  );
}

export function createTray(onQuit: () => void): Tray {
  if (tray) return tray;
  tray = new Tray(loadTrayIcon());
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
