/**
 * Shared contracts between the Electron main process, the preload bridge,
 * the React renderer, and the Python voice service.
 */

/** Mascot expressions the agent can request. Mapped to Live2D expressions/motions in the renderer. */
export type Emotion =
  | "neutral"
  | "happy"
  | "smug"
  | "shy"
  | "embarrassed"
  | "angry"
  | "sad"
  | "surprised"
  | "thinking";

export const EMOTIONS: Emotion[] = [
  "neutral",
  "happy",
  "smug",
  "shy",
  "embarrassed",
  "angry",
  "sad",
  "surprised",
  "thinking",
];

/** High-level conversational state used to drive mascot behavior and UI. */
export type AssistantState =
  | "idle"
  | "listening"
  | "thinking"
  | "speaking"
  | "error";

/** A single chat turn shown in the transcript bubble / settings history. */
export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "tool";
  text: string;
  emotion?: Emotion;
  createdAt: string;
}

/** Events streamed from the agent (main process) to the renderer over IPC. */
export type AgentEvent =
  | { type: "state"; state: AssistantState }
  | { type: "user-transcript"; text: string }
  | { type: "assistant-delta"; text: string }
  | { type: "assistant-final"; text: string; emotion: Emotion }
  | { type: "tool-call"; tool: string; args: unknown }
  | { type: "tool-result"; tool: string; ok: boolean; summary: string }
  | { type: "audio"; url: string; emotion: Emotion; durationMs: number; visemes?: Viseme[] }
  | { type: "error"; message: string };

/** Simple time-stamped mouth-open value for lip-sync when phonemes are unavailable. */
export interface Viseme {
  /** Seconds from clip start. */
  t: number;
  /** Mouth open amount 0..1. */
  value: number;
}

/** Persisted user configuration (stored by the main process). */
export interface AppConfig {
  llm: {
    provider: "openai" | "anthropic" | "gemini" | "none";
    model: string;
  };
  voice: {
    /** edge-tts base voice used before RVC re-timbre. */
    ttsVoice: string;
    /** Enable RVC re-timbre to the Alya voice model. */
    rvcEnabled: boolean;
    /** Pitch shift in semitones for RVC. */
    rvcPitch: number;
    /** RVC model name (directory under the voice service models dir). */
    rvcModel: string;
  };
  input: {
    /** Global push-to-talk accelerator (Electron accelerator syntax). */
    pushToTalkHotkey: string;
    /** faster-whisper model size. */
    sttModel: string;
    wakeWordEnabled: boolean;
  };
  mascot: {
    /** Model directory name under resources/models. */
    model: string;
    scale: number;
    /** Click-through overlay: clicks pass through transparent pixels. */
    clickThrough: boolean;
    /** Anchor corner for the overlay window. */
    anchor: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  };
  integrations: {
    /** Composio toolkit slugs the user enabled (e.g. "gmail", "github"). */
    enabledToolkits: string[];
    /** Stable per-install user id used for Composio connected accounts. */
    userId: string;
  };
  startOnLogin: boolean;
}

export const DEFAULT_CONFIG: AppConfig = {
  llm: { provider: "openai", model: "gpt-4o-mini" },
  voice: {
    ttsVoice: "en-US-AriaNeural",
    rvcEnabled: true,
    rvcPitch: 0,
    rvcModel: "alya",
  },
  input: {
    pushToTalkHotkey: "Alt+Space",
    sttModel: "base",
    wakeWordEnabled: false,
  },
  mascot: {
    model: "placeholder",
    scale: 0.25,
    clickThrough: true,
    anchor: "bottom-right",
  },
  integrations: { enabledToolkits: [], userId: "" },
  startOnLogin: false,
};

/** Health/capabilities reported by the Python voice service. */
export interface VoiceHealth {
  ok: boolean;
  device: string;
  ttsAvailable: boolean;
  sttAvailable: boolean;
  rvcAvailable: boolean;
  rvcModelLoaded: boolean;
  models: string[];
}

/** Request body for POST /speak on the voice service. */
export interface SpeakRequest {
  text: string;
  voice?: string;
  rvc?: boolean;
  model?: string;
  pitch?: number;
}

/** The API the preload script exposes to the renderer as `window.aether`. */
export interface AetherBridge {
  getConfig(): Promise<AppConfig>;
  setConfig(patch: Partial<AppConfig>): Promise<AppConfig>;
  onAgentEvent(cb: (event: AgentEvent) => void): () => void;
  /** Fires when the global push-to-talk hotkey is pressed. */
  onPushToTalk(cb: () => void): () => void;
  sendText(text: string): Promise<void>;
  startListening(): Promise<void>;
  stopListening(): Promise<void>;
  /** Send captured microphone audio (WAV bytes) for transcription + agent turn. */
  submitAudio(wav: ArrayBuffer): Promise<void>;
  setClickThrough(enabled: boolean): Promise<void>;
  /** Report the mascot's opaque bounding box so the overlay can hit-test clicks. */
  setInteractiveRegion(rect: { x: number; y: number; width: number; height: number } | null): Promise<void>;
  getVoiceHealth(): Promise<VoiceHealth | null>;
  openSettings(): Promise<void>;
  quit(): Promise<void>;
  /** Composio: begin OAuth for a toolkit, returns a redirect URL to open. */
  connectToolkit(toolkit: string): Promise<{ redirectUrl: string } | { error: string }>;
  listToolkits(): Promise<string[]>;
}

declare global {
  interface Window {
    aether: AetherBridge;
  }
}
