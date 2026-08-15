import type { LocalLlmStatus } from "@aether/shared";

import { updateConfig } from "../config.js";
import {
  LOCAL_LLM_BASE_URL,
  LOCAL_LLM_MODEL_ID,
  WINDOWS_ONLY_MESSAGE,
  type LocalLlmBackend,
} from "./catalog.js";
import { ensureCpuBinaries, ensureInstalled } from "./install.js";
import { filesReady, readBackend } from "./paths.js";
import { pingServer, StartAbortedError, startServer, stopServer, isServerProcessRunning } from "./server.js";

let snapshot: LocalLlmStatus = { state: "missing", modelId: LOCAL_LLM_MODEL_ID };
let chain: Promise<unknown> = Promise.resolve();

function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function applyBrainConfig(): void {
  updateConfig({
    llm: {
      provider: "openai-compatible",
      baseUrl: LOCAL_LLM_BASE_URL,
      model: LOCAL_LLM_MODEL_ID,
    },
  });
}

function runningStatus(backend?: LocalLlmBackend): LocalLlmStatus {
  return {
    state: "running",
    baseUrl: LOCAL_LLM_BASE_URL,
    modelId: LOCAL_LLM_MODEL_ID,
    backend,
  };
}

async function probe(): Promise<LocalLlmStatus> {
  if (process.platform !== "win32") {
    return { state: "missing", message: WINDOWS_ONLY_MESSAGE, modelId: LOCAL_LLM_MODEL_ID };
  }
  const backend = readBackend();
  if (isServerProcessRunning() || (await pingServer())) {
    return runningStatus(backend);
  }
  if (filesReady()) {
    return {
      state: "ready",
      baseUrl: LOCAL_LLM_BASE_URL,
      modelId: LOCAL_LLM_MODEL_ID,
      backend,
    };
  }
  return { state: "missing", modelId: LOCAL_LLM_MODEL_ID };
}

function setSnapshot(next: LocalLlmStatus): LocalLlmStatus {
  snapshot = next;
  return snapshot;
}

export async function getLocalLlmStatus(): Promise<LocalLlmStatus> {
  if (snapshot.state === "downloading" || snapshot.state === "starting") {
    return snapshot;
  }
  const live = await probe();
  if (snapshot.state === "error" && live.state !== "running") {
    return snapshot;
  }
  return setSnapshot(live);
}

async function bootServer(backend: LocalLlmBackend): Promise<LocalLlmStatus> {
  setSnapshot({
    state: "starting",
    message: "Starting llama-server...",
    baseUrl: LOCAL_LLM_BASE_URL,
    modelId: LOCAL_LLM_MODEL_ID,
    backend,
  });
  try {
    await startServer({
      backend,
      onUnexpectedExit: () => {
        if (snapshot.state === "running") {
          setSnapshot({
            state: "error",
            message: "llama-server stopped unexpectedly",
            modelId: LOCAL_LLM_MODEL_ID,
            backend: readBackend(),
          });
        }
      },
    });
  } catch (err) {
    if (err instanceof StartAbortedError) {
      return setSnapshot(await probe());
    }
    if (backend === "vulkan") {
      console.error("[local-llm] Vulkan server failed, trying CPU:", err);
      stopServer();
      setSnapshot({
        state: "starting",
        message: "Vulkan failed. Trying CPU llama-server...",
        modelId: LOCAL_LLM_MODEL_ID,
        backend: "cpu",
      });
      await ensureCpuBinaries((progress, message) => {
        setSnapshot({
          state: "downloading",
          progress,
          message,
          modelId: LOCAL_LLM_MODEL_ID,
          backend: "cpu",
        });
      });
      setSnapshot({
        state: "starting",
        message: "Starting llama-server (CPU)...",
        baseUrl: LOCAL_LLM_BASE_URL,
        modelId: LOCAL_LLM_MODEL_ID,
        backend: "cpu",
      });
      try {
        await startServer({
          backend: "cpu",
          onUnexpectedExit: () => {
            if (snapshot.state === "running") {
              setSnapshot({
                state: "error",
                message: "llama-server stopped unexpectedly",
                modelId: LOCAL_LLM_MODEL_ID,
                backend: "cpu",
              });
            }
          },
        });
        applyBrainConfig();
        return setSnapshot(runningStatus("cpu"));
      } catch (cpuErr) {
        if (cpuErr instanceof StartAbortedError) {
          return setSnapshot(await probe());
        }
        return setSnapshot({
          state: "error",
          message: errMessage(cpuErr),
          modelId: LOCAL_LLM_MODEL_ID,
          backend: "cpu",
        });
      }
    }
    return setSnapshot({
      state: "error",
      message: errMessage(err),
      modelId: LOCAL_LLM_MODEL_ID,
      backend,
    });
  }
  applyBrainConfig();
  return setSnapshot(runningStatus(backend));
}

export function installLocalLlm(): Promise<LocalLlmStatus> {
  return exclusive(async () => {
    if (process.platform !== "win32") {
      return setSnapshot({ state: "missing", message: WINDOWS_ONLY_MESSAGE, modelId: LOCAL_LLM_MODEL_ID });
    }
    const live = await probe();
    if (live.state === "running") {
      applyBrainConfig();
      return setSnapshot(live);
    }
    try {
      const backend = await ensureInstalled((progress, message) => {
        setSnapshot({
          state: "downloading",
          progress,
          message,
          modelId: LOCAL_LLM_MODEL_ID,
          backend: readBackend(),
        });
      });
      return await bootServer(backend);
    } catch (err) {
      return setSnapshot({
        state: "error",
        message: errMessage(err),
        modelId: LOCAL_LLM_MODEL_ID,
        backend: readBackend(),
      });
    }
  });
}

export function startLocalLlm(): Promise<LocalLlmStatus> {
  return exclusive(async () => {
    if (process.platform !== "win32") {
      return setSnapshot({ state: "missing", message: WINDOWS_ONLY_MESSAGE, modelId: LOCAL_LLM_MODEL_ID });
    }
    const live = await probe();
    if (live.state === "running") {
      applyBrainConfig();
      return setSnapshot(live);
    }
    if (!filesReady()) {
      return setSnapshot({
        state: "error",
        message: "Local model is not installed. Run Set up first.",
        modelId: LOCAL_LLM_MODEL_ID,
      });
    }
    return bootServer(readBackend() ?? "vulkan");
  });
}

export async function stopLocalLlm(): Promise<LocalLlmStatus> {
  stopServer();
  return setSnapshot(await probe());
}
