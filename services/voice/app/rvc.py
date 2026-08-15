"""RVC v2 voice conversion (optional, torch-based). Lazily loaded."""
import tempfile
import threading

from .models import find_model_files

_engine = None
_loaded_model = None
_lock = threading.Lock()


def rvc_available() -> bool:
    try:
        import torch  # noqa: F401
        import rvc_python  # noqa: F401

        return True
    except Exception:
        return False


def device() -> str:
    try:
        import torch

        if torch.cuda.is_available():
            return "cuda:0"
        if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
            return "mps"
    except Exception:
        pass
    return "cpu"


def _get_engine():
    global _engine
    if _engine is not None:
        return _engine
    from rvc_python.infer import RVCInference

    _engine = RVCInference(device=device())
    return _engine


def load_model(name: str) -> bool:
    """Load the given RVC model by directory name. Returns success."""
    global _loaded_model
    pth, index = find_model_files(name)
    if not pth:
        return False
    with _lock:
        try:
            engine = _get_engine()
            engine.load_model(pth, index_path=index or "")
            _loaded_model = name
            return True
        except Exception as exc:  # noqa: BLE001
            print(f"[rvc] failed to load model {name}: {exc}")
            return False


def model_loaded() -> str | None:
    return _loaded_model


def convert(wav_bytes: bytes, model: str, pitch: int = 0) -> bytes:
    """Convert input WAV bytes to the target voice. Falls back to input on error."""
    with _lock:
        try:
            engine = _get_engine()
            if _loaded_model != model and not load_model(model):
                return wav_bytes
            try:
                engine.set_params(f0up_key=int(pitch))
            except Exception:
                pass
            with tempfile.TemporaryDirectory() as d:
                src = f"{d}/in.wav"
                dst = f"{d}/out.wav"
                with open(src, "wb") as f:
                    f.write(wav_bytes)
                engine.infer_file(src, dst)
                with open(dst, "rb") as f:
                    return f.read()
        except Exception as exc:  # noqa: BLE001
            print(f"[rvc] conversion failed, returning base audio: {exc}")
            return wav_bytes
