/** Prefer Mini without advertising an unavailable backend configuration. */
export function defaultModel(
  models: readonly { id: string; available: boolean }[],
): string {
  return (
    models.find(
      (option) => option.id === "gpt-realtime-2.1-mini" && option.available,
    )?.id ??
    models.find((option) => option.available)?.id ??
    ""
  );
}
