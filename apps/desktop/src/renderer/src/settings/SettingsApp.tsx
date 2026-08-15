import { useEffect, useState } from "react";
import type { AppConfig, VoiceHealth } from "@aether/shared";
import { DEFAULT_CONFIG } from "@aether/shared";

import "./settings.css";

function parseLlmProvider(value: string): AppConfig["llm"]["provider"] | undefined {
  if (value === "openai" || value === "none") return value;
  return undefined;
}

export function SettingsApp() {
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const [health, setHealth] = useState<VoiceHealth | null>(null);
  const [toolkits, setToolkits] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    document.body.classList.add("settings");
    void window.aether.getConfig().then(setConfig);
    void window.aether.getVoiceHealth().then(setHealth);
    void window.aether.listToolkits().then(setToolkits);
    const interval = window.setInterval(() => {
      void window.aether.getVoiceHealth().then(setHealth);
    }, 5000);
    return () => window.clearInterval(interval);
  }, []);

  const patch = async (p: Partial<AppConfig>) => {
    const next = await window.aether.setConfig(p);
    setConfig(next);
  };

  const toggleToolkit = (slug: string) => {
    const enabled = config.integrations.enabledToolkits.includes(slug);
    const list = enabled
      ? config.integrations.enabledToolkits.filter((t) => t !== slug)
      : [...config.integrations.enabledToolkits, slug];
    void patch({ integrations: { ...config.integrations, enabledToolkits: list } });
  };

  const connect = async (slug: string) => {
    setNotice(null);
    const res = await window.aether.connectToolkit(slug);
    if ("error" in res) setNotice(res.error);
    else setNotice(`Opened a browser window to connect ${slug}. Approve access, then it's ready.`);
  };

  return (
    <div className="settings-page">
      <header className="settings-header">
        <h1>Aether</h1>
        <p>Alya, your desktop assistant. Configure her brain, voice, and connected apps.</p>
      </header>

      {notice && <div className="notice">{notice}</div>}

      <section className="card">
        <h2>Assistant brain</h2>
        <div className="row">
          <label>Provider</label>
          <select
            value={config.llm.provider}
            onChange={(e) => {
              const provider = parseLlmProvider(e.target.value);
              if (!provider) return;
              void patch({ llm: { ...config.llm, provider } });
            }}
          >
            <option value="openai">OpenAI</option>
            <option value="none">None (offline replies)</option>
          </select>
        </div>
        <div className="row">
          <label>Model</label>
          <input value={config.llm.model} onChange={(e) => patch({ llm: { ...config.llm, model: e.target.value } })} />
        </div>
        <p className="hint">
          API keys are read from the environment (<code>OPENAI_API_KEY</code>) and are never stored in this config file.
        </p>
      </section>

      <section className="card">
        <h2>Voice</h2>
        <div className="row">
          <label>Base TTS voice</label>
          <input value={config.voice.ttsVoice} onChange={(e) => patch({ voice: { ...config.voice, ttsVoice: e.target.value } })} />
        </div>
        <div className="row">
          <label>Alya voice (RVC)</label>
          <input type="checkbox" checked={config.voice.rvcEnabled} onChange={(e) => patch({ voice: { ...config.voice, rvcEnabled: e.target.checked } })} />
        </div>
        <p className="hint">
          RVC is off by default. It needs the optional ML extras (<code>requirements-ml.txt</code>) and a GPU. If
          health below says RVC unavailable, the base TTS voice is used instead.
        </p>
        <div className="row">
          <label>RVC model</label>
          <input value={config.voice.rvcModel} onChange={(e) => patch({ voice: { ...config.voice, rvcModel: e.target.value } })} />
        </div>
        <div className="row">
          <label>Pitch (semitones)</label>
          <input type="number" value={config.voice.rvcPitch} onChange={(e) => patch({ voice: { ...config.voice, rvcPitch: Number(e.target.value) } })} />
        </div>
        <div className="health">
          <span>Voice service:</span>
          {health ? (
            <ul>
              <li>Device: <b>{health.device}</b></li>
              <li>TTS: {health.ttsAvailable ? "ready" : "unavailable"}</li>
              <li>STT: {health.sttAvailable ? "ready" : "unavailable"}</li>
              <li>RVC: {health.rvcAvailable ? (health.rvcModelLoaded ? "ready (model loaded)" : "ready (no model)") : "unavailable"}</li>
              <li>Models: {health.models.join(", ") || "none installed"}</li>
            </ul>
          ) : (
            <em>not responding</em>
          )}
        </div>
      </section>

      <section className="card">
        <h2>Voice input</h2>
        <div className="row">
          <label>Push-to-talk hotkey</label>
          <input value={config.input.pushToTalkHotkey} onChange={(e) => patch({ input: { ...config.input, pushToTalkHotkey: e.target.value } })} />
        </div>
        <div className="row">
          <label>Whisper model</label>
          <select value={config.input.sttModel} onChange={(e) => patch({ input: { ...config.input, sttModel: e.target.value } })}>
            {["tiny", "base", "small", "medium"].map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
      </section>

      <section className="card">
        <h2>Mascot</h2>
        <div className="row">
          <label>Model</label>
          <input value={config.mascot.model} onChange={(e) => patch({ mascot: { ...config.mascot, model: e.target.value } })} />
        </div>
        <p className="hint">Use <code>placeholder</code> for the built-in avatar, or a path/URL to a Live2D <code>.model3.json</code>.</p>
        <div className="row">
          <label>Scale</label>
          <input type="range" min="0.1" max="0.6" step="0.01" value={config.mascot.scale} onChange={(e) => patch({ mascot: { ...config.mascot, scale: Number(e.target.value) } })} />
        </div>
        <div className="row">
          <label>Corner</label>
          <select value={config.mascot.anchor} onChange={(e) => patch({ mascot: { ...config.mascot, anchor: e.target.value as AppConfig["mascot"]["anchor"] } })}>
            <option value="bottom-right">Bottom right</option>
            <option value="bottom-left">Bottom left</option>
            <option value="top-right">Top right</option>
            <option value="top-left">Top left</option>
          </select>
        </div>
        <div className="row">
          <label>Click-through overlay</label>
          <input type="checkbox" checked={config.mascot.clickThrough} onChange={(e) => patch({ mascot: { ...config.mascot, clickThrough: e.target.checked } })} />
        </div>
      </section>

      <section className="card">
        <h2>App integrations (Composio)</h2>
        <p className="hint">Enable a toolkit, then Connect to authorize your account. Requires <code>COMPOSIO_API_KEY</code>.</p>
        <div className="toolkits">
          {toolkits.map((slug) => {
            const enabled = config.integrations.enabledToolkits.includes(slug);
            return (
              <div key={slug} className={`toolkit ${enabled ? "toolkit--on" : ""}`}>
                <span className="toolkit__name">{slug}</span>
                <label className="toolkit__toggle">
                  <input type="checkbox" checked={enabled} onChange={() => toggleToolkit(slug)} /> enabled
                </label>
                <button onClick={() => connect(slug)}>Connect</button>
              </div>
            );
          })}
        </div>
      </section>

      <section className="card">
        <h2>Startup</h2>
        <div className="row">
          <label>Start Aether on login</label>
          <input type="checkbox" checked={config.startOnLogin} onChange={(e) => patch({ startOnLogin: e.target.checked })} />
        </div>
      </section>
    </div>
  );
}
