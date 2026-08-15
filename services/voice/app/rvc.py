"""RVC v2 voice conversion (optional, torch-based). Lazily loaded."""
import os
import struct
import tempfile
import threading
import time
import wave

from .models import find_model_files

_engine = None
_loaded_model = None
_lock = threading.RLock()
_torch_load_patched = False
# AIRI skips RVC (native TTS). We keep RVC but use rmvpe (GPU) — harvest was 60s+.
# fcpe is listed in set_params but not implemented in rvc-python's get_f0.
_DEFAULT_F0 = "rmvpe"
# quality: modest index mix when a *small* FAISS index exists; fast: pth-only feel.
_QUALITY_INDEX_RATE = 0.35
_FAST_INDEX_RATE = 0.0
# Hard ceiling so a stuck FAISS/CUDA path cannot freeze the conversation.
_INFER_TIMEOUT_S = 8.0
_params_mode: str | None = None
_params_pitch: int | None = None


def _index_rate_for(mode: str) -> float:
    return _FAST_INDEX_RATE if mode == "fast" else _QUALITY_INDEX_RATE


def _filter_radius_for(mode: str) -> int:
    return 1 if mode == "fast" else 3


def _patch_torch_load_for_fairseq() -> None:
    """PyTorch 2.6 defaults torch.load(weights_only=True), which breaks fairseq Hubert."""
    global _torch_load_patched
    if _torch_load_patched:
        return
    import torch

    if getattr(torch.load, "_aether_weights_only_patch", False):
        _torch_load_patched = True
        return
    _orig = torch.load

    def _load(*args, **kwargs):  # type: ignore[no-untyped-def]
        kwargs.setdefault("weights_only", False)
        return _orig(*args, **kwargs)

    _load._aether_weights_only_patch = True  # type: ignore[attr-defined]
    torch.load = _load  # type: ignore[assignment]
    _torch_load_patched = True


def rvc_available() -> bool:
    try:
        import torch  # noqa: F401

        _patch_torch_load_for_fairseq()
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
    _patch_torch_load_for_fairseq()
    from rvc_python.infer import RVCInference

    _engine = RVCInference(device=device())
    return _engine


def _apply_params(engine, pitch: int = 0, mode: str = "quality") -> None:
    global _params_mode, _params_pitch
    try:
        engine.set_params(
            f0up_key=int(pitch),
            f0method=_DEFAULT_F0,
            index_rate=_index_rate_for(mode),
            filter_radius=_filter_radius_for(mode),
            rms_mix_rate=1,
            protect=0.33,
        )
        _params_mode = mode
        _params_pitch = int(pitch)
    except Exception as exc:  # noqa: BLE001
        print(f"[rvc] set_params failed: {exc}")


def _reset_engine(reason: str) -> None:
    """Drop the RVC engine after a hang so the next call can reload cleanly."""
    global _engine, _loaded_model, _params_mode, _params_pitch
    print(f"[rvc] resetting engine ({reason})")
    _engine = None
    _loaded_model = None
    _params_mode = None
    _params_pitch = None
    try:
        import torch

        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:
        pass


def load_model(name: str) -> bool:
    """Load the given RVC model by directory name. Returns success."""
    global _loaded_model, _params_mode, _params_pitch
    pth, index = find_model_files(name)
    if not pth:
        return False
    with _lock:
        try:
            engine = _get_engine()
            t0 = time.perf_counter()
            engine.load_model(pth, index_path=index or "")
            _apply_params(engine, 0, "fast")
            _loaded_model = name
            print(f"[rvc] model {name} ready in {(time.perf_counter() - t0) * 1000:.0f}ms")
            return True
        except Exception as exc:  # noqa: BLE001
            print(f"[rvc] failed to load model {name}: {exc}")
            return False


def model_loaded() -> str | None:
    return _loaded_model


def _silence_wav(path: str, frames: int = 12_000, rate: int = 40_000) -> None:
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(struct.pack("<" + "h" * frames, *([0] * frames)))


def warm_pipeline(model: str = "alya") -> None:
    """Load model + Hubert/f0 so the first real /speak is not a 60s cold start."""
    if not load_model(model):
        return
    buf = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    buf.close()
    try:
        _silence_wav(buf.name)
        with open(buf.name, "rb") as f:
            silent = f.read()
        # Two passes: first loads Hubert/rmvpe weights; second proves steady-state latency.
        t0 = time.perf_counter()
        convert(silent, model, 0, mode="fast")
        convert(silent, model, 0, mode="fast")
        print(f"[rvc] warm converts done in {(time.perf_counter() - t0) * 1000:.0f}ms")
    finally:
        try:
            os.unlink(buf.name)
        except OSError:
            pass


def convert(wav_bytes: bytes, model: str, pitch: int = 0, mode: str = "fast") -> bytes:
    """Convert input WAV bytes to the target voice. Falls back to input on error/timeout."""
    quality = "fast" if mode != "quality" else "quality"
    with _lock:
        try:
            engine = _get_engine()
            if _loaded_model != model and not load_model(model):
                return wav_bytes
            # Only refresh params when pitch/mode change; avoid set_params every call.
            try:
                need = (
                    _params_mode != quality
                    or _params_pitch != int(pitch)
                )
                if need:
                    _apply_params(engine, pitch, quality)
            except Exception:
                _apply_params(engine, pitch, quality)
            with tempfile.TemporaryDirectory() as d:
                src = f"{d}/in.wav"
                dst = f"{d}/out.wav"
                with open(src, "wb") as f:
                    f.write(wav_bytes)
                t0 = time.perf_counter()
                # Run infer in a worker so we can abandon a hung CUDA call and reset.
                err: list[BaseException] = []

                def _run() -> None:
                    try:
                        engine.infer_file(src, dst)
                    except BaseException as exc:  # noqa: BLE001
                        err.append(exc)

                worker = threading.Thread(target=_run, daemon=True, name="aether-rvc-infer")
                worker.start()
                worker.join(_INFER_TIMEOUT_S)
                if worker.is_alive():
                    print(
                        f"[rvc] infer timed out after {_INFER_TIMEOUT_S:.0f}s — "
                        "returning edge-tts audio and resetting engine"
                    )
                    _reset_engine("infer timeout")
                    return wav_bytes
                if err:
                    raise err[0]
                ms = (time.perf_counter() - t0) * 1000
                if ms > 2000:
                    print(
                        f"[rvc] slow infer {ms:.0f}ms "
                        f"(f0={_DEFAULT_F0} index={_index_rate_for(quality)} mode={quality})"
                    )
                if not os.path.isfile(dst):
                    return wav_bytes
                with open(dst, "rb") as f:
                    return f.read()
        except Exception as exc:  # noqa: BLE001
            print(f"[rvc] conversion failed, returning base audio: {exc}")
            return wav_bytes
