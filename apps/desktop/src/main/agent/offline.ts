import type { Emotion } from "@aether/shared";

/**
 * A tiny rule-based "brain" used when no LLM API key is configured. It keeps
 * the full voice + mascot pipeline demonstrable offline and stays in character.
 */
export function offlineReply(input: string): { text: string; emotion: Emotion } {
  const q = input.toLowerCase().trim();

  if (!q) {
    return { text: "Hm? You didn't say anything. (Ну говори же — well, go on then.)", emotion: "thinking" };
  }
  if (/\b(hi|hello|hey|good morning|good evening|привет)\b/.test(q)) {
    return { text: "Oh, it's you. Privyet. I'm here if you actually need something.", emotion: "smug" };
  }
  if (/\bhow are you|how's it going\b/.test(q)) {
    return { text: "I'm perfectly fine, obviously. More importantly, what do you need?", emotion: "neutral" };
  }
  // Emotional intent is checked before time/date so phrases like "sad today" win.
  if (/\b(stupid|idiot|dumb|shut up|useless|hate you|baka)\b/.test(q)) {
    return { text: "Haah? Say that one more time and see what happens. Durak.", emotion: "angry" };
  }
  if (/\b(sad|depressed|lonely|feel(ing)? down|upset|crying)\b/.test(q)) {
    return { text: "...Hey. Are you alright? I'm right here if you want to talk about it.", emotion: "sad" };
  }
  if (/\b(cute|pretty|beautiful|love you|adorable|gorgeous)\b/.test(q)) {
    return { text: "W-what are you saying all of a sudden?! Honestly…", emotion: "shy" };
  }
  if (/\b(time|what time)\b/.test(q)) {
    return { text: `It's ${new Date().toLocaleTimeString()}. Don't tell me you can't read a clock.`, emotion: "smug" };
  }
  if (/\b(date|what day|today)\b/.test(q)) {
    return { text: `Today is ${new Date().toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" })}.`, emotion: "neutral" };
  }
  if (/\bthank(s| you)\b/.test(q)) {
    return { text: "D-don't get the wrong idea, I only helped because it was convenient.", emotion: "embarrassed" };
  }
  if (/\b(help|what can you do|commands)\b/.test(q)) {
    return {
      text: "I can chat, and once you set an OPENAI_API_KEY or an OpenAI-compatible local server in Settings and connect apps, I can send emails, manage your calendar, or file GitHub issues by voice.",
      emotion: "neutral",
    };
  }
  if (/\b(email|calendar|github|slack|notion)\b/.test(q)) {
    return {
      text: "I'd love to handle that, but no assistant brain or app connection is set up yet. Add an OPENAI_API_KEY, or pick OpenAI-compatible in Settings and point it at a local server, then connect the app.",
      emotion: "sad",
    };
  }
  if (/\b(bye|goodbye|see you|later)\b/.test(q)) {
    return { text: "Leaving already? Fine. Poka — I'll be right here.", emotion: "shy" };
  }
  return {
    text: `You said: "${input}". I'm running without an assistant brain right now, so set OPENAI_API_KEY, pick OpenAI-compatible with a local base URL in Settings, or set Provider to None for offline-only.`,
    emotion: "thinking",
  };
}
