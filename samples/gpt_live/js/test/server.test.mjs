// Offline server tests: a real HTTP server, and the real Projects SDK talking to an in-memory
// project. The server prepares agents, serves the page, and gives its own page access tokens.
import assert from "node:assert/strict";
import http from "node:http";
import { describe, it } from "node:test";

import { TOKEN_SCOPE, main } from "../server.mjs";
import { MCP_SERVER_URL } from "../tools.mjs";
import { ENDPOINT, ENV, OfflineProject, clientOptions } from "./offline.mjs";

/**
 * Starts the sample on a free port with offline stand-ins. After startup, the credential
 * records the scopes the page's token requests ask for and can be made to fail.
 */
async function start({ argv = [], project = new OfflineProject(), env = {} } = {}) {
  const scopes = [];
  let started = false;
  const credential = {
    failure: undefined,
    getToken: async (scope) => {
      if (started) {
        scopes.push(scope);
        if (credential.failure) throw credential.failure;
      }
      return { token: "offline-test-token", expiresOnTimestamp: 1234 };
    },
  };
  const lines = [];
  const running = await main({
    argv: [...argv, "--port", "0"],
    env: { ...ENV, ...env },
    credential,
    clientOptions: clientOptions(project),
    log: (line) => lines.push(line),
  });
  started = true;
  return { running, project, lines, scopes, credential };
}

/** Runs `test` against a started sample and always stops it. */
async function withServer(options, test) {
  const context = await start(options);
  try {
    await test(context);
  } finally {
    await context.running.stop();
  }
}

/** Sends a request with exact headers, which fetch would add to or refuse. */
function request(port, path, { method = "GET", headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const outgoing = http.request({ host: "127.0.0.1", port, path, method, headers }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => (body += chunk));
      response.on("error", reject);
      response.on("end", () => resolve({ status: response.statusCode, type: response.headers["content-type"], body }));
    });
    outgoing.setTimeout(5000, () => outgoing.destroy(new Error("Request timed out")));
    outgoing.on("error", reject);
    outgoing.end();
  });
}

/** The headers a browser sends for the page's own fetch("/token", { method: "POST" }). */
const ownPage = (port, host = "localhost") => ({
  host: `${host}:${port}`,
  origin: `http://${host}:${port}`,
  "sec-fetch-site": "same-origin",
});

describe("HTTP surface", () => {
  it("rejects malformed targets without losing subsequent page, config, or token requests", () =>
    withServer({}, async ({ running: { port }, scopes }) => {
      for (const target of ["//[", "//%zz", "http://[", "http://localhost:bad/"]) {
        for (const method of ["GET", "POST"]) {
          const bad = await request(port, target, { method });
          assert.equal(bad.status, 400, `${method} ${target}`);
          assert.equal(bad.body, "Bad request");
          assert.equal(bad.type, "text/plain");
          assert.equal((await request(port, "/?value=%5B%20%25")).status, 200);
          const config = await request(port, "/config?value=%5B%20%25");
          assert.equal(config.status, 200);
          assert.equal(JSON.parse(config.body).endpoint, ENDPOINT);
        }
      }
      assert.deepEqual(scopes, []);
      for (const path of ["/missing%20file", "/%63onfig"]) {
        assert.equal((await request(port, path)).status, 404, path);
      }
      assert.equal((await request(port, "/token", { method: "POST" })).status, 403);
      assert.deepEqual(scopes, []);
      const token = await request(port, "/token?value=%5B%20%25", { method: "POST", headers: ownPage(port) });
      assert.equal(token.status, 200);
      assert.equal(JSON.parse(token.body).token, "offline-test-token");
      assert.deepEqual(scopes, [TOKEN_SCOPE]);
    }));

  it("serves the page, the bundled page script, and the agent configuration", async () => {
    const { running, project } = await start();
    const { port } = running;
    const page = await request(port, "/");
    assert.equal(page.status, 200);
    assert.match(page.body, /GPT Live English teacher/);
    // The lesson inputs and the typed-message box.
    for (const id of ["learner-name", "level", "typed", "send"]) assert.ok(page.body.includes(`id="${id}"`), id);
    // The page script bundles the SDK's Live client and the browser transport.
    const script = await request(port, "/app.js");
    assert.equal(script.status, 200);
    assert.match(script.type, /text\/javascript/);
    assert.ok(script.body.includes("authorization.bearer.") && script.body.includes("foundry_features"));
    // The page answers client delegations and runs the managed agent's local function.
    assert.ok(script.body.includes("Client delegation") && script.body.includes("get_current_datetime"));
    assert.ok(!script.body.includes('from "ws"'));
    // The SDK's browser build, without the OpenAI SDK that its unused AIProjectClient imports.
    assert.ok(!/api.openai.com|class OpenAI/.test(script.body));
    assert.ok(script.body.length < 400_000, `bundle is ${script.body.length} bytes`);
    for (const path of ["/pcm-capture.js", "/style.css"]) assert.equal((await request(port, path)).status, 200, path);
    for (const path of ["/live-session.js", "/server.mjs", "/../agents.mjs", "/%2e%2e/agents.mjs", "/package.json"]) {
      assert.equal((await request(port, path)).status, 404, path);
    }
    const config = JSON.parse((await request(port, "/config")).body);
    assert.match(config.downloader, /download_conversation_artifacts\.py$/);
    assert.deepEqual(
      { ...config, downloader: undefined },
      {
        endpoint: ENDPOINT,
        agent: {
          name: project.created[0].name, version: "3", managedDelegation: false, clientDelegation: false,
          backendModel: "text-model", inputs: ["learner_name", "level"],
        },
        delegation: "Responses",
        levels: ["beginner", "intermediate", "advanced"],
        defaultLevel: "intermediate",
        downloader: undefined,
      },
    );
    await running.stop();
  });

  it("gives its own page an access token for Foundry", () =>
    withServer({}, async ({ running, lines, scopes }) => {
      for (const host of ["localhost", "127.0.0.1"]) {
        const response = await request(running.port, "/token", { method: "POST", headers: ownPage(running.port, host) });
        assert.equal(response.status, 200);
        assert.deepEqual(JSON.parse(response.body), { token: "offline-test-token", expiresOnTimestamp: 1234 });
      }
      assert.deepEqual(scopes, [TOKEN_SCOPE, TOKEN_SCOPE]);
      assert.ok(lines.includes("Gave the page an access token for a GPT Live session."));
    }));

  it("refuses tokens to other sites, rebinding hosts, and plain GET requests", () =>
    withServer({}, async ({ running: { port }, scopes }) => {
      for (const headers of [
        { ...ownPage(port), origin: "https://example.com", "sec-fetch-site": "cross-site" },
        { ...ownPage(port), "sec-fetch-site": "same-site" },
        { host: `localhost:${port}` },
        // DNS rebinding: another name that resolves to this server.
        { host: `attacker.example:${port}`, origin: `http://attacker.example:${port}`, "sec-fetch-site": "same-origin" },
      ]) {
        assert.equal((await request(port, "/token", { method: "POST", headers })).status, 403, JSON.stringify(headers));
      }
      assert.equal((await request(port, "/token", { headers: ownPage(port) })).status, 404);
      assert.deepEqual(scopes, []);
    }));

  it("tells the page to run az login when the credential fails", () =>
    withServer({}, async ({ running, credential }) => {
      credential.failure = Object.assign(new Error("Please run az login."), { name: "CredentialUnavailableError" });
      const response = await request(running.port, "/token", { method: "POST", headers: ownPage(running.port) });
      assert.equal(response.status, 500);
      assert.match(response.body, /Run az login/);
    }));

  it("has no Live relay", () =>
    withServer({}, async ({ running }) => {
      const upgrade = await request(running.port, "/live", {
        headers: { connection: "Upgrade", upgrade: "websocket", "sec-websocket-version": "13", "sec-websocket-key": "dGVzdA==" },
      }).catch((error) => error);
      assert.ok(upgrade instanceof Error || upgrade.status === 404);
    }));
});

describe("agent lifecycle", () => {
  it("creates a client-delegation agent with --client, ignoring AGENT_NAME", async () => {
    const project = new OfflineProject({ teacher: { version: "5", definition: {} } });
    const { running } = await start({ argv: ["--client", "--auto-delete"], project, env: { AGENT_NAME: "teacher" } });
    const config = JSON.parse((await request(running.port, "/config")).body);
    await running.stop();
    const [agent] = project.created;
    assert.deepEqual(agent.definition.delegation, { type: "client" });
    assert.equal(config.delegation, "Client (this page answers the time and addition)");
    assert.deepEqual(config.agent, {
      name: agent.name, version: "3", managedDelegation: false, clientDelegation: true,
      backendModel: "this page", inputs: ["learner_name", "level"],
    });
    assert.deepEqual(project.deleted, [agent.name]);
  });

  it("refuses --managed together with --client before creating anything", async () => {
    const project = new OfflineProject();
    await assert.rejects(start({ argv: ["--managed", "--client"], project }), /either --managed or --client/);
    assert.deepEqual(project.created, []);
  });

  it("keeps agents by default and offers the download command", async () => {
    const { running, project, lines } = await start();
    await running.stop();
    assert.deepEqual(project.deleted, []);
    assert.ok(lines.some((line) => line.startsWith("Kept agent: ")));
  });

  it("deletes only this run's agents with --auto-delete and offers no download command", async () => {
    const { running, project } = await start({ argv: ["--auto-delete"] });
    const config = JSON.parse((await request(running.port, "/config")).body);
    await running.stop();
    assert.equal(config.downloader, null);
    assert.deepEqual(project.deleted, [project.created[0].name]);
  });

  it("creates the tools prompt agent and a GPT Live agent pinned to it with --managed", async () => {
    const { running, project } = await start({ argv: ["--managed", "--auto-delete"] });
    const config = JSON.parse((await request(running.port, "/config")).body);
    await running.stop();
    const [prompt, voice] = project.created;
    assert.deepEqual(prompt.definition.tools.map((tool) => tool.type), ["mcp", "function"]);
    assert.equal(prompt.definition.tools[0].server_url, MCP_SERVER_URL);
    assert.match(voice.definition.instructions, /MCP calculator and a client-computer clock function/);
    assert.match(config.delegation, /MCP calculator, local date\/time function/);
    assert.deepEqual(config.agent, {
      name: voice.name, version: "3", managedDelegation: true, clientDelegation: false,
      backendModel: `${prompt.name}:7`, inputs: ["learner_name", "level"],
    });
    assert.deepEqual(project.deleted, [voice.name, prompt.name]);
  });
});
