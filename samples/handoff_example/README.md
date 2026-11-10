---
ai-usage: ai-assisted
---

# Inline subagent handoff example

Create a voice agent with three inline subagents by using typed Foundry SDK
models, then talk to it through the microphone and watch each handoff. This
folder holds the complete code from the Learn article
[Use an inline subagent in a voice-based agent](https://learn.microsoft.com/azure/foundry/agents/how-to/use-inline-subagent-voice-agent).

| File | What it does |
| --- | --- |
| [`create_inline_voice_agent.py`](create_inline_voice_agent.py) | Builds the voice agent definition with `VoiceAgentInlineSubagentConfig`, `InlineVoiceSubagent`, and `VoiceAgentHandoffCondition`, creates an agent version, and reads back the saved inline configuration. |
| [`talk_to_inline_voice_agent.py`](talk_to_inline_voice_agent.py) | Connects with `project_client.voice_agents.realtime.connect()`, streams microphone audio, plays the response, and prints the active subagent and each handoff event. |

The agent follows one path, `$entrypoint` -> `scheduling` -> `end`:

- `$entrypoint` greets the caller and hands off as soon as the caller mentions
  an appointment.
- `scheduling` collects a book, reschedule, or cancel request, summarizes it,
  and speaks with a different voice so the handoff is easy to hear.
- `end` repeats the confirmed request and says goodbye.

The example uses no customer tools and doesn't change any appointments.

## Prerequisites

- Python 3.11 or later.
- Azure CLI signed in with `az login`.
- A Foundry project with access to voice-based agents and the `gpt-realtime`
  model, and permission to create agents in it.
- A microphone and speakers or headphones. Use headphones so the agent's
  speech doesn't feed back into the microphone.

## 1. Install

From this folder:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
```

On Windows PowerShell, activate the environment with `.venv\Scripts\Activate.ps1`.

Version 2.11.0 of `azure-ai-projects` is the first version that includes the
inline subagent and handoff models. PyAudio builds against PortAudio. If its
installation fails, install PortAudio first, for example
`sudo apt-get install portaudio19-dev` on Ubuntu or `brew install portaudio` on
macOS, and then rerun the command.

## 2. Set environment variables

Use a new agent name so that the example doesn't create a version of an agent
used by another application. Find the endpoint on the **Overview** page of your
project in the Foundry portal.

```bash
export FOUNDRY_PROJECT_ENDPOINT="https://<account>.services.ai.azure.com/api/projects/<project>"
export FOUNDRY_VOICE_AGENT_NAME="appointment-voice-agent"
```

In PowerShell:

```powershell
$env:FOUNDRY_PROJECT_ENDPOINT = "https://<account>.services.ai.azure.com/api/projects/<project>"
$env:FOUNDRY_VOICE_AGENT_NAME = "appointment-voice-agent"
```

## 3. Create the agent version

```bash
python create_inline_voice_agent.py
```

Each run creates a new immutable version. The three inline subagents are part
of the version, not separate agent resources. The script raises an error if
the saved version isn't in inline mode. Expected output (the version number
increases with each run):

```output
Created 'appointment-voice-agent', version 1
$entrypoint: voice=default, routes=['scheduling']
scheduling: voice=en-US-JennyNeural, routes=['end']
end: voice=default, routes=[]
max_transfers=8, max_attempts=10
```

## 4. Talk to the agent and test handoffs

```bash
python talk_to_inline_voice_agent.py
```

Try the following conversation. Let each response finish before your next
request. Response wording can vary because the model interprets the handoff
conditions.

| Say to the agent | Expected result |
| --- | --- |
| "Hello. What can you help me with?" | `$entrypoint` remains active. |
| "I'd like to reschedule an appointment." | The client prints `Handoff requested: $entrypoint -> scheduling`, then `Active subagent: scheduling` and `Handoff completed.` |
| "I'd prefer Tuesday." | `scheduling` handles the next turn without returning to the entrypoint. |
| "What day did I just ask for?" | The scheduling subagent uses the earlier conversation history and refers to Tuesday. |
| "Yes, that summary is correct. That's all I need. Goodbye." | The client prints `Handoff requested: scheduling -> end`, then `Active subagent: end` and `Handoff completed.` |

After the closing message finishes playing, press `Ctrl+C` to disconnect.
Reaching `end` completes the conversation flow but doesn't close the session.

To test interruption recovery, add `delay_ms=timedelta(seconds=3)` to the
`entry_to_scheduling` condition in `create_inline_voice_agent.py`, import
`timedelta` from `datetime`, and create a new version. Ask about an
appointment and keep talking right after the request. Because the condition
sets `cancel_on_interruption=True`, the client prints
`Handoff cancelled by caller; source remains active.` Remove `delay_ms` when
you finish testing.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| `ImportError` for `InlineVoiceSubagent` or `VoiceAgentInlineSubagentConfig` | Install `azure-ai-projects` 2.11.0 or later. |
| `AttributeError` for `beta.voice_agents.realtime` in other code | In 2.11.0, realtime connections use `project_client.voice_agents.realtime`. |
| Create fails with a permissions error for an identity you don't expect | `DefaultAzureCredential` picked another credential, such as a virtual machine's managed identity. Set `AZURE_TOKEN_CREDENTIALS=AzureCliCredential` to use your Azure CLI sign-in. |

## Clean up

The agent remains in your project after you disconnect. Delete it in the
Foundry portal when you no longer need it.
