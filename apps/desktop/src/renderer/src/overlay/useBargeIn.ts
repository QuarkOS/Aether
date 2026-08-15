import { useEffect, useRef } from "react";

/**
 * Duplex barge-in: while the assistant is speaking, watch mic energy and fire
 * onInterrupt once speech is sustained (threshold raised to reduce speaker echo).
 */
export function useBargeIn(opts: {
  enabled: boolean;
  /** True while assistant audio / speak state is active. */
  active: boolean;
  onInterrupt: () => void;
}): void {
  const { enabled, active, onInterrupt } = opts;
  const onInterruptRef = useRef(onInterrupt);
  onInterruptRef.current = onInterrupt;
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let proc: ScriptProcessorNode | null = null;
    let speechMs = 0;
    let fired = false;
    let armedAt = 0;

    const cleanup = () => {
      proc?.disconnect();
      proc = null;
      void ctx?.close();
      ctx = null;
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
    };

    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (err) {
        console.error("[barge-in] mic unavailable:", err);
        return;
      }
      if (cancelled) {
        cleanup();
        return;
      }
      ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      proc = ctx.createScriptProcessor(4096, 1, 1);
      // Must connect to destination to keep the node alive; mute to avoid a
      // speaker → mic loop while Alya is talking.
      const silent = ctx.createGain();
      silent.gain.value = 0;
      proc.onaudioprocess = (e) => {
        if (!activeRef.current) {
          speechMs = 0;
          fired = false;
          armedAt = 0;
          return;
        }
        if (!armedAt) armedAt = Date.now();
        // Ignore the first ~350ms of each speak burst (TTS latency / echo settle).
        if (Date.now() - armedAt < 350) return;
        if (fired) return;

        const input = e.inputBuffer.getChannelData(0);
        let sum = 0;
        for (const v of input) sum += v * v;
        const rms = Math.sqrt(sum / input.length);
        const frameMs = (input.length / (ctx?.sampleRate ?? 48000)) * 1000;
        // Higher than wake-word gate so speaker bleed is less likely to trip.
        if (rms >= 0.045) speechMs += frameMs;
        else speechMs = Math.max(0, speechMs - frameMs * 1.5);

        if (speechMs >= 220) {
          fired = true;
          speechMs = 0;
          onInterruptRef.current();
        }
      };
      source.connect(proc);
      proc.connect(silent);
      silent.connect(ctx.destination);
    };

    void start();
    return () => {
      cancelled = true;
      cleanup();
    };
  }, [enabled]);
}
