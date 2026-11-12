/** One short opening, chosen by UI language without fixing recognition language. */
import type { Language } from "@shared/protocol";

const WELCOME: Record<Language, string> = {
  zh: "你好，我是小海，你的家庭助手。今天想让我帮你做点什么？",
  en: "Hi, I'm Hai, your home assistant. What can I help you with today?",
}; // Only the opening follows the UI; subsequent turns follow the user's spoken language.

/**
 * Return the actual Voice Live session-start greeting configuration.
 *
 * Parameters
 * ----------
 * language : Language
 *     Initial UI language, not a recognizer or future-turn language constraint.
 *
 * Returns
 * -------
 * object
 *     Native template greeting with no fixed recognition locale.
 */
export function homeGreeting(language: Language): {
  type: "template";
  text: string;
} {
  return {
    type: "template",
    text: WELCOME[language],
  };
}
