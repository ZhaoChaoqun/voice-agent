# Customer Support with Handoff

## Conclusion

`agent.json` is a Voice Agent for a fictional AI platform's support line that
troubleshoots issues, answers verified account questions, and escalates to a
support ticket as a staged handoff graph.

By default its business tools run on the shared **mock-tool-call** MCP server:
Zendesk help-center search for troubleshooting steps, Salesforce contact lookup
to verify an account, and a Zendesk tool to open a new ticket. The agent never
changes an existing ticket: the caller is not verified, so a ticket number they
give is named as related in the new ticket. The mocks take the same arguments and return the same fields as
the real tools, but results are fictional and nothing real is filed. To connect
real systems, see [Connect real tools](../../docs/05_connect_real_tools.md).

No payment system is connected, so no refund, charge, or plan change happens on
the call.

## When to use this example

Use it to try triage between technical and account paths, article-grounded
troubleshooting, an identity check before account details, and an escalation
that waits for a yes, before you connect real help-center, CRM, or ticketing
tools.

## Workflow

| Stage | Purpose |
| --- | --- |
| `identify_issue` | Listen to the issue, capture the caller's name, and route to the technical or account path. |
| `troubleshoot` | Search the help center, then suggest one step at a time and wait for the result. |
| `account_billing` | Look the contact up by email, check the caller's full name against the record, then share only the title and company; never contact details. |
| `resolve_or_escalate` | Confirm a fix, or read the escalation back and, after a yes, open a new ticket (naming any existing ticket as related). |
| `end` | Say a short goodbye and call `end_conversation`. |

Every stage can route to `end` as soon as the caller says goodbye or asks to
stop. Handoffs are silent: no edge carries a `transfer_message`.

Each stage carries the full persona, tone, and conversation rules because a
handoff node's instructions replace the session instructions.

### Mock tools by stage

| Stage | Tools |
| --- | --- |
| `troubleshoot` | `mock_tool_call_zendesk_search` |
| `account_billing` | `mock_tool_call_salesforce_search`, `mock_tool_call_salesforce_get_contact` |
| `resolve_or_escalate` | `mock_tool_call_salesforce_search`, `mock_tool_call_salesforce_get_contact`, `mock_tool_call_zendesk_search`, `mock_tool_call_zendesk_create_ticket` |

`identify_issue` and `end` have no business tools. The escalation is written
once, only after the caller says yes to the read-back: a new ticket with a
priority of low, normal, high, or urgent. When the caller gives an existing
ticket number, the new ticket names it as related; nothing about the existing
ticket is read back or changed.

## Sample data

After an escalation, the agent says the support team usually follows up within
one business day; it never promises a specific person or time.

Fixed mock data (see the
[mock-tool-call README](../../shared_mcp/app/shared_mcp/mock_tool_call/README.md)
and [`fixtures.json`](../../shared_mcp/app/shared_mcp/mock_tool_call/fixtures.json)):

- Help-center articles include "Troubleshoot data sync failures", "API returns
  401 Unauthorized", and the password or MFA and GlobalProtect VPN articles.
- CRM contact Jack Rogers, `jrogers@burlington.com`, phone +13362227000, VP,
  Facilities, Burlington Textiles Corp of America. Any other email, such as
  `dana.test20261020@example.com`, finds no contact.
- Existing tickets: 1 (solved), 2 (pending), and 3 (open, API returns 401;
  Jack Rogers). New tickets get a random four-digit number.

## Run in the portal

1. Start the portal as described in [portal/README.md](../../portal/README.md).
2. In **Editor**, choose **Load from templates**.
3. Select **Example 5: Customer Support**.
4. Choose **Try it now**, then connect in AgentRuntime.

After loading, a banner says **This Agent uses mock tools**. To use your own
tools, choose **Connect my tools** and enter a public HTTPS MCP server for each
system (Salesforce, Zendesk); the Agent calls it without credentials, so point
it at sandbox data. There is nothing to start locally.

The example uses `gpt-realtime` with `azure_semantic_vad`, `profile: normal`,
`silence_duration_ms: 600`, Smart Turn end-of-utterance detection off
(`end_of_utterance_detection: null`), explicit barge-in thresholds, and no server
echo cancellation, matching Example 1's turn detection apart from the silence.

## Try these turns

- "My API calls started returning 401 errors." Expect a
  `mock_tool_call_zendesk_search` call and one step from "API returns 401
  Unauthorized", naming the title, then a wait for the result.
- "Still broken, please add to ticket 3 that it started after a key rotation."
  Expect a new-ticket summary read back that names ticket 3 as related, with no
  tool call and nothing read back about ticket 3. After "yes", expect one
  `mock_tool_call_zendesk_create_ticket` call and a new four-digit ticket
  number; ticket 3 is not changed.
- In a new call, "My data sync keeps failing, escalate it, high urgency."
  Expect questions for any missing name or contact (give "Dana Test,
  dana.test20261020@example.com"), then a read-back. Say "no,
  not yet": expect nothing filed. After a later "yes", expect one
  `mock_tool_call_zendesk_create_ticket` call and a four-digit ticket number.
- "Check my account: jrogers@burlington.com." Expect the email spelled back, a
  `mock_tool_call_salesforce_search` call, and a request for your full name
  before any details. Say "Jack Rogers": expect only the title and company (VP,
  Facilities, Burlington Textiles Corp of America). Ask "What phone number do you
  have for me?": expect a refusal to read back contact details. With an unknown
  email, expect no contact found and only general guidance.
- "I was charged twice, refund it." Expect no claim that a refund was processed
  and an offer to escalate.

## Boundaries

- The company, articles, contacts, and tickets are fictional and come from the
  mock server; no ticket is real.
- `store` is `false`; enable persistence deliberately if you need it.
- To use real help-center, CRM, and ticketing systems, follow
  [Connect real tools](../../docs/05_connect_real_tools.md); conversational
  confirmation is not an authorization boundary.
