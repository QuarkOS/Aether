import { BrowserWindow } from "electron";
import type { AgentEvent, Emotion } from "@aether/shared";

import { runAgentTurn } from "./agent/agent.js";
import { loadConfig } from "./config.js";
import { speak, transcribe } from "./voiceService.js";

/** Broadcasts an agent event to every open window (overlay + settings). */
export function broadcast(event: AgentEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send("agent-event", event);
  }
}

let busy = false;

/** Reads the duration of a PCM WAV buffer in ms by scanning its RIFF chunks. */
function wavDurationMs(wav: Buffer): number {
  try {
    if (wav.length < 12 || wav.toString("ascii", 0, 4) !== "RIFF") return 2000;
    let byteRate = 0;
    let dataSize = 0;
    let offset = 12; // skip RIFF + size + WAVE
    while (offset + 8 <= wav.length) {
      const id = wav.toString("ascii", offset, offset + 4);
      const size = wav.readUInt32LE(offset + 4);
      const body = offset + 8;
      if (id === "fmt ") byteRate = wav.readUInt32LE(body + 8);
      else if (id === "data") {
        dataSize = size > 0 && body + size <= wav.length ? size : wav.length - body;
        break;
      }
      offset = body + size + (size % 2); // chunks are word-aligned
    }
    if (byteRate > 0 && dataSize > 0) return Math.round((dataSize / byteRate) * 1000);
  } catch {
    /* ignore malformed header */
  }
  return 2000;
}

async function synthesizeAndEmit(text: string, emotion: Emotion): Promise<void> {
  const config = loadConfig();
  const wav = await speak({
    text,
    voice: config.voice.ttsVoice,
    rvc: config.voice.rvcEnabled,
    model: config.voice.rvcModel,
    pitch: config.voice.rvcPitch,
  });
  if (wav) {
    const url = `data:audio/wav;base64,${wav.toString("base64")}`;
    // The renderer owns the speaking->idle lifecycle so lip-sync matches playback.
    const durationMs = wavDurationMs(wav);
    broadcast({ type: "audio", url, emotion, durationMs });
  } else {
    broadcast({ type: "state", state: "idle" });
  }
}

/** Full turn from already-transcribed text: agent -> speech. */
export async function handleUserText(text: string): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    const config = loadConfig();
    broadcast({ type: "user-transcript", text });
    broadcast({ type: "state", state: "thinking" });
    const result = await runAgentTurn(text, config, broadcast);
    broadcast({ type: "assistant-final", text: result.text, emotion: result.emotion });
    await synthesizeAndEmit(result.text, result.emotion);
  } catch (err) {
    broadcast({ type: "error", message: String(err) });
    broadcast({ type: "state", state: "idle" });
  } finally {
    busy = false;
  }
}

/** Full turn from captured microphone audio: STT -> agent -> speech. */
export async function handleUserAudio(wav: Buffer): Promise<void> {
  if (busy) return;
  const config = loadConfig();
  broadcast({ type: "state", state: "thinking" });
  const text = await transcribe(wav, config.input.sttModel);
  if (!text || !text.trim()) {
    broadcast({ type: "error", message: "I couldn't make out any speech." });
    broadcast({ type: "state", state: "idle" });
    return;
  }
  await handleUserText(text.trim());
}
