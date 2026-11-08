# Front Desk with fluency and handoff

This sample is a fictional Contoso receptionist. It routes company questions,
support searches, transfers, and confirmed callback messages through one
workflow. Its shared prompt requires a short, specific response to the caller's
correction, concern, urgency, or decision before continuing the business step.
That response-first behavior is preserved in every stage, including after a
silent handoff.

## Use in the Portal

1. Start the [Portal](../../portal/README.md) with your Foundry Project.
2. In **Editor**, choose **Load from templates**.
3. Select **Example 4: Front Desk with Fluency and Handoff**.
4. Choose **Try it now**, then connect in AgentRuntime.

The portable [Agent definition](agent.json) contains no service URL, Project
connection, or credentials. The
[catalog configuration](../../portal/templates.config.json) supplies the public
no-auth `/mcp/frontdesk` endpoint when loading or publishing the Template. A
fresh Foundry Project does not need an MCP connection or local MCP process.

## Try these turns

- Ask "What are your business hours?" or "Where are you located?" The Agent
  answers Monday to Friday, 8:30 AM to 5:30 PM, at One Microsoft Way, Redmond.
- Ask "How do I reset my password?" to try the help-article search. The demo
  search service may report that articles are unavailable.
- To leave a message, say "Please take a message for Sales." Give the name
  "Alex Chen", the callback number "425-555-0142", and the summary "Call me
  about pricing", then say "Yes" to save it.

## Workflow and tool boundaries

The service creates `$entrypoint` implicitly. Its only startup route enters
`identify_intent`; eight business nodes and sixteen edges cover:

- `company_info`: answer authored company hours, location, and departments
  without MCP.
- `zendesk_search`: call `frontdesk_search_zendesk_articles` and use only the
  returned article facts.
- `transfer`: use `transfer_call` only when the telephony runtime provides it.
  Browser sessions do not provide a telephone transfer; offer a callback
  message instead. A graph handoff is never a successful phone transfer.
- `collect_message`: collect name, callback number, recipient, and summary;
  read everything back and obtain explicit confirmation without calling MCP.
- `save_message`: call `frontdesk_record_message` only after confirmation.
  Report that the message was saved, not sent or delivered.
- `next_request` and `end`: accept another request or close with the platform
  `end_conversation` tool.

The existing public Front Desk MCP is an external demo integration, not a
business pack implemented in this repository's `shared_mcp`. Its two-tool
contract is reused rather than adding a replacement backend to the Portal or
Playground. A successful MCP readiness check proves connectivity and tool
inventory, not that a Zendesk backend is configured. The current service can
return `zendesk_unavailable`; the Agent must disclose that result and offer
Support or a message, never invent an article.

## Preserved runtime settings

- Managed `gpt-realtime`, Whisper transcription, and Ava Dragon HD voice.
- Example 1's semantic VAD with 600 ms silence (`profile: normal`, Smart Turn
  end-of-utterance detection off), noise suppression, and automatic truncation.
- No server echo cancellation, preserving the front-desk self-interruption
  mitigation.
- No required `call_id` input: reuse a supplied call ID or generate the
  prompt-defined per-call fallback.
- No static interim response, which would otherwise promise an action before
  there is evidence of success.
- `store: false` by default. This controls Azure conversation storage, not
  callback-message persistence or optional local Portal recordings.

Only use fictional names, callback numbers, and messages. The public demo is
shared, has no caller authentication, and is not approved for real customer
data. Saving a message does not guarantee delivery or a callback.

## Source and verification

This is a portable snapshot of the fluency-improved Front Desk definition.
Shared and stage instructions,
greeting, audio configuration, node IDs, edge IDs, and tool scopes are
preserved; only the sample name, managed hosting, storage policy, optional
call identity, disabled interim response, and deployment-owned MCP binding
are adapted.

From the repository root:

```bash
PYTHONPATH=portal portal/.venv/bin/python -m unittest discover \
  -s portal/tests -p 'test_templates.py' -v
```

The tests check the shared prompt, full workflow, confirmation gate,
node-scoped tools, portable publishing, and the catalog/API entry.

## Conclusion

The Template preserves the response-first receptionist workflow in the
example source. Portal and Playground only choose its configured MCP endpoint;
neither owns a second copy of the business definition.

## Template versions

The root [`agent.json`](agent.json) is the only version, using `gpt-realtime`
and 600 ms Semantic VAD. Earlier versions were removed on 2026-10-21 and remain in Git history.
