import { BrowserWindow } from "electron";
import type { AgentEvent, AppConfig, Emotion, SpeakRequest } from "@aether/shared";

import {
  looksLikeToolRequest,
  runAgentTurn,
} from "./agent/agent.js";
import { speakablePartial } from "./agent/persona.js";
import { loadConfig } from "./config.js";
import { speak, transcribe } from "./voiceService.js";

/** Broadcasts an agent event to every open window (overlay + settings). */
export function broadcast(event: AgentEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send("agent-event", event);
  }
}

/**
 * GPT-Live-inspired session: Media Frontend (speak queue + barge-in) owns the
 * realtime voice loop; Delegation runs tools async without blocking audio.
 */
type ActiveSession = {
  id: number;
  abort: AbortController;
  speaker: StreamingSpeaker;
  /** Async tool job still running after realtime bridge. */
  delegation?: Promise<void>;
};

let session: ActiveSession | null = null;
let sessionSeq = 0;
/** Soft lock for starting a new user turn (delegation can outlive busy). */
let busy = false;

function beginSession(config: AppConfig, turnStart: number): ActiveSession {
  sessionSeq += 1;
  const next: ActiveSession = {
    id: sessionSeq,
    abort: new AbortController(),
    speaker: new StreamingSpeaker(config, turnStart),
  };
  session = next;
  return next;
}

function isCurrent(s: ActiveSession): boolean {
  return session?.id === s.id;
}

/**
 * Cancel TTS + LLM for the active turn. Duplex barge-in / PTT / new turn.
 * Does not wait for async delegation to finish; that job checks session id.
 */
export function interruptActiveTurn(reason: "barge-in" | "user" | "new-turn" = "user"): void {
  const active = session;
  if (!active) {
    broadcast({ type: "audio-stop" });
    broadcast({ type: "interrupted", reason });
    broadcast({ type: "state", state: "idle" });
    busy = false;
    return;
  }
  console.log(`[duplex] interrupt reason=${reason} session=${active.id}`);
  active.abort.abort();
  active.speaker.cancel();
  session = null;
  busy = false;
  broadcast({ type: "audio-stop" });
  broadcast({ type: "interrupted", reason });
  broadcast({ type: "state", state: "idle" });
}

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

function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

function speakOpts(config: AppConfig): Pick<SpeakRequest, "voice" | "rvc" | "model" | "pitch" | "mode"> {
  return {
    voice: config.voice.ttsVoice,
    rvc: config.voice.rvcEnabled,
    model: config.voice.rvcModel,
    pitch: config.voice.rvcPitch,
    mode: config.voice.voiceMode,
  };
}

const BRIDGE_LINES = ["On it.", "One sec.", "Working on that."];

function pickBridgeLine(): string {
  return BRIDGE_LINES[Math.floor(Math.random() * BRIDGE_LINES.length)]!;
}

/**
 * AIRI-style TTS segmentation: speak the first sentence ASAP instead of waiting
 * for the entire reply to go through edge-tts + RVC.
 * First chunk stays short (low merge threshold) so time-to-first-audio drops.
 */
function splitSpeakChunks(text: string): string[] {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return [];
  const parts =
    cleaned.match(/[^.!?]+[.!?]+(?:["'”’])?|[^.!?]+$/g)?.map((s) => s.trim()).filter(Boolean) ?? [
      cleaned,
    ];
  const out: string[] = [];
  for (const part of parts) {
    const prev = out[out.length - 1];
    // Keep the first spoken unit short; merge later fragments only.
    const mergePrevUnder = out.length <= 1 ? 28 : 48;
    if (prev && (prev.length < mergePrevUnder || part.length < 16)) {
      out[out.length - 1] = `${prev} ${part}`;
    } else {
      out.push(part);
    }
  }
  return out.length ? out : [cleaned];
}

/** Complete sentences ready to speak from a streaming buffer (excludes a trailing fragment). */
function takeCompleteSentences(text: string): { ready: string[]; rest: string } {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return { ready: [], rest: "" };
  const parts =
    cleaned.match(/[^.!?]+[.!?]+(?:["'”’])?|[^.!?]+$/g)?.map((s) => s.trim()).filter(Boolean) ?? [
      cleaned,
    ];
  if (parts.length === 0) return { ready: [], rest: "" };
  const last = parts[parts.length - 1]!;
  const lastComplete = /[.!?]["'”’]?$/.test(last);
  if (lastComplete) return { ready: parts, rest: "" };
  return { ready: parts.slice(0, -1), rest: last };
}

type SpeakJob = { text: string; emotion: Emotion };

/**
 * Queues sentence clips as the LLM streams. Prefetches the next /speak while
 * the current clip plays. Speaks the first complete sentence before the turn ends.
 * cancel() clears the queue for barge-in.
 */
class StreamingSpeaker {
  private readonly opts: ReturnType<typeof speakOpts>;
  private queue: SpeakJob[] = [];
  private pumpRunning = false;
  private pumpPromise: Promise<void> = Promise.resolve();
  private closed = false;
  private cancelled = false;
  private playUntil = 0;
  /** How many complete sentences from the stream we already enqueued. */
  private readySpoken = 0;
  /** Concatenation of text already handed to TTS (normalized spaces). */
  private spokenText = "";
  private firstAudioAt: number | null = null;
  private readonly turnStart: number;
  private ttsWorkMs = 0;
  private waitResolve: (() => void) | null = null;

  constructor(_config: AppConfig, turnStart: number) {
    this.opts = speakOpts(_config);
    this.turnStart = turnStart;
  }

  /** Feed cumulative raw model output (including think tags). */
  pushRaw(raw: string): void {
    if (this.closed || this.cancelled) return;
    const speakable = speakablePartial(raw);
    const { ready } = takeCompleteSentences(speakable);
    while (this.readySpoken < ready.length) {
      const sentence = ready[this.readySpoken]!;
      this.readySpoken += 1;
      for (const chunk of splitSpeakChunks(sentence)) this.enqueue(chunk, "neutral");
    }
  }

  /** Speak a canned bridging line immediately (async tool path). */
  enqueueImmediate(text: string, emotion: Emotion = "thinking"): void {
    if (this.cancelled) return;
    this.enqueue(text, emotion);
  }

  /** Flush remainder after the final cleaned reply is known. */
  async finish(finalText: string, emotion: Emotion): Promise<number> {
    if (this.cancelled) return this.ttsWorkMs;
    this.closed = true;
    const cleaned = finalText.replace(/\s+/g, " ").trim();
    let remaining = cleaned;
    if (this.spokenText) {
      if (cleaned.startsWith(this.spokenText)) {
        remaining = cleaned.slice(this.spokenText.length).trim();
      } else {
        // Stream vs final mismatch (emotion strip, etc.): skip re-speaking if we already started.
        const spokenNorm = this.spokenText.toLowerCase();
        const cleanedNorm = cleaned.toLowerCase();
        if (cleanedNorm.startsWith(spokenNorm)) {
          remaining = cleaned.slice(this.spokenText.length).trim();
        } else if (this.spokenText.length > 0) {
          remaining = "";
        }
      }
    }
    for (const chunk of splitSpeakChunks(remaining)) {
      if (chunk) this.enqueue(chunk, emotion);
    }
    for (const job of this.queue) job.emotion = emotion;
    // Drain until idle (handles pump-exit vs enqueue races).
    for (;;) {
      if (this.cancelled) break;
      await this.pumpPromise;
      if (this.cancelled || (this.queue.length === 0 && !this.pumpRunning)) break;
      this.kickPump();
    }
    return this.ttsWorkMs;
  }

  cancel(): void {
    this.cancelled = true;
    this.closed = true;
    this.queue = [];
    this.playUntil = 0;
    this.waitResolve?.();
    this.waitResolve = null;
  }

  get ttfaMs(): number | undefined {
    return this.firstAudioAt !== null ? this.firstAudioAt - this.turnStart : undefined;
  }

  private enqueue(text: string, emotion: Emotion): void {
    if (this.cancelled) return;
    const t = text.replace(/\s+/g, " ").trim();
    if (!t) return;
    this.spokenText = this.spokenText ? `${this.spokenText} ${t}` : t;
    this.queue.push({ text: t, emotion });
    this.kickPump();
  }

  private kickPump(): void {
    if (this.pumpRunning || this.cancelled) return;
    this.pumpRunning = true;
    this.pumpPromise = this.pump().finally(() => {
      this.pumpRunning = false;
      if (!this.cancelled && this.queue.length > 0) this.kickPump();
    });
  }

  private async waitPlayGap(): Promise<void> {
    const wait = this.playUntil - Date.now();
    if (wait <= 0) return;
    await new Promise<void>((resolve) => {
      this.waitResolve = resolve;
      setTimeout(() => {
        this.waitResolve = null;
        resolve();
      }, wait);
    });
  }

  private async pump(): Promise<void> {
    let next: Promise<Buffer | null> | null = null;

    while (!this.cancelled && (this.queue.length > 0 || next)) {
      const job = this.queue.shift();
      const pending = next;
      next = null;

      let wav: Buffer | null;
      const synthStart = Date.now();
      if (pending) {
        wav = await pending;
      } else if (job) {
        wav = await speak({ text: job.text, ...this.opts });
      } else {
        break;
      }
      this.ttsWorkMs += Date.now() - synthStart;
      if (this.cancelled) break;

      const following = this.queue[0];
      if (following && !this.cancelled) {
        next = speak({ text: following.text, ...this.opts });
      }

      if (!wav) continue;
      if (this.firstAudioAt === null) this.firstAudioAt = Date.now();
      await this.waitPlayGap();
      if (this.cancelled) break;
      const durationMs = wavDurationMs(wav);
      const url = `data:audio/wav;base64,${wav.toString("base64")}`;
      broadcast({
        type: "audio",
        url,
        emotion: job?.emotion ?? "neutral",
        durationMs,
      });
      this.playUntil = Date.now() + durationMs;
    }

    if (!this.cancelled && this.playUntil === 0) broadcast({ type: "state", state: "idle" });
  }
}

/**
 * Realtime voice path: stream LLM without tools and speak sentence chunks ASAP.
 * If tools look needed, speak a bridge line and run Delegation async.
 */
async function runTimedTurn(text: string, sttMs?: number): Promise<void> {
  const config = loadConfig();
  const turnWallStart = Date.now();
  broadcast({ type: "user-transcript", text });
  broadcast({ type: "state", state: "thinking" });

  const active = beginSession(config, turnWallStart);
  const { speaker, abort } = active;

  const needsTools = looksLikeToolRequest(text, config.integrations.enabledToolkits);
  let llmMs = 0;
  let ttsMs = 0;
  let ttfaMs: number | undefined;

  if (needsTools) {
    // Async path: keep the voice loop free — bridge immediately, tools in background.
    const bridge = pickBridgeLine();
    broadcast({ type: "assistant-delta", text: bridge });
    broadcast({ type: "assistant-final", text: bridge, emotion: "thinking" });
    speaker.enqueueImmediate(bridge, "thinking");
    const bridgeTts = await speaker.finish(bridge, "thinking");
    const bridgeTtfa = speaker.ttfaMs;

    const sessionId = active.id;
    // Realtime loop is free after the bridge; busy clears so barge-in / next turn works.
    busy = false;

    active.delegation = (async () => {
      const follow = new StreamingSpeaker(config, Date.now());
      if (session?.id === sessionId) session.speaker = follow;

      try {
        const llmStart = Date.now();
        let rawAccum = "";
        const result = await runAgentTurn(
          text,
          config,
          (event) => {
            if (session?.id !== sessionId) return;
            broadcast(event);
            if (event.type === "assistant-delta") {
              rawAccum += event.text;
              follow.pushRaw(rawAccum);
            }
          },
          { mode: "tools", abortSignal: abort.signal, recordHistory: true },
        );
        const toolsLlmMs = Date.now() - llmStart;
        if (session?.id !== sessionId || result.aborted) return;

        const speakText =
          result.text.trim() ||
          "I couldn't finish that tool action. Try again?";
        broadcast({ type: "assistant-final", text: speakText, emotion: result.emotion });
        const followTts = await follow.finish(speakText, result.emotion);

        const totalMs = (sttMs ?? 0) + (Date.now() - turnWallStart);
        broadcast({
          type: "turn-timing",
          ...(sttMs !== undefined ? { sttMs } : {}),
          llmMs: toolsLlmMs,
          ttsMs: bridgeTts + followTts,
          ...(bridgeTtfa !== undefined ? { ttfaMs: bridgeTtfa } : {}),
          totalMs,
          rvcRequested: config.voice.rvcEnabled,
        });
        console.log(
          `[turn] stt=${sttMs !== undefined ? formatMs(sttMs) : "n/a"} llm=${formatMs(toolsLlmMs)} tts=${formatMs(bridgeTts + followTts)} path=async-tools`,
        );
      } catch (err) {
        if (!abort.signal.aborted) {
          broadcast({ type: "error", message: String(err) });
        }
      } finally {
        if (session?.id === sessionId) {
          session = null;
          busy = false;
          broadcast({ type: "state", state: "idle" });
        }
      }
    })();
    return;
  }

  // Realtime path: companion chat without tools — speak while tokens arrive.
  let rawAccum = "";
  const llmStart = Date.now();
  const result = await runAgentTurn(
    text,
    config,
    (event) => {
      if (!isCurrent(active)) return;
      broadcast(event);
      if (event.type === "assistant-delta") {
        rawAccum += event.text;
        speaker.pushRaw(rawAccum);
      }
    },
    { mode: "realtime", abortSignal: abort.signal },
  );
  llmMs = Date.now() - llmStart;

  if (!isCurrent(active) || result.aborted) {
    busy = false;
    return;
  }

  const speakText =
    result.text.trim() ||
    "Sorry, I got stuck thinking and didn't finish a reply. Try again?";
  broadcast({ type: "assistant-final", text: speakText, emotion: result.emotion });
  ttsMs = await speaker.finish(speakText, result.emotion);
  ttfaMs = speaker.ttfaMs;
  if (session?.id === active.id) session = null;

  const totalMs = (sttMs ?? 0) + (Date.now() - turnWallStart);
  const timing = {
    type: "turn-timing" as const,
    ...(sttMs !== undefined ? { sttMs } : {}),
    llmMs,
    ttsMs,
    ...(ttfaMs !== undefined ? { ttfaMs } : {}),
    totalMs,
    rvcRequested: config.voice.rvcEnabled,
  };
  const parts = [
    sttMs !== undefined ? `stt=${formatMs(sttMs)}` : null,
    `llm=${formatMs(llmMs)}`,
    ttfaMs !== undefined ? `ttfa=${formatMs(ttfaMs)}` : null,
    `tts=${formatMs(ttsMs)}`,
    `total=${formatMs(totalMs)}`,
    `rvc=${config.voice.rvcEnabled ? "on" : "off"}`,
    `mode=${config.voice.voiceMode}`,
    "path=realtime",
  ].filter(Boolean);
  console.log(`[turn] ${parts.join(" ")}`);
  if (!abort.signal.aborted) broadcast(timing);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Detect wake phrase; return remaining command text (may be empty). */
export function matchWakePhrase(
  transcript: string,
  phrase: string,
): { woke: boolean; command: string } {
  const text = transcript.replace(/\s+/g, " ").trim();
  const wake = phrase.replace(/\s+/g, " ").trim();
  if (!text || !wake) return { woke: false, command: "" };
  const re = new RegExp(
    `^(?:hey\\s+|ok\\s+|okay\\s+)?${escapeRegExp(wake)}(?:[,.!?]\\s*|\\s+)(?<rest>.*)$|^(?:hey\\s+|ok\\s+|okay\\s+)?${escapeRegExp(wake)}[,.!?]?$`,
    "i",
  );
  const m = text.match(re);
  if (m) {
    const rest = (m.groups?.rest ?? "").trim();
    return { woke: true, command: rest };
  }
  // Phrase embedded mid-utterance: "so alya what time is it"
  const mid = new RegExp(`(?:^|\\s)${escapeRegExp(wake)}(?:[,.!?]\\s*|\\s+)(?<rest>.+)$`, "i");
  const midMatch = text.match(mid);
  if (midMatch?.groups?.rest) {
    return { woke: true, command: midMatch.groups.rest.trim() };
  }
  return { woke: false, command: "" };
}

/** Full turn from already-transcribed text: agent -> speech. */
export async function handleUserText(text: string): Promise<void> {
  if (busy || session) {
    interruptActiveTurn("new-turn");
  }
  busy = true;
  try {
    await runTimedTurn(text);
  } catch (err) {
    broadcast({ type: "error", message: String(err) });
    broadcast({ type: "state", state: "idle" });
  } finally {
    // Delegation may still hold work; only clear if no session or realtime finished.
    if (!session) busy = false;
    else if (!session.delegation) {
      busy = false;
      session = null;
    }
  }
}

/** Full turn from captured microphone audio: STT -> agent -> speech. */
export async function handleUserAudio(wav: Buffer): Promise<void> {
  if (busy || session) {
    interruptActiveTurn("new-turn");
  }
  busy = true;
  try {
    const config = loadConfig();
    broadcast({ type: "state", state: "thinking" });
    const sttStart = Date.now();
    const text = await transcribe(wav, config.input.sttModel);
    const sttMs = Date.now() - sttStart;
    console.log(`[turn] stt=${formatMs(sttMs)} transcript=${JSON.stringify(text ?? "")}`);
    if (!text?.trim()) {
      broadcast({ type: "error", message: "I didn't catch that — try again?" });
      broadcast({ type: "state", state: "idle" });
      return;
    }
    await runTimedTurn(text.trim(), sttMs);
  } catch (err) {
    broadcast({ type: "error", message: String(err) });
    broadcast({ type: "state", state: "idle" });
  } finally {
    if (!session) busy = false;
    else if (!session.delegation) {
      busy = false;
      session = null;
    }
  }
}

/**
 * Continuous wake-mic clip: ignore unless the configured phrase is present.
 * "Alya, what's up?" runs immediately; bare "Alya" arms a follow-up capture.
 */
export async function handleWakeAudio(wav: Buffer): Promise<void> {
  if (busy) return;
  const config = loadConfig();
  if (!config.input.wakeWordEnabled) return;

  busy = true;
  try {
    const sttStart = Date.now();
    const text = await transcribe(wav, config.input.sttModel);
    const sttMs = Date.now() - sttStart;
    const transcript = (text ?? "").trim();
    console.log(`[wake] stt=${formatMs(sttMs)} transcript=${JSON.stringify(transcript)}`);
    if (!transcript) {
      return;
    }
    const { woke, command } = matchWakePhrase(transcript, config.input.wakePhrase);
    if (!woke) {
      return;
    }
    if (command) {
      await runTimedTurn(command, sttMs);
      return;
    }
    broadcast({ type: "wake-armed" });
    broadcast({ type: "state", state: "listening" });
  } catch (err) {
    broadcast({ type: "error", message: String(err) });
    broadcast({ type: "state", state: "idle" });
  } finally {
    if (!session) busy = false;
    else if (!session.delegation) {
      busy = false;
      session = null;
    }
  }
}
