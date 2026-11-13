/** Same-origin requests; service credentials never enter the browser. */
export async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    const detail = extractError(payload);
    throw new Error(detail ?? `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

function extractError(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  if ("message" in payload && typeof payload.message === "string")
    return payload.message;
  if ("error" in payload && typeof payload.error === "string")
    return payload.error;
  return undefined;
}

/** Normalize unexpected failures without hiding a failed operation. */
export function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Unexpected operation failure";
}
