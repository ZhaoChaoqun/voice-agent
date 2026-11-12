/** Trusted loopback API selection for independent local frontend previews. */

/**
 * Validate a developer-configured backend without accepting browser destinations.
 *
 * Parameters
 * ----------
 * value : string | undefined
 *     Server-side development setting; omitted means the original local backend.
 *
 * Returns
 * -------
 * string
 *     Exact loopback HTTP origin.
 *
 * Raises
 * ------
 * Error
 *     If a destination includes credentials, a path or a non-loopback host.
 */
export function localBackend(value: string | undefined): string {
  const url = new URL(value ?? "http://127.0.0.1:5178");
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new Error(
      "HAIER_LOCAL_BACKEND must be an exact http://127.0.0.1:<port> origin.",
    );
  return url.origin;
}
