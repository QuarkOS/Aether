"""Entry point for the Aether voice service (STT + edge-tts + RVC)."""
import os

import uvicorn


def main() -> None:
    port = int(os.environ.get("AETHER_VOICE_PORT", "8760"))
    uvicorn.run("app.main:app", host="127.0.0.1", port=port, log_level="info")


if __name__ == "__main__":
    main()
