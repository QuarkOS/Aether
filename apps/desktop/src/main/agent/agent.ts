import type { AgentEvent, AppConfig, Emotion } from "@aether/shared";

import { getComposioTools } from "./composio.js";
import { offlineReply } from "./offline.js";
import { parseEmotion, SYSTEM_PROMPT } from "./persona.js";

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
  return Boolean(process.env.OPENAI_API_KEY);
}

export interface AgentTurnResult {
  text: string;
  emotion: Emotion;
}

/**
 * Runs one assistant turn. Streams deltas/tool events via `emit` and returns the
 * final cleaned text + emotion. Falls back to an offline brain without a key.
 */
export async function runAgentTurn(
  input: string,
  config: AppConfig,
  emit: (event: AgentEvent) => void,
): Promise<AgentTurnResult> {
  pushHistory("user", input);

  if (!hasLlm(config)) {
    const reply = offlineReply(input);
    emit({ type: "assistant-delta", text: reply.text });
    pushHistory("assistant", reply.text);
    return reply;
  }

  try {
    const { streamText } = await import("ai");
    const { openai } = await import("@ai-sdk/openai");
    const tools = await getComposioTools(config);

    const result = streamText({
      model: openai(config.llm.model || "gpt-4o-mini"),
      system: SYSTEM_PROMPT,
      messages: history.map((m) => ({ role: m.role, content: m.content })),
      tools,
      maxSteps: 5,
    });

    let full = "";
    for await (const part of result.fullStream) {
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

    const finalRaw = full || (await result.text);
    const parsed = parseEmotion(finalRaw);
    pushHistory("assistant", parsed.text);
    return parsed;
  } catch (err) {
    console.error("[agent] LLM turn failed, using offline reply:", err);
    emit({ type: "error", message: `Assistant brain error: ${String(err)}` });
    const reply = offlineReply(input);
    pushHistory("assistant", reply.text);
    return reply;
  }
}
