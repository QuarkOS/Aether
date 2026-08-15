"""Speech-to-text via faster-whisper (CTranslate2, CPU/GPU). Lazily loaded."""
import threading
import time

_model = None
_model_size = None
_lock = threading.Lock()


def stt_available() -> bool:
    try:
        import faster_whisper  # noqa: F401

        return True
    except Exception:
        return False


def loaded_size() -> str | None:
    return _model_size


def resolve_size(requested: str) -> str:
    """Stick to the already-loaded whisper size to avoid cold reloads mid-session.

    Warmup and the desktop config should agree (AETHER_STT_MODEL). If they diverge,
    keep the warmed weights and log once — swapping small↔base on CUDA was a
    multi-second stall on top of RVC.
    """
    size = (requested or "small").strip() or "small"
    if _model is not None and _model_size and _model_size != size:
        print(
            f"[stt] request whisper-{size} but whisper-{_model_size} is loaded; "
            f"keeping {_model_size} (set AETHER_STT_MODEL / Settings to match)"
        )
        return _model_size
    return size


def _device() -> tuple[str, str]:
    try:
        import ctranslate2

        if ctranslate2.get_cuda_device_count() > 0:
            return "cuda", "float16"
    except Exception:
        pass
    return "cpu", "int8"


def _get_model(size: str, *, force: bool = False):
    global _model, _model_size
    size = (size or "small").strip() or "small"
    if not force:
        size = resolve_size(size)
    with _lock:
        if _model is not None and _model_size == size:
            return _model
        from faster_whisper import WhisperModel

        device, compute_type = _device()
        t0 = time.perf_counter()
        print(f"[stt] loading whisper-{size} on {device}/{compute_type}")
        _model = WhisperModel(size, device=device, compute_type=compute_type)
        _model_size = size
        print(f"[stt] loaded whisper-{size} in {(time.perf_counter() - t0) * 1000:.0f}ms")
        return _model


def warm_model(size: str = "small") -> None:
    """Preload whisper so the first push-to-talk is not a cold download/compile."""
    if not stt_available():
        return
    _get_model(size, force=True)


def transcribe(wav_path: str, size: str = "small") -> str:
    model = _get_model(size)
    # Force English: auto language ID often mislabels short English clips (e.g. as German).
    # VAD trim (AIRI-style) drops leading/trailing silence before decode.
    segments, _info = model.transcribe(
        wav_path,
        beam_size=5,
        language="en",
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 400},
        condition_on_previous_text=False,
        without_timestamps=True,
    )
    return "".join(seg.text for seg in segments).strip()
