import { useEffect, useRef } from "react";

/**
 * Always-on energy gate for wake-word mode. When speech is detected, captures a
 * short utterance and hands the WAV to onUtterance (main process STT + phrase match).
 * Pauses while `suspended` (PTT recording, thinking, speaking).
 */
export function useWakeWord(opts: {
  enabled: boolean;
  suspended: boolean;
  onUtterance: (wav: ArrayBuffer) => void;
}): void {
  const { enabled, suspended, onUtterance } = opts;
  const onUtteranceRef = useRef(onUtterance);
  onUtteranceRef.current = onUtterance;
  const suspendedRef = useRef(suspended);
  suspendedRef.current = suspended;

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let proc: ScriptProcessorNode | null = null;
    let capturing = false;
    let chunks: Float32Array[] = [];
    let silenceMs = 0;
    let startedAt = 0;
    let cooldownUntil = 0;

    const cleanup = () => {
      proc?.disconnect();
      proc = null;
      void ctx?.close();
      ctx = null;
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
    };

    const finishCapture = () => {
      if (!capturing) return;
      capturing = false;
      const sampleRate = ctx?.sampleRate ?? 48000;
      const merged = mergeChunks(chunks);
      chunks = [];
      cooldownUntil = Date.now() + 800;
      if (merged.length < sampleRate * 0.25) return;
      const wav = encodeWav(downsample(merged, sampleRate, 16000), 16000);
      onUtteranceRef.current(wav);
    };

    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (err) {
        console.error("[wake] mic unavailable:", err);
        return;
      }
      if (cancelled) {
        cleanup();
        return;
      }
      ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      proc = ctx.createScriptProcessor(4096, 1, 1);
      proc.onaudioprocess = (e) => {
        if (suspendedRef.current || Date.now() < cooldownUntil) {
          if (capturing) {
            capturing = false;
            chunks = [];
          }
          return;
        }
        const input = e.inputBuffer.getChannelData(0);
        let sum = 0;
        for (const v of input) sum += v * v;
        const rms = Math.sqrt(sum / input.length);
        const frameMs = (input.length / (ctx?.sampleRate ?? 48000)) * 1000;

        if (!capturing) {
          if (rms >= 0.02) {
            capturing = true;
            chunks = [new Float32Array(input)];
            silenceMs = 0;
            startedAt = Date.now();
          }
          return;
        }

        chunks.push(new Float32Array(input));
        if (rms < 0.012) silenceMs += frameMs;
        else silenceMs = 0;
        const elapsed = Date.now() - startedAt;
        if ((elapsed > 500 && silenceMs > 700) || elapsed > 4500) {
          finishCapture();
        }
      };
      source.connect(proc);
      proc.connect(ctx.destination);
    };

    void start();
    return () => {
      cancelled = true;
      cleanup();
    };
  }, [enabled]);
}

function mergeChunks(chunks: Float32Array[]): Float32Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function downsample(buffer: Float32Array, from: number, to: number): Float32Array {
  if (to >= from) return buffer;
  const ratio = from / to;
  const length = Math.round(buffer.length / ratio);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    out[i] = buffer[Math.floor(i * ratio)] ?? 0;
  }
  return out;
}

function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeString(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (const s of samples) {
    const clamped = Math.max(-1, Math.min(1, s));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }
  return buffer;
}
