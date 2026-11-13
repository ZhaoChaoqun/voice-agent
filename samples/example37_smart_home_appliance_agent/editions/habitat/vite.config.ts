/** Habitat shares the classic backend without duplicating tool authority. */
import { fileURLToPath, URL } from "node:url";

import react from "@vitejs/plugin-react";
import {
  defineConfig,
  loadEnv,
  type Plugin,
  type PreviewServer,
  type ProxyOptions,
  type ViteDevServer,
} from "vite";

import { validOrigin } from "./src/origin";
import { localBackend } from "../../shared/dev-backend";

const fileEnvironment = loadEnv(
  "development",
  fileURLToPath(new URL(".", import.meta.url)),
  "SMART_HOME_",
);
const BACKEND = localBackend(
  process.env.SMART_HOME_LOCAL_BACKEND ??
    fileEnvironment.SMART_HOME_LOCAL_BACKEND,
); // Developer-controlled loopback setting; browsers cannot choose destinations.
const aliases = {
  "@habitat": fileURLToPath(new URL("./src", import.meta.url)),
  "@v2": fileURLToPath(new URL("../modern/src", import.meta.url)),
  "@shared": fileURLToPath(new URL("../../shared", import.meta.url)),
  "@": fileURLToPath(new URL("../../src", import.meta.url)),
};

const api: ProxyOptions = {
  target: BACKEND,
  ws: true,
  changeOrigin: true,
  configure(proxy) {
    proxy.on("proxyReq", (request) => request.setHeader("Origin", BACKEND));
    proxy.on("proxyReqWs", (request) => request.setHeader("Origin", BACKEND));
    proxy.on("error", (error) =>
      console.error("Habitat backend connection failed:", error.message),
    );
  },
};

function guardServer(server: ViteDevServer | PreviewServer): void {
  server.middlewares.use((request, response, next) => {
    if (
      request.url?.startsWith("/api") &&
      request.method !== "GET" &&
      !validOrigin(request.headers)
    ) {
      response.writeHead(403).end("A same-origin request is required.");
      return;
    }
    next();
  });
  server.httpServer?.prependListener("upgrade", (request, socket) => {
    if (request.url?.startsWith("/api") && !validOrigin(request.headers))
      socket.destroy();
  });
}

function originGuard(): Plugin {
  return {
    name: "habitat-loopback-origin",
    configureServer: guardServer,
    configurePreviewServer: guardServer,
  };
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
