"""Aether voice service: health, text-to-speech (edge-tts + optional RVC), STT."""
import os
import tempfile
import threading

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

from . import models, rvc, stt, tts

app = FastAPI(title="Aether Voice Service")


class SpeakBody(BaseModel):
    text: str
    voice: str | None = None
    rvc: bool = True
    model: str = "alya"
    pitch: int = 0


def _warm_rvc() -> None:
    """Best-effort: fetch + load the Alya model so first speech is re-timbred."""
    if not rvc.rvc_available():
        return
    try:
        if models.ensure_model("alya"):
            rvc.load_model("alya")
    except Exception as exc:  # noqa: BLE001
        print(f"[voice] RVC warmup skipped: {exc}")


@app.on_event("startup")
def _startup() -> None:
    threading.Thread(target=_warm_rvc, daemon=True).start()


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
        }
    )


@app.post("/speak")
def speak(body: SpeakBody) -> Response:
    if not body.text.strip():
        return Response(status_code=400, content="text is required")
    wav = tts.synthesize_wav(body.text, body.voice or tts.DEFAULT_VOICE)
    if body.rvc and rvc.rvc_available():
        if models.ensure_model(body.model):
            wav = rvc.convert(wav, body.model, body.pitch)
    return Response(content=wav, media_type="audio/wav")


@app.post("/stt")
def transcribe(audio: UploadFile = File(...), model: str = Form("base")) -> JSONResponse:
    if not stt.stt_available():
        return JSONResponse({"text": "", "error": "STT not available"}, status_code=503)
    suffix = os.path.splitext(audio.filename or "audio.wav")[1] or ".wav"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(audio.file.read())
        tmp_path = tmp.name
    try:
        text = stt.transcribe(tmp_path, model)
        return JSONResponse({"text": text})
    finally:
        try:
            os.remove(tmp_path)
        except OSError:
            pass
