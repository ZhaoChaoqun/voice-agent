# Conference Concierge (Ignite 2026)

## Conclusion

`agent.json` is a hands-free conference concierge Voice Agent. The design is
generic; **Microsoft Ignite 2026** (November 17-20, Moscone Center, San Francisco)
is the example event. It finds sessions, recommends a personal path through the week
by role and interests, suggests similar sessions, builds a personal agenda with
clash detection, reports what is starting now and official room and time changes,
answers FAQ and on-site logistics questions, replies in the attendee's language and
time zone, and explains its own design in dev mode.

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

- Model `gpt-realtime` (speech to speech), voice `en-US-Emma:DragonHDLatestNeural`
  (Emma Dragon HD), Azure semantic VAD with barge-in (800 ms
  prefix padding, 400 ms silence), server echo cancellation and noise suppression,
  LLM-generated interim acknowledgements while a tool runs, `store: false`.
- **One node, no handoff graph.** With a three-stage handoff graph, Voice Live
  intermittently emitted the MCP tools as plain function calls that were never
  executed, and the entrypoint sometimes spoke tool JSON aloud (1 of 4 repeated
  runs correct). The single-node agent was correct in 4 of 4 runs and in the full
  acceptance. Dev mode is a section of the instructions.
- The agenda is stateless: every agenda tool takes the current list of session
  IDs and returns the new one, so no sign-in or stored profile is needed.
- Short spoken answers: at most three sentences and two sessions, then
  "Want more?". Answers only from tool results; says "I don't know" otherwise.
- Replies in the language of the attendee's latest message; tool arguments are
  always English keywords. Times are Pacific; with `time_zone` (for example
  `Beijing`) the session tools add `your_time` for online attendees.
- No calendar, email, knowledge, or avatar tool is attached, so the Template needs no
  user-specific connection. Asked to add a session to a calendar or send an email, the
  agent says it can't and offers to read the agenda back. Knowledge IQ was not used:
  combined with an FAQ-style tool it intermittently left MCP calls unexecuted.
- GPT Live was evaluated and is not used: its tools must run behind a delegation
  backend, and the delegated calls failed with `invalid_delegation_result`.

## Tools

| Tool | Purpose |
| --- | --- |
| `conference_get_event_info` | Dates, current event time, keynotes, topics, types, levels, catalog freshness, dev-mode facts |
| `conference_search_sessions` | Keywords plus day, part of day, time window, topic, level, type, speaker, in-person/online, recorded |
| `conference_get_session` | One session's details, with alternatives if it is no longer in the catalog |
| `conference_recommend_sessions` | Non-overlapping picks per day from role and interests, avoiding the agenda |
| `conference_similar_sessions` | Similar sessions by topic, speakers, and content (no attendance data) |
| `conference_sessions_starting_soon` | Sessions starting in the next N minutes, soonest first |
| `conference_get_session_changes` | Official room and time changes and sessions added to or removed from the catalog |
| `conference_agenda_add` / `_remove` / `_list` | Stateless agenda with clash detection and "watch the recording" suggestions |
| `conference_get_faq` | Answers from the official FAQ and event guide only, including where to find venue maps; `found: false` otherwise |

Session, recommendation, agenda, and event-info tools take an optional `time_zone`.

## Run locally

The hosted no-auth MCP does not serve `/mcp/conference` yet, so run the pack
locally and expose it with a Dev Tunnel (Foundry calls MCP servers from the
cloud). From the repository root, in PowerShell, after `az login` and
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

## Generalize to another event

Add `shared_mcp/app/shared_mcp/conference/data/<event>/` with `event.json`,
`sessions.json` (from the event's catalog; see `refresh.py`), and `faq.json` (from the
official FAQ and event guide), set `CONFERENCE_DATASET=<event>`, and replace the
Ignite-specific names in `agent.json` (persona, greeting, BRK244).
