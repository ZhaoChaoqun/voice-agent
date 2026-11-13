# Smart Home Appliance Voice Agent

## Conclusion

This sample combines a Foundry **Voice Agent**, a Node WebSocket relay, and three
React / Three.js browser interfaces: Classic, Modern, and Habitat. The Voice Agent
uses **Voice Live** for speech input and output; they are different layers, not
two names for the same product. Node executes the Agent's allowlisted functions
and owns the sample household state.

All appliances, environmental readings, food records, replenishment lists, and
saved entertainment selections are simulated. No device platform or MCP server
is connected. Selecting entertainment prepares a simulated viewing environment;
it does not stream video or music. No purchasing, payment, or delivery system is
connected. All 3D content is procedurally authored in source code, with no external
product images or manufacturer specifications.

The default model is **Microsoft Realtime Flash**, `microsoft-realtime-flash-1`.
The complete application uses WebSocket. A separate, tool-free **Voice Live
model-mode WebRTC latency lab** does not load this Voice Agent. Agent-mode WebRTC
is described as an integration reference, but is not wired into these UIs.

## When to use this example

Use it to explore bilingual voice control of a visible household, knowledge-grounded
answers, and a model-authored short acknowledgement before a control function,
followed by a concise answer grounded in the actual tool result. Compare the
three interfaces without duplicating the backend or the tool contracts.

For a real device integration, use the [integration guide](INTEGRATION.md).
The simulated executor is a starting point, not a hardware adapter.

## Workflow

| Step                  | Behaviour                                                                                                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Connect               | Node maps an allowlisted model ID to a saved Voice Agent name and authenticates on the server.                                                                                 |
| Initialize            | The Agent receives a structured `welcome_text`; the relay waits for both `session.updated` and the greeting's `response.done` before `demo.ready`.                             |
| Receive a turn        | The browser sends user text or 24 kHz mono PCM16 audio. Recognition remains bilingual (`zh-CN,en-US`).                                                                         |
| Acknowledge a control | In the same response, before the control `function_call`, the model says one short acknowledgement in the user's language: "Sure." / "Got it." or “好的。” / “好。” / “收到。” |
| Execute               | After a completed `response.done`, Node validates arguments, deduplicates call IDs, and executes the local tool. Cancelled or failed responses discard pending calls.          |
| Complete              | Node sends the actual `function_call_output`, then a `tool_choice: "none"` continuation for one concise result, without repeating the acknowledgement.                         |

The session uses **`tool_choice: "auto"`**, not `"required"`: Flash needs to
generate the acknowledgement as well as the function call, while queries and
conversation must not be forced to call tools. The acknowledgement names no
device, setting, action, plan, or result. Information queries do not need it.
The relay forwards the model's audio and transcript; it does not inject an extra
confirmation turn. Success is reported only after the tool succeeds; failure is
not completion.

### Functions

| Function                    | Purpose                                                                     |
| --------------------------- | --------------------------------------------------------------------------- |
| `get_home_state`            | Read simulated appliance state and illustrative environmental readings.     |
| `control_device`            | Change a permitted device setting within schema and server-side limits.     |
| `activate_scene`            | Apply the simulated movie, comfort, or away scene.                          |
| `get_media_recommendations` | Retrieve fictional, saved entertainment selections, not live rankings.      |
| `prepare_media_experience`  | Prepare the simulated TV, lights, and curtains; no content playback.        |
| `get_fridge_inventory`      | Read entered food records; no camera recognition or food-safety assessment. |
| `manage_shopping_list`      | Edit a replenishment list; never place an order.                            |
| `search_product_manual`     | Retrieve bounded excerpts from local sample guidance or authorized uploads. |

## Sample data

The fictional appliance model identifiers are `SAMPLE-TV-01`,
`SAMPLE-FRIDGE-01`, and `SAMPLE-AC-01`. The household also has a humidifier,
lights, and curtains. These are sample identifiers, not commercial products.

| Model              | Procedural room dimensions (width × height × depth) |
| ------------------ | --------------------------------------------------- |
| `SAMPLE-TV-01`     | 1600 × 900 × 40 mm.                                 |
| `SAMPLE-FRIDGE-01` | 800 × 1800 × 600 mm.                                |
| `SAMPLE-AC-01`     | 900 × 300 × 200 mm.                                 |

These dimensions are fictional scene proportions, not product specifications.

| Setting         | Sample limits                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------- |
| TV              | Volume 0–100; channels `home`, `movie`, `music`.                                                  |
| Refrigerator    | Fridge target 2–8 °C; freezer target −24 to −16 °C; power-off is blocked.                         |
| Air conditioner | Target 16–30 °C; modes `cool`, `heat`, `auto`, `fan`; fan speeds `low`, `medium`, `high`, `auto`. |
| Humidifier      | Target humidity 30–70%; mist levels `low`, `medium`, `high`, `auto`.                              |
| Lights          | Brightness 0–100; warmth 2700–6500 K.                                                             |
| Curtains        | Fully open or closed.                                                                             |

Illustrative readings include 26.4 °C, 42% humidity, and air-quality index 18.
Changing a target does **not** fabricate a sensor change or prove energy savings.
The away scene keeps the refrigerator on. Food entries are scenario context, not
observations of freshness or safety.

[`knowledge/products.json`](knowledge/products.json) contains fictional appliance
guidance and sample room proportions. Every entry has `kind: "demo"` and the
fixture contains no URLs. [`shared/appliances.ts`](shared/appliances.ts) defines
the displayed models and links to that checked-in fixture in this public
repository, not to a manufacturer. Retrieval boosts exact model matches so a
query such as `SAMPLE-FRIDGE-01` can find its guide despite the neutral code.

[`knowledge/entertainment.json`](knowledge/entertainment.json) contains five
fictional saved selections dated **2026-11-12**: _Small Town Journal_, _Moonlit
Walk_, _Garden Stories_, _A Journey Through Seasons_, and _Across the Stars_.
Their source URLs point to the checked-in fixture in this public repository,
not real entertainment platforms. Dates describe saved fixture data, not
releases, current availability, or a live chart. Geometry is not manufacturer CAD.

## Prerequisites

- **Node.js 24.5+** and npm. This baseline is required for server-side HTTPS proxy
  support even when no proxy is configured.
- A modern Chrome or Edge browser, with WebGL and microphone support. Microphone
  access requires a user gesture and localhost or an HTTPS secure context.
- Only for live voice: Azure CLI sign-in and your own Foundry resource/project,
  with model access, supported region, quota, and billing.

Offline manual controls and the local knowledge panel work without Azure.
Offline mode has **no fabricated AI responses or browser-TTS fallback**.

The Flash template uses `kind: voice` and `model_type: managed`, not a name of
an existing Azure OpenAI deployment. It does not require a separate self-deployed
model with the same name. If your project requires `self_deployed`, the model
deployment and definition need deliberate adaptation; the sample does not
silently switch models or regions.

Verify support for Azure Speech streaming transcription, Azure Semantic VAD,
personal noise suppression, server echo cancellation, and
`zh-CN-Xiaoxiao:DragonHDFlashLatestNeural`. Flash uses **`auto_truncate: false`**
because it handles truncation itself. Do not remove AEC or noise suppression to
claim a successful integration.

Official references: [Voice Agent quickstart](https://learn.microsoft.com/azure/foundry/agents/quickstarts/prompt-voice-agent),
[configure a Voice Agent](https://learn.microsoft.com/azure/foundry/agents/how-to/configure-voice-agent),
and [limits, quotas, and regions](https://learn.microsoft.com/azure/foundry/agents/concepts/limits-quotas-regions).

## Run locally

From the repository root:

```bash
cd samples/example37_smart_home_appliance_agent
npm ci
cp .env.example .env
npm run dev
```

Leave the Foundry endpoint and verified models unset for offline use. Open
<http://127.0.0.1:5178>. One Node service serves Vite, the HTTP API, and the
WebSocket relay. It binds to loopback by default and fails if the port is busy;
it does not stop other services or choose another port. Local tabs and editions
share one simulated household.

To preview a production build locally:

```bash
npm run build
npm start
```

Keep the root backend running. In another terminal, from the repository root,
install Modern before Habitat because Habitat imports Modern source and needs
its dependencies:

```bash
cd samples/example37_smart_home_appliance_agent/editions/modern
npm ci
cd ../habitat
npm ci
npm run dev
```

Habitat opens at <http://127.0.0.1:5184>. To run Modern instead, run
`npm run dev` from `editions/modern` and open <http://127.0.0.1:5180>.
These Vite proxies are loopback development conveniences, not public gateways.

## Configure live voice explicitly

The base JSON files in `agents/` are not upload-ready definitions.
`server/instructions.txt`, `server/instructions.ts`, and `server/tools.ts` own
the shared instructions and function schemas. From the sample root:

```bash
# Offline only: no Azure queries or modifications.
npm run agents:render
```

Review the `flash` definition in the ignored `.local/agent-definitions.json`:
instructions, all eight tools, structured greeting, 24 kHz mono PCM, dynamic
VAD, AEC, noise suppression, bilingual transcription, and Xiaoxiao output.
Fresh templates use `store: false`; service data-processing terms still apply.

Put your own values in the server-only `.env`:

```dotenv
FOUNDRY_PROJECT_ENDPOINT=https://<resource>.services.ai.azure.com/api/projects/<project>
SMART_HOME_FLASH_AGENT=<your-flash-agent-name>
SMART_HOME_SECONDARY_MODEL_ID=microsoft-realtime-flash-1
```

An authorized operator may sign in with `az login` and explicitly publish:

```bash
# Export the same actual endpoint; .env does not populate shell expansion.
export FOUNDRY_PROJECT_ENDPOINT="https://<resource>.services.ai.azure.com/api/projects/<project>"
npm run agents:publish -- --confirm-project "$FOUNDRY_PROJECT_ENDPOINT"
```

Replace all placeholders first. This command **modifies the confirmed project**;
it is not required for offline startup. It publishes only Flash by default.
It creates a missing Agent or versions an existing Agent of the same kind,
model, and model type, preserves other Portal-owned fields, checks for a
concurrent version change, and reads back every submitted field and the active
new version. The pre-write check is optimistic, not an atomic transaction;
coordinate an exclusive publishing window. The script does not provision
resources, model deployments, or RBAC.

After inspecting your saved Agent and confirming the model configuration,
explicitly enable it in `.env`:

```dotenv
SMART_HOME_VERIFIED_MODELS=microsoft-realtime-flash-1
```

This is an operator declaration, not automated acceptance evidence. Validate
live connectivity before using it in a demonstration. `gpt-live` is not integrated
and is marked unavailable rather than aliased to another model.
See [Agent definitions](agents/README.md) and the [integration guide](INTEGRATION.md)
for the full speech profile, publishing checks, and optional comparison models.

### Environment variables

| Variable                                               | Purpose / default                                                          |
| ------------------------------------------------------ | -------------------------------------------------------------------------- |
| `FOUNDRY_PROJECT_ENDPOINT`                             | The only allowed project HTTPS endpoint; no default resource.              |
| `SMART_HOME_FLASH_AGENT`                               | Your Flash Agent name; required explicitly for publishing.                 |
| `SMART_HOME_SECONDARY_MODEL_ID`                        | Defaults to `microsoft-realtime-flash-1`; does not require a second Agent. |
| `SMART_HOME_VERIFIED_MODELS`                           | Comma-separated exact model IDs; no voice model enabled by default.        |
| `AZURE_TENANT_ID`                                      | Optional local Azure CLI tenant.                                           |
| `AZURE_CLIENT_ID`                                      | Cloud user-assigned managed identity client ID.                            |
| `HOST` / `PORT`                                        | Defaults: `127.0.0.1` / `5178`.                                            |
| `SMART_HOME_LOCAL_BACKEND`                             | Optional validated loopback backend for edition development proxies.       |
| `SMART_HOME_LOCAL_STATE_PATH`                          | Local household JSON; defaults to `.azure/home.json`.                      |
| `SMART_HOME_PUBLIC_ORIGIN`                             | Exact HTTPS origin for protected cloud mode.                               |
| `SMART_HOME_ACCESS_CODE` / `SMART_HOME_SESSION_SECRET` | Independent cloud secrets, at least 24 / 32 characters.                    |
| `SMART_HOME_PUBLIC_GUEST_ACCESS`                       | Defaults to `0`; `1` allows any visitor to incur service charges.          |
| `SMART_HOME_DATA_PATH`                                 | Writable cloud household storage directory.                                |
| `SMART_HOME_WEB_ROOT`                                  | `dist`, `editions/modern/dist`, or `editions/habitat/dist`.                |
| `VOICE_LIVE_ENDPOINT` / `WEBRTC_MODEL`                 | Model-mode WebRTC lab only; no default resource endpoint.                  |

Keep credentials on the server. Local runtime uses `AzureCliCredential`; cloud
runtime uses managed identity, not API keys. Use project-scoped development and
consumption permissions (such as Foundry Agent Developer and Foundry Agent
Consumer) appropriate to the actual role definitions, not subscription Owner
for convenience. Do not put secrets in `VITE_*`: those values reach the browser.

## Try these turns

Use these after connecting to a configured Voice Agent; offline manual controls
do not generate Agent replies:

- "Turn on the television." Expect one short English acknowledgement before
  `control_device`, then a result after the simulated change succeeds.
- “把空调设为二十四度。” Expect a short Chinese acknowledgement, the control
  function, then a concise result. The environmental reading stays illustrative.
- "What's the current humidity?" Expect a grounded sample reading without a
  control acknowledgement or a claim of a live sensor.
- "Set up movie night." Expect a simulated scene, with no actual streaming.
- "What food is in the fridge? Add milk to the replenishment list." Expect food
  records and a list update, not a purchase.
- "What does SAMPLE-FRIDGE-01 support?" Expect retrieval of the fictional sample
  guide, not invented manufacturer facts, warranty, or certification.
- "Turn off the refrigerator." Expect refusal from the server-side control rule,
  never a claim that the refrigerator was switched off.

## Checks and optional tests

From the sample root:

```bash
npm test
npm run build
npm run format:check
npm run lint
npm run agents:render
# With the backend running on 5178 and compatible Playwright Chromium installed:
npm run test:browser -- tests/browser/ui.spec.ts
```

Run `npm test`, `npm run build`, and `npm run format:check` separately in
`editions/modern` and `editions/habitat`. All three packages also provide
`npm run format` to write formatting; root `lint` combines strict TypeScript
and Prettier. Browser tests reset and modify household state: use isolated
instances. Unit tests mock cloud boundaries; mocked browser scenarios do not
prove Azure connectivity.

Vite may warn when a generated chunk exceeds roughly 500 kB. This warning is
not itself a build failure; assess bundle size and loading performance separately.

Real-service tests are **optional, explicit opt-in, and potentially billable**:

```bash
RUN_LIVE_TESTS=1 npm run test:live
SMART_HOME_LIVE_BROWSER=1 npm run test:browser -- tests/browser/live-ui.spec.ts --workers=1
```

Modern has an opt-in live browser spec; Habitat provides `npm run test:live`,
also guarded by `SMART_HOME_LIVE_BROWSER`. These tests do not replace subjective
microphone/speaker checks. Server E2Es
requiring native audio processing need a compatible isolated Linux environment;
do not disable AEC or noise suppression to bypass missing libraries.

### WebRTC latency lab

Configure your own `VOICE_LIVE_ENDPOINT`, then from the sample root:

```bash
PORT=5188 npm run lab:webrtc
```

Open <http://127.0.0.1:5188>. `WEBRTC_MODEL` defaults to
`microsoft-realtime-flash-1`. Audio uses WebRTC RTP, events use the
`voice-live-events` DataChannel, and Node holds the authenticated control channel.
The lab disables tools and does not load the household Agent, knowledge, or
pre/post-tool workflow. TTFA runs from text submission to the **first**
`output_audio_buffer.started` per turn: not physical speaker onset and not
microphone/VAD end-to-end latency. STUN/ICE, UDP, browser policy, and regional
availability affect results. Do not expose this unauthenticated lab publicly.

## Boundaries

- Device controls and scene limits are enforced by schemas and server rules,
  not by model assurances. Real devices require an authorized adapter or MCP
  integration and verifiable execution receipts; none is connected here.
- Uploaded `.txt` / `.md` files require permission to use them. They are retrieval
  evidence, never system instructions. Local uploads live in ignored
  `knowledge/uploads/`; cloud uploads are isolated by signed browser session.
- Do not commit populated environment files, uploads, recordings, Playwright
  traces, or `.local` manifests. Operators own backup, deletion, and retention.
- Local editions share state. Cloud mode checks Host/Origin and uses signed,
  HttpOnly, Secure, SameSite cookies and per-browser households. Access codes
  protect a controlled demo, not enterprise identity; guest mode is not login.
- Cloud capacity is bounded to 100 households per instance. Expired cookies do
  not delete files. New browsers or signing-key rotation lose access to the old
  session; access codes are not cross-device identities.
- The household JSON store is not a distributed database. The optional ACA
  renderer defaults to one replica, `SMART_HOME_MIN_REPLICAS=1`; explicit `0`
  permits scale-to-zero with cold starts. Maximum replicas remain one.
- Public use needs external identity/abuse protection, connection/request/upload
  limits, budget alerts, audit, and retention policies. The deployment renderer
  rejects guest access by default.

### Troubleshooting

| Symptom                          | Check                                                                                                                    |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| No available model               | Endpoint, Agent name, `SMART_HOME_VERIFIED_MODELS`, model access, region, quota; restart Node after environment changes. |
| `401` / `403`                    | CLI sign-in, tenant, project consumption/development permissions; never send a browser token as a workaround.            |
| `realtime_requires_language`     | Saved Azure Speech streaming transcription with `zh-CN,en-US`.                                                           |
| Connection waits indefinitely    | Structured greeting, `session.updated`, greeting completion, output voice, and sanitized server errors.                  |
| Missing pre-tool acknowledgement | `tool_choice: "auto"`, latest instructions/tools, and a new session; `"required"` can suppress Flash's acknowledgement.  |
| Microphone denied                | Secure context, user gesture, browser and operating-system permissions.                                                  |
| `EADDRINUSE`                     | Choose your own unused port and matching edition proxy backend; do not stop another session's service.                   |
| No WebGL                         | Browser/GPU support; the UI should show an error while text/device controls remain usable.                               |
| Storage failure                  | Runtime write access to household JSON, uploads, and the cloud mount; unsaved state is not success.                      |
| SDP/ICE failure                  | Correct model-mode API, supported model, UDP/ICE reachability; not an Agent-mode acceptance test.                        |
| Missing saved definition fields  | Readback comparison; do not overwrite advanced fields with another serializer.                                           |

## Further reading

[Architecture and security](ARCHITECTURE.md) ·
[Integration: Agent, WebSocket, WebRTC, and optional devices/MCP](INTEGRATION.md) ·
[Agent definitions](agents/README.md) ·
[Optional ACA deployment](deploy/README.md) ·
[Modern](editions/modern/README.md) · [Habitat](editions/habitat/README.md).
