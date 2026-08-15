"""Text-to-speech via Microsoft edge-tts, returned as WAV bytes."""
import asyncio
import os
import subprocess
import tempfile

DEFAULT_VOICE = "en-US-JennyNeural"
FALLBACK_VOICE = "en-US-AriaNeural"
# RVC pipelines commonly operate at 40 kHz; harmless for plain playback too.
TARGET_SAMPLE_RATE = 40000


async def _synth_mp3(text: str, voice: str, out_path: str) -> None:
    import edge_tts

    communicate = edge_tts.Communicate(text, voice)
    await communicate.save(out_path)


def synthesize_wav(text: str, voice: str = DEFAULT_VOICE) -> bytes:
    """Synthesize `text` to mono WAV bytes at TARGET_SAMPLE_RATE."""
    cleaned = (text or "").replace("\u0000", "").strip()
    if not cleaned:
        raise ValueError("TTS text is empty")
    voices = [voice or DEFAULT_VOICE, FALLBACK_VOICE]
    # De-dupe while preserving order.
    tried: list[str] = []
    for v in voices:
        if v and v not in tried:
            tried.append(v)

    last_err: Exception | None = None
    with tempfile.TemporaryDirectory() as d:
        mp3_path = os.path.join(d, "tts.mp3")
        wav_path = os.path.join(d, "tts.wav")
        for v in tried:
            try:
                asyncio.run(_synth_mp3(cleaned, v, mp3_path))
                last_err = None
                break
            except Exception as exc:  # noqa: BLE001
                last_err = exc
                print(f"[tts] edge-tts failed voice={v!r} chars={len(cleaned)}: {exc}")
        if last_err is not None:
            raise last_err
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-i",
                mp3_path,
                "-ar",
                str(TARGET_SAMPLE_RATE),
                "-ac",
                "1",
                wav_path,
            ],
            check=True,
            capture_output=True,
        )
        with open(wav_path, "rb") as f:
            return f.read()


def tts_available() -> bool:
    try:
        import edge_tts  # noqa: F401

        return True
    except Exception:
        return False
