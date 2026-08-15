/** Alya RVC model (same URL/revision as services/voice/app/models.py). */
export const ALYA_MODEL_NAME = "alya";
/** Bump when the default zip URL changes so stale userData installs re-download. */
export const ALYA_MODEL_REVISION = "alya-v2";
export const ALYA_ZIP_URL =
  "https://huggingface.co/Chouio/Alisa/resolve/main/Alya.zip";
/** Soft floor; Chouio/Alisa Alya.zip is ~403 MB. */
export const ALYA_ZIP_MIN_BYTES = 50_000_000;

export const WINDOWS_RVC_MESSAGE =
  "Alya RVC auto-setup currently targets Windows (portable Python 3.10 + torch). On other OSes install services/voice/requirements-ml.txt into the voice venv manually.";
