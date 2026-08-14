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
