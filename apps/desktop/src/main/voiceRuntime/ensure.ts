import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

import { app } from "electron";

import { downloadFile } from "../localLlm/download.js";
import { extractZip } from "../localLlm/extract.js";
import {
  FFMPEG_EXE,
  FFMPEG_ZIP_MIN_BYTES,
  FFMPEG_ZIP_URL,
  PYTHON_EXE,
  PYTHON_NUGET_MIN_BYTES,
  PYTHON_NUGET_URL,
  PYTHON_RVC_VERSION,
  PYTHON_ZIP_MIN_BYTES,
  PYTHON_ZIP_URL,
} from "./catalog.js";

const execFileAsync = promisify(execFile);

export type VoiceBootstrapState = "idle" | "downloading" | "installing" | "ready" | "error";

let bootstrapState: VoiceBootstrapState = "idle";
let bootstrapMessage = "";

export function getVoiceBootstrap(): { state: VoiceBootstrapState; message: string } {
  return { state: bootstrapState, message: bootstrapMessage };
}

function runtimeRoot(): string {
  return join(app.getPath("userData"), "voice-runtime");
}

function findFile(root: string, name: string): string | null {
  if (!existsSync(root)) return null;
  const direct = join(root, name);
  if (existsSync(direct)) return direct;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const nested = findFile(join(root, entry.name), name);
    if (nested) return nested;
  }
  return null;
}

function enableEmbedPip(pythonDir: string): void {
  for (const name of readdirSync(pythonDir)) {
    if (!name.endsWith("._pth")) continue;
    const file = join(pythonDir, name);
    let text = readFileSync(file, "utf8");
    // Must not use includes("import site"): "#import site" contains that substring.
    text = text.replace(/^[ \t]*#[ \t]*import site[ \t]*$/gm, "import site");
    if (!/^[ \t]*import site[ \t]*$/m.test(text)) {
      text = `${text.trimEnd()}\nimport site\n`;
    }
    writeFileSync(file, text, "utf8");
  }
}

async function pipWorks(pythonExe: string, pythonDir: string): Promise<boolean> {
  try {
    await execFileAsync(pythonExe, ["-m", "pip", "--version"], {
      cwd: pythonDir,
      windowsHide: true,
      timeout: 30_000,
      maxBuffer: 1_000_000,
    });
    return true;
  } catch {
    return false;
  }
}

async function ensureGetPip(pythonExe: string, pythonDir: string): Promise<void> {
  enableEmbedPip(pythonDir);
  if (await pipWorks(pythonExe, pythonDir)) return;

  const getPip = join(runtimeRoot(), "get-pip.py");
  if (!existsSync(getPip)) {
    await downloadFile({
      url: "https://bootstrap.pypa.io/get-pip.py",
      dest: getPip,
      minBytes: 500_000,
      onProgress: () => undefined,
    });
  }
  enableEmbedPip(pythonDir);
  await execFileAsync(pythonExe, [getPip, "--no-warn-script-location"], {
    cwd: pythonDir,
    windowsHide: true,
    timeout: 300_000,
    maxBuffer: 20_000_000,
  });
  enableEmbedPip(pythonDir);
  if (!(await pipWorks(pythonExe, pythonDir))) {
    throw new Error("get-pip.py ran but python -m pip is still unavailable (check python*._pth has uncommented import site)");
  }
}

function requirementsHash(voiceDir: string): string {
  const req = readFileSync(join(voiceDir, "requirements.txt"), "utf8");
  return createHash("sha256").update(req).digest("hex").slice(0, 16);
}

function mlRequirementsHash(voiceDir: string): string {
  const req = readFileSync(join(voiceDir, "requirements-ml.txt"), "utf8");
  return createHash("sha256").update(req).digest("hex").slice(0, 16);
}

export function voiceRuntimeRoot(): string {
  return runtimeRoot();
}

export function preferRuntimePythonMarker(): string {
  return join(runtimeRoot(), "prefer-runtime.flag");
}

export function setPreferRuntimePython(enabled: boolean): void {
  mkdirSync(runtimeRoot(), { recursive: true });
  const marker = preferRuntimePythonMarker();
  if (enabled) writeFileSync(marker, "1", "utf8");
  else if (existsSync(marker)) unlinkSync(marker);
}

export function shouldPreferRuntimePython(): boolean {
  return existsSync(preferRuntimePythonMarker());
}

/** Prefer full CPython (RVC) over embed when both exist. */
export function resolvePreferredRuntime(): {
  python: string;
  pathPrefix: string;
  pythonDir: string;
} | null {
  const root = runtimeRoot();
  const ffmpegDir = join(root, "ffmpeg");
  const ffmpeg = findFile(ffmpegDir, FFMPEG_EXE);
  const ffmpegBin = ffmpeg ? join(ffmpeg, "..") : "";
  const fullDir = join(root, "cpython");
  const fullPy = join(fullDir, PYTHON_EXE);
  if (existsSync(fullPy)) {
    return {
      python: fullPy,
      pythonDir: fullDir,
      pathPrefix: [ffmpegBin, fullDir, join(fullDir, "Scripts")].filter(Boolean).join(";"),
    };
  }
  const embedDir = join(root, "python");
  const embedPy = join(embedDir, PYTHON_EXE);
  if (existsSync(embedPy)) {
    return {
      python: embedPy,
      pythonDir: embedDir,
      pathPrefix: [ffmpegBin, embedDir].filter(Boolean).join(";"),
    };
  }
  return null;
}

/**
 * Full CPython 3.11 under userData (has Python.h for building fairseq).
 * Required for rvc-python on Windows; embeddable zip is not enough.
 * Uses the official nuget.org portable package (zip) — no MSI/.exe spawn.
 */
export async function ensureFullCpython(
  onStatus?: (message: string, progress?: number) => void,
): Promise<{ python: string; pathPrefix: string; pythonDir: string }> {
  if (process.platform !== "win32") {
    throw new Error("Full CPython auto-install is Windows-only.");
  }
  const root = runtimeRoot();
  const pythonDir = join(root, "cpython");
  const python = join(pythonDir, PYTHON_EXE);
  mkdirSync(root, { recursive: true });

  // Ensure ffmpeg exists alongside (shared with embed runtime).
  const ffmpegDir = join(root, "ffmpeg");
  if (!findFile(ffmpegDir, FFMPEG_EXE)) {
    onStatus?.("Downloading ffmpeg…", 0.05);
    const ffZip = join(root, "ffmpeg.zip");
    await downloadFile({
      url: FFMPEG_ZIP_URL,
      dest: ffZip,
      minBytes: FFMPEG_ZIP_MIN_BYTES,
      onProgress: (r) => onStatus?.(`Downloading ffmpeg… ${Math.round(r * 100)}%`, r * 0.15),
    });
    await extractZip(ffZip, ffmpegDir);
  }
  const ffmpeg = findFile(ffmpegDir, FFMPEG_EXE);
  if (!ffmpeg) throw new Error("ffmpeg.exe missing after extract");
  const ffmpegBin = join(ffmpeg, "..");

  if (!existsSync(python)) {
    onStatus?.("Downloading portable Python 3.10 (RVC-compatible)…", 0.2);
    // Save as .zip so Expand-Archive accepts the nupkg payload.
    const nupkgZip = join(root, `python-${PYTHON_RVC_VERSION}.nupkg.zip`);
    await downloadFile({
      url: PYTHON_NUGET_URL,
      dest: nupkgZip,
      minBytes: PYTHON_NUGET_MIN_BYTES,
      onProgress: (r) =>
        onStatus?.(`Downloading Python… ${Math.round(r * 100)}%`, 0.2 + r * 0.3),
    });
    onStatus?.("Extracting Python…", 0.55);
    const staging = join(root, "cpython-staging");
    await extractZip(nupkgZip, staging);
    const tools = join(staging, "tools");
    if (!existsSync(join(tools, PYTHON_EXE))) {
      throw new Error("NuGet Python package missing tools/python.exe");
    }
    if (!existsSync(join(tools, "include", "Python.h"))) {
      throw new Error("NuGet Python package missing include/Python.h (needed to build fairseq)");
    }
    rmSync(pythonDir, { recursive: true, force: true });
    renameSync(tools, pythonDir);
    rmSync(staging, { recursive: true, force: true });
    if (!existsSync(python)) {
      throw new Error("Python extract finished but python.exe was not found under cpython/");
    }
  }

  // fairseq/hydra break on 3.11+; refuse accidental leftover installs.
  try {
    await execFileAsync(
      python,
      ["-c", "import sys; v=sys.version_info; assert v.major==3 and v.minor==10, v"],
      { windowsHide: true, timeout: 15_000, maxBuffer: 1_000_000 },
    );
  } catch {
    throw new Error(
      `RVC requires portable CPython 3.10 under voice-runtime/cpython (found a different version). Delete that folder and retry.`,
    );
  }

  const pathPrefix = `${ffmpegBin};${pythonDir};${join(pythonDir, "Scripts")}`;
  if (!(await pipWorks(python, pythonDir))) {
    onStatus?.("Bootstrapping pip…", 0.7);
    try {
      await execFileAsync(python, ["-m", "ensurepip", "--upgrade"], {
        cwd: pythonDir,
        windowsHide: true,
        timeout: 180_000,
        maxBuffer: 5_000_000,
      });
    } catch {
      /* fall through to get-pip */
    }
    if (!(await pipWorks(python, pythonDir))) {
      await ensureGetPip(python, pythonDir);
    }
  }
  return { python, pathPrefix, pythonDir };
}

/**
 * Windows embeddable CPython + ffmpeg under userData.
 * Used by packaged voice bootstrap (base STT/TTS only).
 */
export async function ensureWindowsVoiceRuntime(
  voiceDir: string,
  onStatus?: (message: string, progress?: number) => void,
): Promise<{ python: string; pathPrefix: string; pythonDir: string }> {
  if (process.platform !== "win32") {
    throw new Error("Voice runtime auto-bootstrap is Windows-only.");
  }

  const root = runtimeRoot();
  const pythonDir = join(root, "python");
  const ffmpegDir = join(root, "ffmpeg");
  mkdirSync(root, { recursive: true });

  const status = (message: string, progress?: number) => {
    bootstrapState = progress !== undefined && progress < 1 ? "downloading" : bootstrapState;
    bootstrapMessage = message;
    onStatus?.(message, progress);
  };

  status("Downloading embeddable Python…", 0);
  const pyZip = join(root, "python-embed.zip");
  await downloadFile({
    url: PYTHON_ZIP_URL,
    dest: pyZip,
    minBytes: PYTHON_ZIP_MIN_BYTES,
    onProgress: (r) => status(`Downloading Python… ${Math.round(r * 100)}%`, r * 0.35),
  });
  if (!existsSync(join(pythonDir, PYTHON_EXE))) {
    await extractZip(pyZip, pythonDir);
  }
  const python = join(pythonDir, PYTHON_EXE);
  if (!existsSync(python)) throw new Error("python.exe missing after extract");

  status("Downloading ffmpeg…", 0.4);
  const ffZip = join(root, "ffmpeg.zip");
  await downloadFile({
    url: FFMPEG_ZIP_URL,
    dest: ffZip,
    minBytes: FFMPEG_ZIP_MIN_BYTES,
    onProgress: (r) => status(`Downloading ffmpeg… ${Math.round(r * 100)}%`, 0.4 + r * 0.15),
  });
  if (!findFile(ffmpegDir, FFMPEG_EXE)) {
    await extractZip(ffZip, ffmpegDir);
  }
  const ffmpeg = findFile(ffmpegDir, FFMPEG_EXE);
  if (!ffmpeg) throw new Error("ffmpeg.exe missing after extract");
  const ffmpegBin = join(ffmpeg, "..");

  const marker = join(root, "requirements.ok");
  const hash = requirementsHash(voiceDir);
  if (!existsSync(marker) || readFileSync(marker, "utf8").trim() !== hash) {
    bootstrapState = "installing";
    status("Installing base voice packages…", 0.55);
    await ensureGetPip(python, pythonDir);
    await execFileAsync(
      python,
      ["-m", "pip", "install", "--no-warn-script-location", "-r", join(voiceDir, "requirements.txt")],
      {
        cwd: voiceDir,
        env: { ...process.env, PATH: `${ffmpegBin};${pythonDir};${process.env.PATH ?? ""}` },
        windowsHide: true,
        timeout: 900_000,
        maxBuffer: 20_000_000,
      },
    );
    writeFileSync(marker, hash, "utf8");
  }

  bootstrapState = "ready";
  bootstrapMessage = "Voice runtime ready";
  return { python, pathPrefix: `${ffmpegBin};${pythonDir}`, pythonDir };
}

/** @deprecated Prefer ensureWindowsVoiceRuntime; kept for packaged call sites. */
export async function ensurePackagedVoiceRuntime(voiceDir: string): Promise<{
  python: string;
  pathPrefix: string;
}> {
  const runtime = await ensureWindowsVoiceRuntime(voiceDir);
  return { python: runtime.python, pathPrefix: runtime.pathPrefix };
}

/** True when nvidia-smi reports a GPU (best-effort). */
export async function hasNvidiaGpu(): Promise<boolean> {
  try {
    await execFileAsync("nvidia-smi", ["-L"], {
      windowsHide: true,
      timeout: 8_000,
      maxBuffer: 1_000_000,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Install torch + rvc-python into full CPython (not embed).
 * fairseq builds native code and needs Python.h from the full installer.
 */
export async function ensureMlRequirements(
  voiceDir: string,
  onStatus?: (message: string, progress?: number) => void,
): Promise<{ python: string; pathPrefix: string; pythonDir: string }> {
  const runtime = await ensureFullCpython(onStatus);
  const cuda = await hasNvidiaGpu();
  const backend = cuda ? "cuda124" : "cpu";
  const marker = join(runtimeRoot(), "requirements-ml.ok");
  // Bump suffix when install steps change so broken prior installs re-run.
  const hash = `${mlRequirementsHash(voiceDir)}:${backend}:cpython310:numpy1235`;
  if (existsSync(marker) && readFileSync(marker, "utf8").trim() === hash) {
    onStatus?.("ML packages already installed", 1);
    return runtime;
  }
  bootstrapState = "installing";
  const env = { ...process.env, PATH: `${runtime.pathPrefix};${process.env.PATH ?? ""}` };
  const pipBase = ["-m", "pip", "install", "--no-warn-script-location"];
  const pipUninstall = ["-m", "pip", "uninstall", "-y"];

  if (cuda) {
    onStatus?.("Installing CUDA torch (large download)…", 0.15);
    await execFileAsync(runtime.python, [...pipUninstall, "torch", "torchaudio"], {
      cwd: voiceDir,
      env,
      windowsHide: true,
      timeout: 120_000,
      maxBuffer: 5_000_000,
    }).catch(() => undefined);
    await execFileAsync(
      runtime.python,
      [
        ...pipBase,
        "torch",
        "torchaudio",
        "--index-url",
        "https://download.pytorch.org/whl/cu124",
      ],
      { cwd: voiceDir, env, windowsHide: true, timeout: 1_800_000, maxBuffer: 40_000_000 },
    );
  } else {
    onStatus?.("No NVIDIA GPU detected. Installing CPU torch (slower RVC)…", 0.15);
    await execFileAsync(
      runtime.python,
      [
        ...pipBase,
        "torch",
        "torchaudio",
        "--index-url",
        "https://download.pytorch.org/whl/cpu",
      ],
      { cwd: voiceDir, env, windowsHide: true, timeout: 1_800_000, maxBuffer: 40_000_000 },
    );
  }

  onStatus?.("Installing rvc-python…", 0.55);
  // rvc-python pins omegaconf==2.0.6, rejected by pip>=24.1.
  await execFileAsync(runtime.python, [...pipBase, "pip<24.1"], {
    cwd: voiceDir,
    env,
    windowsHide: true,
    timeout: 180_000,
    maxBuffer: 10_000_000,
  });
  await execFileAsync(runtime.python, [...pipBase, "rvc-python>=0.1.5"], {
    cwd: voiceDir,
    env,
    windowsHide: true,
    timeout: 900_000,
    maxBuffer: 40_000_000,
  });

  // rvc-python may pull a CPU torch from PyPI; re-assert the CUDA build we want.
  if (cuda) {
    onStatus?.("Re-asserting CUDA torch after rvc-python…", 0.72);
    await execFileAsync(runtime.python, [...pipUninstall, "torch", "torchaudio"], {
      cwd: voiceDir,
      env,
      windowsHide: true,
      timeout: 120_000,
      maxBuffer: 5_000_000,
    }).catch(() => undefined);
    await execFileAsync(
      runtime.python,
      [
        ...pipBase,
        "torch",
        "torchaudio",
        "--index-url",
        "https://download.pytorch.org/whl/cu124",
      ],
      { cwd: voiceDir, env, windowsHide: true, timeout: 1_800_000, maxBuffer: 40_000_000 },
    );
  }

  // Base voice deps so the sidecar can run on this interpreter alone.
  // requirements.txt allows numpy>=1.26 which upgrades to 2.x and breaks faiss-cpu 1.7.3
  // (compiled against NumPy 1.x). Install base deps, then force rvc's numpy pin.
  onStatus?.("Installing base voice packages into RVC Python…", 0.8);
  await execFileAsync(
    runtime.python,
    [...pipBase, "-r", join(voiceDir, "requirements.txt")],
    { cwd: voiceDir, env, windowsHide: true, timeout: 900_000, maxBuffer: 20_000_000 },
  );
  onStatus?.("Pinning NumPy 1.23.5 for RVC/faiss…", 0.92);
  await execFileAsync(runtime.python, [...pipBase, "numpy==1.23.5"], {
    cwd: voiceDir,
    env,
    windowsHide: true,
    timeout: 300_000,
    maxBuffer: 20_000_000,
  });

  onStatus?.("Verifying RVC imports…", 0.96);
  await execFileAsync(
    runtime.python,
    ["-c", "import numpy; import torch; import rvc_python; assert numpy.__version__.startswith('1.'); print(torch.__version__)"],
    { cwd: voiceDir, env, windowsHide: true, timeout: 120_000, maxBuffer: 2_000_000 },
  );

  writeFileSync(marker, hash, "utf8");
  onStatus?.(`ML packages installed (${backend})`, 1);
  return runtime;
}
