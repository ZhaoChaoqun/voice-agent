/** Exact-origin validation happens before the local proxy rewrites credentials. */
import type { IncomingHttpHeaders } from "node:http";

/**
 * Accept only the dedicated fourth edition's same-origin mutations/upgrades.
 *
 * Parameters
 * ----------
 * headers : IncomingHttpHeaders
 *     Original browser headers, before proxy rewriting.
 *
 * Returns
 * -------
 * boolean
 *     Whether host and origin identify the same V4 loopback endpoint.
 */
export function validOrigin(headers: IncomingHttpHeaders): boolean {
  if (!headers.host || headers.origin !== `http://${headers.host}`)
    return false;
  try {
    const url = new URL(headers.origin);
    return (
      url.protocol === "http:" &&
      ["127.0.0.1", "localhost"].includes(url.hostname) &&
      /^\d{1,5}$/.test(url.port) &&
      Number(url.port) <= 65_535
    );
  } catch {
    return false;
  }
}
