import {
  CPU_ZIP_URL,
  MODEL_MIN_BYTES,
  MODEL_SIZE_LABEL,
  MODEL_URL,
  VULKAN_ZIP_URL,
  WINDOWS_ONLY_MESSAGE,
  ZIP_MIN_BYTES,
  zipUrl,
  type LocalLlmBackend,
} from "./catalog.js";
import { downloadFile, isCompleteFile } from "./download.js";
import { extractZip } from "./extract.js";
import {
  binDir,
  ensureLayout,
  findServerExe,
  modelPath,
  readBackend,
  writeBackend,
  zipPath,
} from "./paths.js";

export type ProgressFn = (progress: number, message: string) => void;

async function installBinaries(report: ProgressFn, prefer: LocalLlmBackend): Promise<LocalLlmBackend> {
  const order: LocalLlmBackend[] = prefer === "cpu" ? ["cpu"] : ["vulkan", "cpu"];
  let lastError: unknown;
  for (const backend of order) {
    try {
      const label = `Downloading llama-server (${backend})...`;
      report(0, label);
      await downloadFile({
        url: zipUrl(backend),
        dest: zipPath(backend),
        minBytes: ZIP_MIN_BYTES,
        onProgress: (ratio) => report(0.08 * ratio, label),
      });
      report(0.08, `Extracting llama-server (${backend})...`);
      await extractZip(zipPath(backend), binDir());
      if (!findServerExe()) {
        throw new Error("llama-server.exe missing after extract");
      }
      writeBackend(backend);
      return backend;
    } catch (err) {
      lastError = err;
      console.error(`[local-llm] ${backend} binaries failed:`, err);
    }
  }
  const fallback = lastError instanceof Error ? lastError.message : "unknown error";
  throw new Error(`Failed to install llama-server (${VULKAN_ZIP_URL} then ${CPU_ZIP_URL}): ${fallback}`);
}

export async function ensureCpuBinaries(report: ProgressFn): Promise<"cpu"> {
  ensureLayout();
  await installBinaries(report, "cpu");
  return "cpu";
}

export async function ensureInstalled(report: ProgressFn): Promise<LocalLlmBackend> {
  if (process.platform !== "win32") {
    throw new Error(WINDOWS_ONLY_MESSAGE);
  }
  ensureLayout();

  let backend = readBackend();
  if (!findServerExe()) {
    backend = await installBinaries(report, "vulkan");
  } else if (!backend) {
    backend = "vulkan";
    writeBackend(backend);
  }

  if (!isCompleteFile(modelPath(), MODEL_MIN_BYTES)) {
    const label = `Downloading Qwen3.5-9B ultra-uncensored heretic (${MODEL_SIZE_LABEL})...`;
    report(0.08, label);
    await downloadFile({
      url: MODEL_URL,
      dest: modelPath(),
      minBytes: MODEL_MIN_BYTES,
      onProgress: (ratio) => report(0.08 + 0.92 * ratio, label),
    });
  }

  report(1, "Files ready");
  return backend ?? "vulkan";
}
