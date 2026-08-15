import { useEffect, useState } from "react";
import type {
  AppConfig,
  IntegrationToolkitStatus,
  LocalLlmStatus,
  RvcInstallStatus,
  SecretsStatus,
  VoiceHealth,
} from "@aether/shared";
import { DEFAULT_CONFIG } from "@aether/shared";

import "./settings.css";

function parseLlmProvider(value: string): AppConfig["llm"]["provider"] | undefined {
  if (value === "openai" || value === "openai-compatible" || value === "none") return value;
  return undefined;
}

const DEFAULT_COMPAT_BASE_URL = "http://127.0.0.1:11434/v1";
const EMPTY_SECRETS: SecretsStatus = { openai: false, composio: false };

type OnboardingStep = "welcome" | "mic" | "keys" | "done";

const ONBOARDING_COPY: Record<OnboardingStep, { title: string; body: string }> = {
  welcome: {
    title: "Meet Alya",
    body: "Alya lives in the corner of your screen. Type in the dock or use push-to-talk. Text chat works even when voice is down.",
  },
  mic: {
    title: "Microphone",
    body: "The first time you use the mic, Windows or Chromium will ask for permission. Allow it so push-to-talk and the dock mic can hear you. Speech-to-text runs locally via Whisper.",
  },
  keys: {
    title: "Brain and apps",
    body: "Paste an OpenAI key below, or Set up the local Heretic llama.cpp brain, or point OpenAI-compatible at your own server. Composio needs its own key for Gmail and friends. Spoken replies use edge-tts on the network.",
  },
  done: {
    title: "You're set",
    body: "You can reopen this walkthrough from Startup. Quit lives on the tray icon.",
  },
};

function localLlmLabel(status: LocalLlmStatus): string {
  switch (status.state) {
    case "missing":
      return status.message ?? "Not installed";
    case "downloading": {
      const pct = status.progress != null ? ` ${Math.round(status.progress * 100)}%` : "";
      return (status.message ?? "Downloading") + pct;
    }
    case "ready":
      return "Downloaded. Not running.";
    case "starting":
      return status.message ?? "Starting llama-server...";
    case "running": {
      const backend = status.backend ? ` (${status.backend})` : "";
      return `Running${backend} at ${status.baseUrl ?? "http://127.0.0.1:8765/v1"}`;
    }
    case "error":
      return status.message ?? "Failed";
    default: {
      const _exhaustive: never = status.state;
      return _exhaustive;
    }
  }
}

function rvcInstallLabel(status: RvcInstallStatus): string {
  switch (status.state) {
    case "missing":
      return status.message ?? "Not installed";
    case "downloading":
    case "installing": {
      const pct = status.progress != null ? ` ${Math.round(status.progress * 100)}%` : "";
      return (status.message ?? status.state) + pct;
    }
    case "ready":
      return status.message ?? `Ready (${status.device ?? "cpu"})`;
    case "error":
      return status.message ?? "Failed";
    default: {
      const _exhaustive: never = status.state;
      return _exhaustive;
    }
  }
}

export function SettingsApp() {
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const [health, setHealth] = useState<VoiceHealth | null>(null);
  const [localLlm, setLocalLlm] = useState<LocalLlmStatus>({ state: "missing" });
  const [localLlmBusy, setLocalLlmBusy] = useState(false);
  const [rvcInstall, setRvcInstall] = useState<RvcInstallStatus>({
    state: "missing",
    rvcAvailable: false,
    modelReady: false,
  });
  const [rvcBusy, setRvcBusy] = useState(false);
  const [secrets, setSecrets] = useState<SecretsStatus>(EMPTY_SECRETS);
  const [openaiDraft, setOpenaiDraft] = useState("");
  const [composioDraft, setComposioDraft] = useState("");
  const [toolkits, setToolkits] = useState<string[]>([]);
  const [integrationStatus, setIntegrationStatus] = useState<IntegrationToolkitStatus[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [onboardingStep, setOnboardingStep] = useState<OnboardingStep>("welcome");

  useEffect(() => {
    document.body.classList.add("settings");
    void window.aether.getConfig().then((cfg) => {
      setConfig(cfg);
      if (!cfg.onboardingCompleted) setOnboardingStep("welcome");
    });
    void window.aether.getVoiceHealth().then(setHealth);
    void window.aether.getLocalLlmStatus().then(setLocalLlm);
    void window.aether.getRvcInstallStatus().then(setRvcInstall);
    void window.aether.getSecretsStatus().then(setSecrets);
    void window.aether.listToolkits().then(setToolkits);
    void window.aether.listIntegrationStatus().then(setIntegrationStatus);
    const interval = window.setInterval(() => {
      void window.aether.getVoiceHealth().then(setHealth);
      void window.aether.listIntegrationStatus().then(setIntegrationStatus);
    }, 5000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const fast = localLlm.state === "downloading" || localLlm.state === "starting";
    const tick = async () => {
      const next = await window.aether.getLocalLlmStatus();
      setLocalLlm(next);
      if (next.state === "running") {
        setConfig(await window.aether.getConfig());
      }
    };
    const interval = window.setInterval(() => {
      void tick();
    }, fast ? 400 : 2500);
    return () => window.clearInterval(interval);
  }, [localLlm.state]);

  useEffect(() => {
    const fast = rvcInstall.state === "downloading" || rvcInstall.state === "installing";
    const tick = async () => {
      const next = await window.aether.getRvcInstallStatus();
      setRvcInstall(next);
      if (next.state === "ready") {
        setConfig(await window.aether.getConfig());
        setHealth(await window.aether.getVoiceHealth());
      }
    };
    const interval = window.setInterval(() => {
      void tick();
    }, fast ? 500 : 3000);
    return () => window.clearInterval(interval);
  }, [rvcInstall.state]);

  const patch = async (p: Partial<AppConfig>) => {
    const next = await window.aether.setConfig(p);
    setConfig(next);
  };

  const toggleToolkit = (slug: string) => {
    const enabled = config.integrations.enabledToolkits.includes(slug);
    const list = enabled
      ? config.integrations.enabledToolkits.filter((t) => t !== slug)
      : [...config.integrations.enabledToolkits, slug];
    void patch({ integrations: { ...config.integrations, enabledToolkits: list } }).then(() => {
      void window.aether.listIntegrationStatus().then(setIntegrationStatus);
    });
  };

  const connect = async (slug: string) => {
    setNotice(null);
    if (!secrets.composio) {
      setNotice("Save a Composio API key before connecting.");
      return;
    }
    const res = await window.aether.connectToolkit(slug);
    if ("error" in res) setNotice(res.error);
    else setNotice(`Opened a browser window to connect ${slug}. Approve access, then refresh status.`);
    setIntegrationStatus(await window.aether.listIntegrationStatus());
  };

  const runLocalLlm = async (op: "install" | "start" | "stop") => {
    setLocalLlmBusy(true);
    try {
      const next =
        op === "install"
          ? await window.aether.installLocalLlm()
          : op === "start"
            ? await window.aether.startLocalLlm()
            : await window.aether.stopLocalLlm();
      setLocalLlm(next);
      setConfig(await window.aether.getConfig());
    } finally {
      setLocalLlmBusy(false);
    }
  };

  const runRvcInstall = async () => {
    setRvcBusy(true);
    setNotice(null);
    try {
      const next = await window.aether.installRvc();
      setRvcInstall(next);
      setConfig(await window.aether.getConfig());
      setHealth(await window.aether.getVoiceHealth());
      if (next.state === "ready") setNotice("Alya RVC installed. Spoken replies will use her voice.");
      else if (next.state === "error") setNotice(next.message ?? "RVC install failed.");
    } finally {
      setRvcBusy(false);
    }
  };

  const saveSecret = async (id: "openai" | "composio", value: string) => {
    setNotice(null);
    const res = await window.aether.setSecret(id, value);
    if ("error" in res) {
      setNotice(res.error);
      return;
    }
    setSecrets(await window.aether.getSecretsStatus());
    if (id === "openai") setOpenaiDraft("");
    else setComposioDraft("");
    setNotice(id === "openai" ? "OpenAI key saved." : "Composio key saved.");
  };

  const wipeSecret = async (id: "openai" | "composio") => {
    await window.aether.clearSecret(id);
    setSecrets(await window.aether.getSecretsStatus());
    setNotice(id === "openai" ? "OpenAI key cleared." : "Composio key cleared.");
  };

  const finishOnboarding = async () => {
    await patch({ onboardingCompleted: true });
    setNotice("Onboarding complete.");
  };

  const nextOnboarding = () => {
    const order: OnboardingStep[] = ["welcome", "mic", "keys", "done"];
    const i = order.indexOf(onboardingStep);
    if (i < 0 || i >= order.length - 1) {
      void finishOnboarding();
      return;
    }
    setOnboardingStep(order[i + 1]!);
  };

  const windowsOnly = Boolean(localLlm.message?.includes("Windows-only"));
  const showOnboarding = !config.onboardingCompleted;
  const inFlight =
    localLlmBusy || localLlm.state === "downloading" || localLlm.state === "starting";
  const canSetup = !windowsOnly && !inFlight && localLlm.state !== "running";
  const canStart =
    !windowsOnly && !inFlight && (localLlm.state === "ready" || localLlm.state === "error");
  const canStop = !windowsOnly && (localLlm.state === "running" || localLlm.state === "starting");

  return (
    <div className="settings-page">
      <header className="settings-header">
        <h1>Aether</h1>
        <p>Alya, your desktop assistant. Configure her brain, voice, and connected apps.</p>
      </header>

      {notice && <div className="notice">{notice}</div>}

      {showOnboarding && (
        <section className="card onboarding">
          <h2>{ONBOARDING_COPY[onboardingStep].title}</h2>
          <p>{ONBOARDING_COPY[onboardingStep].body}</p>
          <div className="local-llm-actions">
            {onboardingStep === "done" ? (
              <button type="button" onClick={() => void finishOnboarding()}>
                Finish
              </button>
            ) : (
              <button type="button" onClick={nextOnboarding}>
                Next
              </button>
            )}
            <button type="button" onClick={() => void finishOnboarding()}>
              Skip
            </button>
          </div>
        </section>
      )}

      <section className="card">
        <h2>Assistant brain</h2>
        <div className="row">
          <label>Provider</label>
          <select
            value={config.llm.provider}
            onChange={(e) => {
              const provider = parseLlmProvider(e.target.value);
              if (!provider) return;
              const next = { ...config.llm, provider };
              if (provider === "openai-compatible" && !next.baseUrl.trim()) {
                next.baseUrl = DEFAULT_COMPAT_BASE_URL;
              }
              void patch({ llm: next });
            }}
          >
            <option value="openai">OpenAI</option>
            <option value="openai-compatible">OpenAI-compatible (local)</option>
            <option value="none">None (offline replies)</option>
          </select>
        </div>
        <div className="row">
          <label>Model</label>
          <input value={config.llm.model} onChange={(e) => patch({ llm: { ...config.llm, model: e.target.value } })} />
        </div>
        {config.llm.provider === "openai-compatible" && (
          <div className="row">
            <label>Base URL</label>
            <input
              value={config.llm.baseUrl}
              placeholder={DEFAULT_COMPAT_BASE_URL}
              onChange={(e) => patch({ llm: { ...config.llm, baseUrl: e.target.value } })}
            />
          </div>
        )}
        {config.llm.provider === "openai" && (
          <>
            <div className="row">
              <label>OpenAI API key</label>
              <input
                type="password"
                autoComplete="off"
                placeholder={secrets.openai ? "•••••••• (saved)" : "sk-..."}
                value={openaiDraft}
                onChange={(e) => setOpenaiDraft(e.target.value)}
              />
            </div>
            <div className="local-llm-actions">
              <button type="button" disabled={!openaiDraft.trim()} onClick={() => void saveSecret("openai", openaiDraft)}>
                Save key
              </button>
              <button type="button" disabled={!secrets.openai} onClick={() => void wipeSecret("openai")}>
                Clear
              </button>
            </div>
          </>
        )}
        <p className="hint">
          {config.llm.provider === "openai-compatible"
            ? "Point at Ollama, LM Studio, llama.cpp, or any OpenAI-compatible /v1 server. No cloud API key required. Local companion mode is on (less prudish refusals)."
            : config.llm.provider === "openai"
              ? <>Keys are stored with OS encryption, not in the config file. A process env <code>OPENAI_API_KEY</code> still wins when set.</>
              : "Offline rule-based replies only."}
        </p>
        <div className="local-llm">
          <div className="row">
            <label>Local Heretic brain</label>
            <span className="local-llm-status">{localLlmLabel(localLlm)}</span>
          </div>
          {(localLlm.state === "downloading" || localLlm.progress != null) && (
            <progress className="local-llm-progress" max={1} value={localLlm.progress ?? 0} />
          )}
          <div className="local-llm-actions">
            <button type="button" disabled={!canSetup} onClick={() => void runLocalLlm("install")}>
              Set up
            </button>
            <button type="button" disabled={!canStart} onClick={() => void runLocalLlm("start")}>
              Start
            </button>
            <button type="button" disabled={!canStop} onClick={() => void runLocalLlm("stop")}>
              Stop
            </button>
          </div>
          <p className="hint">
            About 5.6 GB download on Windows. This is Qwen3.5-9B ultra-uncensored heretic, an
            abliterated model with fewer refusals. With provider set to OpenAI-compatible, Alya
            uses a local companion persona (adult roleplay OK; illegal/harmful still refused).
            Text weights only, no mmproj.
          </p>
        </div>
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
        <div className="row">
          <label>Voice mode</label>
          <select
            value={config.voice.voiceMode ?? "quality"}
            disabled={!config.voice.rvcEnabled}
            onChange={(e) =>
              patch({
                voice: {
                  ...config.voice,
                  voiceMode: e.target.value === "fast" ? "fast" : "quality",
                },
              })
            }
          >
            <option value="quality">Quality (fuller Alya timbre)</option>
            <option value="fast">Fast (snappier RVC)</option>
          </select>
        </div>
        <p className="hint">
          Fast uses a lighter RVC mix (index 0) so replies start sooner; Quality keeps richer
          Alya color. Takes effect on the next spoken line — no restart needed.
        </p>
        <div className="local-llm-box">
          <div className="row">
            <label>RVC setup</label>
            <span>{rvcInstallLabel(rvcInstall)}</span>
          </div>
          <div className="local-llm-actions">
            <button
              type="button"
              disabled={
                rvcBusy ||
                rvcInstall.state === "downloading" ||
                rvcInstall.state === "installing" ||
                rvcInstall.state === "ready"
              }
              onClick={() => void runRvcInstall()}
            >
              {rvcInstall.state === "ready" ? "Installed" : "Set up Alya voice"}
            </button>
          </div>
          <p className="hint">
            Windows only. Installs portable Python 3.10 (with build headers), torch (CUDA if
            nvidia-smi works, otherwise CPU), rvc-python, and the Alya model. First setup can
            take a long time and several GB of disk.
          </p>
        </div>
        <p className="hint">
          If health below says RVC unavailable, spoken audio stays on the base Microsoft TTS voice.
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
              <li>
                Warmup:{" "}
                {health.warmReady
                  ? `ready (whisper-${health.sttModel ?? "?"}${health.rvcWarmed ? ", rvc" : ""})`
                  : health.warmReady === false
                    ? "loading models…"
                    : "unknown"}
              </li>
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
        <p className="hint">
          Prefer <code>small</code> (default) for accuracy. Existing installs on{" "}
          <code>base</code> are migrated to <code>small</code> so warmup matches the mic path.
          Restart the app after changing this so the voice sidecar reloads the same size.
        </p>
        <div className="row">
          <label>Wake word</label>
          <input
            type="checkbox"
            checked={config.input.wakeWordEnabled}
            onChange={(e) =>
              patch({ input: { ...config.input, wakeWordEnabled: e.target.checked } })
            }
          />
        </div>
        <div className="row">
          <label>Wake phrase</label>
          <input
            value={config.input.wakePhrase}
            disabled={!config.input.wakeWordEnabled}
            onChange={(e) => patch({ input: { ...config.input, wakePhrase: e.target.value } })}
            placeholder="alya"
          />
        </div>
        <p className="hint">
          When enabled, the overlay listens for the phrase (e.g. &quot;Alya&quot; or &quot;Hey Alya,
          what&apos;s up?&quot;). Uses the same Whisper model — keep the app unmuted and allow mic
          access. Push-to-talk still works.
        </p>
        <div className="row">
          <label>Barge-in</label>
          <input
            type="checkbox"
            checked={config.input.bargeInEnabled ?? true}
            onChange={(e) =>
              patch({ input: { ...config.input, bargeInEnabled: e.target.checked } })
            }
          />
        </div>
        <p className="hint">
          Listen while Alya speaks: if you talk over her, playback stops and a new mic turn
          starts. Uses energy detection (raise your voice slightly if speakers echo into the mic).
          Push-to-talk also interrupts. Default on.
        </p>
      </section>

      <section className="card">
        <h2>Mascot</h2>
        <div className="row">
          <label>Model</label>
          <input value={config.mascot.model} onChange={(e) => patch({ mascot: { ...config.mascot, model: e.target.value } })} />
        </div>
        <p className="hint">Use <code>placeholder</code> for the built-in avatar, or a path/URL to a Live2D <code>.model3.json</code>.</p>
        {config.mascot.model !== "placeholder" && (
          <div className="row">
            <label>Scale</label>
            <input type="range" min="0.1" max="0.6" step="0.01" value={config.mascot.scale} onChange={(e) => patch({ mascot: { ...config.mascot, scale: Number(e.target.value) } })} />
          </div>
        )}
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
        <div className="row">
          <label>Composio API key</label>
          <input
            type="password"
            autoComplete="off"
            placeholder={secrets.composio ? "•••••••• (saved)" : "composio key"}
            value={composioDraft}
            onChange={(e) => setComposioDraft(e.target.value)}
          />
        </div>
        <div className="local-llm-actions">
          <button type="button" disabled={!composioDraft.trim()} onClick={() => void saveSecret("composio", composioDraft)}>
            Save key
          </button>
          <button type="button" disabled={!secrets.composio} onClick={() => void wipeSecret("composio")}>
            Clear
          </button>
        </div>
        <p className="hint">
          Stored with OS encryption. Env <code>COMPOSIO_API_KEY</code> still wins when set. Enable a toolkit, then Connect.
        </p>
        <div className="toolkits">
          {(integrationStatus.length
            ? integrationStatus
            : toolkits.map(
                (slug): IntegrationToolkitStatus => ({
                  slug,
                  enabled: config.integrations.enabledToolkits.includes(slug),
                  connected: false,
                }),
              )
          ).map((row) => (
            <div key={row.slug} className={`toolkit ${row.enabled ? "toolkit--on" : ""}`}>
              <span className="toolkit__name">{row.slug}</span>
              <span className="hint">
                {row.connected ? `connected${row.accountLabel ? `: ${row.accountLabel}` : ""}` : "not connected"}
              </span>
              <label className="toolkit__toggle">
                <input type="checkbox" checked={row.enabled} onChange={() => toggleToolkit(row.slug)} /> enabled
              </label>
              <button type="button" disabled={!secrets.composio} onClick={() => connect(row.slug)}>
                Connect
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>Startup</h2>
        <div className="row">
          <label>Start Aether on login</label>
          <input type="checkbox" checked={config.startOnLogin} onChange={(e) => patch({ startOnLogin: e.target.checked })} />
        </div>
        <div className="local-llm-actions">
          <button
            type="button"
            onClick={() => {
              void patch({ onboardingCompleted: false }).then(() => setOnboardingStep("welcome"));
            }}
          >
            Show onboarding
          </button>
          <button type="button" onClick={() => void window.aether.quit()}>
            Quit Aether
          </button>
        </div>
      </section>
    </div>
  );
}
