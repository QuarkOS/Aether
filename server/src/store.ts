import { randomUUID } from "node:crypto";

export interface Signal {
  id: string;
  message: string;
  author: string;
  createdAt: string;
}

export interface NewSignal {
  message: string;
  author: string;
}

/**
 * In-memory store for broadcast "signals". Kept intentionally simple so the
 * starter runs with zero external infrastructure; swap for a real database
 * when persistence is needed.
 */
export class SignalStore {
  private signals: Signal[] = [];

  list(): Signal[] {
    return [...this.signals].reverse();
  }

  add(input: NewSignal): Signal {
    const signal: Signal = {
      id: randomUUID(),
      message: input.message.trim(),
      author: input.author.trim(),
      createdAt: new Date().toISOString(),
    };
    this.signals.push(signal);
    return signal;
  }

  remove(id: string): boolean {
    const before = this.signals.length;
    this.signals = this.signals.filter((s) => s.id !== id);
    return this.signals.length < before;
  }

  clear(): void {
    this.signals = [];
  }
}

export function validateNewSignal(body: unknown): NewSignal | null {
  if (typeof body !== "object" || body === null) return null;
  const { message, author } = body as Record<string, unknown>;
  if (typeof message !== "string" || message.trim().length === 0) return null;
  if (typeof author !== "string" || author.trim().length === 0) return null;
  if (message.length > 280 || author.length > 60) return null;
  return { message, author };
}
