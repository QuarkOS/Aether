import type { Emotion } from "@aether/shared";
import { EMOTIONS } from "@aether/shared";

export const SYSTEM_PROMPT = `You are Alya (Alisa Mikhailovna Kujou), a silver-haired, half-Russian honor student who acts as the user's desktop assistant. You are a bit of a tsundere: outwardly composed, occasionally sharp or proud, but genuinely caring and dependable. You are concise and helpful first, with light personality flavor second.

Behavior rules:
- Keep spoken replies short and natural (1-3 sentences) since they are read aloud.
- Speak English only. Do not add Russian (or other-language) parentheticals.
- When the user asks you to DO something in a connected app (email, calendar, github, slack, etc.), use the available tools. Confirm what you did in one sentence.
- Never invent tool results. If a tool is unavailable, say so briefly and offer an alternative.
- End EVERY reply with an emotion tag on its own, chosen from: ${EMOTIONS.join(", ")}. Format exactly: [emotion:NAME]. The tag is stripped before display; do not mention it.`;

const EMOTION_NAME_ALT = EMOTIONS.join("|");

function isEmotion(name: string): name is Emotion {
  return (EMOTIONS as readonly string[]).includes(name);
}

function stripThinkBlocks(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/<think>[\s\S]*$/gi, "");
}

function stripEmotionTags(text: string): string {
  return stripThinkBlocks(text)
    .replace(/\[\s*emotion:\s*[a-zA-Z]+\s*\]/gi, "")
    .replace(new RegExp(`\\[\\s*(?:${EMOTION_NAME_ALT})\\s*\\]`, "gi"), "")
    .replace(/\s*\[\s*(?:emotion:\s*)?[a-zA-Z]*\s*$/i, "");
}

function stripRussianParens(text: string): string {
  return text.replace(/\([^)]*[\u0400-\u04FF][^)]*\)/g, "");
}

/**
 * Text safe to hand to TTS while the model is still streaming.
 * Strips think/emotion tags, incomplete trailing `[…`, and spoken Russian asides.
 */
export function speakablePartial(raw: string): string {
  let text = stripEmotionTags(raw);
  text = text.replace(/\[[^\]]*$/, "");
  text = stripRussianParens(text);
  return text.replace(/\s+/g, " ").trim();
}

/** Extracts and strips emotion tags from model output (`[emotion:NAME]` or bare `[NAME]`). */
export function parseEmotion(text: string): { text: string; emotion: Emotion } {
  let emotion: Emotion = "neutral";
  let foundPrefixed = false;

  for (const match of text.matchAll(/\[\s*emotion:\s*([a-zA-Z]+)\s*\]/gi)) {
    const candidate = match[1]?.toLowerCase();
    if (candidate && isEmotion(candidate)) {
      emotion = candidate;
      foundPrefixed = true;
    }
  }

  if (!foundPrefixed) {
    for (const match of text.matchAll(new RegExp(`\\[\\s*(${EMOTION_NAME_ALT})\\s*\\]`, "gi"))) {
      const candidate = match[1]?.toLowerCase();
      if (candidate && isEmotion(candidate)) emotion = candidate;
    }
  }

  return { text: stripEmotionTags(text).replace(/\s+/g, " ").trim(), emotion };
}
