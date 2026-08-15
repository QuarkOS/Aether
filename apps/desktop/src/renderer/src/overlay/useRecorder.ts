import { useRef, useState } from "react";

/**
 * Captures microphone audio and encodes it to 16 kHz mono 16-bit WAV. Uses a
 * simple silence-based auto-stop (VAD) so push-to-talk can be "tap to start,
 * stops when you finish speaking".
 */
export function useRecorder(onComplete: (wav: ArrayBuffer) => void): {
  recording: boolean;
  start: () => Promise<void>;
  stop: () => void;
} {
  const [recording, setRecording] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const procRef = useRef<ScriptProcessorNode | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);
  const silenceMsRef = useRef(0);
  const startedAtRef = useRef(0);

  const cleanup = () => {
    procRef.current?.disconnect();
    procRef.current = null;
    ctxRef.current?.close();
    ctxRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  const finish = () => {
    if (!recording) return;
    setRecording(false);
    const sampleRate = ctxRef.current?.sampleRate ?? 48000;
    const merged = mergeChunks(chunksRef.current);
    cleanup();
    const wav = encodeWav(downsample(merged, sampleRate, 16000), 16000);
    onComplete(wav);
  };

  const start = async (): Promise<void> => {
    if (recording) return;
    chunksRef.current = [];
    silenceMsRef.current = 0;
    startedAtRef.current = Date.now();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;
    const ctx = new AudioContext();
    ctxRef.current = ctx;
    const source = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    procRef.current = proc;
    setRecording(true);

    proc.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);
      chunksRef.current.push(new Float32Array(input));
      let sum = 0;
      for (const v of input) sum += v * v;
      const rms = Math.sqrt(sum / input.length);
      const frameMs = (input.length / ctx.sampleRate) * 1000;
      if (rms < 0.012) silenceMsRef.current += frameMs;
      else silenceMsRef.current = 0;
      const elapsed = Date.now() - startedAtRef.current;
      // Auto-stop after ~1s of trailing silence (but require >0.6s of audio first).
      if (elapsed > 600 && silenceMsRef.current > 1000) finish();
    };

    source.connect(proc);
    proc.connect(ctx.destination);
  };

  const stop = () => finish();

  return { recording, start, stop };
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
