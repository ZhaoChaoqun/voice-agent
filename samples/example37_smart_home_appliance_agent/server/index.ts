/** Start the single-port local demo; credentials and upstream tools stay server-side. */
import "dotenv/config";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { createDemoServer } from "#server/app";
import { runtimeConfig } from "#server/config";
import { HomeStore } from "#server/home";
import { KnowledgeStore } from "#server/knowledge";
import { CloudAccess, cloudOptions } from "#server/cloud";

const DEFAULT_PORT = 5178; // Single browser/API/Voice relay port for this isolated sample.
const root = fileURLToPath(new URL("../", import.meta.url));
const port = Number(process.env.PORT ?? DEFAULT_PORT);
const host = process.env.HOST ?? "127.0.0.1";
const cloud = cloudOptions(process.env, resolve(root, "knowledge"));
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("PORT must be a valid TCP port.");
if (!cloud && host !== "127.0.0.1" && host !== "localhost" && host !== "::1")
  throw new Error(
    "This single-household demo must bind to a loopback interface.",
  );

const demo = createDemoServer({
  config: runtimeConfig(),
  home: new HomeStore(
    resolve(
      root,
      process.env.SMART_HOME_LOCAL_STATE_PATH ?? ".azure/home.json",
    ),
  ),
  knowledge: new KnowledgeStore(),
  cloud: cloud ? new CloudAccess(cloud) : undefined,
});

if (process.env.NODE_ENV === "production") {
  const webRoot = resolve(root, process.env.SMART_HOME_WEB_ROOT ?? "dist");
  demo.app.use(express.static(webRoot));
  demo.app.get("/{*path}", (_request, response) =>
    response.sendFile(resolve(webRoot, "index.html")),
  );
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    root,
    server: { middlewareMode: true, hmr: { server: demo.server } },
    appType: "spa",
  });
  demo.app.use(vite.middlewares);
  process.once("SIGTERM", () => void vite.close());
  process.once("SIGINT", () => void vite.close());
}

demo.server.on("error", (error: NodeJS.ErrnoException) => {
  console.error(
    error.code === "EADDRINUSE"
      ? `Port ${port} is already in use; the existing service was not changed.`
      : "The local demo server could not start.",
  );
  demo.close();
  process.exitCode = 1;
});
demo.server.listen(port, host, () =>
  console.info(`Smart Home simulated home: http://${host}:${port}`),
);
process.once("SIGTERM", demo.close);
process.once("SIGINT", demo.close);
