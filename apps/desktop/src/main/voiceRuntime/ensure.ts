import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
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
  const pth = readdirSync(pythonDir).find((f) => f.endsWith("._pth") || f.endsWith("-python311._pth"));
  const candidates = [
    pth ? join(pythonDir, pth) : null,
    join(pythonDir, "python311._pth"),
    join(pythonDir, "python39._pth"),
  ].filter(Boolean) as string[];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    let text = readFileSync(file, "utf8");
    if (!text.includes("import site")) {
      text = text.replace("#import site", "import site");
      if (!text.includes("import site")) text += "\nimport site\n";
      writeFileSync(file, text, "utf8");
    }
    return;
  }
}

async function ensureGetPip(pythonExe: string, pythonDir: string): Promise<void> {
  const getPip = join(runtimeRoot(), "get-pip.py");
  if (!existsSync(getPip)) {
    await downloadFile({
      url: "https://bootstrap.pypa.io/get-pip.py",
      dest: getPip,
      minBytes: 1_000_000,
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
}

function requirementsHash(voiceDir: string): string {
  const req = readFileSync(join(voiceDir, "requirements.txt"), "utf8");
  return createHash("sha256").update(req).digest("hex").slice(0, 16);
}

/**
 * For packaged Windows builds, download embeddable Python + ffmpeg into userData
 * and pip-install voice requirements once. Returns python path and PATH prefix for ffmpeg.
 */
export async function ensurePackagedVoiceRuntime(voiceDir: string): Promise<{
  python: string;
  pathPrefix: string;
}> {
  if (process.platform !== "win32") {
    throw new Error("Packaged voice auto-bootstrap is Windows-only.");
  }

  const root = runtimeRoot();
  const pythonDir = join(root, "python");
  const ffmpegDir = join(root, "ffmpeg");
  mkdirSync(root, { recursive: true });

  bootstrapState = "downloading";
  bootstrapMessage = "Downloading embeddable Python…";
  const pyZip = join(root, "python-embed.zip");
  await downloadFile({
    url: PYTHON_ZIP_URL,
    dest: pyZip,
    minBytes: PYTHON_ZIP_MIN_BYTES,
    onProgress: (r) => {
      bootstrapMessage = `Downloading Python… ${Math.round(r * 100)}%`;
    },
  });
  if (!existsSync(join(pythonDir, PYTHON_EXE))) {
    await extractZip(pyZip, pythonDir);
  }
  const python = join(pythonDir, PYTHON_EXE);
  if (!existsSync(python)) throw new Error("python.exe missing after extract");

  bootstrapMessage = "Downloading ffmpeg…";
  const ffZip = join(root, "ffmpeg.zip");
  await downloadFile({
    url: FFMPEG_ZIP_URL,
    dest: ffZip,
    minBytes: FFMPEG_ZIP_MIN_BYTES,
    onProgress: (r) => {
      bootstrapMessage = `Downloading ffmpeg… ${Math.round(r * 100)}%`;
    },
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
    bootstrapMessage = "Installing voice Python packages…";
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
  return { python, pathPrefix: `${ffmpegBin};${pythonDir}` };
}
