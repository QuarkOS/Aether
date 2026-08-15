import type { AgentEvent, AppConfig, Emotion } from "@aether/shared";

import { getComposioTools } from "./composio.js";
import { offlineReply } from "./offline.js";
import { parseEmotion, systemPromptFor } from "./persona.js";
import { resolveOpenAiKey } from "../secrets.js";

interface HistoryMessage {
  role: "user" | "assistant";
  content: string;
}

const history: HistoryMessage[] = [];
const MAX_HISTORY = 10;

function pushHistory(role: "user" | "assistant", content: string): void {
  history.push({ role, content });
  while (history.length > MAX_HISTORY) history.shift();
}

function hasLlm(config: AppConfig): boolean {
  if (config.llm.provider === "none") return false;
  if (config.llm.provider === "openai-compatible") {
    return Boolean(config.llm.baseUrl.trim());
  }
  return Boolean(resolveOpenAiKey());
}

export interface AgentTurnResult {
  text: string;
  emotion: Emotion;
  aborted?: boolean;
}

export type AgentTurnMode = "realtime" | "tools";

export interface AgentTurnOptions {
  /** realtime = no tools (fast spoken path); tools = Composio / heavier work. */
  mode?: AgentTurnMode;
  abortSignal?: AbortSignal;
  /** When false, skip writing to conversation history (e.g. aborted mid-stream). */
  recordHistory?: boolean;
}

/**
 * Heuristic: utterance likely needs integrations / side effects, not just chat.
 * Used to route to the async tools path without a second model.
 */
export function looksLikeToolRequest(text: string, enabledToolkits: string[]): boolean {
  if (enabledToolkits.length === 0) return false;
  const t = text.toLowerCase();
  const verbs =
    /\b(send|email|check|open|create|schedule|book|post|search|look up|find|list|reply|forward|star|archive|delete|remind|set a reminder|what's on|what is on|calendar|inbox|github|slack|gmail|tweet|draft)\b/i;
  const nouns =
    /\b(email|mail|inbox|calendar|meeting|event|github|issue|pr|pull request|slack|message|reminder|tweet|draft)\b/i;
  if (verbs.test(t) && nouns.test(t)) return true;
  if (/\b(send|email|schedule|book|create an? issue|open (a )?pr)\b/i.test(t)) return true;
  for (const slug of enabledToolkits) {
    if (t.includes(slug.toLowerCase())) return true;
  }
  return false;
}

/**
 * Runs one assistant turn. Streams deltas/tool events via `emit` and returns the
 * final cleaned text + emotion. Falls back to an offline brain without a key.
 *
 * mode "realtime" omits tools so first spoken tokens are not blocked by tool loops.
 * mode "tools" enables Composio when configured (async / delegated path).
 */
export async function runAgentTurn(
  input: string,
  config: AppConfig,
  emit: (event: AgentEvent) => void,
  options: AgentTurnOptions = {},
): Promise<AgentTurnResult> {
  const mode = options.mode ?? "realtime";
  const recordHistory = options.recordHistory !== false;
  if (recordHistory) pushHistory("user", input);

  if (!hasLlm(config)) {
    const reply = offlineReply(input);
    emit({ type: "assistant-delta", text: reply.text });
    if (recordHistory) pushHistory("assistant", reply.text);
    return reply;
  }

  try {
    const { streamText } = await import("ai");
    const { createOpenAI } = await import("@ai-sdk/openai");
    const tools = mode === "tools" ? await getComposioTools(config) : {};

    const compatible = config.llm.provider === "openai-compatible";
    const baseURL = compatible ? config.llm.baseUrl.trim() : undefined;
    const apiKey = resolveOpenAiKey() || (compatible ? "local" : undefined);
    const client = createOpenAI({
      ...(baseURL ? { baseURL } : {}),
      ...(apiKey ? { apiKey } : {}),
    });
    const modelId = config.llm.model || (compatible ? "llama3.2" : "gpt-4o-mini");
    const model = compatible ? client.chat(modelId) : client(modelId);

    const result = streamText({
      model,
      system: systemPromptFor(config.llm.provider),
      messages: history.map((m) => ({ role: m.role, content: m.content })),
      tools,
      maxSteps: mode === "tools" ? 5 : 1,
      // Spoken replies must stay short; uncapped local models (Qwen think) fill the ctx window.
      maxTokens: compatible ? 180 : 220,
      temperature: compatible ? 0.85 : 0.7,
      abortSignal: options.abortSignal,
    });

    let full = "";
    for await (const part of result.fullStream) {
      if (options.abortSignal?.aborted) {
        return { text: parseEmotion(full).text, emotion: "neutral", aborted: true };
      }
      switch (part.type) {
        case "text-delta":
          full += part.textDelta;
          emit({ type: "assistant-delta", text: part.textDelta });
          break;
        case "tool-call":
          emit({ type: "tool-call", tool: part.toolName, args: part.args });
          break;
        case "tool-result":
          emit({
            type: "tool-result",
            tool: part.toolName,
            ok: true,
            summary: typeof part.result === "string" ? part.result : JSON.stringify(part.result).slice(0, 200),
          });
          break;
        case "error":
          emit({ type: "error", message: String(part.error) });
          break;
        default:
          break;
      }
    }

    if (options.abortSignal?.aborted) {
      return { text: parseEmotion(full).text, emotion: "neutral", aborted: true };
    }

    const finalRaw = full || (await result.text);
    const parsed = parseEmotion(finalRaw);
    if (recordHistory) pushHistory("assistant", parsed.text);
    return parsed;
  } catch (err) {
    if (options.abortSignal?.aborted) {
      return { text: "", emotion: "neutral", aborted: true };
    }
    console.error("[agent] LLM turn failed, using offline reply:", err);
    emit({ type: "error", message: `Assistant brain error: ${String(err)}` });
    const reply = offlineReply(input);
    if (recordHistory) pushHistory("assistant", reply.text);
    return reply;
  }
}

/** Heuristic helper tests / future guidance injection after async tool turns. */
export function injectGuidance(summary: string): void {
  const text = summary.replace(/\s+/g, " ").trim();
  if (!text) return;
  pushHistory("assistant", `[context] ${text}`);
}
