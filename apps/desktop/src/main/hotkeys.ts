import { globalShortcut } from "electron";

let registered: string | null = null;

export function registerPushToTalk(accelerator: string, onTrigger: () => void): void {
  unregisterPushToTalk();
  try {
    const ok = globalShortcut.register(accelerator, onTrigger);
    if (ok) registered = accelerator;
    else console.error(`[hotkeys] failed to register ${accelerator}`);
  } catch (err) {
    console.error(`[hotkeys] error registering ${accelerator}:`, err);
  }
}

export function unregisterPushToTalk(): void {
  if (registered) {
    globalShortcut.unregister(registered);
    registered = null;
  }
}

export function unregisterAll(): void {
  globalShortcut.unregisterAll();
  registered = null;
}
