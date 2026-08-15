/**
 * Pinned artifacts for the managed Windows llama.cpp brain.
 * Model: mradermacher/Qwen3.5-9B-ultra-uncensored-heretic-v1-GGUF @ Q4_K_M
 */

export const LOCAL_LLM_HOST = "127.0.0.1";
export const LOCAL_LLM_PORT = 8765;
export const LOCAL_LLM_BASE_URL = `http://${LOCAL_LLM_HOST}:${LOCAL_LLM_PORT}/v1`;
export const LOCAL_LLM_MODEL_ID = "alya-heretic-9b";
export const LOCAL_LLM_CONTEXT = 4096;

export const LLAMA_CPP_TAG = "b10167";
export const SERVER_EXE = "llama-server.exe";

export const MODEL_HF_REPO = "mradermacher/Qwen3.5-9B-ultra-uncensored-heretic-v1-GGUF";
export const MODEL_FILENAME = "Qwen3.5-9B-ultra-uncensored-heretic-v1.Q4_K_M.gguf";
export const MODEL_URL =
  `https://huggingface.co/${MODEL_HF_REPO}/resolve/main/${MODEL_FILENAME}`;
/** Soft floor so a truncated download is rejected (~5.6 GB file). */
export const MODEL_MIN_BYTES = 5_000_000_000;
export const MODEL_SIZE_LABEL = "~5.6 GB";

export const VULKAN_ZIP_NAME = "llama-b10167-bin-win-vulkan-x64.zip";
export const CPU_ZIP_NAME = "llama-b10167-bin-win-cpu-x64.zip";
export const VULKAN_ZIP_URL = `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_CPP_TAG}/${VULKAN_ZIP_NAME}`;
export const CPU_ZIP_URL = `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_CPP_TAG}/${CPU_ZIP_NAME}`;
export const ZIP_MIN_BYTES = 5_000_000;

export const WINDOWS_ONLY_MESSAGE =
  "Local llama.cpp auto-setup is Windows-only for now. Use the OpenAI-compatible provider with your own server.";

export type LocalLlmBackend = "vulkan" | "cpu";

export function zipName(backend: LocalLlmBackend): string {
  return backend === "vulkan" ? VULKAN_ZIP_NAME : CPU_ZIP_NAME;
}

export function zipUrl(backend: LocalLlmBackend): string {
  return backend === "vulkan" ? VULKAN_ZIP_URL : CPU_ZIP_URL;
}
