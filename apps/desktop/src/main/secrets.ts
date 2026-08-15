import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { app, safeStorage } from "electron";

export type SecretId = "openai" | "composio";

export interface SecretsStatus {
  openai: boolean;
  composio: boolean;
}

const SECRET_IDS: SecretId[] = ["openai", "composio"];

function secretsDir(): string {
  return join(app.getPath("userData"), "secrets");
}

function secretPath(id: SecretId): string {
  return join(secretsDir(), `${id}.bin`);
}

export function getSecretsStatus(): SecretsStatus {
  return {
    openai: existsSync(secretPath("openai")),
    composio: existsSync(secretPath("composio")),
  };
}

export function getSecret(id: SecretId): string | null {
  const path = secretPath(id);
  if (!existsSync(path)) return null;
  if (!safeStorage.isEncryptionAvailable()) return null;
  try {
    const buf = readFileSync(path);
    return safeStorage.decryptString(buf);
  } catch (err) {
    console.error(`[secrets] failed to read ${id}:`, err);
    return null;
  }
}

export function setSecret(id: SecretId, value: string): { ok: true } | { error: string } {
  const trimmed = value.trim();
  if (!trimmed) return { error: "Secret value is empty." };
  if (!safeStorage.isEncryptionAvailable()) {
    return { error: "OS encryption is unavailable; cannot store secrets." };
  }
  try {
    mkdirSync(secretsDir(), { recursive: true });
    const encrypted = safeStorage.encryptString(trimmed);
    writeFileSync(secretPath(id), encrypted);
    return { ok: true };
  } catch (err) {
    console.error(`[secrets] failed to write ${id}:`, err);
    return { error: String(err) };
  }
}

export function clearSecret(id: SecretId): void {
  const path = secretPath(id);
  if (!existsSync(path)) return;
  try {
    unlinkSync(path);
  } catch (err) {
    console.error(`[secrets] failed to clear ${id}:`, err);
  }
}

export function resolveOpenAiKey(): string | undefined {
  return process.env.OPENAI_API_KEY || getSecret("openai") || undefined;
}

export function resolveComposioKey(): string | undefined {
  return process.env.COMPOSIO_API_KEY || getSecret("composio") || undefined;
}

export function isSecretId(value: string): value is SecretId {
  return (SECRET_IDS as string[]).includes(value);
}
