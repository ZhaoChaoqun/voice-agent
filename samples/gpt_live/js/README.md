# Foundry GPT Live in the browser with the Azure AI Projects SDK for JavaScript

A simple browser version of the [Python GPT Live samples](../python/README.md): talk to an
English-teacher GPT Live agent with your microphone, hear the teacher's reply, and watch the
GPT Live, Delegation, and You panes update.

The page connects to GPT Live directly. It opens the agent's Live WebSocket with the preview
`@azure/ai-projects` package's Live client (`VoiceAgentLiveClient.connect(...)`, the class behind
`project.beta.voiceAgents.live`), streams microphone audio, and plays the teacher's audio. No
audio or Live events pass through a server. A small local Node.js server does the rest: it creates
or reuses the agents through `AIProjectClient.agents`, serves the page, and gives the page an
access token from your `az login` session.

The GPT Live APIs are not in an npm release yet, so `package.json` installs the bundled
preview package `dist/azure-ai-projects-2.10.0.tgz`; see
[`dist/README.md`](../../../dist/README.md) for its source and checksum.
Azure Identity is pinned to `4.14.1`, which requires patched MSAL Node `7.1.0`
or later for [GHSA-xcx6-jx8p-x3h5](https://github.com/AzureAD/microsoft-authentication-library-for-js/security/advisories/GHSA-xcx6-jx8p-x3h5).
This sample uses Azure CLI authentication rather than the affected authorization-code flow.

## Files

| File | Description |
| --- | --- |
| `server.mjs` | Prepares the agents, serves the page on `127.0.0.1`, answers the page's token requests, and cleans up on Ctrl+C. |
| `agents.mjs` | Settings, agent definitions, and the create/reuse/delete lifecycle, mirroring the Python samples. |
| `tools.mjs` | The managed prompt agent's tool definitions: an MCP calculator and a local `get_current_datetime` function. |
| `browser_bundle.mjs` | Bundles `public/app.js` and the SDK into the page's `/app.js` with esbuild when the server starts. |
| `public/app.js` | The page: microphone in, teacher audio out, and the three panes. |
| `public/live-transport.js` | Opens the Live session with the SDK over a browser WebSocket transport that signs in with a subprotocol (see below). |
| `public/live-session.js` | Turns Live events into pane updates, as the Python samples do for their panes, and streams microphone audio. |
| `public/local-tools.js` | Runs `get_current_datetime` in the page and returns its results to the prompt agent. |
| `public/` (other) | `index.html`, `pcm-audio.js` (Web Audio capture and playback), `pcm-capture.js` (AudioWorklet), and `style.css`. |
| `test/` | Offline agent, session, tool, transport, and server tests. |
| `package.json` / `package-lock.json` | Dependencies, including the bundled preview `@azure/ai-projects` package. |

## How to run

Requires Node.js 22+, Azure CLI, Chrome or Edge, a microphone (headphones recommended), and a
Foundry project with the Voice Agents / GPT Live preview, a GPT Live deployment, and a
Responses deployment. Configure the shared `samples/gpt_live/.env` as described in
[`../README.md`](../README.md), then from this folder:

```powershell
npm ci
npm start
```

`npm ci` installs the bundled package from `../../../dist` (the path is relative to
`package.json`). The patched Azure Identity and MSAL packages resolve through
Microsoft's anonymously accessible `npm-public` feed because these versions are
not yet available on npmjs. Other packages retain their public npm registry URLs;
npm uses your configured registry for those URLs when you have one.

Open the printed address, `http://localhost:8080`, click **Start**, allow the microphone,
and wait for **Ready**. Then ask, for example, **"Please correct my English: I goed to school
yesterday. Explain why."** Click **Stop** to end the lesson; the page shows the session's
close reason, Live usage, and Foundry conversation ID. Each **Start** opens a new session.
Press **Ctrl+C** in the terminal to stop the server.

### Responses delegation (default)

`npm start` creates an English-teacher GPT Live agent with Responses delegation and
`store: true`, or reuses `AGENT_NAME` without creating, updating, or deleting it. The
Delegation pane shows each delegation's status and the Responses backend's guidance, which is
separate from what the teacher says. A client-target delegation receives commentary tied to
its ID; a backend failure ends the session with an error.

### Managed prompt-agent delegation with MCP and local function tools

```powershell
npm run managed
```

This is the browser version of the Python
[managed prompt agent with MCP and local function tools](../python/README.md#managed-prompt-agent-with-mcp-and-local-function-tools).
It creates two fresh agents and ignores `AGENT_NAME`: an English-teacher prompt agent with a
`[commentary]`/`[thinking]` tagged-text contract and two tools, then a GPT Live voice agent
pinned to the prompt agent's exact returned version with `"type": "foundry_managed_agent"`.

- **MCP calculator:** the public, unauthenticated
  `https://voice-mcp-auth-tests.graysky-8afcdfd2.eastus2.azurecontainerapps.io/noauth/mcp`
  server, exposing only `add(a, b)` for integers, with `require_approval: "never"`. Foundry
  calls it directly. This test endpoint is not a production dependency.
- **`get_current_datetime`:** a local function that the page runs. It returns the browser
  computer's local time, IANA timezone, and UTC time as ISO 8601 timestamps with offsets, and
  takes no arguments.

Try **"What is 17 plus 25?"**, **"What is the current date and time?"**, or **"Please correct
my English: I goed to school yesterday."** Foundry runs the prompt agent and forwards accepted
guidance; the page streams audio and shows events:

- `session.delegation.created` with `target: "foundry_managed_agent"` reports Foundry's
  ownership. Native `client` or `responses` targets end the session, with no fallback executor.
- The prompt agent's Responses stream arrives as `response.event` with that delegation ID; the
  Delegation pane shows its status and raw tagged-text output.
- Each `session.commentary.appended` or `session.thinking.appended` marks the latest
  delegation's accepted guidance as forwarded to GPT Live. Backend failures stay visible
  without ending the session.
- When the prompt agent calls `get_current_datetime`, the page collects the completed
  `function_call` items from `response.event`, waits for `response.completed`, sends each
  `function_call_output` with `response.item.create`, then sends one `response.create` to resume
  the same managed delegation. The Delegation pane briefly shows **Managed prompt-agent tools:
  Local function results sent**. MCP calls run on the service and are never executed locally.

The page answers local function calls in every managed session, including an `AGENT_NAME`
agent with managed delegation; it answers unknown functions with an error result.

### How the page signs in to GPT Live

Browsers cannot set headers on a WebSocket handshake, so the page cannot send the usual
`Authorization: Bearer` and `Foundry-Features: VoiceAgents=V1Preview` headers. Instead:

1. When a session starts, the SDK asks its credential for a token. The page's credential calls
   `POST /token` on the local server, which returns an access token for
   `https://ai.azure.com/.default` from your `az login` session (`AzureCliCredential`).
2. `public/live-transport.js` passes the SDK a WebSocket transport through the public
   `webSocketFactory` option. It offers two subprotocols, `live` and
   `authorization.bearer.<token>`. For the Live session route, Foundry turns the second offer into
   an `Authorization` header before authentication, then selects and echoes only `live`. The
   transport fails the session if Foundry selects anything else.
3. The page uses `api-version=2025-11-15-preview`, which enables the Voice Agents preview
   without the `Foundry-Features` header. With `api-version=v1` and no header, Foundry returns
   HTTP 403.

The token stays in the page's memory for that one handshake. The server listens on `127.0.0.1`
only and answers `POST /token` only when the request's `Host` and `Origin` are its own
`localhost` or `127.0.0.1` address, so other websites, including ones that rebind their DNS name
to `127.0.0.1`, cannot get a token. This suits a local development sample; a hosted app would
sign users in with their own identity, for example with MSAL.js.
Request targets that cannot be parsed as URLs receive HTTP 400 without stopping
the server or requesting a token. Later valid requests still work, and token
requests must still pass the same-origin checks.

#### Why the sample supplies its own WebSocket transport

Besides signing in, the transport lets the page return local function results. This preview JS
SDK refuses `response.item.create` and `response.create` unless the session uses Responses
delegation (`Responses commands require a Responses delegation.`), so `sendToolOutput` cannot
return a function result in a managed session. The service accepts these commands in managed
mode, and the Python SDK sends them. So `openLiveSession` keeps a handle on its transport and
sends the two commands on it directly. Everything else, including the handshake, the token
request, and event parsing, goes through the SDK.

The SDK package targets Node.js, so `browser_bundle.mjs` bundles the page with esbuild and
replaces the Node-only modules it never uses in the page (its `ws` transport, proxy agent, and
file helpers) with empty stubs.

### Keeping or deleting agents

Agents created by the server are kept when it stops, so you can reconnect or download
conversations later; after each session the page shows a command for the shared Python
[`download_conversation_artifacts.py`](../../download_conversation_artifacts.py). Add
`-- --auto-delete` (for example `npm start -- --auto-delete`) to delete only the agents this
run created when you press Ctrl+C, voice agent first. Use `-- --port 9000` to change the port.

## Tests

Run the offline tests (no Azure resources, browser, or audio devices). They drive the real
Projects SDK client: the server's agent calls go to an in-memory HTTP client, and the page's
Live sessions talk to a scripted WebSocket transport. The browser transport runs on Node.js's
built-in WebSocket against a local `ws` server.
HTTP regressions cover malformed request targets followed by valid page,
configuration, and same-origin token requests.

```powershell
npm test
```
