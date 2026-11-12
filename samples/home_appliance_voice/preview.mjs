import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const files = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/demo.mjs", ["demo.mjs", "text/javascript; charset=utf-8"]],
  ["/assets/home-scene.png", ["assets/home-scene.png", "image/png"]],
]);
const port = Number(process.env.PORT ?? 8092);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be an integer from 1 to 65535.");
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, "http://127.0.0.1").pathname;
  const entry = files.get(pathname);
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" }).end("Method not allowed");
    return;
  }
  if (!entry) {
    response.writeHead(404).end("Not found");
    return;
  }
  try {
    const body = await readFile(new URL(entry[0], import.meta.url));
    response.writeHead(200, {
      "Content-Type": entry[1],
      "Content-Length": body.length,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    });
    response.end(request.method === "HEAD" ? undefined : body);
  } catch (error) {
    console.error(`Cannot serve ${entry[0]}:`, error);
    response.writeHead(500).end("Preview asset unavailable; see server log.");
  }
});
server.on("error", error => { console.error("Preview server failed:", error.message); process.exitCode = 1; });
server.listen(port, "127.0.0.1", () => console.log(`Home appliance design preview: http://127.0.0.1:${port}`));
