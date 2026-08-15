/** Alya RVC v2 model (same URL as services/voice/app/models.py). */
export const ALYA_MODEL_NAME = "alya";
export const ALYA_ZIP_URL =
  "https://huggingface.co/sxndypz/rvc-v2-models/resolve/main/alya.zip";
/** Soft floor; real zip is tens of MB. */
export const ALYA_ZIP_MIN_BYTES = 5_000_000;

export const WINDOWS_RVC_MESSAGE =
  "Alya RVC auto-setup currently targets Windows (portable Python 3.10 + torch). On other OSes install services/voice/requirements-ml.txt into the voice venv manually.";
