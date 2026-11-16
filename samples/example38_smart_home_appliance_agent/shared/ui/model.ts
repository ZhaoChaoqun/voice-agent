/** Select only supported, explicitly available Voice Agent models. */
import { VOICE_MODEL_IDS } from "@shared/protocol";

/** Prefer Microsoft Realtime Flash without advertising an unavailable backend configuration. */
export function defaultModel(
  models: readonly { id: string; available: boolean }[],
): string {
  for (const preferred of VOICE_MODEL_IDS) {
    const match = models.find(
      (option) => option.id === preferred && option.available,
    );
    if (match) return match.id;
  }
  return "";
}
