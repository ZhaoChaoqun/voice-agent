# Appointment Setter with Handoff

## Conclusion

`agent.json` is a Voice Agent for a fictional B2B company that qualifies a warm
lead's interest, finds open demo times, books a 30-minute Teams demo, and
records a new prospect as a CRM lead, as a staged handoff graph.

By default its business tools run on the shared **mock-tool-call** MCP server:
Microsoft 365 (Work IQ) calendar tools to find times and create the invite, and
Salesforce tools to look the prospect up and create a lead. The mocks take the
same arguments and return the same fields as the real tools, but results are
fictional and nothing real is booked or sent. To connect real systems, see
[Connect real tools](../../docs/05_connect_real_tools.md).

No text or email tool is connected: the agent never says materials were sent;
the only thing it may say was sent is a calendar invite the tool reported.

## When to use this example

Use it to try lead qualification, slot offers grounded in a calendar result, a
booking that waits for a yes, and a nurture branch for prospects who are not
ready, before you connect real calendar or CRM tools.

## Workflow

| Stage | Purpose |
| --- | --- |
| `greeting` | Thank the prospect for their interest and ask what they hope to solve. |
| `qualify` | Understand use case, role, and timeline without pressure. |
| `check_availability` | Ask for days and timezone, find 30-minute slots, and offer two or three returned times. |
| `book_meeting` | Collect name, company, and email, read the booking back, then after a yes create the invite and, for a new prospect, a lead. |
| `nurture` | For a prospect who is not ready, read back name, company, email, and follow-up time, then after a yes create a lead. |
| `wrap_up` | Confirm the meeting details and thank the prospect. |
| `end` | Say a short goodbye and call `end_conversation`. |

Every stage can route to `end` as soon as the caller says goodbye or asks to
stop. Handoffs are silent: no edge carries a `transfer_message`.

Each stage carries the full persona, tone, and conversation rules because a
handoff node's instructions replace the session instructions.

### Mock tools by stage

| Stage | Tools |
| --- | --- |
| `check_availability` | `mock_tool_call_find_meeting_times`, `mock_tool_call_get_user_date_and_time_zone_settings` |
| `nurture` | `mock_tool_call_salesforce_search`, `mock_tool_call_salesforce_get_contact`, `mock_tool_call_salesforce_create_lead` |
| `book_meeting` | `mock_tool_call_create_event`, `mock_tool_call_salesforce_search`, `mock_tool_call_salesforce_get_contact`, `mock_tool_call_salesforce_create_lead` |

`greeting`, `qualify`, `wrap_up`, and `end` have no business tools.
`mock_tool_call_create_event` runs once, only after the prospect says yes to
the booking read-back. `mock_tool_call_salesforce_create_lead` runs once, only
when `mock_tool_call_salesforce_search` finds no contact for the email.

## Sample data

Demos are 30-minute Teams video calls. The agent asks for
`maxCandidates` 3 over the next few business days in the prospect's Windows
time zone; suggestions come back in UTC and the agent converts them.

Fixed mock data (see the
[mock-tool-call README](../../shared_mcp/app/shared_mcp/mock_tool_call/README.md)
and [`fixtures.json`](../../shared_mcp/app/shared_mcp/mock_tool_call/fixtures.json)):

- The calendar owner's time zone is Pacific Standard Time. Free slots are fixed
  for a given day and duration; about one half-hour start in five is busy, and
  booked events block their time.
- A created event returns an `id`, times, attendees, and a fake Teams
  `joinUrl`; no invite leaves the service.
- CRM contact Jack Rogers, `jrogers@burlington.com`, Burlington Textiles Corp
  of America, already exists, so no lead is created. Any other email, such as
  `dana.test20261020@example.com`, is a new prospect and gets a lead id
  starting `00QMOCK`.

## Run in the portal

1. Start the portal as described in [portal/README.md](../../portal/README.md).
2. In **Editor**, choose **Load from templates**.
3. Select **Example 6: Appointment Setter**.
4. Choose **Try it now**, then connect in AgentRuntime.

After loading, a banner says **This Agent uses mock tools**. To use your own
Salesforce tools, choose **Connect my tools** and enter a public HTTPS MCP
server; the Agent calls it without credentials, so point it at sandbox data.
The Microsoft 365 (Work IQ) calendar tools act as the signed-in user, so they
cannot be connected in the shared Playground and stay on mock data there; use a
Work IQ Toolbox in your own Foundry Project instead.

The example uses `gpt-realtime` with `azure_semantic_vad`, `profile: normal`,
`silence_duration_ms: 600`, Smart Turn end-of-utterance detection off
(`end_of_utterance_detection: null`), explicit barge-in thresholds, and no server
echo cancellation, matching Example 1's turn detection apart from the silence.

## Try these turns

- "We want to automate support calls; I'd like a demo this week, Pacific
  time." Expect a short qualification, then a
  `mock_tool_call_find_meeting_times` call and two or three returned slots with
  the date and time in Pacific time, converted with the offset in effect on
  that date (UTC-7 during daylight saving time, UTC-8 otherwise).
- "Could we do 7 AM instead?" Expect a new
  `mock_tool_call_find_meeting_times` call for that window; the time is offered
  only if the tool returns it.
- "The first one works. Dana Test, Fabrikam, dana.test20261020@example.com."
  Expect the email spelled back and a full booking read-back with no tool call.
  Say "no, wait": expect nothing booked.
- "Yes, send it." Expect one `mock_tool_call_create_event` call, the invite
  reported as sent, then `mock_tool_call_salesforce_search` finding no contact
  and one `mock_tool_call_salesforce_create_lead` call. If the invite fails,
  expect the agent to say it could not be created and read the meeting details
  back.
- In a new call, "I'm not ready yet, follow up next month. Dana Test, Fabrikam,
  dana.test20261020@example.com." Expect the nurture path: name, company,
  email, and follow-up time read back, then after "yes" a
  Salesforce search and a lead for a new email. Expect no claim that case
  studies or a brief were sent.

## Boundaries

- The company, calendar, contacts, and leads are fictional and come from the
  mock server; no meeting or lead is real.
- `store` is `false`; enable persistence deliberately if you need it.
- To use real calendar and CRM systems, follow
  [Connect real tools](../../docs/05_connect_real_tools.md); conversational
  confirmation is not an authorization boundary.
