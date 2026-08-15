import { type ChildProcess, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { app } from "electron";
import type { SpeakRequest, VoiceHealth } from "@aether/shared";

import { ensurePackagedVoiceRuntime, getVoiceBootstrap } from "./voiceRuntime/ensure.js";

const PORT = Number(process.env.AETHER_VOICE_PORT ?? 8760);
const BASE_URL = `http://127.0.0.1:${PORT}`;

let child: ChildProcess | null = null;
let ready = false;
let starting: Promise<void> | null = null;

function voiceDir(): string {
  const packaged = join(process.resourcesPath ?? "", "voice");
  if (app.isPackaged && existsSync(packaged)) return packaged;
  return join(app.getAppPath(), "..", "..", "services", "voice");
}

function pythonExecutable(dir: string): string {
  if (process.env.AETHER_PYTHON) return process.env.AETHER_PYTHON;
  const venvUnix = join(dir, ".venv", "bin", "python");
  const venvWin = join(dir, ".venv", "Scripts", "python.exe");
  if (existsSync(venvUnix)) return venvUnix;
  if (existsSync(venvWin)) return venvWin;
  return process.platform === "win32" ? "python" : "python3";
}

/** Starts the sidecar unless a voice service is already responding on the port. */
export async function ensureVoiceService(): Promise<void> {
  const existing = await getHealth();
  if (existing?.ok) {
    ready = true;
    console.log("[voice] reusing already-running voice service.");
    return;
  }
  if (!starting) {
    starting = startVoiceService().finally(() => {
      starting = null;
    });
  }
  await starting;
}

export async function startVoiceService(): Promise<void> {
  if (child) return;
  const dir = voiceDir();
  const runner = join(dir, "run.py");
  if (!existsSync(runner)) {
    console.error(`[voice] run.py not found at ${runner}; voice features disabled.`);
    return;
  }

  let python = pythonExecutable(dir);
  let pathEnv = process.env.PATH ?? "";
  if (app.isPackaged && process.platform === "win32") {
    try {
      const runtime = await ensurePackagedVoiceRuntime(dir);
      python = runtime.python;
      pathEnv = `${runtime.pathPrefix};${pathEnv}`;
    } catch (err) {
      console.error("[voice] packaged runtime bootstrap failed:", err);
      return;
    }
  }

  console.log(`[voice] starting: ${python} ${runner} (port ${PORT})`);
  child = spawn(python, [runner], {
    cwd: dir,
    env: {
      ...process.env,
      PATH: pathEnv,
      AETHER_VOICE_PORT: String(PORT),
      AETHER_MODELS_DIR: join(app.getPath("userData"), "voice-models"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (b: Buffer) => process.stdout.write(`[voice] ${b}`));
  child.stderr?.on("data", (b: Buffer) => process.stderr.write(`[voice] ${b}`));
  child.on("exit", (code) => {
    console.log(`[voice] exited with code ${code}`);
    child = null;
    ready = false;
  });
}

export function stopVoiceService(): void {
  if (child) {
    child.kill();
    child = null;
    ready = false;
  }
}

async function tryFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, init);
}

export async function waitForVoiceReady(timeoutMs = 120_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await tryFetch("/health");
      if (res.ok) {
        ready = true;
        return true;
      }
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 800));
  }
  return false;
}

export function isReady(): boolean {
  return ready;
}

export async function getHealth(): Promise<(VoiceHealth & { bootstrap?: string }) | null> {
  try {
    const res = await tryFetch("/health");
    if (!res.ok) return null;
    const body = (await res.json()) as VoiceHealth;
    const boot = getVoiceBootstrap();
    return {
      ...body,
      bootstrap: boot.state === "ready" || boot.state === "idle" ? undefined : boot.message || boot.state,
    };
  } catch {
    const boot = getVoiceBootstrap();
    if (boot.state === "downloading" || boot.state === "installing") {
      return {
        ok: false,
        device: "bootstrapping",
        ttsAvailable: false,
        sttAvailable: false,
        rvcAvailable: false,
        rvcModelLoaded: false,
        models: [],
        bootstrap: boot.message,
      };
    }
    return null;
  }
}

/** Returns WAV audio bytes for the given text, applying RVC when available. */
export async function speak(req: SpeakRequest): Promise<Buffer | null> {
  try {
    const res = await tryFetch("/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    });
    if (!res.ok) {
      console.error(`[voice] /speak failed: ${res.status} ${await res.text()}`);
      return null;
    }
    return Buffer.from(await res.arrayBuffer());
  } catch (err) {
    console.error("[voice] /speak error:", err);
    return null;
  }
}

/** Transcribes WAV audio bytes to text. */
export async function transcribe(wav: Buffer, model?: string): Promise<string | null> {
  try {
    const form = new FormData();
    form.append("audio", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "audio.wav");
    if (model) form.append("model", model);
    const res = await tryFetch("/stt", { method: "POST", body: form });
    if (!res.ok) {
      console.error(`[voice] /stt failed: ${res.status} ${await res.text()}`);
      return null;
    }
    const data = (await res.json()) as { text: string };
    return data.text;
  } catch (err) {
    console.error("[voice] /stt error:", err);
    return null;
  }
}
