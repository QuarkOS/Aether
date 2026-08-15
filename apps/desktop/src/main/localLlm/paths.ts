import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { app } from "electron";

import {
  CPU_ZIP_NAME,
  MODEL_FILENAME,
  MODEL_MIN_BYTES,
  SERVER_EXE,
  VULKAN_ZIP_NAME,
  type LocalLlmBackend,
} from "./catalog.js";

export function localLlmRoot(): string {
  return join(app.getPath("userData"), "local-llm");
}

export function binDir(): string {
  return join(localLlmRoot(), "bin");
}

export function modelsDir(): string {
  return join(localLlmRoot(), "models");
}

export function cacheDir(): string {
  return join(localLlmRoot(), "cache");
}

export function modelPath(): string {
  return join(modelsDir(), MODEL_FILENAME);
}

export function zipPath(backend: LocalLlmBackend): string {
  return join(cacheDir(), backend === "vulkan" ? VULKAN_ZIP_NAME : CPU_ZIP_NAME);
}

export function backendMarkerPath(): string {
  return join(binDir(), "backend.txt");
}

export function ensureLayout(): void {
  mkdirSync(binDir(), { recursive: true });
  mkdirSync(modelsDir(), { recursive: true });
  mkdirSync(cacheDir(), { recursive: true });
}

export function findServerExe(root = binDir()): string | null {
  const direct = join(root, SERVER_EXE);
  if (existsSync(direct)) return direct;
  if (!existsSync(root)) return null;
  const entries = readdirSync(root, { recursive: true, encoding: "utf8" });
  for (const rel of entries) {
    if (rel.toLowerCase().replaceAll("\\", "/").endsWith(SERVER_EXE.toLowerCase())) {
      return join(root, rel);
    }
  }
  return null;
}

export function readBackend(): LocalLlmBackend | undefined {
  const marker = backendMarkerPath();
  if (!existsSync(marker)) return undefined;
  const value = readFileSync(marker, "utf8").trim();
  if (value === "vulkan" || value === "cpu") return value;
  return undefined;
}

export function writeBackend(backend: LocalLlmBackend): void {
  mkdirSync(binDir(), { recursive: true });
  writeFileSync(backendMarkerPath(), backend, "utf8");
}

export function filesReady(): boolean {
  const exe = findServerExe();
  if (!exe) return false;
  if (!existsSync(modelPath())) return false;
  return statSync(modelPath()).size >= MODEL_MIN_BYTES;
}
