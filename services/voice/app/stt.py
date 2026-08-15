"""Speech-to-text via faster-whisper (CTranslate2, CPU/GPU). Lazily loaded."""
import threading

_model = None
_model_size = None
_lock = threading.Lock()


def stt_available() -> bool:
    try:
        import faster_whisper  # noqa: F401

        return True
    except Exception:
        return False


def _device() -> tuple[str, str]:
    try:
        import ctranslate2

        if ctranslate2.get_cuda_device_count() > 0:
            return "cuda", "float16"
    except Exception:
        pass
    return "cpu", "int8"


def _get_model(size: str):
    global _model, _model_size
    with _lock:
        if _model is not None and _model_size == size:
            return _model
        from faster_whisper import WhisperModel

        device, compute_type = _device()
        _model = WhisperModel(size, device=device, compute_type=compute_type)
        _model_size = size
        return _model


def transcribe(wav_path: str, size: str = "base") -> str:
    model = _get_model(size)
    segments, _info = model.transcribe(wav_path, beam_size=1)
    return "".join(seg.text for seg in segments).strip()
