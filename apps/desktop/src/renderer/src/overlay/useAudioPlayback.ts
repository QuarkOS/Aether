import { useCallback, useEffect, useRef, type MutableRefObject } from "react";

interface Playback {
  /** Latest lip-sync amplitude (0..1) and the time it was measured. */
  ampRef: MutableRefObject<{ value: number; t: number }>;
  play: (url: string) => Promise<void>;
}

/**
 * Plays assistant audio and continuously measures a lip-sync amplitude via an
 * AnalyserNode. Amplitude is written to `ampRef`; the overlay blends it with a
 * synthetic mouth animation so lips still move on machines without audio output.
 */
export function useAudioPlayback(): Playback {
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const sourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const ampRef = useRef<{ value: number; t: number }>({ value: 0, t: 0 });

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      audioRef.current?.pause();
      void ctxRef.current?.close();
    };
  }, []);

  const measure = () => {
    const analyser = analyserRef.current;
    if (!analyser) return;
    const buf = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) {
      const centered = (v - 128) / 128;
      sum += centered * centered;
    }
    const rms = Math.sqrt(sum / buf.length);
    ampRef.current = { value: Math.min(1, rms * 3.2), t: performance.now() };
    rafRef.current = requestAnimationFrame(measure);
  };

  // Plays sound for real audio devices and feeds the analyser. The speaking
  // lifecycle (and lip-sync duration) is owned by the caller via clip length,
  // so a missing/instant `ended` event never cuts the animation short.
  const play = useCallback(async (url: string): Promise<void> => {
    try {
      if (!ctxRef.current) {
        ctxRef.current = new AudioContext();
        analyserRef.current = ctxRef.current.createAnalyser();
        analyserRef.current.fftSize = 1024;
      }
      const ctx = ctxRef.current;
      if (ctx.state === "suspended") await ctx.resume();

      if (!audioRef.current) {
        audioRef.current = new Audio();
        audioRef.current.crossOrigin = "anonymous";
        sourceRef.current = ctx.createMediaElementSource(audioRef.current);
        sourceRef.current.connect(analyserRef.current!);
        analyserRef.current!.connect(ctx.destination);
      }
      const audio = audioRef.current;
      audio.src = url;
      await audio.play();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(measure);
    } catch (err) {
      // No audio output device (e.g. headless): lip-sync falls back to synthetic.
      console.warn("[audio] playback unavailable, using synthetic lip-sync:", err);
    }
  }, []);

  return { ampRef, play };
}
