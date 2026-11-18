# Conference Concierge (Ignite 2026)

## Conclusion

`agent.json` is a hands-free conference concierge Voice Agent. The design is
generic; **Microsoft Ignite 2026** (November 17-20, Moscone Center, San Francisco)
is the example event. It finds sessions, recommends a personal path through the week
by role and interests, suggests similar sessions, builds a personal agenda with
clash detection, reports what is starting now and official room and time changes,
answers FAQ and on-site logistics questions, replies in the attendee's language and
time zone, and explains its own design in dev mode.

`agent.json` is exported from the agent that answered real phone calls during the
event, so the instructions, audio settings, handoff graph, and tool contract are the
shipped configuration rather than a simplified illustration. Two production
dependencies are not public: the speaker lookup tool and the email tool. The [hosted
tools](#use-the-hosted-tools) cover both, the second with a mock that sends nothing, and
you can supply your own instead (see [Differences from the production
agent](#differences-from-the-production-agent)).

It is meant for external attendees, so it uses **only official data**. Where no
official source exists (walking routes, restroom and booth locations, Wi-Fi, full
rooms, cancellations), it points to the official interactive map, the Microsoft Events
app, the Information desk, or ignite.microsoft.com. No Knowledge IQ, Work IQ, or other
user-specific connection is needed, so the Template works as soon as it is created.

Its tools run on the stateless **conference** MCP pack
([`shared_mcp/app/shared_mcp/conference`](../../shared_mcp/app/shared_mcp/conference/README.md)).

| Data | Source |
| --- | --- |
| Sessions, speakers, rooms, times, keynotes | Public catalog `https://ignite.microsoft.com/api/session/all/en-US`: checked-in snapshot (1,469 sessions, 2026-10-28), refreshed live every 30 minutes by `run_local.ps1`, falling back to the snapshot |
| FAQ: registration, prices, recordings, hotels, accessibility, Digital Pass, app, transfers | **Official** FAQ `https://ignite.microsoft.com/en-US/get-help` (captured 2026-10-29) |
| On-site logistics: badge pickup, shuttles and routes, parking, security and bags, lunch, Celebration, accessibility services, charging lounges, coffee | **Official** event guide `https://ignite.microsoft.com/en-US/event-guide` (captured 2026-10-30) |
| Room and time changes, sessions added or removed | **Official**: the live catalog compared with the snapshot |
| Walking routes, restroom and booth locations | Not provided: the agent points to the official interactive map `https://wayfinding.event.microsoft.com/ignite` |
| Wi-Fi, full rooms, cancellations | Not provided: no official source |

The tools use the real time. Before November 17 they report `event_phase:
before_event`, and the agent says the event has not started and helps plan instead.
`CONFERENCE_NOW=<ISO time>` fixes the time for rehearsals and tests.

## Design

- Model `gpt-realtime-2.1` (speech to speech), voice `en-US-Ava:DragonHDLatestNeural`
  (Ava Dragon HD), Azure semantic VAD with barge-in (800 ms prefix padding, 200 ms
  silence), server echo cancellation and headset noise suppression,
  LLM-generated interim acknowledgements while a tool runs, `store: false`.
- **Three inline subagents with a handoff graph**: `$entrypoint` (concierge),
  `email`, and `end`. The concierge keeps the conference tools; the email stage owns
  the privacy notice and address collection; the end stage says goodbye and calls
  `end_conversation`. Each handoff condition names the exact caller wording that
  triggers it, including the cases that must *not* trigger it, because a vague
  condition transfers on "thanks" alone. An earlier revision of this sample ran as a
  single node after a three-stage graph emitted MCP tools as unexecuted function
  calls; the current contract is stable with `response_scheduling: when_idle` on the
  MCP tools. Dev mode is a section of the instructions.
- **Transcription is disclosed in the greeting** and the one-time email requires
  two-step verbal consent: the concierge asks before transferring, and the email
  stage states the Microsoft privacy notice before collecting an address.
  With `store: false` no audio is persisted, and traces stay text-only.
- The agenda is stateless: every agenda tool takes the current list of session
  IDs and returns the new one, so no sign-in or stored profile is needed.
- Short spoken answers: at most three sentences and two sessions, then
  "Want more?". Answers only from tool results; says "I don't know" otherwise.
- Replies in the language of the attendee's latest message; tool arguments are
  always English keywords. Times are Pacific; with `time_zone` (for example
  `Beijing`) the session tools add `your_time` for online attendees.
- No calendar, knowledge, or avatar tool is attached, and the conference tools need no
  user-specific connection, so the Template works as soon as it is created. The one
  email tool is optional and ships without a `server_url`. Asked to add a session to a
  calendar, the agent says it can't and offers to read the agenda back or email it.
  Knowledge IQ was not used: combined with an FAQ-style tool it intermittently left
  MCP calls unexecuted.
- GPT Live was evaluated and is not used: its tools must run behind a delegation
  backend, and the delegated calls failed with `invalid_delegation_result`.

## Tools

| Tool | Purpose |
| --- | --- |
| `conference_get_event_info` | Dates, current event time, keynotes, topics, types, levels, catalog freshness, dev-mode facts |
| `conference_search_sessions` | Keywords plus day, part of day, time window, topic, level, type, speaker, in-person/online, recorded |
| `conference_find_speaker` | Finds a speaker from how the caller pronounced the name and returns their title, company, and bio. **Not in the public `conference` pack**: see [Differences from the production agent](#differences-from-the-production-agent) |
| `conference_get_session` | One session's details, with alternatives if it is no longer in the catalog |
| `conference_recommend_sessions` | Non-overlapping picks per day from role and interests, avoiding the agenda |
| `conference_similar_sessions` | Similar sessions by topic, speakers, and content (no attendance data) |
| `conference_sessions_starting_soon` | Sessions starting in the next N minutes, soonest first |
| `conference_get_session_changes` | Official room and time changes and sessions added to or removed from the catalog |
| `conference_agenda_add` / `_remove` / `_list` | Stateless agenda with clash detection and "watch the recording" suggestions |
| `conference_get_faq` | Answers from the official FAQ and event guide only, including where to find venue maps; `found: false` otherwise |

Session, recommendation, agenda, and event-info tools take an optional `time_zone`.

## Differences from the production agent

The shipped agent calls two more tools that have no public implementation in this
repository. `agent.json` keeps their structure so the shape is visible, and leaves
`server_url` empty for you to fill in.

| Production tool | What it does | How to get it |
| --- | --- | --- |
| `conference_find_speaker` | Finds a speaker by how a caller pronounced the name, so an accent or a recognition error still reaches the right person, and returns their title, company, and bio. The instructions call it every time a caller says a person's name | Use the [hosted tools](#use-the-hosted-tools), which include it. To run the pack yourself, implement it or drop it from `allowed_tools` and delete the two instruction paragraphs that call it; speakers stay searchable through the `speaker` filter of `conference_search_sessions` |
| `ignite_email_sessions` | Sends the one-time email of saved sessions through an Office 365 shared mailbox | The [hosted tools](#use-the-hosted-tools) include a mock that validates the request and delivers nothing, which is enough to hear the stage. To really send, point the `email` subagent at your own email MCP server, or delete the subagent together with the `to_email` and `email_to_*` handoff conditions. The privacy notice and address confirmation live in the subagent's instructions |

Everything else, including every instruction, handoff condition, and audio setting,
is the configuration that served live calls.

**A missing tool is silent, not an error.** This matters when you run the pack yourself;
the hosted tools already include the speaker lookup. `allowed_tools` filters what the MCP server
lists; it does not require it. If the server does not expose `conference_find_speaker`,
the other tools still register, the model never sees it, and the two instruction
paragraphs that call it cannot be followed. Speaker questions then fall back to the
`speaker` filter of `conference_search_sessions`, which matches words rather than
pronunciation, so "Zakia" or "Sathiya" no longer reaches "Satya Nadella", and
`tell me about <name>` has no biography source.

### Implementing `conference_find_speaker`

Only needed if you run the pack yourself. The contract is small, and this repository
already ships a working phonetic matcher you can port:
[`samples/ignite_planner/web/name-search.mjs`](../ignite_planner/web/name-search.mjs)
with its tuning data [`name-search-data.json`](../ignite_planner/data/name-search-data.json)
(letter-to-sound rules, phoneme confusion costs, nicknames, and the score thresholds).

Input: `spoken_names`, the name as the agent heard it followed by up to two other
spellings. Never correct the name before calling; the matcher compares sound.

Return:

| Field | Value |
| --- | --- |
| `status` | `likely` (one speaker is clearly meant), `choose` (up to three candidates), `no_match`, or `no_name_heard` |
| `heard` | The readings you matched, so the agent can read a name back |
| `choices` | Speakers, best first, each with `name`, `job_title`, `company`, `bio`, their sessions, and `profile_note` when the catalog has no details |
| `next_step` | One sentence telling the model what to do with this status, for example "Ask which speaker the caller meant, naming each choice" |

Keeping `next_step` in the result is what lets the instructions stay short: the tool,
not the prompt, decides whether the agent answers directly or asks the caller to choose.

### Configuring the email tool

The `email` subagent already contains the privacy notice, the address read-back, and the
handoffs, so what is missing is only a server that exposes one tool. The [hosted
tools](#use-the-hosted-tools) include a mock of it, so you can hear the stage before you
write anything. To send real mail, point the subagent's `server_url` at any MCP server of
your own that implements:

```jsonc
// ignite_email_sessions
{
  "email": "jane.doe@contoso.com",        // confirmed with the caller first
  "session_codes": ["BRK244", "TT1663"]   // official codes, at least one
}
```

The production server builds the message from the official catalog and attaches a
calendar file with one-tap Outlook and Google buttons, but the agent only needs a
success or failure result, so a simpler server works.

Three things to keep in mind when you write it:

- The instructions call the tool **once**, after the caller confirms the spelled-out
  address, so the server does not need to handle retries or de-duplication.
- A caller's address is personal data. Keep it out of logs, and send only to the address
  given on that call.
- Nothing is sent until this `server_url` is set. The stage still runs, the agent still
  asks for consent and reads the address back, and the handoff back to the concierge
  still works, so the conversation is complete even before you add the server.

To remove the feature instead, delete the `email` subagent together with the `to_email`
handoff on `$entrypoint` and the two `email_to_*` handoffs, and drop the paragraphs about
emailing from the instructions.

## Use the hosted tools

The conference tools are served without a sign-in at

```
https://voice-agent-noauth-mcp.lemonsky-36682081.westus2.azurecontainerapps.io/mcp/conference
```

Put that in the `conference` tool's `server_url` and the Agent is ready; the
catalog behind it refreshes from the official source. This is the fastest way to
hear the Agent, and the only way to get `conference_find_speaker`, which the pack
in this repository does not implement.

The email stage has a mock at

```
https://voice-agent-noauth-mcp.lemonsky-36682081.westus2.azurecontainerapps.io/mcp/ignite-email-mock
```

It takes the same arguments as the production tool and applies the same validation,
including looking the session codes up in the official catalog, but it never delivers:
the result says `delivered: false` and tells the Agent to say the request was taken and
no email went out. **It is a mock on purpose.** The server needs no sign-in, so anyone
who finds the URL can call it; a route that really sent mail would let anyone make it
send to any address they chose. Use it to hear the stage end to end, and run your own
server when you want the mail to arrive.

Run the pack yourself instead when you want to change a tool, use your own event
data, or keep every call inside your own subscription.

## Run the tools yourself

Foundry calls MCP servers from the cloud, so a local pack needs a Dev Tunnel.
From the repository root, in PowerShell, after `az login` and
`devtunnel user login`:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r portal\requirements.txt -r shared_mcp\requirements.txt tzdata
.\samples\example35_conference_concierge\run_local.ps1 -ProjectEndpoint https://<account>.services.ai.azure.com/api/projects/<project>
```

The script starts the pack on `127.0.0.1:18787` with a 30-minute live catalog
refresh, hosts an anonymous Dev Tunnel, writes an untracked copy of the Template
catalog (`portal/.run/`) that points only this Template at the tunnel, and starts
the Portal on <http://127.0.0.1:9531/editor/>. Add `-Background` to return
immediately. Then **Load from templates**, choose
**Example 35: Conference Concierge (Ignite 2026)**, and **Try it now**. The
published Agent is in your Foundry Project, where you can share it.

`verify_local.py` publishes the Template through the local Portal as one named
Agent and runs a scripted 21-turn session, writing a transcript with the tool calls
of every turn.

## Try these turns

This Agent uses live official Microsoft Ignite data, so answers follow the current catalog and
the real date. Try these turns:

- "What's on voice AI on Thursday afternoon?" → `conference_search_sessions`
- "Add BRK244 to my schedule." then "Also add BRK284." → a 45-minute clash, both recorded, so watch one on demand
- "What's next for me?" → BRK244 on Thursday 5:15 PM, AMC Metreon Theater 12
- "I'm a developer building contact-center agents. What should I attend on Wednesday?" → `conference_recommend_sessions`
- "What else is like BRK244?" → `conference_similar_sessions`, presented as similar sessions, not attendance data
- "I'm watching from Beijing. When is BRK244 in Beijing time?" → Friday, November 20, 9:15 AM
- "What's starting in the next 15 minutes?" → before the event: not started yet, and when it starts
- "Any room changes?" → real room and time changes from the official catalog
- "Where's the nearest restroom?" / "Where's the Foundry booth?" → the official interactive map or the Microsoft Events app
- "What's the Wi-Fi?" → "I don't have that information", with the Information desk
- "When do the shuttles run on Wednesday?" / "Where do I pick up my badge?" → official event guide
- "How much does a conference pass cost?" → official FAQ
- "Is the coffee organic?" → "I don't know", with the Information desk
- "请问周四下午有关于语音智能体的分会吗？" → answer in Chinese; the next English turn is answered in English
- "Show me how you're built." → dev mode, recommends BRK244

## Call it by phone (Twilio)

The Foundry Agent Service answers phone calls for a published Agent itself, so no extra
server is needed. A Twilio **telephony binding** routes calls on one Twilio number to the Agent.
When the binding is created, the service sets that number's Voice webhook to the Agent's
`incoming_call_url`. Twilio streams G.711 μ-law audio at 8 kHz. The service converts it,
and the same `agent.json` serves both browser and phone callers.

You need:

- A Twilio account with a voice-capable number. One number routes to one Agent at a time.
  Creating the binding replaces the number's current Voice webhook.
- A Foundry connection in the Agent's Project with category **Twilio** and auth type **API key**.
  Its target is the Account SID, and its key is the Auth Token.
- A published Agent, for example one created with **Try it now** above.

From the repository root, after `az login`:

```powershell
$env:PROJECT_ENDPOINT = "https://<account>.services.ai.azure.com/api/projects/<project>"
python samples\example35_conference_concierge\bind_phone.py bind --agent-name <agent> --connection <twilio-connection> --phone-number +15551234567
```

Then call the number. Emma greets the caller, and the conversation works as in the browser.
Each spoken turn is short, and the Agent never reads web addresses aloud.
`bind_phone.py show` lists the binding, `calls` lists recent calls with their status
and end reason, and `unbind --binding-id twilio:<digits> --yes` stops routing the number.
`unbind` keeps the Agent, the connection, and the Twilio number. `--dry-run` prints the
binding request without signing in.

Callers outside the US can dial a US number at their own carrier's international rates.

## Generalize to another event

Add `shared_mcp/app/shared_mcp/conference/data/<event>/` with `event.json`,
`sessions.json` (from the event's catalog; see `refresh.py`), and `faq.json` (from the
official FAQ and event guide), set `CONFERENCE_DATASET=<event>`, and replace the
Ignite-specific names in `agent.json` (persona, greeting, BRK244).
