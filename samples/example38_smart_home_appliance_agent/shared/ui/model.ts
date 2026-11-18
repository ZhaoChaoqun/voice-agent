/** Select only supported, explicitly available Voice Agent models. */
import { SUPPORTED_MODEL_IDS } from "@shared/protocol";

/** Prefer Microsoft Realtime Flash; choose GPT Live only when it is the sole available model. */
export function defaultModel(
  models: readonly { id: string; available: boolean }[],
): string {
  for (const preferred of SUPPORTED_MODEL_IDS) {
    const match = models.find(
      (option) => option.id === preferred && option.available,
    );
    if (match) return match.id;
  }
  return "";
}
