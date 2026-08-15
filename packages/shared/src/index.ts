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
  | {
      type: "turn-timing";
      /** Whisper STT only; omitted for typed turns. */
      sttMs?: number;
      llmMs: number;
      ttsMs: number;
      /** Wall time from turn start until first audio clip was emitted. */
      ttfaMs?: number;
      totalMs: number;
      /** Config asked for RVC; false means base edge-tts only. */
      rvcRequested: boolean;
    }
  | { type: "error"; message: string }
  /** Wake phrase heard; overlay should open a short command capture window. */
  | { type: "wake-armed" }
  /** Stop TTS playback and clear the speak queue (barge-in / cancel). */
  | { type: "audio-stop" }
  /** User interrupted the assistant; overlay should stop audio and may listen. */
  | { type: "interrupted"; reason: "barge-in" | "user" | "new-turn" };

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
    provider: "openai" | "openai-compatible" | "none";
    model: string;
    /** OpenAI-compatible API root (e.g. http://127.0.0.1:11434/v1). Empty for cloud OpenAI. */
    baseUrl: string;
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
    /**
     * quality = fuller Alya timbre (index mix); fast = snappier RVC (index 0).
     * Only matters when rvcEnabled is true.
     */
    voiceMode: "quality" | "fast";
  };
  input: {
    /** Global push-to-talk accelerator (Electron accelerator syntax). */
    pushToTalkHotkey: string;
    /** faster-whisper model size. */
    sttModel: string;
    /** Continuous mic listen for the wake phrase (energy + STT keyword gate). */
    wakeWordEnabled: boolean;
    /** Phrase that arms listening / starts a turn (case-insensitive). */
    wakePhrase: string;
    /**
     * Listen while Alya speaks: energy/VAD barge-in stops TTS, clears the speak
     * queue, and aborts the in-flight LLM stream so a new turn can start.
     */
    bargeInEnabled: boolean;
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
  /** First-run walkthrough completed. */
  onboardingCompleted: boolean;
}

export const DEFAULT_CONFIG: AppConfig = {
  llm: { provider: "openai", model: "gpt-4o-mini", baseUrl: "" },
  voice: {
    ttsVoice: "en-US-AriaNeural",
    rvcEnabled: false,
    rvcPitch: 0,
    rvcModel: "alya",
    voiceMode: "quality",
  },
  input: {
    pushToTalkHotkey: "CommandOrControl+Shift+Space",
    sttModel: "small",
    wakeWordEnabled: false,
    wakePhrase: "alya",
    bargeInEnabled: true,
  },
  mascot: {
    model: "placeholder",
    scale: 0.25,
    clickThrough: true,
    anchor: "bottom-right",
  },
  integrations: { enabledToolkits: [], userId: "" },
  startOnLogin: false,
  onboardingCompleted: false,
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
  /** Startup STT+RVC warmup finished (or timed out). */
  warmReady?: boolean;
  sttWarmed?: boolean;
  rvcWarmed?: boolean;
  /** Whisper size the sidecar warmed / will keep loaded. */
  sttModel?: string | null;
  warmError?: string | null;
  bootstrap?: string;
}

/** Request body for POST /speak on the voice service. */
export interface SpeakRequest {
  text: string;
  voice?: string;
  rvc?: boolean;
  model?: string;
  pitch?: number;
  /** quality (default) or fast RVC params. */
  mode?: "quality" | "fast";
}

/** Live status for one Composio toolkit (not persisted). */
export interface IntegrationToolkitStatus {
  slug: string;
  enabled: boolean;
  connected: boolean;
  accountLabel?: string;
  lastError?: string;
}

export type LocalLlmState = "missing" | "downloading" | "ready" | "starting" | "running" | "error";

/** Snapshot of the managed local llama.cpp install and process. */
export interface LocalLlmStatus {
  state: LocalLlmState;
  progress?: number;
  message?: string;
  baseUrl?: string;
  modelId?: string;
  backend?: "vulkan" | "cpu";
}

export type RvcInstallState = "missing" | "downloading" | "installing" | "ready" | "error";

/** Managed Alya RVC (torch + rvc-python + model) install progress. */
export interface RvcInstallStatus {
  state: RvcInstallState;
  progress?: number;
  message?: string;
  rvcAvailable: boolean;
  modelReady: boolean;
  device?: string;
}

/** Which API keys are configured in OS-encrypted storage (not the values). */
export interface SecretsStatus {
  openai: boolean;
  composio: boolean;
}

export type SecretId = "openai" | "composio";

/** The API the preload script exposes to the renderer as `window.aether`. */
export interface AetherBridge {
  getConfig(): Promise<AppConfig>;
  setConfig(patch: Partial<AppConfig>): Promise<AppConfig>;
  getSecretsStatus(): Promise<SecretsStatus>;
  setSecret(id: SecretId, value: string): Promise<{ ok: true } | { error: string }>;
  clearSecret(id: SecretId): Promise<void>;
  getLocalLlmStatus(): Promise<LocalLlmStatus>;
  installLocalLlm(): Promise<LocalLlmStatus>;
  startLocalLlm(): Promise<LocalLlmStatus>;
  stopLocalLlm(): Promise<LocalLlmStatus>;
  getRvcInstallStatus(): Promise<RvcInstallStatus>;
  installRvc(): Promise<RvcInstallStatus>;
  onAgentEvent(cb: (event: AgentEvent) => void): () => void;
  /** Fires when the global push-to-talk hotkey is pressed. */
  onPushToTalk(cb: () => void): () => void;
  sendText(text: string): Promise<void>;
  startListening(): Promise<void>;
  stopListening(): Promise<void>;
  /** Send captured microphone audio (WAV bytes) for transcription + agent turn. */
  submitAudio(wav: ArrayBuffer): Promise<void>;
  /** Candidate clip from continuous wake listening (ignored unless wake word matches). */
  submitWakeAudio(wav: ArrayBuffer): Promise<void>;
  /** Stop speaking / cancel the active turn (barge-in or explicit cancel). */
  interrupt(reason?: "barge-in" | "user"): Promise<void>;
  setClickThrough(enabled: boolean): Promise<void>;
  /** Report the mascot's opaque bounding box so the overlay can hit-test clicks. */
  setInteractiveRegion(rect: { x: number; y: number; width: number; height: number } | null): Promise<void>;
  getVoiceHealth(): Promise<VoiceHealth | null>;
  openSettings(): Promise<void>;
  quit(): Promise<void>;
  /** Composio: begin OAuth for a toolkit, returns a redirect URL to open. */
  connectToolkit(toolkit: string): Promise<{ redirectUrl: string } | { error: string }>;
  listToolkits(): Promise<string[]>;
  listIntegrationStatus(): Promise<IntegrationToolkitStatus[]>;
}

declare global {
  interface Window {
    aether: AetherBridge;
  }
}
