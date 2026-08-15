import { execFile } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

import { app } from "electron";
import type { RvcInstallStatus } from "@aether/shared";

import { updateConfig } from "../config.js";
import { downloadFile } from "../localLlm/download.js";
import { extractZip } from "../localLlm/extract.js";
import {
  ensureMlRequirements,
  setPreferRuntimePython,
} from "../voiceRuntime/ensure.js";
import { getHealth, getVoiceDir, restartVoiceService } from "../voiceService.js";
import {
  ALYA_MODEL_NAME,
  ALYA_ZIP_MIN_BYTES,
  ALYA_ZIP_URL,
  WINDOWS_RVC_MESSAGE,
} from "./catalog.js";

const execFileAsync = promisify(execFile);

let snapshot: RvcInstallStatus = {
  state: "missing",
  rvcAvailable: false,
  modelReady: false,
};
let chain: Promise<unknown> = Promise.resolve();

function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function setSnapshot(next: RvcInstallStatus): RvcInstallStatus {
  snapshot = next;
  return snapshot;
}

function modelsRoot(): string {
  const dir = join(app.getPath("userData"), "voice-models");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function modelReady(name: string): boolean {
  const d = join(modelsRoot(), name);
  if (!existsSync(d)) return false;
  return readdirSync(d).some((f) => f.endsWith(".pth"));
}

async function probe(): Promise<RvcInstallStatus> {
  const health = await getHealth();
  const readyModel =
    modelReady(ALYA_MODEL_NAME) || Boolean(health?.models.includes(ALYA_MODEL_NAME));
  if (health?.rvcAvailable && readyModel) {
    return {
      state: "ready",
      rvcAvailable: true,
      modelReady: true,
      device: health.device,
      message: "Alya RVC ready",
    };
  }
  if (health?.rvcAvailable) {
    return {
      state: "missing",
      rvcAvailable: true,
      modelReady: false,
      device: health.device,
      message: "RVC packages present; Alya model not downloaded yet",
    };
  }
  return {
    state: "missing",
    rvcAvailable: false,
    modelReady: readyModel,
    message: process.platform === "win32" ? undefined : WINDOWS_RVC_MESSAGE,
  };
}

export async function getRvcInstallStatus(): Promise<RvcInstallStatus> {
  if (snapshot.state === "downloading" || snapshot.state === "installing") {
    return snapshot;
  }
  return setSnapshot(await probe());
}

function flattenModelDir(root: string): void {
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, name.name);
      if (name.isDirectory()) {
        walk(full);
        continue;
      }
      if (!name.name.endsWith(".pth") && !name.name.endsWith(".index")) continue;
      if (dir === root) continue;
      const target = join(root, name.name);
      if (!existsSync(target)) renameSync(full, target);
    }
  };
  walk(root);
}

async function downloadAlyaModel(onProgress: (r: number) => void): Promise<void> {
  if (modelReady(ALYA_MODEL_NAME)) return;
  const destDir = join(modelsRoot(), ALYA_MODEL_NAME);
  mkdirSync(destDir, { recursive: true });
  const zipPath = join(modelsRoot(), "alya.zip");
  await downloadFile({
    url: ALYA_ZIP_URL,
    dest: zipPath,
    minBytes: ALYA_ZIP_MIN_BYTES,
    onProgress,
  });
  await extractZip(zipPath, destDir);
  flattenModelDir(destDir);
  try {
    unlinkSync(zipPath);
  } catch {
    /* ignore */
  }
  if (!modelReady(ALYA_MODEL_NAME)) {
    throw new Error("Alya model zip extracted but no .pth file found");
  }
}

async function installRvcWindows(): Promise<RvcInstallStatus> {
  const voiceDir = getVoiceDir();
  setSnapshot({
    state: "downloading",
    progress: 0,
    message: "Preparing portable Python 3.10 (needed to build RVC)…",
    rvcAvailable: false,
    modelReady: modelReady(ALYA_MODEL_NAME),
  });

  const runtime = await ensureMlRequirements(voiceDir, (message, progress) => {
    const installing = (message ?? "").toLowerCase().includes("install");
    setSnapshot({
      state: installing ? "installing" : "downloading",
      progress,
      message,
      rvcAvailable: false,
      modelReady: modelReady(ALYA_MODEL_NAME),
    });
  });

  await execFileAsync(
    runtime.python,
    ["-c", "import torch; import rvc_python; print(torch.__version__)"],
    {
      env: { ...process.env, PATH: `${runtime.pathPrefix};${process.env.PATH ?? ""}` },
      windowsHide: true,
      timeout: 120_000,
      maxBuffer: 2_000_000,
    },
  );

  setSnapshot({
    state: "downloading",
    progress: 0.8,
    message: "Downloading Alya RVC model…",
    rvcAvailable: false,
    modelReady: false,
  });
  await downloadAlyaModel((r) => {
    setSnapshot({
      state: "downloading",
      progress: 0.8 + r * 0.15,
      message: `Downloading Alya RVC model… ${Math.round(r * 100)}%`,
      rvcAvailable: false,
      modelReady: false,
    });
  });

  setPreferRuntimePython(true);
  setSnapshot({
    state: "installing",
    progress: 0.96,
    message: "Restarting voice service with RVC…",
    rvcAvailable: false,
    modelReady: true,
  });
  const up = await restartVoiceService();
  if (!up) {
    return setSnapshot({
      state: "error",
      message: "Voice service did not come back after RVC install. Restart the app.",
      rvcAvailable: false,
      modelReady: true,
    });
  }

  const health = await getHealth();
  const cfgVoice = {
    ttsVoice: "en-US-AriaNeural",
    rvcEnabled: true,
    rvcPitch: 0,
    rvcModel: ALYA_MODEL_NAME,
    voiceMode: "quality" as const,
  };
  updateConfig({ voice: cfgVoice });

  if (!health?.rvcAvailable) {
    return setSnapshot({
      state: "error",
      message:
        "Packages installed but voice health still reports RVC unavailable. Check the terminal for import errors.",
      rvcAvailable: false,
      modelReady: true,
      device: health?.device,
    });
  }

  return setSnapshot({
    state: "ready",
    progress: 1,
    message: "Alya RVC ready. Replies will use the Alya voice when enabled.",
    rvcAvailable: true,
    modelReady: true,
    device: health.device,
  });
}

export function installRvc(): Promise<RvcInstallStatus> {
  return exclusive(async () => {
    if (process.platform !== "win32") {
      return setSnapshot({
        state: "error",
        message: WINDOWS_RVC_MESSAGE,
        rvcAvailable: false,
        modelReady: modelReady(ALYA_MODEL_NAME),
      });
    }
    try {
      return await installRvcWindows();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[rvc-install] failed:", err);
      return setSnapshot({
        state: "error",
        message,
        rvcAvailable: false,
        modelReady: modelReady(ALYA_MODEL_NAME),
      });
    }
  });
}
