# Use real tools with Templates

## Conclusion

The reference workflow Templates (Examples 5 to 34) call **mock tools** by
default: the `mock-tool-call` MCP server on the shared no-auth MCP service. The
mocks take the same arguments and return the same fields as real Salesforce,
Zendesk, Twilio, and Microsoft 365 tools, but they use fictional data and never
book, send, or store anything real. The fixed test data is listed in the
[mock-tool-call README](../shared_mcp/app/shared_mcp/mock_tool_call/README.md).

You can switch any system of a Template, for example only Salesforce, to your own
MCP server and keep mock data for the others.

**This integration is optional.** To try the default Templates, use the shared
public no-auth MCP; do not install or start a local MCP, Dev Tunnel, or Logic
Apps workflow. Reuse an existing public HTTPS MCP when connecting real tools.
Dev Tunnel is only a development option for exposing a server on your machine,
not a requirement for connecting an already deployed service.

| I want to | Read |
| --- | --- |
| Use my own server for a system in the Playground | Section 1 |
| Build a Salesforce or Zendesk MCP server and get its URL | [Create MCP servers with Azure Logic Apps](./06_logic_apps_mcp_servers.md) |
| Build a server for Twilio SMS, orders, reservations, or another system | Sections 2 and 3 |
| Use real data with credentials in my own Foundry Project | Section 4 |

| Path | Where | How the tools are authorized | Use it for |
| --- | --- | --- | --- |
| **Connect real tools** in the Editor | Hosted Playground or local Portal | Your MCP server for each system holds the credentials; the Agent calls it without any | Demos and pilots on sandbox data |
| **Foundry Toolbox or Project connection** | Your own Foundry Project (local Portal or Foundry) | Foundry stores the credential or uses the signed-in user's identity | Anything with real customer data |

## 1. Choose real tools or mock tool calls for each system in the Editor

1. In **Editor**, choose **Load from templates**. Cards whose tools are mocks
   show **Mock tools** and the systems they stand for, for example Salesforce and
   Zendesk. Select **Connect real tools** under a card to load it and open the
   connections at once, or select **Load with mock tool calls** on the card; you can
   still choose **Connect real tools** on the banner that says **This Agent uses mock
   tool calls** later.
2. The dialog shows one card per system, and every card starts at **Using mock
   tool calls**. Each system has its own URL box, so Salesforce and Zendesk can be on
   different servers.
3. For each system that should use your data, paste the public HTTPS URL of its
   MCP server, for example `https://crm.contoso.com/mcp`, and select **Connect real
   tool**. Pasting a URL alone does not switch the system: the card shows **URL not
   connected** until you select **Connect real tool**. When it succeeds, the card shows
   **Connected to real tool**. Each card links to how to build that system's server.
4. For each system that should keep mock tool calls, leave the URL empty. **Use mock
   tool calls** clears a URL you entered, or switches a connected system back.
5. The Portal checks the server and matches the Template's tools to the server's
   tools by name in any naming style (`FindMeetingTimes`, `find_meeting_times`,
   `crm___find_meeting_times`). If a tool has no match, the card asks you to match
   it by hand.
6. Select **Done**. A summary lists which systems use real tools and which use
   mock tool calls. Select **Confirm and try it now** to publish the working copy and start
   a test session, **Back** to change a system, or **×** to close without publishing.
   **Undo** also reverts a connection.
   The Portal remembers the last URL you connected for each system in this browser.

**Microsoft 365 (Work IQ)** calendar, Teams, and mail tools are listed as
**Mock only**: Work IQ can't be connected with an MCP URL yet, because it acts as
the signed-in user in your own Microsoft 365 tenant and the shared Playground
cannot hold that identity. Use a Work IQ Toolbox in your own Foundry Project
instead (section 4).

Requirements in the hosted Playground:

- The URL must be public HTTPS without a user name, password, query string, or
  fragment, and it must not resolve to a private or loopback address.
- The Agent sends **no credentials**: no `Authorization` header, custom header, or
  Project connection. Anyone who learns the URL can call it, so keep the
  credentials for Salesforce, Zendesk, or Twilio on the server and point them at a
  sandbox org, a trial tenant, or test data.
- The server must speak MCP Streamable HTTP (`initialize`, `tools/list`,
  `tools/call`). Discovery has a short timeout.

**Connection behavior:** the first **Connect real tool** request discovers the server's tools, matches their names, and applies a complete mapping in one backend request and one fresh MCP handshake. There is no separate discovery round trip on this path. If names need manual mapping, the system remains on mock tools; choosing the mappings and selecting Connect again rechecks the server's current tool list before applying them. The legacy discovery endpoint remains available. No tool-list cache or automatic background probe is introduced.

Connection changes are applied one at a time so one system's response cannot overwrite another system's working copy. **Done** is disabled while a connection change is pending. Closing the dialog or changing the working copy invalidates a late connection response instead of applying it to a different template. This reduces redundant requests, not server cold starts or network latency.

## 2. Match the tool contract

The Template's instructions expect each tool's arguments and result fields. Your
tool may have a different name, but keep the arguments and return at least these
fields, with `ok` and `error` on every result so the Agent can report failures.

| Template tool | Real system | Arguments | Result fields the Agent reads |
| --- | --- | --- | --- |
| `find_meeting_times` | Microsoft 365 calendar | `meetingDuration` (`PT30M`), `startDateTime`, `endDateTime` (local, no offset), `timeZone` (Windows name), `attendeeEmails`, `maxCandidates` | `meetingTimeSuggestions[].meetingTimeSlot.start/end` (UTC) |
| `get_user_date_and_time_zone_settings` | Microsoft 365 | none | `timeZone`, `currentDateTime`, `date` |
| `create_event` | Microsoft 365 calendar | `subject`, `startDateTime`, `endDateTime`, `timeZone`, `attendeeEmails`, `isOnlineMeeting`, `body`, `location` | `id`, `start`, `end` |
| `list_calendar_view` | Microsoft 365 calendar | `startDateTime`, `endDateTime`, `timeZone`, `subject`, `top` | `value[].id/subject/start/end` |
| `update_event` / `cancel_event` | Microsoft 365 calendar | `eventId`, new times or `comment` | `id` or `cancelled` |
| `get_user_presence` | Microsoft Teams | `userEmail` | `availability`, `activity` |
| `send_email_with_attachments` | Microsoft 365 mail | `to`, `subject`, `body`, `contentType` | `status` |
| `salesforce_search` | Salesforce Contacts | `email` or `name` | `count`, `records[].Id/Name/Email/Phone/Title/Account.Name` |
| `salesforce_get_contact` | Salesforce Contacts | `contact_id` or `email` | `found`, `contact` |
| `salesforce_create_lead` | Salesforce Leads | `last_name`, `company`, `first_name`, `email`, `phone`, `title`, `description` | `lead_id` |
| `zendesk_search` | Zendesk Help Center or tickets | `query`, `type` (`articles` or `tickets`) | `results[].id/title/status/url/snippet` |
| `zendesk_add_comment` | Zendesk tickets | `ticket_id`, `comment`, `public` | `ticket_id`, `status` |
| `zendesk_create_ticket` | Zendesk tickets | `subject`, `description`, `requester_name`, `requester_email`, `priority` | `ticket_id`, `status`, `priority` |
| `twilio_send_message` | Twilio SMS | `to` (E.164), `body` (300 characters or fewer) | `message_sid`, `status` |
| `order_lookup`, `hotel_*`, `quiz_record_result`, `training_record_session`, `research_save_interview_notes` | Your order, reservation, learning, or research system | See the mock schemas | See the mock schemas |

The exact JSON Schemas are the mock server's `tools/list` response at
`https://voice-agent-noauth-mcp.lemonsky-36682081.westus2.azurecontainerapps.io/mcp/mock-tool-call`.
Write tools run only after the caller says yes to a read-back, so your server does
not need its own confirmation step.

## 3. Build the server

Any MCP server that exposes those tools works. Two common choices on Azure:

- **Python MCP server on Azure Container Apps or Azure Functions.** Use the
  [`mcp` Python SDK](https://github.com/modelcontextprotocol/python-sdk) with
  stateless Streamable HTTP, and keep the system credentials in app settings or
  Key Vault. A minimal tool:

  ```python
  from mcp.server.fastmcp import FastMCP

  mcp = FastMCP("contoso-tools", stateless_http=True)

  @mcp.tool()
  def zendesk_add_comment(ticket_id: str, comment: str, public: bool = False) -> dict:
      """Add a comment to an existing Zendesk ticket."""
      ticket = zendesk.put(f"/api/v2/tickets/{ticket_id}.json",
                           json={"ticket": {"comment": {"body": comment, "public": public}}})
      return {"ok": True, "ticket_id": ticket["id"], "status": ticket["status"], "error": None}
  ```

- **Azure Logic Apps (Standard) workflows exposed as MCP tools.** Each tool is a
  workflow with an HTTP Request trigger whose JSON schema is the tool's arguments;
  the Salesforce, Zendesk, and Twilio calls use connectors or HTTP actions. This is
  how the reference backend behind the Foundry Templates is built. Logic Apps MCP
  servers require an `X-API-KEY` header, so the Playground reaches them through a
  no-auth proxy that holds the key. Step-by-step setup:
  [Create MCP servers with Azure Logic Apps](./06_logic_apps_mcp_servers.md).

### Salesforce

1. In Setup, create an External Client App (or Connected App) with the
   **client credentials flow**, assign it a run-as integration user, and grant the
   `api` scope.
2. Get a token from `https://<my-domain>.my.salesforce.com/services/oauth2/token`
   with `grant_type=client_credentials`.
3. Search and get Contacts with SOQL on
   `/services/data/v62.0/query?q=SELECT Id, Name, Email, Phone, Title, Account.Name FROM Contact WHERE Email = '...'`.
4. Create Leads with `POST /services/data/v62.0/sobjects/Lead`. Send
   `Sforce-Duplicate-Rule-Header: allowSave=true` if duplicate rules would block
   test leads.

### Zendesk

1. Create an OAuth client (or an API token for a test account) with the `read`
   and `write` scopes for tickets and Help Center.
2. Articles: `GET /api/v2/help_center/articles/search.json?query=...`.
   Tickets: `GET /api/v2/tickets/{id}.json` or `GET /api/v2/search.json?query=type:ticket ...`.
3. Comments: `PUT /api/v2/tickets/{id}.json` with `{"ticket": {"comment": {"body": "...", "public": false}}}`.
4. New tickets: `POST /api/v2/tickets.json` with `subject`, `comment.body`,
   `requester`, and `priority`.

### Twilio SMS

1. Use a paid account or a trial account with verified recipient numbers; trial
   accounts may reject custom message bodies.
2. Send with `POST https://api.twilio.com/2010-04-01/Accounts/{AccountSid}/Messages.json`
   and the form fields `To`, `From`, and `Body`. Return the message `sid` and `status`.

### Microsoft 365 calendar, presence, and mail

- With your own MCP server, call Microsoft Graph with an app registration:
  `POST /users/{id}/findMeetingTimes`, `POST /users/{id}/events`,
  `GET /users/{id}/calendarView`, `PATCH /users/{id}/events/{eventId}`,
  `POST /users/{id}/events/{eventId}/cancel`, `GET /users/{id}/presence`, and
  `POST /users/{id}/sendMail`. Limit application permissions to test mailboxes,
  for example with an Exchange application access policy.
- In your own Foundry Project, you can instead attach the Work IQ Calendar,
  Teams, and Mail MCP servers through a Foundry Toolbox; they act as the signed-in
  user.

## 4. Use a Foundry Toolbox in your own Project

For real customer data, run the Template in your own Foundry Project, where
credentials stay in Project connections:

1. Start the [local Portal](./03_run_samples.md) against your Project, or create the
   Agent from the matching Foundry Template card.
2. Create a Project connection for each MCP server (key, OAuth, or Entra
   identity), and a Foundry Toolbox per stage that restricts `allowed_tools`.
3. Replace each stage's mock MCP tool with the Toolbox reference. The tool names
   in the stage instructions must match the Toolbox tools.

The hosted Playground rejects Toolboxes, connections, and credential headers,
because every Playground Agent lives in one shared Project.

## 5. Test

1. Paste the system's URL and select **Connect real tool**; the card shows **Connected to
   real tool**, and the **Done** summary lists the system under real tools.
2. Select **Try it now** and follow the Template's try-it turns with your own data, for
   example a real ticket number or a contact email that exists in your sandbox.
3. A failed call should return `ok: false` with an `error.message`; the Agent then
   says plainly that the action did not go through.

## Security checklist

- Only sandbox or test data behind a no-auth URL.
- Credentials only on the server, never in the Agent definition.
- Validate and limit every argument on the server; a caller can say anything.
- Rate-limit the endpoint and log calls without logging message bodies.
- Make write tools idempotent where you can; the Agent calls each once, but
  networks retry.
