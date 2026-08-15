# Aether Voice Service

A local FastAPI sidecar that provides speech-to-text and Alya-voiced text-to-speech to the Aether desktop app.

## Endpoints

- `GET /health` — capabilities (device, TTS/STT/RVC availability, installed models).
- `POST /speak` — body `{ text, voice?, rvc?, model?, pitch? }` → returns `audio/wav`.
- `POST /stt` — multipart `audio` (WAV) + optional `model` → `{ text }`.

## Pipeline

1. `edge-tts` synthesizes base speech from text (Microsoft neural voices; needs internet).
2. If RVC is available and a model is installed, `rvc-python` re-timbres the audio to the Alya voice.
3. `faster-whisper` transcribes microphone audio for voice commands.

## Setup

```bash
python3 -m venv .venv
. .venv/bin/activate            # Windows: .venv\Scripts\activate
pip install -r requirements.txt         # base: FastAPI, edge-tts, faster-whisper
pip install -r requirements-ml.txt      # optional: torch + rvc-python (GPU recommended)
python run.py                           # serves on $AETHER_VOICE_PORT (default 8760)
```

Without `requirements-ml.txt`, the service still runs: STT and base TTS work, and
`/speak` returns the base edge-tts voice (no Alya re-timbre). Install the ML extras
on a machine with a GPU (CUDA/MPS) for low-latency Alya voice.

## Alya voice model

The Alya RVC v2 model is downloaded on demand from Hugging Face
(`sxndypz/rvc-v2-models/alya.zip`) into `$AETHER_MODELS_DIR` (set by the desktop app)
or `./models`. Drop any other RVC v2 model directory (containing a `.pth` and
optional `.index`) there and select it by name in Settings.
