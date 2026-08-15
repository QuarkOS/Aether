"""Aether voice service: health, text-to-speech (edge-tts + optional RVC), STT."""
import os
import tempfile
import threading
import time

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

from . import models, rvc, stt, tts

app = FastAPI(title="Aether Voice Service")

# Startup warmup must finish (or time out) before /stt and RVC /speak serve.
# Interleaving cold whisper + RVC on one GPU was causing 30s+ spikes.
_warm_event = threading.Event()
_warm_status: dict[str, object] = {
    "stt": False,
    "rvc": False,
    "sttModel": None,
    "error": None,
}
# Serialize /speak: StreamingSpeaker prefetches the next chunk; concurrent
# edge-tts + RVC on the threadpool caused NoAudioReceived / CUDA stalls.
_speak_lock = threading.Lock()


class SpeakBody(BaseModel):
    text: str
    voice: str | None = None
    rvc: bool = True
    model: str = "alya"
    pitch: int = 0
    mode: str = "quality"


def _default_stt_model() -> str:
    return os.environ.get("AETHER_STT_MODEL", "small").strip() or "small"


def _warm_all() -> None:
    """Pay model load cost at startup, not on first utterance.

    RVC before STT: typed replies can speak as soon as RVC is ready once we split
    readiness — today we still gate both, but order avoids whisper compile fighting
    the first RVC convert on the same CUDA device.
    """
    err: str | None = None
    try:
        if rvc.rvc_available():
            try:
                if models.ensure_model("alya"):
                    rvc.warm_pipeline("alya")
                    _warm_status["rvc"] = True
                    print("[voice] RVC pipeline warmed")
            except Exception as exc:  # noqa: BLE001
                err = f"rvc: {exc}"
                print(f"[voice] RVC warmup skipped: {exc}")
        else:
            _warm_status["rvc"] = True  # nothing to warm

        size = _default_stt_model()
        try:
            stt.warm_model(size)
            _warm_status["stt"] = True
            _warm_status["sttModel"] = size
            print(f"[voice] STT warmed (whisper-{size})")
        except Exception as exc:  # noqa: BLE001
            err = f"stt: {exc}" if err is None else f"{err}; stt: {exc}"
            print(f"[voice] STT warmup skipped: {exc}")
    finally:
        if err:
            _warm_status["error"] = err
        _warm_event.set()
        print(
            f"[voice] warmup done stt={_warm_status['stt']} rvc={_warm_status['rvc']} "
            f"model={_warm_status['sttModel']}"
        )


def _wait_warm(kind: str, timeout_s: float = 300.0) -> None:
    """Block until startup warmup finished (or timed out)."""
    if _warm_event.is_set():
        return
    print(f"[voice] /{kind} waiting for warmup…")
    if not _warm_event.wait(timeout_s):
        print(f"[voice] /{kind} warmup wait timed out after {timeout_s:.0f}s")


@app.on_event("startup")
def _startup() -> None:
    threading.Thread(target=_warm_all, daemon=True, name="aether-voice-warm").start()


@app.get("/health")
def health() -> JSONResponse:
    return JSONResponse(
        {
            "ok": True,
            "device": rvc.device() if rvc.rvc_available() else "cpu",
            "ttsAvailable": tts.tts_available(),
            "sttAvailable": stt.stt_available(),
            "rvcAvailable": rvc.rvc_available(),
            "rvcModelLoaded": rvc.model_loaded() is not None,
            "models": models.list_models(),
            "warmReady": _warm_event.is_set(),
            "sttWarmed": bool(_warm_status["stt"]),
            "rvcWarmed": bool(_warm_status["rvc"]),
            "sttModel": _warm_status["sttModel"] or stt.loaded_size() or _default_stt_model(),
            "warmError": _warm_status["error"],
        }
    )


@app.post("/speak")
def speak(body: SpeakBody) -> Response:
    if not body.text.strip():
        return Response(status_code=400, content="text is required")

    with _speak_lock:
        need_rvc = bool(body.rvc and rvc.rvc_available())
        if need_rvc:
            _wait_warm("speak")

        # Prefer fast unless explicitly asked for quality (desktop forces fast).
        mode = "fast" if body.mode != "quality" else "quality"
        t0 = time.perf_counter()
        try:
            wav = tts.synthesize_wav(body.text, body.voice or tts.DEFAULT_VOICE)
        except Exception as exc:  # noqa: BLE001
            print(f"[speak] TTS failed chars={len(body.text)}: {exc}")
            return Response(status_code=502, content=f"TTS failed: {exc}")
        edge_ms = (time.perf_counter() - t0) * 1000
        rvc_ms = 0.0
        if need_rvc:
            if models.ensure_model(body.model):
                t1 = time.perf_counter()
                wav = rvc.convert(wav, body.model, body.pitch, mode=mode)
                rvc_ms = (time.perf_counter() - t1) * 1000
        total_ms = (time.perf_counter() - t0) * 1000
        print(
            f"[speak] chars={len(body.text)} edge={edge_ms:.0f}ms rvc={rvc_ms:.0f}ms "
            f"total={total_ms:.0f}ms rvc_on={need_rvc} mode={mode}"
        )
        return Response(content=wav, media_type="audio/wav")


@app.post("/stt")
def transcribe(
    audio: UploadFile = File(...),
    model: str = Form(None),
    initial_prompt: str | None = Form(None),
) -> JSONResponse:
    if not stt.stt_available():
        return JSONResponse({"text": "", "error": "STT not available"}, status_code=503)
    _wait_warm("stt")
    # Prefer the warmed size so we never unload small to load base mid-session.
    size = stt.resolve_size(model or _default_stt_model())
    suffix = os.path.splitext(audio.filename or "audio.wav")[1] or ".wav"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(audio.file.read())
        tmp_path = tmp.name
    try:
        t0 = time.perf_counter()
        text = stt.transcribe(tmp_path, size, initial_prompt=initial_prompt)
        print(f"[stt] model={size} {(time.perf_counter() - t0) * 1000:.0f}ms chars={len(text)}")
        return JSONResponse({"text": text, "model": size})
    finally:
        try:
            os.remove(tmp_path)
        except OSError:
            pass
