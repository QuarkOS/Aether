import { useCallback, useEffect, useState } from "react";

import {
  createSignal,
  deleteSignal,
  fetchSignals,
  type Signal,
} from "./api.js";
import "./App.css";

export function App() {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [author, setAuthor] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setSignals(await fetchSignals());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load signals");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!author.trim() || !message.trim()) return;
    setSubmitting(true);
    try {
      await createSignal({ author, message });
      setMessage("");
      setError(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send signal");
    } finally {
      setSubmitting(false);
    }
  };

  const onDelete = async (id: string) => {
    try {
      await deleteSignal(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete signal");
    }
  };

  return (
    <div className="app">
      <header className="hero">
        <h1>Aether</h1>
        <p>A signal board drifting through the ether.</p>
      </header>

      <form className="composer" onSubmit={onSubmit}>
        <input
          aria-label="Your name"
          className="composer__author"
          placeholder="Your name"
          maxLength={60}
          value={author}
          onChange={(e) => setAuthor(e.target.value)}
        />
        <input
          aria-label="Signal message"
          className="composer__message"
          placeholder="Broadcast a signal…"
          maxLength={280}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        <button
          type="submit"
          disabled={submitting || !author.trim() || !message.trim()}
        >
          {submitting ? "Sending…" : "Broadcast"}
        </button>
      </form>

      {error && <p className="error" role="alert">{error}</p>}

      <section className="feed">
        {loading ? (
          <p className="muted">Tuning in…</p>
        ) : signals.length === 0 ? (
          <p className="muted">No signals yet. Be the first to broadcast.</p>
        ) : (
          <ul>
            {signals.map((signal) => (
              <li key={signal.id} className="signal">
                <div className="signal__body">
                  <span className="signal__author">{signal.author}</span>
                  <span className="signal__message">{signal.message}</span>
                </div>
                <div className="signal__meta">
                  <time dateTime={signal.createdAt}>
                    {new Date(signal.createdAt).toLocaleString()}
                  </time>
                  <button
                    className="signal__delete"
                    aria-label="Delete signal"
                    onClick={() => onDelete(signal.id)}
                  >
                    ×
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
