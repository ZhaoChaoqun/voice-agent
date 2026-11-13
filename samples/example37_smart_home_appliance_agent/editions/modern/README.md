# Smart Home Appliance Voice Agent — Modern

## Conclusion

Modern is a source-built frontend for the [smart-home sample](../../README.md),
not a separate Agent or backend. It offers a bright WebGL room, bilingual
controls, six simulated appliances, household scenes, local knowledge, and the
shared WebSocket voice workflow. Its controls and scene utilities are also
used by [Habitat](../habitat/README.md).

## Run locally

Use **Node.js 24.5+** and npm. Follow the [root instructions](../../README.md)
to install and start the backend at <http://127.0.0.1:5178>.
Then, in another terminal from the repository root:

```bash
cd samples/example37_smart_home_appliance_agent/editions/modern
npm ci
npm run dev
```

Open <http://127.0.0.1:5180>. The server binds only to loopback with
`--strictPort`: a busy port is an error, not a reason to switch ports or stop
another service. Classic remains at `5178`; Habitat uses `5184`.
Startup does not create, deploy, or configure Azure resources.

The Classic navigation link defaults to the local Classic UI.
Set `VITE_CLASSIC_URL` before building only if you need a different local URL
or same-origin static layout. Never put secrets in `VITE_*`; Vite embeds those
values in browser assets.

## Shared source and API boundary

Keep the full sample directory. Modern imports hooks/knowledge components
from `../../src` and protocol/proxy validation from `../../shared`.
Habitat imports Modern's controls, text, default model selection, and procedural
scene utilities. Internal `@v2` aliases refer to Modern source.

Vite proxies `/api`, including voice WebSocket, to <http://127.0.0.1:5178>.
Optional `SMART_HOME_LOCAL_BACKEND` is server-only and validated as loopback;
the browser cannot choose an upstream target. Mutations and WebSocket upgrades
from external origins or without Origin are rejected before Host/Origin rewriting.
This development proxy is not a public authentication gateway. Credentials,
project configuration, and Agent settings belong only to the root backend.

`/api/config` supplies model availability. Flash defaults to
`microsoft-realtime-flash-1`, configured through server-only
`SMART_HOME_FLASH_AGENT` (runtime logical default `home-flash`).
Publishing requires an explicit Agent name. The UI selects a model the backend
actually marks available; absent configuration never becomes a pretend engine.
Comparison models are optional, not prerequisites. Live voice requires an
authorized configured service; offline controls generate no fake Agent reply.

The common session uses `tool_choice: "auto"`, one model-authored short
acknowledgement before a control function, actual execution, then a concise
`tool_choice: "none"` completion. Flash uses `auto_truncate: false`.
See [architecture](../../ARCHITECTURE.md) for cancellation and readiness gates.

## Checks

From this edition directory:

```bash
npm test
npm run build
npm run format:check
# To write formatting deliberately:
npm run format
# Preview the build on 5180, with the root backend still running:
npm start
```

`build` runs TypeScript before Vite. `npm start` retains the API proxy boundary.
`npm run test:browser` covers desktop/mobile WebGL, controls, REST, and explicitly
mocked voice transport. Start isolated backend/frontend instances and install a
compatible Playwright browser first: tests reset and change household state.

`tests/browser/live.spec.ts` is optional and guarded by `SMART_HOME_LIVE_BROWSER`:

```bash
SMART_HOME_LIVE_BROWSER=1 npm run test:browser -- tests/browser/live.spec.ts --workers=1
```

This calls a real service and may incur charges. Offline checks and unconfigured
CI must leave it disabled.

## Boundaries

All room geometry/materials are procedurally authored, with no external product
images, downloaded scenes, fonts, or manufacturer facts. Household/readings,
food, replenishment, and saved entertainment are fictional fixtures: no real
devices, MCP, purchase/payment/delivery, or actual media streaming.

The complete UI uses WebSocket, not Agent-mode WebRTC. The separate tool-free
model-mode WebRTC lab does not load this Agent or measure this tool workflow.
Keep uploads, recordings, traces, secrets, and deployment values out of commits.
Use your own npm registry configuration; lockfile versions and integrity checks
remain the dependency source of truth.
