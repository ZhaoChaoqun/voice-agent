# Receptionist and Messaging with Handoff

## Conclusion

`agent.json` is a Voice Agent for the front desk of a fictional company,
Contoso, that answers company questions, checks whether a person is available
and texts them, and emails a phone message to a directory contact, as a staged
handoff graph.

By default its business tools run on the shared **mock-tool-call** MCP server:
Microsoft 365 (Work IQ) Teams presence and mail, and Twilio SMS. The mocks take
the same arguments and return the same fields as the real tools, but results
are fictional and nothing real is sent. To connect real systems, see
[Connect real tools](../../docs/05_connect_real_tools.md).

This line cannot transfer calls; the agent never says it is transferring or
connecting the caller.

## When to use this example

Use it to try intent routing, answers grounded in a short list of company
facts, a presence check with a text, and a message email that waits for a yes,
before you connect real presence, mail, or SMS tools.

## Workflow

| Stage | Purpose |
| --- | --- |
| `greeting` | Capture the caller's name and route to a person, a message, or a company question. |
| `transfer` | Match the directory, check a person's presence, and offer to text them the caller's name, number, and reason. |
| `take_message` | Collect name, callback number, recipient, and message, read it back, then after a yes email it to the recipient. |
| `answer_faq` | Answer hours, location, and parking from the sample facts only. |
| `wrap_up` | Confirm what happened on the call and thank the caller. |
| `end` | Say a short goodbye and call `end_conversation`. |

Every stage can route to `end` as soon as the caller says goodbye or asks to
stop. Handoffs are silent: no edge carries a `transfer_message`.

Each stage carries the full persona, tone, conversation rules, and sample facts
because a handoff node's instructions replace the session instructions.

### Mock tools by stage

| Stage | Tools |
| --- | --- |
| `transfer` | `mock_tool_call_get_user_presence`, `mock_tool_call_twilio_send_message` |
| `take_message` | `mock_tool_call_send_email_with_attachments` |

The other stages have no business tools. The text goes once to the person's
directory mobile, with a body under 300 characters, only after the caller
agrees. The email goes once to the recipient's directory address, only after
the caller says yes to the read-back. Departments have no presence or mobile,
so the agent offers to take a message instead.

## Sample data

Contoso is open Monday to Friday, 9 AM to 6 PM Pacific time, and closed on
public holidays. The office is at 1 Contoso Way, Redmond, Washington, with
visitor parking at the main entrance.

| Directory entry | Email | Mobile |
| --- | --- | --- |
| Sales | `sales@contoso.com` | |
| Support | `support@contoso.com` | |
| Billing | `billing@contoso.com` | |
| Human Resources | `hr@contoso.com` | |
| Engineering | `engineering@contoso.com` | |
| Alex Wilber, Sales lead | `alexw@contoso.com` | +14255550101 |
| Megan Bowen, HR manager | `meganb@contoso.com` | +14255550102 |

Fixed mock data (see the
[mock-tool-call README](../../shared_mcp/app/shared_mcp/mock_tool_call/README.md)
and [`fixtures.json`](../../shared_mcp/app/shared_mcp/mock_tool_call/fixtures.json)):

- Presence: Alex Wilber is Available; Megan Bowen is Busy, in a meeting.
  Adele Vance and Isaiah Langer have presence on the mock server but are not in
  this directory.
- A text to any valid E.164 number is queued, including both directory mobiles;
  no text is delivered.
- A sent email is recorded as `sent`; no email leaves the service.

## Run in the portal

1. Start the portal as described in [portal/README.md](../../portal/README.md).
2. In **Editor**, choose **Load from templates**.
3. Select **Example 7: Receptionist and Messaging**.
4. Choose **Try it now**, then connect in AgentRuntime.

After loading, a banner says **This Agent uses mock tools**. To use your own
Twilio SMS tool, choose **Connect my tools** and enter a public HTTPS MCP
server; the Agent calls it without credentials, so point it at test data.
The Microsoft 365 (Work IQ) presence and mail tools act as the signed-in user,
so they cannot be connected in the shared Playground and stay on mock data
there; use a Work IQ Toolbox in your own Foundry Project instead.

The example uses `gpt-realtime` with `azure_semantic_vad`, `profile: normal`,
`silence_duration_ms: 600`, Smart Turn end-of-utterance detection off
(`end_of_utterance_detection: null`), explicit barge-in thresholds, and no server
echo cancellation, matching Example 1's turn detection apart from the silence.

## Try these turns

- "What are your hours, and where do I park?" Expect the sample hours and
  visitor parking at the main entrance, with no tool call.
- "Can I talk to Alex Wilber?" Expect no transfer claim, a
  `mock_tool_call_get_user_presence` call, and "available". Agree to a text and
  give your name, a callback number with country code such as
  "+1 425 555 0123", and a reason: expect the
  number read back, then one `mock_tool_call_twilio_send_message` call to Alex's
  mobile and the text reported as sent.
- "Is Megan Bowen free?" Expect presence reported as in a meeting and an offer
  to text her or take a message.
- "Leave a message for Megan about my onboarding." Expect missing details asked
  one at a time (give "Dana Test" and the callback number "+1 425 555 0123")
  and the message read back. Say "no, don't send it": expect no
  email. After a later "yes", expect one
  `mock_tool_call_send_email_with_attachments` call to `meganb@contoso.com`.
  If the send fails, expect it reported as not sent and an offer to read the
  unsent message back, with no retry.
- "Put me through to Isaiah Langer." Expect no directory match and an offer of
  the closest department.

## Boundaries

- The company, directory, presence, texts, and emails are fictional and come
  from the mock server; nothing is delivered.
- `store` is `false`; enable persistence deliberately if you need it.
- To use real presence, mail, or SMS systems, follow
  [Connect real tools](../../docs/05_connect_real_tools.md); conversational
  confirmation is not an authorization boundary.
