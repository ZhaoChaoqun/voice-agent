# Reproducible Voice Agent definitions

## Conclusion

`flash.json` is the default base template: `kind: voice`,
`model_type: managed`, and model `microsoft-realtime-flash-1`. It contains no
endpoint, subscription, tenant, project, or saved Agent version.
The only supported API model IDs are `microsoft-realtime-flash-1` and
`gpt-realtime-2.1`. Template and verified-model declaration must match the
exact ID; product names and unversioned IDs are not aliases.

These are **base templates, not upload-ready payloads**.
From `samples/example37_smart_home_appliance_agent`, run:

```bash
npm run agents:render
```

This is offline: it queries and modifies no Azure resources. It writes complete
definitions to ignored `.local/agent-definitions.json` (file mode `0600`, newly
created directory mode `0700`).

| Source                                               | Owns                                                                                             |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `agents/*.json`                                      | Model, PCM formats, speech profile, voice, and fresh `store: false` defaults.                    |
| `server/voice-profile.ts`                            | Dynamic VAD, AEC, noise suppression, and bilingual transcription constants.                      |
| `server/instructions.txt` / `server/instructions.ts` | Short pre-control acknowledgement, concise actual-result answers, language, and grounding rules. |
| `server/tools.ts` / `shared/controls.ts`             | All eight function schemas and server control limits.                                            |
| `server/greeting.ts`                                 | English/Chinese `welcome_text` and structured greeting defaults.                                 |
| `server/agent-config.ts`                             | Wire-definition merge and preservation of other Portal-owned fields.                             |
| `server/sync-agent-config.ts`                        | Offline rendering, explicit publishing, concurrency checks, and readback.                        |

## Speech and response behaviour

`welcome_text` is a string structured input; greeting is
`{"type":"template","text":"{{{welcome_text}}}"}`.
The initial browser language chooses the welcome, not a single recognition language.

- Input/output: 24 kHz PCM, browser mono PCM16.
- AEC: `server_echo_cancellation`, server reference, `channels: 1`.
- Personal noise suppression: `detection_input: mas_dns`.
- Transcription: `azure-speech-streaming`, `language: zh-CN,en-US`.
- Flash VAD: `azure_semantic_vad`, `profile: normal`,
  **`auto_truncate: false`** because Flash handles truncation itself; this avoids
  duplicate server/client truncation races.
- `create_response` / `interrupt_response`: `true`;
  `remove_filler_words: false`. No additional classifier is attached.
- Output: `zh-CN-Xiaoxiao:DragonHDFlashLatestNeural`.

The session keeps **`tool_choice: "auto"`**. For a control, the model says one
short acknowledgement in the user's language before the function in the same
response, without describing a device, setting, action, plan, or result.
The relay does not inject a second acknowledgement turn. After validated,
deduplicated execution, a **`tool_choice: "none"`** continuation reports the actual
result concisely and does not repeat the acknowledgement. Queries do not need
the acknowledgement. See [architecture](../ARCHITECTURE.md) for the event order.

## Explicit publishing

Prepare your own project, permissions, and server-only `.env` using the
[integration guide](../INTEGRATION.md). Review the offline output first.
Export the actual configured endpoint to the shell, then:

```bash
npm run agents:publish -- --confirm-project "$FOUNDRY_PROJECT_ENDPOINT"
```

`--confirm-project` must exactly match `FOUNDRY_PROJECT_ENDPOINT`;
`SMART_HOME_FLASH_AGENT` must be explicitly set. Placeholders are rejected.
The default publishes only Flash. The script does not provision a resource,
model deployment, or role assignment.

Authoring uses `2025-11-15-preview`; voice connections use `api-version=v1`.
Verify target-service support before publishing rather than ignoring unsupported
fields. A new Agent uses the full template. An existing Agent must have the same
kind, model, and model type; otherwise the script refuses to overwrite it.

The merge preserves recording/store, output settings, and unknown Portal fields,
while updating shared instructions, tools, greeting, PCM/AEC, and turn detection.
For existing Flash definitions it preserves configured noise suppression and
transcription, supplying defaults when absent and bilingual languages when missing
from Azure Speech streaming transcription. Review these preserved fields: they
may differ from a fresh template. Runtime output uses the source-defined Xiaoxiao
voice; a deliberate voice change requires aligned source/templates and validation.

The publisher checks the latest version immediately before the write, then
requires a new active version and recursively reads back every submitted field.
This is optimistic concurrency checking, **not** server-side compare-and-swap.
Avoid simultaneous Portal edits. Rendering or unit tests do not prove the saved
Agent is usable; live acceptance remains optional and must be run deliberately.

## Optional GPT Realtime comparison

`realtime.json` (`gpt-realtime-2.1`) is an explicit comparison option, not a
prerequisite for the Flash sample. Offline rendering includes both supported
templates. Publishing Realtime requires:

```bash
# Only in a project that supports GPT Realtime 2.1.
npm run agents:publish -- --comparison --confirm-project "$FOUNDRY_PROJECT_ENDPOINT"
```

`--comparison` selects only Realtime **instead of Flash**.
Set `SMART_HOME_REALTIME_AGENT` to an explicit Agent name distinct from the Flash
Agent name; the publisher refuses to change an existing Agent's model.
After checking the saved definition, include `gpt-realtime-2.1` in
`SMART_HOME_VERIFIED_MODELS` to enable it in the UI. A successful comparison does
not establish Flash access, regional support, or equivalent behaviour.
