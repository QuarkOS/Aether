import { type ChildProcess, spawn } from "node:child_process";
import { dirname } from "node:path";

import {
  LOCAL_LLM_BASE_URL,
  LOCAL_LLM_CONTEXT,
  LOCAL_LLM_HOST,
  LOCAL_LLM_MODEL_ID,
  LOCAL_LLM_PORT,
  type LocalLlmBackend,
} from "./catalog.js";
import { findServerExe, modelPath } from "./paths.js";

export class StartAbortedError extends Error {
  constructor() {
    super("Start cancelled");
    this.name = "StartAbortedError";
  }
}

let child: ChildProcess | null = null;
let session = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isServerProcessRunning(): boolean {
  return child !== null && child.exitCode === null;
}

export async function pingServer(): Promise<boolean> {
  const urls = [`${LOCAL_LLM_BASE_URL}/models`, `http://${LOCAL_LLM_HOST}:${LOCAL_LLM_PORT}/health`];
  for (const url of urls) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (res.ok) return true;
    } catch {
      continue;
    }
  }
  return false;
}

export function stopServer(): void {
  session += 1;
  if (!child) return;
  const proc = child;
  child = null;
  proc.kill();
}

export async function startServer(opts: {
  backend: LocalLlmBackend;
  onUnexpectedExit: () => void;
}): Promise<void> {
  if (isServerProcessRunning()) {
    if (await pingServer()) return;
    stopServer();
  }

  const exe = findServerExe();
  if (!exe) {
    throw new Error("llama-server.exe is not installed. Run Set up first.");
  }

  const mySession = session;
  const ngl = opts.backend === "cpu" ? "0" : "99";
  const args = [
    "-m",
    modelPath(),
    "-a",
    LOCAL_LLM_MODEL_ID,
    "--host",
    LOCAL_LLM_HOST,
    "--port",
    String(LOCAL_LLM_PORT),
    "-c",
    String(LOCAL_LLM_CONTEXT),
    "-ngl",
    ngl,
    "--jinja",
  ];
  console.log(`[local-llm] starting: ${exe} ${args.join(" ")}`);
  const proc = spawn(exe, args, {
    cwd: dirname(exe),
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child = proc;
  proc.stdout?.on("data", (b: Buffer) => process.stdout.write(`[local-llm] ${b}`));
  proc.stderr?.on("data", (b: Buffer) => process.stderr.write(`[local-llm] ${b}`));
  proc.on("exit", (code) => {
    console.log(`[local-llm] exited with code ${code}`);
    if (child === proc) child = null;
    if (session === mySession) opts.onUnexpectedExit();
  });

  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (session !== mySession) throw new StartAbortedError();
    if (!isServerProcessRunning()) {
      throw new Error("llama-server exited before becoming ready");
    }
    if (await pingServer()) {
      if (session !== mySession) throw new StartAbortedError();
      return;
    }
    await sleep(1000);
  }
  stopServer();
  throw new Error("llama-server did not become ready within 120s");
}
