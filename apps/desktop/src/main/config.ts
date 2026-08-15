import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { app } from "electron";
import { DEFAULT_CONFIG, type AppConfig } from "@aether/shared";

const CONFIG_PATH = join(app.getPath("userData"), "aether-config.json");

let cache: AppConfig | null = null;

function deepMerge<T>(base: T, patch: Partial<T>): T {
  const out = { ...base } as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    const current = out[key];
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      current &&
      typeof current === "object" &&
      !Array.isArray(current)
    ) {
      out[key] = deepMerge(current, value as Record<string, unknown>);
    } else if (value !== undefined) {
      out[key] = value;
    }
  }
  return out as T;
}

function normalizeConfig(config: AppConfig): AppConfig {
  let next = config;
  const provider: string = next.llm.provider;
  if (provider === "anthropic" || provider === "gemini") {
    next = { ...next, llm: { ...next.llm, provider: "openai" } };
  }
  // Old installs defaulted to whisper-base while the sidecar warmed "small",
  // causing a cold second load on the first mic turn. Prefer small unless the
  // user has already picked tiny/medium/etc.
  if (next.input.sttModel === "base") {
    console.log("[config] migrating sttModel base → small (align with voice warmup)");
    next = { ...next, input: { ...next.input, sttModel: "small" } };
  }
  if (typeof next.input.wakeWordEnabled !== "boolean") {
    next = {
      ...next,
      input: {
        ...next.input,
        wakeWordEnabled: DEFAULT_CONFIG.input.wakeWordEnabled,
        wakePhrase: next.input.wakePhrase || DEFAULT_CONFIG.input.wakePhrase,
      },
    };
  }
  if (!next.input.wakePhrase?.trim()) {
    next = { ...next, input: { ...next.input, wakePhrase: DEFAULT_CONFIG.input.wakePhrase } };
  }
  if (typeof next.input.bargeInEnabled !== "boolean") {
    next = { ...next, input: { ...next.input, bargeInEnabled: DEFAULT_CONFIG.input.bargeInEnabled } };
  }
  if (next.voice.voiceMode === "quality") {
    console.log("[config] migrating voiceMode quality → fast (avoid RVC stalls)");
    next = { ...next, voice: { ...next.voice, voiceMode: "fast" } };
  }
  if (next.voice.voiceMode !== "quality" && next.voice.voiceMode !== "fast") {
    next = { ...next, voice: { ...next.voice, voiceMode: DEFAULT_CONFIG.voice.voiceMode } };
  }
  return next;
}

export function loadConfig(): AppConfig {
  if (cache) return cache;
  let loaded: AppConfig = { ...DEFAULT_CONFIG };
  try {
    if (existsSync(CONFIG_PATH)) {
      const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Partial<AppConfig>;
      loaded = deepMerge(DEFAULT_CONFIG, raw);
    }
  } catch (err) {
    console.error("[config] failed to read config, using defaults:", err);
  }
  loaded = normalizeConfig(loaded);
  if (!loaded.integrations.userId) {
    loaded.integrations.userId = `aether-${randomUUID()}`;
  }
  cache = loaded;
  saveConfig(loaded);
  return loaded;
}

export function saveConfig(config: AppConfig): AppConfig {
  cache = config;
  try {
    mkdirSync(dirname(CONFIG_PATH), { recursive: true });
    writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
  } catch (err) {
    console.error("[config] failed to write config:", err);
  }
  return config;
}

export function updateConfig(patch: Partial<AppConfig>): AppConfig {
  return saveConfig(deepMerge(loadConfig(), patch));
}
