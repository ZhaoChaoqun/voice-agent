# Smart Home Appliance Voice Agent — Habitat

## Conclusion

Habitat is a source-built frontend for the [smart-home sample](../../README.md).
Its eye-level WebGL interior uses procedurally authored wood, linen, plaster,
and limestone surfaces, physically based materials, ambient occlusion, restrained
bloom, and desktop/mobile rendering budgets. Bilingual controls, scenes,
knowledge, and WebSocket voice reuse the sample's shared UI modules.

## Run locally

Use **Node.js 24.5+** and npm. Follow the [root instructions](../../README.md)
to install the sample workspace (one `npm ci` in the sample root installs both
editions) and start the backend at <http://127.0.0.1:5178>.
Then, in another terminal from the repository root:

```bash
cd samples/example38_smart_home_appliance_agent/editions/habitat
npm run dev
```

Open <http://127.0.0.1:5184>. Habitat is loopback-only and uses
`--strictPort`; a busy port is an error. The backend stays at `5178`;
[Modern](../modern/README.md) runs independently at `5180`.
Starting Habitat does not create, deploy, or modify Azure resources or require
restarting another development server.

## Shared source

Keep this directory structure intact:

```text
example38_smart_home_appliance_agent/
  shared/               # Protocol and loopback backend validation
    ui/                 # Browser code shared by both editions
  server/               # One backend and tool executor
  editions/
    modern/src/         # Modern UI and rendering
    habitat/src/        # Habitat UI and rendering
```

Habitat imports only its own source (`@habitat`) and `../../shared` (`@shared`);
it does not import Modern source and builds without Modern. The sample root is an
npm workspace, so dependencies are installed once there. Vite deduplicates React,
React DOM, and Three.js. The edition builds its own static assets without
external product images, model binaries, scene downloads, CDN scripts, fonts,
or browser credentials. Dependency downloads use your npm registry
configuration and the sample lockfile's versions/integrity checks.

## API and model boundary

Vite proxies `/api` HTTP/WebSocket to <http://127.0.0.1:5178>.
Optional server-only `SMART_HOME_LOCAL_BACKEND` must pass shared loopback
validation; the browser cannot select a target. Mutations and WebSocket upgrades
require the edition's same-origin loopback Host/Origin before rewriting to the
backend. Other edition origins, external origins, and missing Origin are rejected.
This is a development boundary, not a production authentication gateway.

The backend supplies available models through `/api/config`.
The default Flash model is `microsoft-realtime-flash-1`; server-only
`SMART_HOME_FLASH_AGENT` selects its saved Agent (runtime logical default
`home-flash`, but publishing requires an explicit name). The UI uses a model the
backend actually marks available. Comparison models are optional; no configured
model means no live voice, not a simulated engine. Credentials, resource
identifiers, and Agent configuration must not be put into browser variables.

The common WebSocket workflow uses `tool_choice: "auto"`: one short
model-authored acknowledgement before a control function, actual tool execution,
then one concise `tool_choice: "none"` result. Flash uses `auto_truncate: false`.
See [architecture](../../ARCHITECTURE.md) for the shared speech profile,
greeting gates, cancellation, and deduplication.

## Checks

From this edition directory:

```bash
npm test
npm run build
npm run format:check
# To write formatting deliberately:
npm run format
# Preview the build on 5184, with the root backend still running:
npm start
```

Unit tests cover camera framing, quality budgets, procedural textures,
material resources, post-processing, and origin checks without external service
calls. `build` runs TypeScript and Vite; preview retains the API proxy.

`npm run test:browser` covers desktop/mobile WebGL, controls, REST, and explicitly
mocked voice. Start isolated root-backend and Habitat instances and install a
compatible Playwright browser first. Tests reset and modify household state.

Habitat runs the sample's shared real-model scenarios
(`../../tests/browser/edition-live.spec.ts`) through its live configuration:

```bash
SMART_HOME_LIVE_BROWSER=1 npm run test:live -- --workers=1
```

These tests skip without explicit opt-in, require an authorized configured
service, and may incur charges. Keep them disabled for offline checks and
unconfigured CI.

## Boundaries

Devices, readings, food records, replenishment lists, and saved entertainment
are simulated. No real device API or MCP is connected; no purchase, payment,
delivery, or actual video/music streaming occurs. Local editions share one
household; browser tests do not prove physical device execution.

This UI connects to the Voice Agent over Agent-mode WebSocket. Live browser tests are not a
physical microphone/speaker acceptance test. Follow the root security and
retention guidance before considering public use.
