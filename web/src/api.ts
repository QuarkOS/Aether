export interface Signal {
  id: string;
  message: string;
  author: string;
  createdAt: string;
}

async function parseError(res: Response): Promise<never> {
  let detail = res.statusText;
  try {
    const body = (await res.json()) as { error?: string };
    if (body.error) detail = body.error;
  } catch {
    // response had no JSON body; fall back to status text
  }
  throw new Error(detail);
}

export async function fetchSignals(): Promise<Signal[]> {
  const res = await fetch("/api/signals");
  if (!res.ok) return parseError(res);
  return (await res.json()) as Signal[];
}

export async function createSignal(input: {
  author: string;
  message: string;
}): Promise<Signal> {
  const res = await fetch("/api/signals", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) return parseError(res);
  return (await res.json()) as Signal;
}

export async function deleteSignal(id: string): Promise<void> {
  const res = await fetch(`/api/signals/${id}`, { method: "DELETE" });
  if (!res.ok && res.status !== 404) return parseError(res);
}
