import { BrowserWindow } from "electron";
import type { AgentEvent, AppConfig, Emotion, SpeakRequest } from "@aether/shared";

import { runAgentTurn } from "./agent/agent.js";
import { speakablePartial } from "./agent/persona.js";
import { loadConfig } from "./config.js";
import { speak, transcribe } from "./voiceService.js";

/** Broadcasts an agent event to every open window (overlay + settings). */
export function broadcast(event: AgentEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send("agent-event", event);
  }
}

/** Active voice turn: speak queue + barge-in cancel via abort. */
type ActiveSession = {
  id: number;
  abort: AbortController;
  speaker: StreamingSpeaker;
};

let session: ActiveSession | null = null;
let sessionSeq = 0;
/** Soft lock for starting a new user turn. */
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

/** Cancel TTS + active turn. Duplex barge-in / PTT / new turn. */
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
  // Conversation path always uses fast RVC. Quality mode + big indexes caused
  // multi-minute stalls; Settings "quality" is ignored for live turns.
  return {
    voice: config.voice.ttsVoice,
    rvc: config.voice.rvcEnabled,
    model: config.voice.rvcModel,
    pitch: config.voice.rvcPitch,
    mode: "fast",
  };
}

/** Peel a first-audio unit at a comma/colon or ~40 chars (word boundary). */
function firstFlushFragment(text: string): string | null {
  const punct = text.search(/[,;:]/);
  if (punct >= 12 && punct <= 72) {
    return text.slice(0, punct + 1).trim();
  }
  if (text.length >= 40) {
    const window = text.slice(0, 48);
    const sp = window.lastIndexOf(" ");
    if (sp >= 24) return window.slice(0, sp).trim();
  }
  return null;
}

/**
 * AIRI-style TTS segmentation: speak the first clause ASAP instead of waiting
 * for the entire reply to go through edge-tts + RVC.
 * First chunk stays short (comma / ~40 chars) so time-to-first-audio drops.
 */
function splitSpeakChunks(text: string): string[] {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return [];
  const parts =
    cleaned.match(/[^.!?]+[.!?]+(?:["'”’])?|[^.!?]+$/g)?.map((s) => s.trim()).filter(Boolean) ?? [
      cleaned,
    ];
  const out: string[] = [];
  for (let part of parts) {
    if (out.length === 0) {
      const early = firstFlushFragment(part);
      if (early && early.length < part.length - 4) {
        out.push(early);
        part = part.slice(early.length).trim();
        if (!part) continue;
      }
    }
    const prev = out[out.length - 1];
    // Never merge back into the first spoken unit; merge later fragments only.
    if (prev && out.length >= 2 && (prev.length < 48 || part.length < 16)) {
      out[out.length - 1] = `${prev} ${part}`;
    } else {
      out.push(part);
    }
  }
  return out.length ? out : [cleaned];
}

/** Remainder of `full` after text already handed to TTS. */
function unspokenTail(full: string, spoken: string): string {
  if (!spoken) return full;
  if (full.startsWith(spoken)) return full.slice(spoken.length).trim();
  const a = full.toLowerCase();
  const b = spoken.toLowerCase();
  if (a.startsWith(b)) return full.slice(spoken.length).trim();
  return "";
}

/** Units ready to speak from a streaming buffer (excludes a trailing fragment). */
function takeCompleteSentences(
  text: string,
  opts?: { allowEarlyFlush?: boolean },
): { ready: string[]; rest: string } {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return { ready: [], rest: "" };
  const parts =
    cleaned.match(/[^.!?]+[.!?]+(?:["'”’])?|[^.!?]+$/g)?.map((s) => s.trim()).filter(Boolean) ?? [
      cleaned,
    ];
  if (parts.length === 0) return { ready: [], rest: "" };
  const last = parts[parts.length - 1]!;
  const lastComplete = /[.!?]["'”’]?$/.test(last);
  const ready = lastComplete ? parts : parts.slice(0, -1);
  const rest = lastComplete ? "" : last;
  if (ready.length === 0 && rest && opts?.allowEarlyFlush) {
    const early = firstFlushFragment(rest);
    if (early) return { ready: [early], rest: rest.slice(early.length).trim() };
  }
  return { ready, rest };
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
    const unspoken = unspokenTail(speakable, this.spokenText);
    if (!unspoken) return;
    const { ready } = takeCompleteSentences(unspoken, { allowEarlyFlush: !this.spokenText });
    for (const sentence of ready) {
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

/** Stream LLM and speak sentence chunks as they arrive. */
async function runTimedTurn(text: string, sttMs?: number): Promise<void> {
  const config = loadConfig();
  const turnWallStart = Date.now();
  broadcast({ type: "user-transcript", text });
  broadcast({ type: "state", state: "thinking" });

  const active = beginSession(config, turnWallStart);
  const { speaker, abort } = active;

  let rawAccum = "";
  const llmStart = Date.now();
  const result = await runAgentTurn(text, config, (event) => {
    if (!isCurrent(active)) return;
    broadcast(event);
    if (event.type === "assistant-delta") {
      rawAccum += event.text;
      speaker.pushRaw(rawAccum);
    }
  });
  const llmMs = Date.now() - llmStart;

  if (!isCurrent(active) || abort.signal.aborted) {
    busy = false;
    return;
  }

  const speakText =
    result.text.trim() ||
    "Sorry, I got stuck thinking and didn't finish a reply. Try again?";
  broadcast({ type: "assistant-final", text: speakText, emotion: result.emotion });
  const ttsMs = await speaker.finish(speakText, result.emotion);
  const ttfaMs = speaker.ttfaMs;
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

/** Whisper often mishears the default wake name; accept common variants. */
const ALYA_WAKE_ALIASES = ["alya", "alia", "alyah", "aliya", "aliyah", "aaliyah"] as const;

const WAKE_PREFIXES = new Set(["hey", "ok", "okay"]);

/** Collapse punctuation/symbols so "Alya!" / "Alya…" match cleanly. */
function normalizeWakeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1]! + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j]!;
  }
  return prev[b.length]!;
}

function wakeAliasList(phrase: string): string[] {
  const wake = normalizeWakeText(phrase);
  if (!wake) return [];
  if (wake === "alya" || (ALYA_WAKE_ALIASES as readonly string[]).includes(wake)) {
    return [...ALYA_WAKE_ALIASES];
  }
  return [wake];
}

/** True when `token` is an exact or careful fuzzy match for a single-token alias. */
function tokenMatchesAlias(token: string, alias: string): boolean {
  if (token === alias) return true;
  // "all" / "ya" / "ala" stay out; "all yeah" is not an alias.
  if (token.length < 4 || alias.length < 4) return false;
  if (token[0] !== alias[0]) return false;
  const lenDiff = Math.abs(token.length - alias.length);
  if (lenDiff > 1) return false;
  // 4-letter names: same-length substitution only (alya↔alia). Insertion
  // would accept "alien" vs "alia"; longer aliases cover aliya/aliyah.
  if ((alias.length < 5 || token.length < 5) && lenDiff !== 0) return false;
  return levenshtein(token, alias) <= 1;
}

/**
 * Try to consume a wake alias at `tokens[start]`. Returns the index after the
 * matched alias, or -1 if none match.
 */
function matchAliasAt(tokens: string[], start: number, aliases: string[]): number {
  if (start >= tokens.length) return -1;
  for (const alias of aliases) {
    const parts = alias.split(" ");
    if (parts.length === 1) {
      const tok = tokens[start];
      if (tok && tokenMatchesAlias(tok, parts[0]!)) return start + 1;
      continue;
    }
    if (
      parts.length === 2 &&
      tokens[start] === parts[0] &&
      tokens[start + 1] === parts[1]
    ) {
      return start + 2;
    }
  }
  return -1;
}

/** Detect wake phrase; return remaining command text (may be empty). */
export function matchWakePhrase(
  transcript: string,
  phrase: string,
): { woke: boolean; command: string } {
  const text = normalizeWakeText(transcript);
  const aliases = wakeAliasList(phrase);
  if (!text || aliases.length === 0) return { woke: false, command: "" };

  const tokens = text.split(" ");
  let start = 0;
  if (tokens[0] && WAKE_PREFIXES.has(tokens[0])) start = 1;

  const after = matchAliasAt(tokens, start, aliases);
  if (after >= 0) {
    return { woke: true, command: tokens.slice(after).join(" ").trim() };
  }

  // Clear name token later in the clip: "so alya what time is it"
  for (let i = start + 1; i < tokens.length; i++) {
    const midAfter = matchAliasAt(tokens, i, aliases);
    if (midAfter >= 0) {
      return { woke: true, command: tokens.slice(midAfter).join(" ").trim() };
    }
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
    busy = false;
    session = null;
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
    busy = false;
    session = null;
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
    const wakePhrase = config.input.wakePhrase.trim();
    const wakePrompt = `${wakePhrase.replace(/^\w/, (c) => c.toUpperCase())}.`;
    const text = await transcribe(wav, config.input.sttModel, {
      wake: true,
      initialPrompt: wakePrompt,
    });
    const sttMs = Date.now() - sttStart;
    const transcript = (text ?? "").trim();
    console.log(`[wake] stt=${formatMs(sttMs)} transcript=${JSON.stringify(transcript)}`);
    if (!transcript) {
      return;
    }
    const { woke, command } = matchWakePhrase(transcript, config.input.wakePhrase);
    if (!woke) {
      console.log(`[wake] ignore (no phrase match)`);
      return;
    }
    console.log(`[wake] armed command=${JSON.stringify(command)}`);
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
    busy = false;
    session = null;
  }
}
