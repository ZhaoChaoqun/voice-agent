# Foundry GPT Live with the Azure AI Projects Python SDK

English-teacher voice samples that create or reuse agents in an existing Foundry
project, stream microphone audio through a GPT Live session, and display user/agent
transcripts, all with the Azure AI Projects SDK. They cover all three ways GPT Live can
delegate work:

| Delegation | Sample | Who answers |
| --- | --- | --- |
| Responses (`responses`) | `response_delegation.py` | A Responses model deployment that Foundry calls. |
| Foundry-managed agent (`foundry_managed_agent`) | `prompt_agent_delegation.py`, `prompt_agent_delegation_tools.py` | A versioned prompt agent that Foundry runs; the tools sample adds an MCP calculator and a local function. |
| Client (`client`) | `client_delegation.py` | This app: it reads the computer's clock or adds two whole numbers, and replies on the Live session. |

Every agent also has a **greeting** and **structured inputs**: the learner's name and
English level personalize the instructions and the greeting for each session (see
[Greeting and structured inputs](#greeting-and-structured-inputs)). The Agent area has
separate **GPT Live** and **Delegation** panes; delegation IDs, status, and guidance appear
in the Delegation pane.

Agents are defined with the SDK's typed `VoiceAgentLiveDefinition` and
`PromptAgentDefinition` models and created, read back, and deleted through
`AIProjectClient.agents`. Audio sessions use the SDK's Live WebSocket client,
`AIProjectClient.beta.voice_agents.live.connect(...)`, with the same credential.
These GPT Live APIs are not in a PyPI release yet, so `requirements.txt` installs the
bundled preview wheel `dist/azure_ai_projects-2.11.0-py3-none-any.whl`, built from the
SDK's `feature/azure-ai-projects/vnext` branch with the GPT Live WebSocket client; see
[`dist/README.md`](../../../dist/README.md) for its source and checksum.

The samples send and receive Live messages only through the SDK; they do not use the
OpenAI SDK. The SDK returns generated models for known Live events and plain dicts for
any event it does not model yet. Both are mappings, so the samples dispatch on
`event.get("type")`. Every event these samples handle is modeled except
`session.delegation.done`, which Foundry sends when a managed delegation finishes
(`delegation_id`, `status`, `error_code`, `response_id`); the samples show it as the
delegation's final status.

## Files

| File | Description |
| --- | --- |
| `response_delegation.py` | Checks deployments, runs the voice conversation, and prints its ID and download command. |
| `prompt_agent_delegation.py` | Creates a prompt agent first, creates a GPT Live voice agent pinned to it, and runs the shared voice conversation. |
| `prompt_agent_delegation_tools.py` | Adds a server-executed MCP calculator and a client-executed current date/time function to the managed prompt agent. |
| `client_delegation.py` | Creates a GPT Live agent with client delegation and answers its delegations in this app. |
| `audio_common.py` | Captures microphone audio and plays the agent's response. |
| `transcript_common.py` | Independently scrollable GPT Live, Delegation, and User terminal panes. |
| `../../download_conversation_artifacts.py` | Existing separate downloader for conversation JSON, per-item audio, and merged audio. |
| `requirements.txt` | Required Python packages and versions, including the bundled preview Projects SDK wheel. |
| `../.env.example` | Configuration template, shared with the [JavaScript sample](../js/README.md). |
| `../.env` | Your local project, agent, deployment, and subscription settings; git-ignored and shared with the JavaScript sample. |

## How to run

Requires Python 3.11+, Azure CLI, a microphone/headset, and a Foundry project with the
Voice Agents / GPT Live preview, a GPT Live deployment, and a Responses deployment.
On Linux, install the PortAudio runtime (`libportaudio2` on Ubuntu/Debian).

These samples use their own virtual environment, `samples/gpt_live/python/.venv`, not the
shared repository-root `.venv`. The preview 2.11.0 build changes some APIs that other
samples use with the PyPI release (for example, `VoiceAgentSubagentConfig` no longer takes
`subagents`, and realtime structured inputs are sent as `structured_inputs`), so keep it out
of the shared environment. From the repository root, in PowerShell:

```powershell
az login
if (-not (Test-Path -LiteralPath samples\gpt_live\python\.venv\Scripts\python.exe)) { python -m venv samples\gpt_live\python\.venv }
$py = "samples\gpt_live\python\.venv\Scripts\python.exe"
& $py -m pip install --index-url https://pypi.org/simple -r samples\gpt_live\python\requirements.txt
if (-not (Test-Path -LiteralPath samples\gpt_live\.env)) { Copy-Item samples\gpt_live\.env.example samples\gpt_live\.env }
```

Run the install from the repository root: pip resolves the wheel path in
`requirements.txt` from the current directory. The commands below use `$py` from this block.

In `samples/gpt_live/.env`, set `FOUNDRY_PROJECT_ENDPOINT`. Authentication uses
your `az login` account through `AzureCliCredential`, with automatically refreshed
Entra tokens for agent management and the Live WebSocket handshake. No API keys or manually
copied tokens are needed. If you have multiple signed-in subscriptions, set
`AZURE_SUBSCRIPTION_ID` to select the right account without changing the CLI default.

To use an existing GPT Live agent, set `AGENT_NAME=your-agent-name` in `.env`.
Its latest version and saved configuration are used without creating, updating,
or deleting the agent. The deployment variables below are ignored in this mode.

Leave `AGENT_NAME` blank to create a new English-teacher agent, and configure both
deployments:

```dotenv
GPT_LIVE_DEPLOYMENT=YOUR-GPT-LIVE-DEPLOYMENT
RESPONSE_DELEGATION_DEPLOYMENT=YOUR-DELEGATION-DEPLOYMENT
```

If you used the older sample, rename `GPT_LIVE_DELEGATION_DEPLOYMENT` in your
local `.env` to `RESPONSE_DELEGATION_DEPLOYMENT`, and run
`response_delegation.py` instead of `foundry_gpt_live_openai_sdk.py`.

Both names are required for new agents. Existing agents' saved deployments are
checked instead. The sample does not create deployments. Never commit `.env`.

Run:

```powershell
& $py samples\gpt_live\python\response_delegation.py
```

Wait for **Ready**, speak into your microphone, and press **Ctrl+C** to stop.
Text starts at the top of each pane and fills downward.
Scroll each pane with the mouse wheel, or use **Tab / Shift+Tab** to focus it and
**arrows / PgUp / PgDn / Home** to scroll. **End** resumes following new text.
Scrolling one pane does not move the others; full history remains after exit.
New agents are kept by default; add `--auto-delete` to delete only an agent created
by this run. Existing agents are never deleted, even with `--auto-delete`.

New agents are created with `store=True`. When `AGENT_NAME` is set, the existing
agent's storage policy is left as-is; no session override or agent update is sent.
After close, if a persisted conversation ID is returned,
the sample prints the Foundry conversation ID and a command for the existing
`samples/download_conversation_artifacts.py`; it does not download anything itself.
Run that command from the repository root, with `AZURE_VOICE_AGENTS_ENDPOINT` set to the
same value as `FOUNDRY_PROJECT_ENDPOINT`. The separate downloader waits for
persistence and saves JSON and audio to `voice-agent-output/<conversation-id>/`.
Keep the agent (omit `--auto-delete`) if you want to download later.

On macOS/Linux, also run from the repository root: use `python3` to create
`samples/gpt_live/python/.venv` if needed, `samples/gpt_live/python/.venv/bin/python` for
install/run commands, and `/` path separators. Keep `.env` in `samples/gpt_live/`, not in the
environment directory; the Python and JavaScript samples read the same file.

## Greeting and structured inputs

Every voice agent these samples create declares two structured inputs and a template
greeting that uses them:

```json
{
  "structured_inputs": {
    "learner_name": {"description": "What the teacher calls the learner.", "default_value": "friend"},
    "level": {
      "description": "The learner's English level.",
      "default_value": "intermediate",
      "schema": {"type": "string", "enum": ["beginner", "intermediate", "advanced"]}
    }
  },
  "instructions": "... The learner's name is {{learner_name}}, and their English level is {{level}}. ...",
  "greeting": {"type": "template", "text": "Hi {{learner_name}}! I'm your English teacher. What would you like to practice today?"}
}
```

Each session supplies the values when it connects, with
`live.connect(..., structured_inputs={"learner_name": ..., "level": ...})`; the SDK sends
them as JSON in the handshake query. Foundry fills them into the instructions and the
greeting, and GPT Live speaks the greeting as soon as the session starts. Choose the
values with `--learner-name` (default `Alex`) and `--level` (default `intermediate`) on
any sample:

```powershell
& $py samples\gpt_live\python\response_delegation.py --learner-name Mei --level beginner
```

The sample prints the inputs it sends. With `AGENT_NAME`, only the inputs that agent
declares are sent; an agent that declares none gets none.

## Managed prompt-agent delegation

Use the same environment, dependencies, and `az login` setup above. The project
must support GPT Live **Foundry-managed delegation with tagged-text results**.
Both agents are created in that same project; cross-project delegation is not used.
Set both `GPT_LIVE_DEPLOYMENT` and `RESPONSE_DELEGATION_DEPLOYMENT` in `.env`.
Here the latter is the **text-model deployment for the prompt agent**, not a
direct Responses backend.

From the repository root, run:

```powershell
& $py samples\gpt_live\python\prompt_agent_delegation.py
```

This sample always creates two fresh agents; it ignores `AGENT_NAME` and leaves
existing agents untouched. The voice agent has the same greeting and structured inputs:

1. Create an English-teacher **prompt agent** with plain-text output and versioned
   instructions requiring `[commentary]` and optional `[thinking]` sections.
2. Create a **GPT Live voice agent** with `store=True` and the prompt's exact
   returned version:
   ```json
   {
     "delegation": {
       "type": "foundry_managed_agent",
       "agent_name": "<created-prompt-agent>",
       "agent_version": "<returned-prompt-version>"
     }
   }
   ```
   The result format defaults to `tagged_text`, matching the demo portal.
3. Connect through the SDK's Live client. Foundry executes the prompt agent and
   forwards accepted guidance; the client only streams audio and displays events.

Ask: **"Please correct my English: I goed to school yesterday. Explain why."**
The service emits `session.delegation.created` with
`delegation.target="foundry_managed_agent"` as an ownership notification, not a
request for the client to execute the prompt agent. Native `client` or `responses`
targets are rejected in managed mode; no fallback executor is started.
The prompt agent's Responses stream then arrives as `response.event` with that
delegation ID, and the Delegation pane shows its status and raw tagged-text output.
Foundry validates that output and appends accepted sections to GPT Live itself;
each `session.commentary.appended` or `session.thinking.appended` acknowledgment
marks the delegation as forwarded. These acknowledgments carry no text or
delegation ID, so the sample attributes them to the latest delegation. When the
delegation finishes, Foundry sends `session.delegation.done` with its final status.
The `[thinking]` section is factual background, not private reasoning. Backend
guidance is kept separate from the transcript of what GPT Live says. Backend
failures stay visible without a client-side retry or fallback executor.

Add `--create-only` to create and keep both agents without opening the microphone.
Otherwise, press **Ctrl+C** to finish. Both agents are kept by default; add
`--auto-delete` to delete only this run's agents on exit, voice agent first.
It also cleans up the prompt agent if voice-agent creation fails. Keep both
agents if you want to reconnect or download the voice conversation later.
`response_delegation.py` can reconnect using `AGENT_NAME=<created-voice-agent>`.

Prompt/backend conversations follow their own persistence policy, independently
of the voice agent's `store` setting. The sample does not set `store` on the prompt
definition. `--auto-delete` deletes the two agent resources; it is not a separate
purge of backend responses or conversations.

## Managed prompt agent with MCP and local function tools

Use the same setup and `.env`, then run:

```powershell
& $py samples\gpt_live\python\prompt_agent_delegation_tools.py
```

The new prompt agent has two tools:

- **MCP calculator:** the public, unauthenticated
  `https://voice-mcp-auth-tests.graysky-8afcdfd2.eastus2.azurecontainerapps.io/noauth/mcp`
  server. Only its `add(a, b)` tool is exposed; both arguments are integers.
  Foundry calls this server directly, with `require_approval="never"` and no
  credentials. This test endpoint is not a production dependency.
- **`get_current_datetime`:** a local Python function returning the sample
  computer's current local time, timezone, and corresponding UTC time as ISO 8601
  timestamps with UTC offsets. It takes no arguments.

Try **"What is 17 plus 25?"**, **"What is the current date and time?"**, or
**"Add 17 and 25, and tell me the current date and time."**

This still uses `foundry_managed_agent`, not client delegation or a direct
Responses fallback. It requires a backend deployment with **managed client-function
continuation** support. The client collects completed `function_call` items from
`response.event` observations, waits for `response.completed`, submits each
`function_call_output` using `connection.response.item.create`, then sends one
`connection.response.create` to resume the same managed delegation. Foundry owns
the prompt-agent conversation and forwards only validated tagged-text guidance
to GPT Live; the client never speaks raw tool output.

Keep the script running to execute the local clock function. `--create-only` and
`--auto-delete` behave as in the original managed example, but creating the agents
alone does not prove that the deployed backend supports function continuation.
A different client reconnecting to these agents must implement that handler too;
the basic `response_delegation.py` client does not execute their local function.
No additional packages or `.env` settings are needed.

## Client delegation

Use the same setup and `.env`; only `GPT_LIVE_DEPLOYMENT` is needed. Run:

```powershell
& $py samples\gpt_live\python\client_delegation.py
```

This sample always creates a fresh agent with `"delegation": {"type": "client"}` and
ignores `AGENT_NAME`. Its instructions tell GPT Live to delegate current date/time
questions and adding two numbers, so this app is the backend:

1. GPT Live sends `session.delegation.created` with `target: "client"` and waits.
2. The event does not repeat the request, so the app waits until the learner's input
   transcript has been quiet briefly, then reads what the learner said since the
   previous delegation. It adds two whole numbers ("seventeen plus twenty-five",
   "add 3 and 4") and reads the computer's clock for time questions.
3. It replies on the same session with `connection.session.thinking.append(...)`
   (unspoken facts) and `connection.session.commentary.append(...)` (the answer GPT
   Live says), both with the delegation's `delegation_id`. Anything else gets a short
   commentary saying what the app can do.

Try **"What is 17 plus 25?"** or **"What is the current date and time?"**. The
Delegation pane shows what the app heard and its answer. No backend model, prompt
agent, or `response.*` commands are involved.

## Tests

Run the offline payload, function-continuation, client-delegation, cleanup, and SDK loopback tests
(no Azure resources or audio devices). They drive the real Projects SDK client:
agent calls go to an in-memory transport, and the Live client's `wss://` handshake
is routed to a local WebSocket server:

```powershell
& $py -m unittest discover -s samples/gpt_live/python -p "test_*.py" -v
```
