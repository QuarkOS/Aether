import { contextBridge, ipcRenderer } from "electron";
import type { AetherBridge, AgentEvent, AppConfig } from "@aether/shared";

const bridge: AetherBridge = {
  getConfig: () => ipcRenderer.invoke("config:get"),
  setConfig: (patch: Partial<AppConfig>) => ipcRenderer.invoke("config:set", patch),
  onAgentEvent: (cb: (event: AgentEvent) => void) => {
    const listener = (_e: unknown, event: AgentEvent) => cb(event);
    ipcRenderer.on("agent-event", listener);
    return () => ipcRenderer.removeListener("agent-event", listener);
  },
  onPushToTalk: (cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on("hotkey:push-to-talk", listener);
    return () => ipcRenderer.removeListener("hotkey:push-to-talk", listener);
  },
  sendText: (text: string) => ipcRenderer.invoke("agent:text", text),
  startListening: () => ipcRenderer.invoke("agent:startListening"),
  stopListening: () => ipcRenderer.invoke("agent:stopListening"),
  submitAudio: (wav: ArrayBuffer) => ipcRenderer.invoke("agent:audio", wav),
  setClickThrough: (enabled: boolean) => ipcRenderer.invoke("overlay:setClickThrough", enabled),
  setInteractiveRegion: (rect) => ipcRenderer.invoke("overlay:setInteractive", rect),
  getVoiceHealth: () => ipcRenderer.invoke("voice:health"),
  openSettings: () => ipcRenderer.invoke("settings:open"),
  quit: () => ipcRenderer.invoke("app:quit"),
  connectToolkit: (toolkit: string) => ipcRenderer.invoke("integrations:connect", toolkit),
  listToolkits: () => ipcRenderer.invoke("integrations:list"),
};

contextBridge.exposeInMainWorld("aether", bridge);
