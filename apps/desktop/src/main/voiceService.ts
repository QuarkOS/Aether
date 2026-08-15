import { type ChildProcess, execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

import { app } from "electron";
import type { SpeakRequest, VoiceHealth } from "@aether/shared";

import { loadConfig } from "./config.js";
import {
  ensureWindowsVoiceRuntime,
  getVoiceBootstrap,
  resolvePreferredRuntime,
  shouldPreferRuntimePython,
} from "./voiceRuntime/ensure.js";

const execFileAsync = promisify(execFile);

const PORT = Number(process.env.AETHER_VOICE_PORT ?? 8760);
const BASE_URL = `http://127.0.0.1:${PORT}`;

let child: ChildProcess | null = null;
let ready = false;
let starting: Promise<void> | null = null;

export function getVoiceDir(): string {
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
    if (existing.warmReady === false) {
      console.log("[voice] sidecar up; waiting for model warmup…");
      await waitForVoiceReady(180_000);
      return;
    }
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
  const dir = getVoiceDir();
  const runner = join(dir, "run.py");
  if (!existsSync(runner)) {
    console.error(`[voice] run.py not found at ${runner}; voice features disabled.`);
    return;
  }

  let python = pythonExecutable(dir);
  let pathEnv = process.env.PATH ?? "";
  const useRuntime =
    process.platform === "win32" && (app.isPackaged || shouldPreferRuntimePython());
  if (useRuntime) {
    try {
      const preferred = resolvePreferredRuntime();
      if (preferred) {
        python = preferred.python;
        pathEnv = `${preferred.pathPrefix};${pathEnv}`;
      } else if (app.isPackaged) {
        const runtime = await ensureWindowsVoiceRuntime(dir);
        python = runtime.python;
        pathEnv = `${runtime.pathPrefix};${pathEnv}`;
      }
    } catch (err) {
      console.error("[voice] Windows runtime bootstrap failed:", err);
      if (app.isPackaged) return;
    }
  }

  const sttModel = loadConfig().input.sttModel || "small";
  console.log(`[voice] starting: ${python} ${runner} (port ${PORT}, stt=${sttModel})`);
  child = spawn(python, [runner], {
    cwd: dir,
    env: {
      ...process.env,
      PATH: pathEnv,
      AETHER_VOICE_PORT: String(PORT),
      AETHER_MODELS_DIR: join(app.getPath("userData"), "voice-models"),
      AETHER_STT_MODEL: sttModel,
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

/** Best-effort free of the voice port (dev often leaves a prior sidecar running). */
export async function freeVoicePort(): Promise<void> {
  if (process.platform !== "win32") return;
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `Get-NetTCPConnection -LocalPort ${PORT} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique`,
      ],
      { windowsHide: true, timeout: 10_000 },
    );
    const pids = stdout
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => /^\d+$/.test(s) && s !== "0");
    for (const pid of pids) {
      try {
        await execFileAsync("taskkill", ["/PID", pid, "/F"], { windowsHide: true, timeout: 10_000 });
        console.log(`[voice] killed pid ${pid} on port ${PORT}`);
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

/** Stop any sidecar on the port and start with the preferred runtime. */
export async function restartVoiceService(): Promise<boolean> {
  stopVoiceService();
  await freeVoicePort();
  await startVoiceService();
  return waitForVoiceReady(180_000);
}

async function tryFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, init);
}

export async function waitForVoiceReady(timeoutMs = 180_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await tryFetch("/health");
      if (res.ok) {
        const body = (await res.json()) as VoiceHealth;
        // Prefer warmReady when the sidecar reports it; older builds only had ok.
        if (body.warmReady === undefined || body.warmReady) {
          ready = true;
          if (body.sttModel) {
            console.log(`[voice] ready (warm stt=${body.sttModel} rvc=${body.rvcWarmed ?? "?"})`);
          }
          return true;
        }
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
