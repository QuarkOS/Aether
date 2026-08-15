import { join } from "node:path";

import { BrowserWindow, screen, shell } from "electron";
import type { AppConfig } from "@aether/shared";

const OVERLAY_WIDTH = 300;
const OVERLAY_HEIGHT = 460;
const MARGIN = 16;

let overlayWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;

const preload = join(__dirname, "../preload/index.js");

function rendererEntry(hash = ""): { url?: string; file?: string; hash: string } {
  const devUrl = process.env["ELECTRON_RENDERER_URL"];
  if (devUrl) return { url: devUrl, hash };
  return { file: join(__dirname, "../renderer/index.html"), hash };
}

function loadRenderer(win: BrowserWindow, hash = ""): void {
  const entry = rendererEntry(hash);
  if (entry.url) {
    void win.loadURL(entry.url + (hash ? `#${hash}` : ""));
  } else if (entry.file) {
    void win.loadFile(entry.file, hash ? { hash } : undefined);
  }
}

function anchorPosition(config: AppConfig): { x: number; y: number } {
  const display = screen.getPrimaryDisplay();
  const { x: ax, y: ay, width, height } = display.workArea;
  const right = ax + width - OVERLAY_WIDTH - MARGIN;
  const bottom = ay + height - OVERLAY_HEIGHT - MARGIN;
  switch (config.mascot.anchor) {
    case "top-left":
      return { x: ax + MARGIN, y: ay + MARGIN };
    case "top-right":
      return { x: right, y: ay + MARGIN };
    case "bottom-left":
      return { x: ax + MARGIN, y: bottom };
    case "bottom-right":
    default:
      return { x: right, y: bottom };
  }
}

export function createOverlayWindow(config: AppConfig): BrowserWindow {
  if (overlayWindow && !overlayWindow.isDestroyed()) return overlayWindow;
  const pos = anchorPosition(config);
  overlayWindow = new BrowserWindow({
    width: OVERLAY_WIDTH,
    height: OVERLAY_HEIGHT,
    x: pos.x,
    y: pos.y,
    transparent: true,
    frame: false,
    resizable: false,
    movable: true,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    fullscreenable: false,
    webPreferences: {
      preload,
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      // Overlay never holds focus; without this Chromium throttles rAF/timers,
      // freezing the mascot's lip-sync, blink, and idle animations.
      backgroundThrottling: false,
    },
  });

  overlayWindow.setAlwaysOnTop(true, "screen-saver");
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  if (config.mascot.clickThrough) {
    overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  }

  loadRenderer(overlayWindow, "/overlay");

  overlayWindow.on("closed", () => {
    overlayWindow = null;
  });
  return overlayWindow;
}

export function getOverlayWindow(): BrowserWindow | null {
  return overlayWindow && !overlayWindow.isDestroyed() ? overlayWindow : null;
}

export function toggleOverlayVisibility(): void {
  const win = getOverlayWindow();
  if (!win) return;
  if (win.isVisible()) win.hide();
  else win.show();
}

export function setOverlayClickThrough(enabled: boolean): void {
  const win = getOverlayWindow();
  if (!win) return;
  if (enabled) win.setIgnoreMouseEvents(true, { forward: true });
  else win.setIgnoreMouseEvents(false);
}

export function openSettingsWindow(): BrowserWindow {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return settingsWindow;
  }
  settingsWindow = new BrowserWindow({
    width: 940,
    height: 720,
    title: "Aether Settings",
    autoHideMenuBar: true,
    webPreferences: {
      preload,
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  loadRenderer(settingsWindow, "/settings");
  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });
  return settingsWindow;
}

export function openExternal(url: string): void {
  void shell.openExternal(url);
}

export function repositionOverlay(config: AppConfig): void {
  const win = getOverlayWindow();
  if (!win) return;
  const pos = anchorPosition(config);
  win.setPosition(pos.x, pos.y);
}
