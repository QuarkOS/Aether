import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentEvent, AppConfig, AssistantState, Emotion } from "@aether/shared";
import { DEFAULT_CONFIG, EMOTIONS } from "@aether/shared";

import { Mascot } from "./Mascot";
import { useAudioPlayback } from "./useAudioPlayback";
import { useBargeIn } from "./useBargeIn";
import { useClickThrough } from "./useClickThrough";
import { useRecorder } from "./useRecorder";
import { useWakeWord } from "./useWakeWord";
import "./overlay.css";

const MODEL_URLS: Record<string, string | null> = {
  placeholder: null,
};

const EMOTION_NAME_ALT = EMOTIONS.join("|");

/** Strip think/emotion junk from the streaming bubble (TTS uses speakablePartial in main). */
function stripBubbleJunk(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<think>[\s\S]*$/gi, "")
    .replace(/\[\s*emotion:\s*[a-zA-Z]+\s*\]/gi, "")
    .replace(new RegExp(`\\[\\s*(?:${EMOTION_NAME_ALT})\\s*\\]`, "gi"), "")
    .replace(/\[[^\]]*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function modelUrlFor(config: AppConfig): string | null {
  if (config.mascot.model in MODEL_URLS) return MODEL_URLS[config.mascot.model];
  // Any other value is treated as a direct model3.json URL/path (e.g. the Alya model).
  return config.mascot.model;
}

export function OverlayApp() {
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const [state, setState] = useState<AssistantState>("idle");
  const [emotion, setEmotion] = useState<Emotion>("neutral");
  const [mouthOpen, setMouthOpen] = useState(0);
  const [gaze, setGaze] = useState({ x: 0, y: 0 });
  const [bubble, setBubble] = useState<string>("");
  const [userText, setUserText] = useState<string>("");
  const [inputText, setInputText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [timingLabel, setTimingLabel] = useState<string | null>(null);
  const streamingRef = useRef("");
  const timingClearRef = useRef<number | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const { ampRef, play, stop: stopAudio } = useAudioPlayback();
  const speakRafRef = useRef<number | null>(null);
  const speakTimerRef = useRef<number | null>(null);
  const { recording, start, stop } = useRecorder(
    (wav) => {
      void window.aether.submitAudio(wav);
    },
    { maxListenMs: 6000 },
  );

  const stopSpeaking = useCallback(() => {
    if (speakRafRef.current) cancelAnimationFrame(speakRafRef.current);
    if (speakTimerRef.current) window.clearTimeout(speakTimerRef.current);
    speakRafRef.current = null;
    speakTimerRef.current = null;
    stopAudio();
    setMouthOpen(0);
  }, [stopAudio]);

  const beginSpeaking = useCallback(
    (url: string, durationMs: number) => {
      if (speakRafRef.current) cancelAnimationFrame(speakRafRef.current);
      if (speakTimerRef.current) window.clearTimeout(speakTimerRef.current);
      setState("speaking");
      void play(url);
      const loop = () => {
        const now = performance.now();
        const fresh = now - ampRef.current.t < 140 ? ampRef.current.value : 0;
        // Use real amplitude when audio is playing; otherwise a synthetic flap with
        // distinct open and closed phases (~2/sec) that clearly crosses the 0.33 threshold.
        const synth = 0.1 + 0.75 * (0.5 + 0.5 * Math.sin(now / 130));
        setMouthOpen(fresh > 0.05 ? fresh : synth);
        speakRafRef.current = requestAnimationFrame(loop);
      };
      speakRafRef.current = requestAnimationFrame(loop);
      // Clip length is the source of truth for how long the mouth animates.
      speakTimerRef.current = window.setTimeout(() => {
        stopSpeaking();
        setState((s) => (s === "speaking" ? "idle" : s));
      }, Math.max(800, durationMs));
    },
    [ampRef, play, stopSpeaking],
  );

  const startMicCapture = useCallback(async () => {
    try {
      await window.aether.startListening();
      await start();
    } catch (err) {
      setError(`Microphone unavailable: ${String(err)}`);
    }
  }, [start]);

  const handleBargeIn = useCallback(() => {
    if (stateRef.current !== "speaking" && stateRef.current !== "thinking") return;
    stopSpeaking();
    setState("listening");
    void window.aether.interrupt("barge-in");
    void startMicCapture();
  }, [startMicCapture, stopSpeaking]);

  useWakeWord({
    enabled: config.input.wakeWordEnabled,
    // Barge-in owns duplex while speaking; wake stays paused for PTT / think / speak.
    suspended: recording || state === "thinking" || state === "listening" || state === "speaking",
    maxListenMs: 5500,
    onUtterance: (wav) => {
      void window.aether.submitWakeAudio(wav);
    },
  });

  useBargeIn({
    enabled: config.input.bargeInEnabled,
    active: state === "speaking",
    onInterrupt: handleBargeIn,
  });

  useClickThrough(config.mascot.clickThrough);

  useEffect(() => {
    void window.aether.getConfig().then(setConfig);
  }, []);

  useEffect(() => {
    const off = window.aether.onAgentEvent((event: AgentEvent) => {
      switch (event.type) {
        case "state":
          setState(event.state);
          break;
        case "user-transcript":
          setUserText(event.text);
          streamingRef.current = "";
          setBubble("");
          break;
        case "assistant-delta":
          streamingRef.current += event.text;
          setBubble(stripBubbleJunk(streamingRef.current));
          break;
        case "assistant-final":
          setBubble(stripBubbleJunk(event.text));
          setEmotion(event.emotion);
          break;
        case "audio":
          setEmotion(event.emotion);
          beginSpeaking(event.url, event.durationMs);
          break;
        case "audio-stop":
        case "interrupted":
          stopSpeaking();
          if (event.type === "interrupted" && event.reason === "barge-in") {
            setState("listening");
          } else {
            setState("idle");
          }
          break;
        case "error":
          setError(event.message);
          setTimeout(() => setError(null), 6000);
          break;
        case "wake-armed":
          setError(null);
          void (async () => {
            try {
              if (recording) return;
              await startMicCapture();
            } catch (err) {
              setError(`Microphone unavailable: ${String(err)}`);
            }
          })();
          break;
        case "turn-timing": {
          const fmt = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`);
          const bits = [
            event.sttMs !== undefined ? `STT ${fmt(event.sttMs)}` : null,
            `LLM ${fmt(event.llmMs)}`,
            event.ttfaMs !== undefined ? `TTFA ${fmt(event.ttfaMs)}` : null,
            `TTS ${fmt(event.ttsMs)}`,
            `total ${fmt(event.totalMs)}`,
            event.rvcRequested ? "RVC on" : "edge-tts",
          ].filter(Boolean);
          setTimingLabel(bits.join(" · "));
          if (timingClearRef.current) window.clearTimeout(timingClearRef.current);
          timingClearRef.current = window.setTimeout(() => setTimingLabel(null), 12000);
          break;
        }
        default:
          break;
      }
    });
    return off;
  }, [beginSpeaking, recording, startMicCapture, stopSpeaking]);

  // Reload config when settings may have changed (wake word toggle, etc.).
  useEffect(() => {
    const id = window.setInterval(() => {
      void window.aether.getConfig().then(setConfig);
    }, 4000);
    return () => window.clearInterval(id);
  }, []);

  // Push-to-talk hotkey toggles recording (interrupts speak first).
  useEffect(() => {
    const off = window.aether.onPushToTalk(() => {
      setError(null);
      void (async () => {
        if (recording) stop();
        else {
          if (stateRef.current === "speaking" || stateRef.current === "thinking") {
            stopSpeaking();
            await window.aether.interrupt("user");
          }
          await startMicCapture();
        }
      })();
    });
    return off;
  }, [recording, startMicCapture, stop, stopSpeaking]);

  // Gaze follows the cursor across the screen.
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const cx = window.innerWidth / 2;
      const cy = window.innerHeight * 0.6;
      setGaze({
        x: Math.max(-1, Math.min(1, (e.clientX - cx) / (window.innerWidth / 2))),
        y: Math.max(-1, Math.min(1, (e.clientY - cy) / (window.innerHeight / 2))),
      });
    };
    document.addEventListener("mousemove", onMove);
    return () => document.removeEventListener("mousemove", onMove);
  }, []);

  const submitText = useCallback(() => {
    const text = inputText.trim();
    if (!text) return;
    setInputText("");
    void window.aether.sendText(text);
  }, [inputText]);

  const statusLabel: Record<AssistantState, string> = {
    idle: "",
    listening: "Listening…",
    thinking: "Thinking…",
    speaking: "Speaking…",
    error: "",
  };

  return (
    <div className="overlay">
      <div className="overlay__bubble-wrap">
        {(bubble || userText) && (
          <div className="bubble" data-interactive>
            {userText && <div className="bubble__user">{userText}</div>}
            {bubble && <div className="bubble__assistant">{bubble}</div>}
          </div>
        )}
        {statusLabel[state] && <div className="status-pill">{statusLabel[state]}</div>}
        {timingLabel && <div className="status-pill status-pill--timing" data-interactive>{timingLabel}</div>}
        {error && <div className="status-pill status-pill--error" data-interactive>{error}</div>}
      </div>

      <Mascot
        emotion={emotion}
        mouthOpen={mouthOpen}
        gaze={gaze}
        state={state}
        modelUrl={modelUrlFor(config)}
        scale={config.mascot.scale * 4}
      />

      <div className="dock" data-interactive>
        <button
          className={`mic ${recording ? "mic--on" : ""}`}
          title="Push to talk"
          onClick={() => {
            setError(null);
            void (async () => {
              if (recording) stop();
              else {
                if (stateRef.current === "speaking" || stateRef.current === "thinking") {
                  stopSpeaking();
                  await window.aether.interrupt("user");
                }
                await startMicCapture();
              }
            })();
          }}
        >
          {recording ? "■" : "🎙"}
        </button>
        <input
          className="dock__input"
          placeholder="Ask Alya…"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submitText()}
        />
        <button className="dock__send" onClick={submitText} title="Send">
          ➤
        </button>
        <button className="dock__settings" onClick={() => window.aether.openSettings()} title="Settings">
          ⚙
        </button>
      </div>
    </div>
  );
}
