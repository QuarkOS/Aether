import { once } from "node:events";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

function markerPath(dest: string): string {
  return `${dest}.ok`;
}

export function isCompleteFile(dest: string, minBytes: number): boolean {
  if (!existsSync(dest)) return false;
  const size = statSync(dest).size;
  const marker = markerPath(dest);
  if (existsSync(marker)) {
    const expected = Number(readFileSync(marker, "utf8").trim());
    if (Number.isFinite(expected) && expected > 0) return size === expected;
  }
  return size >= minBytes;
}

export async function downloadFile(opts: {
  url: string;
  dest: string;
  minBytes: number;
  onProgress: (ratio: number) => void;
}): Promise<void> {
  const { url, dest, minBytes, onProgress } = opts;
  if (isCompleteFile(dest, minBytes)) {
    onProgress(1);
    return;
  }

  mkdirSync(dirname(dest), { recursive: true });
  const part = `${dest}.part`;
  if (existsSync(part)) unlinkSync(part);

  const res = await fetch(url, {
    redirect: "follow",
    headers: {
      "User-Agent": "Aether/0.1",
      Accept: "application/octet-stream",
    },
  });
  if (!res.ok) {
    throw new Error(`Download failed (${res.status}) for ${url}`);
  }
  if (!res.body) {
    throw new Error(`Download had no body: ${url}`);
  }

  const total = Number(res.headers.get("content-length") ?? "0");
  const reader = res.body.getReader();
  const file = createWriteStream(part);
  let received = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (!file.write(Buffer.from(value))) {
        await once(file, "drain");
      }
      onProgress(total > 0 ? Math.min(received / total, 1) : 0);
    }
    await new Promise<void>((resolve, reject) => {
      file.end((error: Error | null | undefined) => (error ? reject(error) : resolve()));
    });
  } catch (err) {
    file.destroy();
    if (existsSync(part)) unlinkSync(part);
    throw err;
  }

  if (received < minBytes) {
    unlinkSync(part);
    throw new Error(`Download too small (${received} bytes)`);
  }
  if (total > 0 && received !== total) {
    unlinkSync(part);
    throw new Error(`Download incomplete (${received} of ${total} bytes)`);
  }
  if (existsSync(dest)) unlinkSync(dest);
  renameSync(part, dest);
  writeFileSync(markerPath(dest), String(received), "utf8");
  onProgress(1);
}
