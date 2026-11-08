#!/usr/bin/env node
// Browser GPT Live English teacher. The Node server creates or reuses the agents with the
// Azure AI Projects SDK, serves the page, and gives the page an access token from your az login
// session. The page connects to GPT Live directly with the SDK's Live client; no audio or Live
// events pass through this server.
import { config } from "dotenv";
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import {
  DemoError,
  createProject,
  deleteAgents,
  prepareManagedAgents,
  prepareResponsesAgent,
  projectCredential,
  projectEndpoint,
} from "./agents.mjs";
import { browserBundle } from "./browser_bundle.mjs";
import { toolsPromptAgentDefinition, toolsVoiceAgentDefinition } from "./tools.mjs";

const USAGE = `Usage: node server.mjs [--managed] [--auto-delete] [--port 8080]

  (default)      Create an English-teacher GPT Live agent with Responses delegation,
                 or reuse AGENT_NAME from samples/gpt_live/.env.
  --managed      Create a prompt agent with an MCP calculator and a local date/time function,
                 and a GPT Live agent pinned to it (Foundry-managed delegation).
                 Ignores AGENT_NAME.
  --auto-delete  Delete only the agents created by this run when the server stops.
  --port         Local port (default 8080). The server listens on 127.0.0.1 only.`;

/** The page's GPT Live sessions use access tokens for Foundry. */
export const TOKEN_SCOPE = "https://ai.azure.com/.default";

// Only these files and the bundled /app.js are served; nothing else in the sample is reachable.
const PUBLIC = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/pcm-capture.js": ["pcm-capture.js", "text/javascript; charset=utf-8"],
  "/style.css": ["style.css", "text/css; charset=utf-8"],
};
const PUBLIC_DIR = new URL("./public/", import.meta.url);
const DOWNLOADER = fileURLToPath(new URL("../../download_conversation_artifacts.py", import.meta.url));

/**
 * Whether a request comes from this server's own page: its Host is this server (no DNS
 * rebinding) and its Origin is this server. Other websites must never receive a token.
 */
function fromOwnPage(request, port) {
  const hosts = [`localhost:${port}`, `127.0.0.1:${port}`];
  const site = request.headers["sec-fetch-site"];
  return (
    hosts.includes(request.headers.host) &&
    hosts.some((host) => request.headers.origin === `http://${host}`) &&
    (site === undefined || site === "same-origin")
  );
}

function describeTokenFailure(error) {
  if (["CredentialUnavailableError", "AuthenticationError"].includes(error?.name)) {
    return (
      "Azure CLI authentication failed. Run az login with an account that can access " +
      "this project, and check AZURE_SUBSCRIPTION_ID in .env."
    );
  }
  return `${error?.name ?? "Error"}: ${error?.message ?? error}`;
}

/**
 * Serves the page for `agent`, its configuration, the bundled page script, and access tokens
 * from `credential`. Call listen(port) to start.
 */
export function createServer({ credential, agent, endpoint, keepAgent = true, log = () => {} }) {
  const server = http.createServer(async (request, response) => {
    const send = (status, type, body) => {
      response.writeHead(status, { "content-type": type, "cache-control": "no-store" });
      response.end(body);
    };
    let pathname;
    try {
      pathname = new URL(request.url, "http://localhost").pathname;
    } catch (error) {
      if (error.code !== "ERR_INVALID_URL") throw error;
      send(400, "text/plain", "Bad request");
      return;
    }
    if (request.method === "GET" && pathname === "/config") {
      send(
        200,
        "application/json",
        JSON.stringify({
          endpoint,
          agent: {
            name: agent.name,
            version: agent.version,
            managedDelegation: agent.managedDelegation,
            backendModel: agent.backendModel,
          },
          delegation: agent.tools
            ? "Foundry-managed prompt agent (MCP calculator, local date/time function)"
            : agent.managedDelegation
              ? "Foundry-managed prompt agent"
              : "Responses",
          downloader: keepAgent ? DOWNLOADER : null,
        }),
      );
      return;
    }
    if (request.method === "POST" && pathname === "/token") {
      if (!fromOwnPage(request, server.address().port)) {
        send(403, "text/plain", "Forbidden");
        return;
      }
      try {
        const { token, expiresOnTimestamp } = await credential.getToken(TOKEN_SCOPE);
        log("Gave the page an access token for a GPT Live session.");
        send(200, "application/json", JSON.stringify({ token, expiresOnTimestamp }));
      } catch (error) {
        log(`Access token request failed: ${describeTokenFailure(error)}`);
        send(500, "text/plain", describeTokenFailure(error));
      }
      return;
    }
    if (request.method === "GET" && pathname === "/app.js") {
      send(200, "text/javascript; charset=utf-8", await browserBundle());
      return;
    }
    const file = request.method === "GET" ? PUBLIC[pathname] : undefined;
    if (!file) {
      send(404, "text/plain", "Not found");
      return;
    }
    send(200, file[1], await readFile(new URL(file[0], PUBLIC_DIR)));
  });

  return {
    server,
    listen: (port = 0) =>
      new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => resolve(server.address().port));
      }),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/**
 * Prepares the agents, bundles the page, and starts the server. Tests pass credential and
 * clientOptions (an offline HTTP client); the command line uses az login.
 * Resolves with { port, agent, stop }, where stop() closes the server and cleans up agents.
 */
export async function main({ argv = [], env = process.env, credential, clientOptions, log = console.log } = {}) {
  const { values } = parseArgs({
    args: argv,
    options: {
      managed: { type: "boolean", default: false },
      "auto-delete": { type: "boolean", default: false },
      port: { type: "string", default: "8080" },
      help: { type: "boolean", default: false },
    },
    strict: true,
  });
  if (values.help) {
    log(USAGE);
    return undefined;
  }
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new DemoError("--port must be 0-65535.");
  const autoDelete = values["auto-delete"];
  const endpoint = projectEndpoint(env);
  credential ??= projectCredential(env);
  const project = createProject(endpoint, credential, clientOptions);
  const created = [];
  const cleanup = async () => {
    if (autoDelete) await deleteAgents(project, created, log);
    else for (const name of [...created].reverse()) log(`Kept agent: ${name}. Delete it in your Foundry project when finished.`);
  };

  let agent;
  let app;
  let listening;
  try {
    agent = values.managed
      ? {
          ...(await prepareManagedAgents(project, env, log, created, {
            promptDefinition: toolsPromptAgentDefinition,
            voiceDefinition: toolsVoiceAgentDefinition,
          })),
          tools: true,
        }
      : await prepareResponsesAgent(project, env, log, created);
    await browserBundle();
    app = createServer({ credential, agent, endpoint, keepAgent: !autoDelete || !created.includes(agent.name), log });
    listening = await app.listen(port);
  } catch (error) {
    await cleanup();
    throw error;
  }
  log(`\nOpen http://localhost:${listening} in Chrome or Edge, click Start, and speak. Press Ctrl+C to stop.`);
  return {
    port: listening,
    agent,
    async stop() {
      await app.close();
      await cleanup();
    },
  };
}

async function runCli() {
  config({ path: fileURLToPath(new URL("../.env", import.meta.url)), quiet: true });
  try {
    const running = await main({ argv: process.argv.slice(2), env: process.env });
    if (!running) return;
    process.once("SIGINT", async () => {
      console.log("\nStopping...");
      await running.stop();
    });
  } catch (error) {
    if (error instanceof DemoError || error?.code?.startsWith?.("ERR_PARSE_ARGS")) {
      console.error(`\nError: ${error.message}`);
    } else if (["CredentialUnavailableError", "AuthenticationError"].includes(error?.name)) {
      console.error(`\n${describeTokenFailure(error)}`);
    } else {
      const status = error?.statusCode ? ` (HTTP ${error.statusCode})` : "";
      console.error(`\n${error?.name ?? "Error"}${status}: ${error?.message ?? error}`);
    }
    process.exitCode = 1;
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  await runCli();
}
