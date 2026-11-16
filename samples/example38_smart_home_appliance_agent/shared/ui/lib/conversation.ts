/** Small, deterministic event reducers for streamed conversation text. */
export interface Transcript {
  id: string;
  role: "user" | "assistant";
  text: string;
  final: boolean;
}

// Bound visible history for long-running showroom sessions.
const HISTORY_LIMIT = 80;

/** Merge a streamed delta or an authoritative final transcript by item id. */
export function updateTranscript(
  messages: Transcript[],
  update: {
    id: string;
    role: Transcript["role"];
    text: string;
    final: boolean;
  },
): Transcript[] {
  const existing = messages.find((message) => message.id === update.id);
  if (!existing) return [...messages, update].slice(-HISTORY_LIMIT);
  return messages.map((message) => {
    if (message.id !== update.id) return message;
    return {
      ...update,
      text: update.final ? update.text : message.text + update.text,
    };
  });
}

/** Render model expression markup as speech intent, not visible square-bracket tags. */
export function readableTranscript(value: string): string {
  return value
    .replace(
      /\[(?:neutral|cheerful|friendly|empathetic|reassuring|excited|gentle|laughter|chuckle|warm)\]/gi,
      "",
    )
    .trim();
}

/** Validate untrusted WebSocket JSON before inspecting event fields. */
export function parseEvent(raw: string): Record<string, unknown> {
  const event: unknown = JSON.parse(raw);
  if (
    !event ||
    typeof event !== "object" ||
    !("type" in event) ||
    typeof event.type !== "string"
  ) {
    throw new Error("Invalid realtime event");
  }
  return event as Record<string, unknown>;
}
