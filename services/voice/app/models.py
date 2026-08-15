"""RVC model storage: locate installed models and download the Alya model."""
import io
import os
import shutil
import zipfile

# Chouio/Alisa Alya.zip (~403 MB). Keep in sync with apps/desktop rvcInstall/catalog.ts.
ALYA_ZIP_URL = "https://huggingface.co/Chouio/Alisa/resolve/main/Alya.zip"
# Bump when the default zip URL changes so stale installs re-download.
ALYA_MODEL_REVISION = "alya-v2"
_REVISION_FILENAME = ".aether-model-revision"


def models_dir() -> str:
    path = os.environ.get(
        "AETHER_MODELS_DIR",
        os.path.join(os.path.dirname(os.path.dirname(__file__)), "models"),
    )
    os.makedirs(path, exist_ok=True)
    return path


def list_models() -> list[str]:
    """Model directories that contain a .pth weight file."""
    root = models_dir()
    out: list[str] = []
    for name in sorted(os.listdir(root)):
        d = os.path.join(root, name)
        if os.path.isdir(d) and any(f.endswith(".pth") for f in os.listdir(d)):
            out.append(name)
    return out


def find_model_files(name: str) -> tuple[str | None, str | None]:
    """Return (pth_path, index_path) for a model directory, if present.

    Oversized FAISS indexes (100MB+) are skipped: the Chouio Alya.index is ~360MB
    and a single first search can take minutes, which destroys realtime TTS.
    The .pth alone still converts to Alya's timbre.
    """
    d = os.path.join(models_dir(), name)
    if not os.path.isdir(d):
        return None, None
    pth = next((os.path.join(d, f) for f in os.listdir(d) if f.endswith(".pth")), None)
    index = None
    max_index_bytes = 80 * 1024 * 1024
    for f in os.listdir(d):
        if not f.endswith(".index"):
            continue
        path = os.path.join(d, f)
        try:
            size = os.path.getsize(path)
        except OSError:
            continue
        if size > max_index_bytes:
            print(
                f"[models] skipping oversized index {f} "
                f"({size / (1024 * 1024):.0f}MB > {max_index_bytes // (1024 * 1024)}MB) — realtime RVC"
            )
            continue
        index = path
        break
    return pth, index


def _revision_path(name: str) -> str:
    return os.path.join(models_dir(), name, _REVISION_FILENAME)


def _read_revision(name: str) -> str | None:
    path = _revision_path(name)
    if not os.path.isfile(path):
        return None
    try:
        with open(path, encoding="utf-8") as f:
            return f.read().strip() or None
    except OSError:
        return None


def _write_revision(name: str, revision: str) -> None:
    dest = os.path.join(models_dir(), name)
    os.makedirs(dest, exist_ok=True)
    with open(_revision_path(name), "w", encoding="utf-8") as f:
        f.write(revision)


def _clear_model_dir(name: str) -> None:
    dest = os.path.join(models_dir(), name)
    if os.path.isdir(dest):
        print(f"[models] clearing stale {name} (revision mismatch)")
        shutil.rmtree(dest, ignore_errors=True)


def ensure_model(
    name: str = "alya",
    url: str = ALYA_ZIP_URL,
    revision: str = ALYA_MODEL_REVISION,
) -> bool:
    """Download + extract the model zip into models_dir/name if missing or stale."""
    pth, _ = find_model_files(name)
    if pth and _read_revision(name) == revision:
        return True
    if pth or os.path.isdir(os.path.join(models_dir(), name)):
        _clear_model_dir(name)
    try:
        import requests

        dest = os.path.join(models_dir(), name)
        os.makedirs(dest, exist_ok=True)
        print(f"[models] downloading {name} ({revision}) from {url}")
        resp = requests.get(url, timeout=600)
        resp.raise_for_status()
        with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
            for member in zf.namelist():
                # Flatten into dest, keeping only the basename to avoid nested dirs.
                filename = os.path.basename(member)
                if not filename:
                    continue
                with zf.open(member) as src, open(os.path.join(dest, filename), "wb") as out:
                    out.write(src.read())
        ok = find_model_files(name)[0] is not None
        if ok:
            _write_revision(name, revision)
        return ok
    except Exception as exc:  # noqa: BLE001
        print(f"[models] failed to download {name}: {exc}")
        return False
