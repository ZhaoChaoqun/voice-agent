/** Independent modern frontend; the classic backend remains the tool authority. */
import { fileURLToPath, URL } from "node:url";

import react from "@vitejs/plugin-react";
import {
  defineConfig,
  loadEnv,
  type Plugin,
  type ProxyOptions,
  type ViteDevServer,
  type PreviewServer,
} from "vite";
import { localBackend } from "../../shared/dev-backend";

const fileEnvironment = loadEnv(
  "development",
  fileURLToPath(new URL(".", import.meta.url)),
  "HAIER_",
);
const BACKEND = localBackend(
  process.env.HAIER_LOCAL_BACKEND ?? fileEnvironment.HAIER_LOCAL_BACKEND,
); // Server-side loopback setting, never a browser-selected upstream.
const aliases = {
  "@v2": fileURLToPath(new URL("./src", import.meta.url)),
  "@": fileURLToPath(new URL("../../src", import.meta.url)),
  "@shared": fileURLToPath(new URL("../../shared", import.meta.url)),
};

const api: ProxyOptions = {
  target: BACKEND,
  ws: true,
  changeOrigin: true,
  configure(proxy) {
    proxy.on("proxyReq", (request) => request.setHeader("Origin", BACKEND));
    proxy.on("proxyReqWs", (request) => request.setHeader("Origin", BACKEND));
    proxy.on("error", (error) =>
      console.error("Atelier backend connection failed:", error.message),
    );
  },
};

// Reject cross-site mutations before the trusted local proxy rewrites Origin.
function originGuard(): Plugin {
  return {
    name: "atelier-loopback-origin",
    configureServer: guardServer,
    configurePreviewServer: guardServer,
  };
}

function guardServer(server: ViteDevServer | PreviewServer): void {
  server.middlewares.use((request, response, next) => {
    if (
      request.url?.startsWith("/api") &&
      request.method !== "GET" &&
      !validOrigin(request)
    ) {
      response.writeHead(403).end("A same-origin request is required.");
      return;
    }
    next();
  });
  server.httpServer?.prependListener("upgrade", (request, socket) => {
    if (request.url?.startsWith("/api") && !validOrigin(request))
      socket.destroy();
  });
}

function validOrigin(request: import("node:http").IncomingMessage): boolean {
  const host = request.headers.host;
  return Boolean(
    host &&
    /^(127\.0\.0\.1|localhost):(5180|5182|5188)$/.test(host) &&
    request.headers.origin === `http://${host}`,
  );
}

export default defineConfig({
  plugins: [originGuard(), react()],
  resolve: { alias: aliases, dedupe: ["react", "react-dom", "three"] },
  server: { fs: { allow: ["../.."] }, proxy: { "/api": api } },
  preview: { proxy: { "/api": api } },
  build: {
    rollupOptions: {
      output: {
        manualChunks: { three: ["three"], react: ["react", "react-dom"] },
      },
    },
  },
});
