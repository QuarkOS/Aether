# Privacy

Aether is a desktop app. Here is what leaves your machine in V1.

## Microphone

Audio from push-to-talk or the dock mic is transcribed locally by faster-whisper in the voice sidecar. It is not uploaded for STT.

## Speech out

Reply text is sent to Microsoft edge-tts to synthesize audio (network required to speak). Optional RVC re-timbre stays on your machine when enabled.

## Assistant brain

- OpenAI provider. Your prompts go to OpenAI using the key you save (OS-encrypted) or `OPENAI_API_KEY`.
- OpenAI-compatible / local Heretic. Prompts go to the local llama-server (or whatever base URL you set). No cloud key required.
- None. Offline rule-based replies only.

## Integrations

With a Composio key, tool calls and OAuth go through Composio to the apps you connect (Gmail, GitHub, and so on).

## Storage

Config lives in the Electron userData folder. API keys use Electron `safeStorage`. Local models and voice runtimes download into userData. Nothing is written into the installer payload for secrets.
