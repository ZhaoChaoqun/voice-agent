const PREFERRED_MODELS = [
  "microsoft-realtime-flash-1",
  "microsoft-realtime-flash",
  "gpt-realtime-2.1-mini",
];

/** Prefer Microsoft Realtime Flash without advertising an unavailable backend configuration. */
export function defaultModel(
  models: readonly { id: string; available: boolean }[],
): string {
  for (const preferred of PREFERRED_MODELS) {
    const match = models.find(
      (option) => option.id === preferred && option.available,
    );
    if (match) return match.id;
  }
  return models.find((option) => option.available)?.id ?? "";
}
