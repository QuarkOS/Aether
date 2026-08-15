import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentEvent, AppConfig, AssistantState, Emotion } from "@aether/shared";
import { DEFAULT_CONFIG } from "@aether/shared";

import { Mascot } from "./Mascot";
import { useAudioPlayback } from "./useAudioPlayback";
import { useClickThrough } from "./useClickThrough";
import { useRecorder } from "./useRecorder";
import "./overlay.css";

const MODEL_URLS: Record<string, string | null> = {
  placeholder: null,
};

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
  const streamingRef = useRef("");

  const { ampRef, play } = useAudioPlayback();
  const speakRafRef = useRef<number | null>(null);
  const speakTimerRef = useRef<number | null>(null);
  const { recording, start, stop } = useRecorder((wav) => {
    void window.aether.submitAudio(wav);
  });

  const stopSpeaking = useCallback(() => {
    if (speakRafRef.current) cancelAnimationFrame(speakRafRef.current);
    if (speakTimerRef.current) window.clearTimeout(speakTimerRef.current);
    speakRafRef.current = null;
    speakTimerRef.current = null;
    setMouthOpen(0);
    setState("idle");
  }, []);

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
      speakTimerRef.current = window.setTimeout(stopSpeaking, Math.max(800, durationMs));
    },
    [ampRef, play, stopSpeaking],
  );

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
          setBubble(streamingRef.current);
          break;
        case "assistant-final":
          setBubble(event.text);
          setEmotion(event.emotion);
          break;
        case "audio":
          setEmotion(event.emotion);
          beginSpeaking(event.url, event.durationMs);
          break;
        case "error":
          setError(event.message);
          setTimeout(() => setError(null), 6000);
          break;
        default:
          break;
      }
    });
    return off;
  }, [beginSpeaking]);

  // Push-to-talk hotkey toggles recording.
  useEffect(() => {
    const off = window.aether.onPushToTalk(() => {
      setError(null);
      void (async () => {
        if (recording) stop();
        else {
          try {
            await window.aether.startListening();
            await start();
          } catch (err) {
            setError(`Microphone unavailable: ${String(err)}`);
          }
        }
      })();
    });
    return off;
  }, [recording, start, stop]);

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
          onClick={() => (recording ? stop() : void start())}
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
