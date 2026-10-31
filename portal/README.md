# Voice Agent portal

A standalone local **Voice Agent Runtime**, **Templates catalog**, **Handoff
Graph editor**, and **WebRTC sample**. Configure agents, edit their definitions
as YAML or as a visual graph, publish the checked-in sample templates, and
connect to your own Azure Foundry project. No other repository or private
package feed is needed.

**Default startup is Portal only.** Use the public no-auth MCP below; do not run
`scripts/setup-local-examples.sh`, install or authenticate Dev Tunnel, or start
`shared_mcp/scripts/e2e-local.sh` as part of Portal setup. Local MCP development
and hosting are optional and documented separately in the
[MCP guide](../docs/02_mcp_settings.md). An already deployed MCP needs no tunnel.
Azure Foundry project access and authentication are still required.

## Prerequisites

- **Python 3.10+**. Built browser assets are checked in, so Node.js is not
  required just to run the portal.
- **Your own Azure Foundry project**, with Voice Agents preview access and an
  identity authorized to use it. Follow the [VoiceAgent prerequisites](../README.md).
- Azure CLI sign-in (`az login`) or another `DefaultAzureCredential` identity.
- A microphone and headset for voice conversations.

**The portal always uses Azure Foundry.** There is no offline backend or runtime
mode selector. A missing or invalid project endpoint stops startup with setup
instructions; authentication/network errors never switch to mock responses.
Running the portal locally does not run the Azure voice service locally.

All checked-in **Templates** call their tools on this public no-auth MCP
endpoint by default:

```text
https://voice-agent-noauth-mcp.lemonsky-36682081.westus2.azurecontainerapps.io
```

Loading a Template preserves its original model. When publishing from Editor or
Templates, the portal first submits that model unchanged. If Foundry returns HTTP
400 specifically because managed `gpt-realtime-regional` is unsupported in the
region, the portal logs a warning and retries once with `gpt-realtime`, including
matching managed handoff-node models. Other errors and self-deployed models do
not trigger this retry. A failed retry is returned normally; sample files and
previously published versions are never rewritten.

Finance Realtime and Cascade use `/mcp/finance-handoff`, Finance OTP uses
`/mcp/finance-otp-officer`, Elevator Service uses `/mcp/elevator-service`,
Front Desk uses `/mcp/frontdesk`, and Examples 5–34 use mock tool calls on
`/mcp/mock-tool-call`.
No local MCP process, Dev Tunnel, bearer token, or Foundry Project connection
is needed for these Templates, and you do not need to start
[`../shared_mcp`](../shared_mcp/README.md); it is only for the Finance CLI
samples' customer-managed path or for hosting those Finance routes yourself. To use your own systems
instead of the mock tools, see
[Connect real tools](../docs/05_connect_real_tools.md). The public tools use fictional shared sample
data; availability and state resets depend on the service. Do not send real
customer data.

The Finance Hindi templates are independent of the English examples. They keep
English business instructions but use `hi-IN` Azure Speech input and Hindi
Diya Dragon output (`hi-IN-Diya:DragonLatestNeural`). The Portal preserves an explicitly configured transcription
language when loading or publishing a template; omitting it keeps automatic
language detection. Hindi birthday and early-end handling require the updated
[Finance MCP source](../shared_mcp/README.md) on the selected MCP host.

All five Finance templates (English/Hindi Realtime and Cascade, plus OTP and
Officer Search) use `azure-speech` input transcription. Examples 5-34 also use
`azure-speech`; Example 3 Elevator Service and Example 4 Front Desk still use
`whisper-1`. Only the two Hindi templates explicitly set `language: hi-IN`;
the others leave the transcription language unset. The catalog's target-locale
metadata does not set the input language. Realtime models still receive audio
directly; the input-transcription model identifies the transcript provider,
not the conversation model.

Editor's **Load from templates** groups workflows by their **Target locale**:
Hindi (India), `hi-IN`, appears first, followed by English, `en-*`. Each card
shows its exact locale. The left-aligned **By locale** / **By domain** controls
switch between language and business categories; there are no separate locale
filter pills. Each category expands and collapses independently. The default
view on every opening is **By locale**, with all categories expanded. Domain
categories also start expanded. The domain view uses a curated priority order:
**Customer support**, then **Financial services**, followed by the remaining
categories alphabetically. This is a recommended order, not measured usage.

Search opens matching categories so results are immediately visible. Clearing
search restores the expansion choices, which are remembered separately for each
grouping mode while browsing. Reopening starts a fresh search and grouping view;
selected versions are retained. Grouping never changes Agent settings.

The locale describes the customer conversation, not the language used to write
the instructions or every language a multilingual voice might support. Declare
`target_locale` explicitly in [`templates.config.json`](templates.config.json),
for example `"hi-IN"`, `"en-IN"`, or `"en-US"`. Missing metadata is displayed as
**Locale not specified**, never guessed from a voice name. This metadata organizes
the picker; the Agent definition still owns actual input/output language settings.

## Voice selection without discovery permissions

Editor, Runtime and WebRTC start with a bundled reference voice catalog and
the configured default voice. Loading the page does not wait for account-level
Voice Live discovery or require that extra permission. The reference includes
Azure Speech and native voice metadata; it is not a guarantee of availability
for every project, region or model.

Live discovery is an optional background update. Permission errors, timeouts,
network failures and invalid responses retain the default catalog and show a
visible status with **Retry live voice discovery**. Retrying or receiving live
metadata never changes the selected voice, saved Agent or in-progress edits.
The API also returns explicitly marked bundled data when live discovery fails,
with a diagnostic reason; it never labels that response as live discovery.
Project configuration errors still fail explicitly rather than using a fake backend.

**Try it now does not perform voice or region discovery before publishing.**
It submits the authored definition, preserving root and handoff-node voices.
The editor's local graph checks are advisory: errors remain visible, but do not
disable **Try it now** or prevent submission. Foundry's version-creation response
determines publication success or failure.

Template MCP configuration and published-version readback are retained.
A readback failure is reported as **published, but verification failed**, not
as a failed version creation. The separate **Automatic voice language** action
in the Editor Voice panel can still query regional metadata when explicitly
requested; it is not part of publication or Runtime connection.

Public Template MCP configuration also checks URL syntax without DNS or an MCP
handshake. Explicit **Test connection** probes still resolve and check public
addresses before contacting the server. Configuring a customer-managed Project
connection still requires Azure access.

To reproduce unavailable discovery safely, block external metadata requests
only for the Portal process or test fixture; do not disable the host's network.
The built-in voice picker remains usable. Actual publication and
readback require the configured Foundry project and Azure authentication; voice
conversations also require the voice service and any configured MCP tools.
If those required services are unreachable, the Portal reports the failure and
preserves the working copy rather than claiming publication succeeded offline.
Restart the Python Portal after backend changes; a browser refresh alone does
not reload the server.

## Set up

On the first Editor visit in each browser tab, a **Welcome to the Azure Voice
Agent Playground** dialog explains the sample experience and links to the
[Microsoft Foundry setup guide](https://learn.microsoft.com/en-us/azure/foundry/tutorials/quickstart-create-foundry-resources?tabs=portal)
and then the
[Voice Agent quickstart](https://learn.microsoft.com/en-us/azure/foundry/agents/quickstarts/prompt-voice-agent?pivots=portal)
to create and test a voice agent in the user's own project. Both are inline
text links that open in new tabs. **Try the playground** or Escape dismisses it for that tab's
session. The dialog also reminds users not to enter sensitive or confidential data.

Use a complete checkout of this repository, not a copy of `portal/` alone.
The shared helpers and templates in [samples/](../samples/) and the guide in
[docs/](../docs/) are included here; no sibling repository is required.

From the repository root, in PowerShell:

```powershell
cd portal
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

macOS / Linux:

```bash
cd portal
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
[ -f .env ] || cp .env.example .env
```

Edit the portal's `.env` and set your project endpoint:

```dotenv
AZURE_VOICE_AGENTS_ENDPOINT=https://<account>.services.ai.azure.com/api/projects/<project>
AZURE_VOICE_AGENTS_MODEL=gpt-realtime
AZURE_VOICE_AGENTS_VOICE=en-US-AvaNeural
```

The backend uses `DefaultAzureCredential` and keeps its Azure access token out
of browser configuration. Only public-cloud HTTPS Foundry project endpoints
are accepted. It reads **only this directory's `.env`**, not `../samples/.env`;
process environment variables take precedence.

Set `AZURE_CREDENTIAL_MODE=cli` or pass `--credential-mode cli` to use exactly
the identity selected by `az login`.

## Run locally

PowerShell, from this directory:

```powershell
az login
.\.venv\Scripts\python.exe demo_server.py
```

macOS / Linux:

```bash
az login
.venv/bin/python demo_server.py
```

On macOS / Linux, the equivalent wrapper forwards all arguments to the same
Python entry point:

```bash
./run.sh --port 9530 --no-record-sessions
```

Both entry points read this directory's `.env`. Explicit command-line arguments
override process environment variables, which override `.env`; the wrapper does
not supply a second set of host or port defaults. It does not install dependencies
or perform Azure/MCP connectivity checks.

Alternatively, supply the project on the command line instead of in `.env`:

```powershell
.\.venv\Scripts\python.exe demo_server.py --project-endpoint "https://<account>.services.ai.azure.com/api/projects/<project>"
```

Open **http://127.0.0.1:9527** to enter **Editor** at `/editor/`. Create a blank
working copy or load a template, edit it, and choose **Try it now**. This publishes
the Agent and opens Runtime; click **Connect & start session** and grant
microphone permission when ready. Press **Ctrl+C** to stop.

**Create blank** is a minimal, runnable Agent rather than an empty handoff graph.
It starts with `$entrypoint -> end` and a helpful-assistant prompt. Its base
settings are hardcoded from
[Example 5: Customer Support](../samples/example5_customer_support/agent.json):
managed `gpt-realtime`, `azure-speech` transcription, 24 kHz PCM input/output,
`en-US-Emma:DragonHDOmniLatestNeural` (`azure-standard`), semantic turn detection
with the `normal` profile and 400 ms silence, automatic truncation and
interruption, server echo cancellation, deep noise suppression, audio-only
output, `store: false`, and handoff limits of 16. These defaults are identical
locally and in hosted playgrounds; project defaults do not replace them.

Blank uses a generic template greeting and `tool_choice: auto`, not the sample's
support persona, business tools, or forced first handoff. This lets the entrypoint
answer normal questions instead of immediately ending the conversation. Saying
goodbye routes to `end`, which says a brief farewell and calls the built-in
`end_conversation` tool. No MCP server or settings edits are required before
**Try it now**. Existing Agents and imported templates retain their own settings.

The initial endpoint is the startup Project. Use Runtime's searchable **Foundry
project** field to select any Project visible through Azure Resource Graph or
paste a full Project endpoint. The selection is stored in a secure same-site
browser cookie and applies to Runtime, Handoff Graph, REST, WebSocket, and
publish operations, including the template catalog consumed by Handoff Graph.

`--port` is optional: it defaults to `9527`, or `DEMO_PORT` if configured. Use
`--port 9530` when needed; do not stop an unrelated service to free a port.

## Using the portal

- The header has two main destinations. **Editor** is the default landing page
  at `/editor/` and provides visual authoring,
  validation, deterministic YAML/JSON previews, JSON/YAML import, and release publication. The
  **Runtime** at `/runtime/` selects published Agents, runs conversations and shows
  the live handoff/debug graph. Agent Creation, Generate and definition editing
  are not part of Runtime; create and edit Agents in **Editor**. Existing
  root URLs with an `agent` query still open that Agent in Runtime. The
  standalone Templates page remains available only as an internal contributor
  surface and is intentionally absent from Portal navigation.
- Runtime's **Export** opens a read-only complete published definition with
  **YAML** and **JSON** tabs. JSON contains the Agent definition itself, not
  session overrides or a version-publication request. Use Editor's
  **Export/Import > Import from agent** to paste either format, or choose an
  `agent.json`, `agent.yaml` or `agent.yml` file, and load it as a working copy.
  All definition fields, including unknown extensions,
  are retained. The existing Editor import limitations below still apply
  (model-backed realtime Voice Agents, not native Live or hosted-agent wrappers).
  Export does not publish a version or open the microphone. Existing `/demo`
  and `/demo/` bookmarks redirect to `/runtime/`, preserving query parameters
  such as Agent, view and transport. `/runtime` also redirects to `/runtime/`.
- Runtime's **Agent configuration** displays the published configuration read-only:
  model, voice, input language, transcription, conversation storage, greeting,
  turn detection, echo cancellation, avatar, tools, workflow and instructions.
  Input language and storage remain visible in the collapsed summary. Runtime
  connects with the stored Agent settings; there is no **Session settings** panel,
  Apply button, or per-session voice, storage or structured-input override.
  Change settings in **Editor** and publish a new version. **Export** still shows
  the complete definition, including settings not listed in the summary.
- Runtime links can select the audio transport explicitly, for example
  `/runtime/?agent=<name>&view=handoff&transport=webrtc`. Supported values are
  `webrtc` and `websocket`; links without the parameter still default to WebSocket.
  The read-only configuration also shows the connection transport. **Copy URL**
  includes it while retaining the Agent, view, and other URL
  fields. Shared links never start the microphone automatically; choose
  **Connect & start session**. An unsupported value displays an error and blocks
  connection until corrected in the URL. Agents using live-reference echo cancellation still
  require WebSocket: the selection and URL are changed to WebSocket with a visible
  explanation. Editor's one-shot start uses the same transport selection.
- **Create blank**, **Export/Import**, and **Load from templates** sit together in the top action
  row, alongside the green **Try it now** button. **Format view**
  remains on the canvas below. Both hosted and local Editor modes show a compact
  left sidebar: searchable **Agents** cards with versions, then **Nodes** and
  **Edges** navigation. The sidebar has no Project selector, duplicate New Agent
  action, publication-name field, or runtime parameter form. Single-click an
  Agent card to load its latest complete definition directly; there is no
  separate open button. Arrow keys navigate the Agent cards, and Enter loads
  the selected Agent. The `$entrypoint` card has a full-width, high-contrast
  **Overall settings** button with **Click to configure the entire Agent**,
  visible before any node is opened. This card action edits shared
  Agent settings and entrypoint behavior in one editor; there is no separate
  **Agent General Settings** button. Validation problems appear only when present.
  Nodes and routes also remain editable directly on the canvas.
- Blank working copies explicitly set `model_type: "managed"`. Publishing and
  **Copy publish body** omit the empty `handoff` used to draw the starter node,
  because Foundry rejects a handoff graph without edges. Real graphs and the
  editable JSON/YAML exports retain their configuration.
- **Export/Import** is the top-toolbar entry for the complete working definition
  with **JSON** and **YAML** format tabs. Both read-only previews contain the
  same Agent definition, including all
  overall settings, nodes, routes and extension fields, not just visible form
  values. The panel's only action, apart from closing it, is the prominent blue
  **Import from agent** button, which is also available before an Agent is loaded;
  there are no copy, file-download, or publication-body-copy buttons. Viewing and
  importing do not publish a version. Resource-level version metadata is separate
  from the definition; **Try it now** builds the publication wrapper automatically.
- Editor can load any configured Template into a temporary working copy.
  Example 1 has Realtime and Cascade runtime variants, so the 34 sample
  projects appear as 35 selectable catalog cards. The
  [Front Desk sample](../samples/example4_frontdesk_with_fluency_and_handoff/README.md)
  preserves its response-first shared prompt, eight business nodes, and two-tool
  search/confirmed-message boundary.
- Examples 5-34 are the 30 mock-tool templates. Their default English TTS voices
  retain the upstream persona choices: `en-US-Emma:DragonHDOmniLatestNeural`
  or `en-US-Brian:DragonHDOmniLatestNeural`. Examples 1-4 and historical
  backup versions retain their authored voices.
- **$entrypoint > Overall settings > Speech input** configures the shared transcript
  model and input languages. The language dropdown has a locale-prefix search
  above the checkboxes, for example `en`, `en-` or `hi-IN`, ignoring letter case.
  Search filters visible options only; checked languages and their primary order
  are retained. Clear search restores the full list. The main field lists the
  selected locale codes directly, such as `hi-IN, en-IN`, rather than a count.
  There is no free-text language configuration:
  Azure Speech accepts up to 10 candidate languages, with the first selection
  as primary. Select one locale per base language. **Auto** clears explicit
  candidates; streaming Azure Speech requires explicit input. Single-language
  models show a validation error for multiple candidates instead of replacing
  or clearing them. The checkbox list always supports explicit multi-selection,
  up to 10 candidates, and retains existing candidate order. Choose a compatible
  model such as Azure Speech before publishing multiple candidates.
  Explicit Azure Speech choices use the published Speech locale list, rather
  than limiting customers to the default multilingual model's 15 locales.
- The entrypoint's **Overall settings** groups **Phrase list**, **Audio enhancement** (noise
  suppression and echo cancellation), and **Automatic turn detection**.
  Echo cancellation can use server playback with mono input, or client playback
  with two PCM channels. Client reference requires WebSocket and no avatar in
  this Portal; Runtime uses the matching capture mode. Turn detection
  offers Azure semantic, Basic, and OpenAI semantic strategies while retaining
  their advanced controls. Changes remain local until publication.
- **Import from agent** is also available in the entrypoint editor and the definition
  viewer. Choose a JSON or YAML file (`.json`, `.yaml`, `.yml`, maximum 2 MB)
  or paste either format, validate it, and
  select **Import working copy**. Accepted shapes are a raw exported definition,
  `{ "definition": { ... } }` (with optional name, description and metadata),
  or an Agent resource containing `versions.latest.definition`. Import checks
  known field shapes, language and audio configuration, and graph routes.
  Errors show the affected field and block import without replacing current
  edits. Replacing an existing working copy requires confirmation. Unknown
  definition fields are retained for export and publication.
  YAML accepts a single document with JSON-compatible values, including multiline
  instructions. Duplicate YAML keys, aliases and custom tags are rejected.
  Import supports model-backed realtime Voice Agents, not native Live or
  hosted-agent wrappers. Local validation does not check remote project/model
  availability or replace Foundry validation during publication. Import never
  publishes an Agent or starts a microphone.
- The **Voice** table groups voices by locale, with a locale filter that defaults
  to **All locales**, not the current voice's `en-US`. Runtime voice
  selectors use the same locale groups.
- **Voice locale** is editable: choose a suggestion or type a code or language
  name such as `en-US`, `en us`, `Hindi`, or `hi-IN`. **Search voices** narrows
  the results by name, full ID, or variant; for example, use locale `en-US` and
  search `Ava`, then compare the visible full voice IDs. `Dragon HD` narrows
  variants further. A match count, explicit empty state, and **Clear filters**
  keep the selection predictable. Filtering never changes the selected voice,
  opens a microphone, or publishes an Agent. Editor rows show full IDs and the
  current selection; Runtime uses the same matching rules.
  Active voice controls use white input surfaces and distinct borders; the
  voice panel does not include an empty advanced-controls placeholder.
- Voice preview is not implemented as a generated speech session. The current
  South India deployment advertises prerecorded sample URLs, but the tested
  Ava, Diya, and Alloy URLs return HTTP 404. No nonworking playback buttons or
  implicit paid synthesis are added.
- `/config` includes the complete bundled voice catalog without acquiring an
  Azure token or calling a discovery API. Editor, Runtime and WebRTC
  initialize from these defaults immediately. Native voice names and locales
  come from the versioned [native reference](static/handoff/native-voices.json);
  they are not guessed from short voice names. A compound locale uses its first
  locale as the group and retains the others as metadata.
- `/api/voices` optionally refreshes native metadata using the selected account's
  `/voice-live/capabilities?api-version=v1`. Account-level Speech discovery access
  is **not required to open the Portal or select a voice**. Credential failures,
  denied access, timeouts and invalid capabilities return the full bundled
  catalog with `source: "bundled"`, `discoveryError` and an explicit notice,
  rather than making the editor unavailable. Actual Agent publication and voice
  sessions still require their normal permissions.
- Azure Speech TTS choices use the full, generated
  [reference catalog](static/handoff/azure-voices.json), not a hand-maintained
  shortlist. It currently contains 974 voices across 154 locales. This is a
  reference list from its documented region, **not** a guarantee that every
  voice is available in the selected Project's region. The picker displays this
  distinction. Optional discovery runs in the background; a visible status and
  **Retry live voice discovery** action explain failures without discarding the
  current selection or edits. Server discovery is bounded to 5 seconds and
  concurrent requests share one lookup. Live results are cached per Project
  for 5 minutes, bundled failure results for 1 minute; explicit retries bypass
  that failure cache. The browser also bounds discovery to 8 seconds.
  Refresh the reference using an authorized account in a supported Speech
  region, without saving any key or token:

  ```bash
  .venv/bin/python voice_catalog.py \
    --project-endpoint "https://<account>.services.ai.azure.com/api/projects/<project>" \
    --reference-region "<account-region>"
  ```
  The native reference records its region and capture date separately; refresh
  it from a successful capabilities response when updating native defaults.
- Voice choices are independent of the model in the Portal: changing models
  preserves the selected voice, and voice options are neither disabled nor
  hidden by model rules or the old project probe file. The actual voice type is
  preserved on publication and session overrides. This is not a claim that every
  service configuration works; service rejections remain explicit errors. The
  TTS reference provenance remains separate from live Project discovery.
- **Try it now** also works for an existing Agent loaded from the sidebar. If its
  published definition is unchanged, it opens that Agent in Runtime and
  starts the voice session without publishing another version. If the existing
  Agent has local edits or is a draft, it publishes and verifies a release first.
  Grant microphone permission when prompted. This start request is consumed once
  in the same browser tab; reloading or sharing the Runtime URL does not start
  another session.
- For a new working copy, **Try it now** automatically validates and publishes the edited definition, verifies it with an API
  readback, and opens Runtime with the runtime graph expanded. For a
  Template working copy, publication first checks its MCP configuration.
  Default Templates bind the hosted HTTPS endpoint directly without credentials;
  the optional managed local allowlist refreshes the Project connection instead.
  It is the Editor page's single publication action; no separate Validate
  button is needed. A progress dialog
  reports validation, MCP refresh, version publication, readback verification,
  and Runtime launch; failures stop on the owning step without discarding
  the local working copy.
  New working copies and ordinary Runtime links preserve the explicit-connect
  policy: select **Connect & start session** when you are ready to use
  microphone/audio.
- **Debug mode is off by default** on Editor, Runtime, and WebRTC.
  Enable the page header's **Debug mode** checkbox to inspect model/STT/TTS
  cost and latency estimates, runtime latency breakdowns, and per-turn metrics
  (including STT and User→Agent). Turning it off also removes open metric details;
  transcripts, tools, and background metric collection continue unchanged.
  The choice is page-local and resets on reload or navigation. In Runtime,
  this replaces the former **Developer mode** switch and also shows protocol
  events. WebRTC review keeps latency trajectories and raw message metadata
  behind the same switch.
  The Runtime notice also shows its auxiliary WebRTC and local-session-log
  links only in Debug mode. The notice and license link remain visible; direct
  routes are unchanged. This does not certify WebRTC connectivity.
- In Debug mode, node costs use US cents per minute (`¢/min`), and latency shows only the
  range, without `normalized` or `estimated` labels. Expanding a graph card's
  metrics shows a short disclaimer, not a calculation walkthrough. **Edit node**
  and the Transcriber, Model, and Voice comparison tables use the same concise
  disclaimer; actual results vary by usage, pricing, and network conditions.
- Cost comparisons are not an invoiced per-minute tariff. The approved temporary
  adjustment divides **only the prior LLM component by 150**, including its
  Realtime native-input allowance. STT and TTS still each budget a full 60 seconds;
  their rates, amounts and all latency values are unchanged. Pipeline totals add
  those unchanged speech components to the adjusted LLM component.
  The prior workload (10 requests/minute, each with 64,000 uncached text-input,
  2,000 text-output and 6,000 Realtime native-input history tokens) is retained
  only as the adjustment baseline, not as a realistic default workload.
  A new request/context/output estimate requires approval before replacing this
  temporary policy. This factor is not a provider discount or a change to billing.
  Prices are
  rounded up to hundredths of a US cent. Standalone OpenAI transcription prices
  are not treated as verified Voice Live auxiliary prices: those selections
  reserve at least 2 cents per input-audio minute. Publicly unverified model
  rates use higher, explicitly identified allowances instead of guessed cheap
  tiers. This comparison is not a spending cap; longer context, additional
  calls, tools, training, hosting or other features can increase actual charges.
- Runtime renders the runtime handoff topology with the same layered
  cards, pipeline badges, route curves, and active-node treatment as Handoff
  Graph authoring. Every node accumulates **Dwell** wall-clock time while it is
  active and **User turns** attributed to that node. Re-entering a node adds to
  the existing totals and increments its visit count. Spoken turns are assigned
  to the node that was active when speech started; typed turns are assigned
  when they are sent. Runtime numbers refresh every two seconds with a flip
  transition; **Share** divides 100% of elapsed active-node time across the
  visited nodes. With **Debug mode** enabled, click the bottom metric strip to inspect observed Average,
  P50, P95, and latest turn latency plus the shared editor catalog's estimated
  STT/LLM/TTS latency and cost. On desktop, drag the divider between **Agent
  Debug** and **Live conversation** to give either side more room; arrow keys
  resize the focused divider. Desktop starts with **50% Agent Debug / 50% Live
  conversation** and keeps that split while the window changes size, unless
  you manually resize it. Double-click the divider or press **Home** to return
  to equal widths. Narrow screens retain the stacked layout.
- Before a runtime path reaches a node, its full card is covered by a gray
  **NOT VISITED** veil. The current node has the animated rainbow **LIVE**
  treatment. Leaving a node after handoff shows a large filled green
  **COMPLETED** badge and a checkmark icon without changing the card's size.
  Re-entry returns it to LIVE. A normal server-side session end completes the
  last visit; manual cancellation or an abnormal disconnect shows **STOPPED**,
  not a false completion. COMPLETED describes the node visit, not successful
  completion of every external business operation.
- The Handoff Graph **Load from templates** picker reads the allowlist in
  `templates.config.json`. It exposes
  `example1_finance_with_handoff_realtime` and
  `example1_finance_with_handoff_cascade` as separate Realtime and Cascade cards,
  and also detects `example2_finance_with_OTP_and_Officer_Search` and
  `example3_elevator_service_with_safety_zendesk_and_handoff`. The
  `example5_customer_support`, `example6_appointment_setter`, and
  `example7_receptionist_messaging` handoff examples, and the 27
  reference-template `example8_*` through `example34_*` handoff examples,
  call mock tools on the public `/mcp/mock-tool-call` route by default and
  need no MCP setup. `example35_conference_concierge` (Conference Concierge, Ignite 2026,
  official data only) uses the hosted `/mcp/conference` route; its README also describes running
  the pack locally. Each card has a **Version** selector: **Default** loads
  the configured Agent file;
  other versions are discovered recursively under that sample folder using
  the same filename (normally `agent.json`). Version names join the relative
  folders with `/`, for example `backups/20261020T011523936708Z/original`.
  Choose a version before **Load into canvas**. Loading creates a working copy
  without modifying the sample or backup. Select **Reload** to rediscover
  versions and reread their files. Invalid versions are reported without
  hiding valid versions; files resolving outside the sample folder are rejected.
  The internal Templates page also has a **Version** selector, and its preview,
  MCP checks, and publication use the selected definition.
  Versions under a sample's `backups/` folder are earlier or experimental
  variants of that Template; selecting one is not a quality acceptance or a
  change to the default. Each backup manifest records the exact snapshot.
  The eight original templates and every selectable backup explicitly use 400 ms
  `azure_semantic_vad` silence. Non-Cascade definitions use `gpt-realtime`, not
  `gpt-realtime-2.1`; the Finance Cascade card uses `gpt-4.1-mini`.
  Pre-runtime-update source bytes and manifests are retained separately and
  are not selectable versions. These parameter changes are not a new live
  latency, interruption or listening acceptance.
- Examples 5–34 have independently named personas and greetings. Their default en-US output uses `en-US-Emma:DragonHDOmniLatestNeural` or `en-US-Brian:DragonHDOmniLatestNeural`. Voice names are speaker identities, not the names the agents introduce themselves with.
- **Automatic voice language** is an explicit action in the Editor's starter-node Voice panel. It does not run when publishing or connecting from Runtime. Changing the shared STT input language does not automatically change the output voice. Voice selection does not translate prompts or greetings.
- The priorities in `static/voice-presets.json` cover en-US, en-IN, hi-IN, zh-CN, en-GB, es-US, fr-FR, de-DE, and ja-JP. Preferred Hindi output uses Diya Dragon, with Swara Neural as a regional fallback; Chinese uses Xiaoqi/Yunfan Dragon, with Xiaoxiao/Yunxi Neural fallbacks. Male voice preferences use male variants when available. Other explicitly requested locales can use voices listed for that locale in the regional catalog.
- Editor and Templates publish the selected root and handoff-node voices without a regional voice-availability precheck or automatic substitution. Runtime also connects with the published voices. A failed metadata catalog must not block these operations; Foundry's actual publication/session response determines whether the voice is supported.
- Only an explicit **Automatic voice language** selection queries the selected project's region and the public catalog at `https://<region>.tts.speech.microsoft.com/synthesize/list/cognitive-service/voices?showHidden=true`. That optional action may require management-plane read access for region discovery; its Voice panel accepts the actual Project region when discovery is unavailable. Successful lookups are cached for ten minutes. This helper reports selections and errors but does not gate subsequent publication.

- Template MCP readiness calls `initialize` and `tools/list` against the hosted
  endpoint without an Authorization header and checks every declared tool.
  Publishing sets that endpoint on every MCP tool, including handoff nodes,
  and removes Project connection IDs and credentials. A newly created Foundry
  Project needs no MCP connection. New Agents retain the `local-only-*` naming
  prefix for compatibility; for default Templates this does not imply a local
  MCP dependency. Previously published Agents keep their old bindings until
  republished.
- Choose an existing agent or create one. The browser sends service-shaped
  REST requests through the local authenticated backend. Agent pickers load the
  first 25 Voice Agents and fetch later cursor pages only when you select
  **Load more agents**, so projects with large Agent catalogs become usable
  without waiting for a full catalog scan. In Studio, **Session agent** is a
  searchable card dropdown with Agent icons, model/version details and a mint
  selected state. Long names wrap to two lines; the full ID remains in the
  field and tooltip and is never changed for API calls or copied URLs. Choose
  a card or use the arrow keys and Enter; Escape restores the selected Agent.
  Enter or **Search** also resolves an exact Agent name even when it is on a
  later page. The dropdown fits the available viewport and stays locked while
  a session is connected.
  Creation uses `POST /agents/<name>/versions` and flat `voice` / `voice_type`
  audio fields, matching this repository's current REST/Projects SDK samples.
  The Voice tab keeps **Input transcription (STT)** separate from
  **Speech output (TTS / voice)**. Changing the model disables incompatible
  transcription choices but preserves the selected output voice.
  **Input language** defaults to **Auto**. Auto detects the input language;
  selecting the expected language can improve recognition accuracy. The Editor
  and Runtime creation form share a checkbox list: open it, then check
  languages in locale-code order, with the locale first and the name in
  parentheses, such as **en-IN (English (India))** and **hi-IN (Hindi (India))**.
  Each checked row represents one complete locale: selecting `en-IN` never
  checks `en-US`, `en-AU`, `en-GB` or `en-CA`. The local working definition
  retains the selected locale, including for single-language models.
  Prefix search is optional. Select **Auto** to clear explicit languages;
  unchecking the final candidate also returns to Auto when the model supports it.
  The list expands to as much as **560 px** of available height, opening above
  or below the field to fit the viewport. It uses the browser's top layer so
  scrolling cards and editor panels cannot clip the language options. Both
  Editor and Runtime use the same positioning and selection behavior.
  In the Editor, the input is located in
  **$entrypoint > Overall settings > Speech input**. Specialist nodes do not have a language input;
  their Transcriber panels link to the entrypoint's shared setting. Both STT and input
  language apply to every graph node. The forms use the
  [Voice Live multilingual input list](https://learn.microsoft.com/azure/ai-services/speech-service/voice-live-language-support):
  Azure Speech uses the full published Speech locale list; other models use the
  15 Voice Live input locales, including `hi-IN`.
  Click the field or arrow to open the checkbox list. Clicking or tapping outside,
  pressing Escape, or using the arrow again closes the list without clearing
  any checked languages. Clicking inside stays open for further selections. The request
  uses a full locale for Azure Speech and a language code where the STT model
  requires it. Selecting a language sends `audio.input.transcription.language`
  in the real version-create request; Auto omits that field. Loading an Agent
  preserves existing languages, including ordered Azure Speech candidate lists.
  Incompatible language/model combinations are shown as errors, not silently
  reset to Auto. These are documented catalogs, not a per-region audio test.
  The entrypoint's **Overall settings** section contains session behavior,
  greeting, audio transport, and turn-taking. The canvas **Export/Import** button shows the complete definition: shared settings are
  on its root, while node overrides live under `handoff.nodes[].config`.
  Field labels, including **Input language**, have a **?** button with detailed
  explanations of purpose, scope, units, examples, and relevant tradeoffs.
  Hover or focus to read, or click to keep the explanation open. Explanations
  also use the top layer, fit within the browser viewport, and scroll internally
  on short screens instead of being clipped by a card or panel. **Escape** closes
  an explanation without closing the editor or discarding edits. Reading help
  never changes the Agent's configuration.
  Voice choices
  are grouped by locale without model-based disabling. Realtime models still
  select a transcription model for transcript events even though the model
  itself consumes audio directly.
  Voice selection opens above the Agent settings, including the input-language
  picker. At narrow or zoomed viewports it uses the full editor overlay rather
  than the space between the node header and footer. Voice locale/search filters
  stay visible while the voice table scrolls independently.
  The Playground keeps search, Agent metadata, session settings, and connection
  actions in compact rows so the transcript retains most of the runtime page.
- Agent links select an agent but never start a session automatically.
  Press **Connect & start session** explicitly; legacy `autostart=1` is ignored.
- Use a headset and grant microphone permission for real audio. WebSocket PCM,
  WebRTC, and avatar signaling retain their upstream implementations.
  WebSocket greeting audio remains queued in order while microphone startup
  completes, so later sentences do not overlap earlier ones. Speaking still
  interrupts and clears queued playback immediately.
- Creation and version edits change your Azure project and may incur charges.
  **Stopping the portal never deletes agents.** Manage unwanted agents in your
  Azure project separately.
- Managed models, guided authoring, hosted-agent wrappers, greetings, handoffs,
  tools, avatars, and WebRTC depend on the capabilities enabled in your project.
  The selectable examples are not a guarantee of model or feature availability.
- **Save conversations** defaults off for newly configured agents. Enable it
  deliberately to use **View persisted** and audio downloads. Existing agents
  retain their stored policy. Runtime never overrides that policy; change it in
  **Editor** and publish a new version to use a different policy.
- **View persisted** and the WebRTC review still open a captured conversation
  directly. If no ID was captured, choose a recent ID or paste a known historical
  ID and click **Open conversation**. No transcript, tool result, or audio is
  fetched just because a shared agent has a newer conversation.

The standalone Editor page is
**http://127.0.0.1:9527/editor/**. Existing `/handoff/` links permanently
redirect to this address. The standalone WebRTC page is
**http://127.0.0.1:9527/webrtc** and uses the same
configured Foundry project. Its Agent field also accepts an exact name outside
the loaded pages and resolves that resource directly before starting. Its media
helper uses Google's public STUN server
(`stun:stun.l.google.com:19302`) for network discovery; ensure that dependency is
appropriate for your environment. Avatar ICE settings still come from the
configured service. Use fictitious identity/contact details in the digit demo.

The Editor's **Transcriber** panel and **Overall settings**, plus Runtime's
creation form, offer every listed transcription model without model-family
locks or project-probe filtering. Changing a model or model source preserves the
selected STT. GPT Realtime can use **Azure Speech**; Whisper is not mandatory.
Open **Transcriber** on the entrypoint or any specialist node to choose STT.
The selection updates the Agent-level `audio.input.transcription.model` shared
by all nodes, not a separate per-node field.

The service validates model, project, and regional support when publishing or
starting a session. A rejection remains visible and does not silently replace
the selection or discard the working copy. Local structure and input-language
validation still apply. The native-audio-only cost-estimate placeholder is not
offered as a transcription model because it is not a service model identifier.

The canvas **Export/Import** button opens the entire local Agent
definition, including shared settings, every node, and every edge. It always opens
in YAML, supports a JSON preview and **Import from agent**, and does not
publish or modify the working copy just by viewing it. The same view is available
while editing any node, including the entrypoint.

Single-click the prominent green **Overall settings** button on the graph's
`$entrypoint` card, labeled **Click to configure the entire Agent**, to open the unified
**Entrypoint / Overall settings** editor. The Nodes list also marks `$entrypoint`
as **overall**. Input language, shared STT, greeting, conversation storage,
audio transport, and turn detection are edited alongside the entrypoint's
model, voice, instructions, tools, and interim responses. These shared settings
apply to the entire graph; specialist nodes retain their own configured overrides.
There is no separate **Agent General Settings** button or editing mode.
**Save node** saves all changes from this editor to the local working copy as
one undoable edit; **Back to graph** or Escape discards unsaved changes.
Clicking outside the node editor does not close it or discard edits.
Specialist Transcriber panels link directly to the entrypoint's input language.
No changes reach Foundry until **Try it now** publishes.

After editing a node field, click a Transcriber, Model, or Voice card directly to
open its configuration. The first click or tap commits the field locally and
opens the panel; there is no need to leave the field first. **Back to graph**
still discards unsaved node edits.

### Optional configuration

Foundry configuration must refer to **your** resources. The Template catalog
separately defaults to the shared fictional-data MCP described above.

| Environment variable | Purpose |
| --- | --- |
| `VOICE_PORTAL_REALTIME_DEPLOYMENTS` | Comma-separated BYOM realtime deployment names. |
| `VOICE_PORTAL_CASCADED_DEPLOYMENTS` | Comma-separated BYOM text-model deployment names. |
| `AZURE_VOICE_AGENTS_MCP_CONNECTION_ID` | Pre-fill your MCP project connection. |
| `AZURE_VOICE_AGENTS_MCP_SERVER_LABEL` | Label for that connection; default `mcp`. |
| `AZURE_VOICE_AGENTS_FOUNDRY_IQ_URL` | Your knowledge-base MCP URL. |
| `AZURE_VOICE_AGENTS_FOUNDRY_IQ_CONNECTION_ID` | Your knowledge-base connection. |
| `AZURE_VOICE_AGENTS_TOOLBOX_NAME` / `AZURE_VOICE_AGENTS_TOOLBOX_VERSION` | Your versioned Toolbox. |
| `AZURE_SUBSCRIPTION_ID` / `AZURE_RESOURCE_GROUP` | Optional project metadata enabling **View trace**. |
| `DEMO_PORT` | Local listener port; default `9527`. |
| `AZURE_CREDENTIAL_MODE` | `default` or `cli`; the latter pins Azure CLI identity. |
| `VOICE_PORTAL_HOST` | Loopback bind host; default `127.0.0.1`. |
| `VOICE_PORTAL_DATA_DIR` | Debug log root; default `~/.voice-agent-portal`. |
| `VOICE_PORTAL_RECORD_SESSIONS` | Record session debug artifacts by default; set `false` to disable. |
| `VOICE_PORTAL_TEMPLATE_CONFIG` | Alternate template allowlist path for contributor testing. |

BYOM deployment lists are configuration, **not** automatic ARM discovery. The
portal does not enumerate your subscriptions or retrieve connection secrets.
Prefer project connections over entering MCP authorization tokens in the UI:
manually entered tokens are part of the draft/definition and must not be shared
in YAML, screenshots, or logs.

### Local event recording

Local session recording is enabled by default.
Artifacts are written under `~/.voice-agent-portal/sessions/`, or the directory
selected by `--data-dir` / `VOICE_PORTAL_DATA_DIR`. Use
`--no-record-sessions` or `VOICE_PORTAL_RECORD_SESSIONS=false` to disable it.
Audio payloads are elided and common credential fields are
redacted, including JSON-encoded tool arguments/results and nested JSON tool
content. Invalid, oversized, or excessively nested JSON tool data is omitted
rather than recorded unsafely. Ordinary text results remain readable, so
**transcripts, prompts, and free-text tool data may still be sensitive**.
Protocol error events and `response.done` events with `status: failed` are
promoted into the session summary and timeline.
Recording is separate from the agent's Azure `store` policy. Do not commit or
share these logs. The **Local session logs** link
opens the included viewer.

The portal also writes a permission-restricted rotating `server.log` in the
data directory (5 MiB, three backups). HTTP access logging remains disabled
because raw request URLs can contain structured input; portal API and bridge
events are logged only after sensitive query values are redacted.

Backend failures are returned to the active page instead of being visible only
in `server.log`. HTTP APIs return a JSON error with a request ID, and the voice
WebSocket sends a structured `portal_bridge_error` event before it closes.
The same request ID appears in the browser message and server log so the two
sides can be correlated. Credential-shaped values are redacted from propagated
exception text.

## Develop and validate

Frontend development requires **Node.js 22+**. From this directory:

```powershell
cd web
npm ci
npm run build:all
npm test
npx playwright install chromium
npm run test:ui
npm run test:defaults
npm run test:local
cd ..
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
.\.venv\Scripts\python.exe -m pip check
```

`npm run test:ui` runs the ported browser regressions with mocked Azure
boundaries. `npm run test:local` starts the **real Foundry-only Python portal**
on loopback port `8097`, using `tests/serve_portal.py` to substitute only the
Azure credential and upstream transport with test fixtures. It drives creation,
YAML edits, WebSocket responses, persisted-data retrieval, and microphone startup
through a synthetic browser device. The application has no test/offline runtime
mode. These tests do not prove a real Azure conversation.
The browser fixture supplies synthetic MCP configuration and a temporary bearer
file; it does not require a running Dev Tunnel or local MCP credentials.

`npm run test:defaults` is the first-user release gate. It runs the dedicated
default-flow suite against the checked-in browser assets, without opening or
saving General Settings. It covers blank creation and conversation, reopening
without another publication, JSON round trips, flat-Agent imports, discovery
failures, visible publication failure and retry, and every enabled Template's
untouched Default version. New catalog cards enter this suite automatically.
Each successful path checks the publication response, exact persisted definition,
runtime connection, assistant reply, and session stop, not merely a button click.
The playground-mode browser cases exercise UI defaults; hosted policy and real
Azure acceptance must also pass before a hosted release. This suite is included
in `test:local` and uses a separate output directory when run as `test:defaults`
so concurrent browser runs do not remove its trace artifacts.

The static UI fixture uses `8098`. Both test servers are stopped by Playwright;
neither test helper is used by `demo_server.py`.
Set `VOICE_PORTAL_TEST_PORT` to use another loopback port for local browser tests
when `8097` is already in use.

For the browser tests you can use an installed Edge browser instead:
`$env:PLAYWRIGHT_CHANNEL='msedge'` (POSIX: `export PLAYWRIGHT_CHANNEL=msedge`).
`VOICE_PORTAL_PYTHON` can point to a Python environment other than `.venv`.
Run the two browser commands sequentially because their build steps write the
same checked-in bundles.

Use `npm run watch` / `npm run watch:webrtc` while editing. Rebuild **both**
bundles before committing.

### Voice-selection contributor checks

`POST /api/voices/resolve` is a Portal-local helper, **not** the proposed Vienna template/tool-binding API. It accepts `definition`, optional `language`, `region`, `voice`, and `mode` (`fallback` or `automatic`), and returns a copied `definition`, resolved `region`, and per-field `resolutions`. No credentials or caller content are included in catalog requests or selection logs.

Install the optional pytest developer tool with `python -m pip install pytest`, then run mocked checks with `python -m pytest tests/unit tests/test_templates.py tests/test_portal.py`. Opt-in live tests use `VOICE_POLICY_LIVE_TESTS=1`, `AZURE_VOICE_AGENTS_ENDPOINT`, and `VOICE_POLICY_EXPECTED_REGION`; run `python -m pytest tests/end_to_end/test_voice_policy_live.py`. They query real catalogs, read the project region, and create short-lived test agents with conversation storage disabled. Audio-only tests have no tools; the Customer Support conversation only reads fictional CRM data from the stateless mock. Test agents are deleted afterward.

The tests check fresh, unique persona names, consistency between root/node instructions and greetings, and actual email read-back/confirmation before Customer Support CRM lookup. Prompt checks do not replace conversational evaluation: identity/privacy and consent rules remain unchanged.

Tool-connection regressions are in `tests/unit/test_tool_connections.py` and the Editor browser tests. The first `/api/tools/connect` request may omit `tool_map`: a complete name match connects immediately, while incomplete discovery returns `connected: false` and mapping choices without changing the definition. An explicitly supplied map is always checked against a fresh server listing; an invalid map is never silently replaced with an automatic suggestion. `/api/tools/discover` remains backward compatible.

For the real handshake check, set `TOOL_CONNECT_LIVE_TESTS=1` and `VOICE_TOOL_TEST_URL` locally, then run `python -m pytest tests/end_to_end/test_tool_connect_live.py`. This test wraps the real handshake to assert exactly one call; it does not mock the external server, call business tools, or publish an Agent. Treat URLs containing access tokens as credentials and do not check them into source.

## Safety and troubleshooting

- This is a **single-user local sample**, not an authenticated hosted portal.
  It binds only to loopback and rejects cross-origin browser requests and
  unexpected Host headers. Do not expose it through a tunnel, proxy, or public
  listener without a separate authentication/security design.
- `401` / `403`: check Azure sign-in, project permissions, and preview access.
- `404` / unsupported feature: verify the project endpoint and available
  service capabilities; remove unsupported options from the definition.
- Missing browser assets: run `npm ci` and `npm run build:all` in `web/`.
- Microphone unavailable: use localhost and a supported browser, check
  permissions/hardware and your Foundry project access.
- No saved conversation: enable the desired agent/session storage policy,
  finish the session, and allow time for Azure persistence.

Microsoft copyright notices and bundled third-party license comments are
retained. Full bundled-dependency notices ship with the browser assets in
[THIRD_PARTY_NOTICES.txt](static/THIRD_PARTY_NOTICES.txt); keep that file with
both bundles when redistributing them. See the repository [license](../LICENSE.md).
