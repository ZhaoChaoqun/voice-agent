import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const allowed = new Set(["index.html", "styles.css", "app.mjs", "calculator.mjs", "prices.json", "favicon.svg"]);
const mime = { html: "text/html", css: "text/css", mjs: "text/javascript", json: "application/json", svg: "image/svg+xml" };
const port = Number(process.env.PORT || 8095);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be an integer from 1 to 65535.");
const server = createServer(async (req, res) => {
  let path;
  try {
    path = new URL(req.url, "http://localhost").pathname;
  } catch (error) {
    if (error.code !== "ERR_INVALID_URL") throw error;
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }).end("Bad request");
    return;
  }
  const file = path === "/" ? "index.html" : path.slice(1);
  if (!["GET", "HEAD"].includes(req.method) || !allowed.has(file)) {
    res.writeHead(404).end("Not found");
    return;
  }
  try {
    const content = await readFile(fileURLToPath(new URL(file, import.meta.url)));
    res.writeHead(200, {
      "Content-Type": `${mime[file.split(".").at(-1)]}; charset=utf-8`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
    });
    res.end(req.method === "HEAD" ? undefined : content);
  } catch (error) {
    console.error(`Failed to serve ${file}:`, error.message);
    res.writeHead(500).end("Unable to read calculator asset. See server log.");
  }
});
server.on("error", error => {
  console.error(`Calculator server failed: ${error.message}`);
  process.exitCode = 1;
});
server.listen(port, "127.0.0.1", () => console.log(`Voice Agent Cost Lab: http://127.0.0.1:${port}`));
