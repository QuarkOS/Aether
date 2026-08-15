import { execFile } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function powershellExe(): string {
  return join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

function psLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export async function extractZip(zipFile: string, destDir: string): Promise<void> {
  if (!existsSync(zipFile)) {
    throw new Error(`Zip not found: ${zipFile}`);
  }
  rmSync(destDir, { recursive: true, force: true });
  mkdirSync(destDir, { recursive: true });
  const script = `Expand-Archive -LiteralPath ${psLiteral(zipFile)} -DestinationPath ${psLiteral(destDir)} -Force`;
  await execFileAsync(
    powershellExe(),
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { windowsHide: true, timeout: 180_000, maxBuffer: 10_000_000 },
  );
}
