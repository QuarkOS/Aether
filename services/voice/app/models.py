"""RVC model storage: locate installed models and download the Alya model."""
import io
import os
import zipfile

# The Alya RVC v2 model provided by the user.
ALYA_ZIP_URL = "https://huggingface.co/sxndypz/rvc-v2-models/resolve/main/alya.zip"


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
    """Return (pth_path, index_path) for a model directory, if present."""
    d = os.path.join(models_dir(), name)
    if not os.path.isdir(d):
        return None, None
    pth = next((os.path.join(d, f) for f in os.listdir(d) if f.endswith(".pth")), None)
    index = next((os.path.join(d, f) for f in os.listdir(d) if f.endswith(".index")), None)
    return pth, index


def ensure_model(name: str = "alya", url: str = ALYA_ZIP_URL) -> bool:
    """Download + extract the model zip into models_dir/name if not present."""
    pth, _ = find_model_files(name)
    if pth:
        return True
    try:
        import requests

        dest = os.path.join(models_dir(), name)
        os.makedirs(dest, exist_ok=True)
        print(f"[models] downloading {name} from {url}")
        resp = requests.get(url, timeout=120)
        resp.raise_for_status()
        with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
            for member in zf.namelist():
                # Flatten into dest, keeping only the basename to avoid nested dirs.
                filename = os.path.basename(member)
                if not filename:
                    continue
                with zf.open(member) as src, open(os.path.join(dest, filename), "wb") as out:
                    out.write(src.read())
        return find_model_files(name)[0] is not None
    except Exception as exc:  # noqa: BLE001
        print(f"[models] failed to download {name}: {exc}")
        return False
