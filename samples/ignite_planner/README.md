# Ignite Session Planner - a voice Agent that drives a web page

## Conclusion

A demo conference assistant for Microsoft Ignite 2026 (November 17–20, San
Francisco). Attendees browse and plan sessions on a web page and can talk to a
voice assistant that opens from the top of the page. The assistant does not only
answer: it operates the page. It reorders the list, highlights cards, opens
details and adds sessions to the calendar. The attendee can also use the page
directly (open details, drag into the calendar, find a speaker, fill free time,
compare two sessions), and the Agent is told what they did.

Every action is a Voice Agent **function** that the browser page executes in
JavaScript, not a server-side tool, so the result appears on the page the moment
the Agent calls it.

The session data is a snapshot of the public Ignite 2026 catalog; see
[data/README.md](data/README.md).

## Layout

```text
ignite_planner/
├── server.mjs   Loopback helper: creates or reuses the Agent, serves the page, gives the page an az-login token
├── agent/       Agent definition sent to Foundry: agent.mjs, prompt.txt, tools.json, knowledge-tools.json
├── web/         Browser files: page, styles, page logic, voice session, playback and microphone, effects
├── data/        Public Ignite snapshot, the catalog generated from it, and the modules that read them
├── tools/       Offline scripts: refresh the snapshot, build the catalog and name tables, evaluate, probe
└── tests/       Node unit tests and snapshot-script tests; tests/browser/ holds Playwright page tests
```

The page uses flat URLs (`/app.mjs`, `/catalog.json`, `/tools.json`). The server
maps each allowed URL to one file in `web/`, `agent/` or `data/` and returns 404
for anything else, including inherited JavaScript property names. Malformed
URLs return 400; unexpected request or file-read failures are logged locally
and return a generic 500 without stopping the server. All page paths are
relative, so the same page can also be served under a sub-path by another host
(see [Hosting the page elsewhere](#hosting-the-page-elsewhere)).

## Architecture

```text
Browser ───── WebSocket (audio, events, function calls) ─────▶ Foundry Voice Agent
   │
   └─ asks the local Node server for a token once per call (POST /api/token)
```

`server.mjs` does three things: create or reuse the Voice Agent at startup,
serve the page files, and hand a short-lived `az login` token to a same-origin
page. It never sees audio, events or function calls, so several tabs can talk
at once.

The Agent has 14 functions, all executed in the page:

| Kind | Function | What the page shows |
| --- | --- | --- |
| Query (`web/session-index.mjs`) | `ignite_rank_sessions` | The Agent's interest keywords are "typed" into the search box with the match count |
| | `ignite_search_sessions` | The same, with the search terms and date filters |
| | `ignite_get_session` | The card's lock frame flashes |
| | `ignite_validate_agenda` | Overlapping calendar blocks flash orange |
| Page action (`web/page-tools.mjs`) | `show_ranked_sessions` | The list reshuffles into the top N with rank badges and interest tags |
| | `highlight_session` | Animated border, lock frame and a beam from the voice orb |
| | `open_session_details` | The details panel expands from the card |
| | `add_to_agenda` | The card flies into the calendar |
| | `remove_from_agenda` | The calendar block dissolves |
| | `overview_agenda` | A scan line sweeps the calendar and lights each session |
| | `find_speaker` | Phonetic speaker search: lists the person's sessions, or a "Did you mean…?" card when unsure |
| | `fill_free_time` | Free slots of the day are hatched in the calendar, with sessions that fit |
| | `compare_sessions` | A side-by-side panel of 2–3 sessions with differing rows marked |
| | `show_how_it_works` | An explainer panel slides in and shows how the Agent operates the page |

### Ranking by interest

`ignite_rank_sessions(interests, related_terms, date)` scores every interest
phrase with weighted BM25 over title, topics, speakers and the official
description, with a bonus when the whole phrase appears in the title or topics.
A session is a `strong` match only when at least two thirds of the words match.
Every ranking returns at least five sessions: when there are fewer strong
matches, looser ones fill up to five and are labelled `partial` (some interest
words) or `related` (only the Agent's `related_terms`). The page shows those
cards with a dashed "≈ looser match" label, and the Agent says they are weaker
suggestions.

The Agent then calls `show_ranked_sessions` and introduces the top three, one
`highlight_session` at a time.

### Keeping the spotlight in step with speech

A function call reaches the page when the response is generated, often seconds
before the matching speech plays. The page defers each `highlight_session`
until the speech before it has played (`whenSpoken` in `web/app.mjs`), so the
spotlight moves as the Agent starts talking about the next session. If the
attendee interrupts, pending actions apply at once.

### Page events

When the attendee clicks a card or adds or removes a session, the page sends a
system message such as `[Page event] The attendee selected BRK244 …`. It does
not trigger a reply, so a follow-up such as "is this one good for me?" resolves
to that session.

### Finding a speaker

Recognizers often turn unfamiliar names into ordinary words ("Raghavan" →
"rug of on"). `web/name-search.mjs` compares names by sound: both sides become
phonemes, aligned with accent-aware costs, and adjacent transcript words may be
joined back into one name. A confident match lists the speaker's sessions;
anything else returns up to three candidates for the attendee to pick.

The matcher is a browser port of a Python phonetic name-search package that is
not part of this repository. Its tables in `data/name-search-data.json` were
exported from that package by `tools/build_name_search_data.py`.

## Authentication

A browser WebSocket cannot set an `Authorization` header, so the page passes
the token as the second subprotocol:
`new WebSocket(url, ['realtime', 'authorization.bearer.<token>'])`. The browser
cannot send the `Foundry-Features` header either, so the URL uses
`api-version=2025-11-15-preview`. `tools/probe_browser_auth.mjs` re-checks these
handshakes.

The token comes from the `az login` of whoever runs `server.mjs` and carries
that person's Foundry permissions for about an hour. The server therefore
listens on `127.0.0.1` only and gives the token only to a page whose Host and
Origin are the same loopback origin. This sample is for a demo on your own
machine; do not expose `server.mjs` to other users.

## Run

Requirements: Node.js 22+, the Azure CLI, and a Foundry project with Voice
Agents. There is no `npm install`. Run the commands in this directory.

### Configure

The server reads these settings from `.env` in this directory (ignored by Git)
or from the file given with `--env-file`:

| Variable | Default |
| --- | --- |
| `AZURE_VOICE_AGENTS_ENDPOINT` | Required for voice, for example `https://<account>.services.ai.azure.com/api/projects/<project>` |
| `AZURE_VOICE_AGENTS_MODEL` | `gpt-realtime` |
| `AZURE_VOICE_AGENTS_VOICE` | `en-US-AvaNeural` |

The `az login` account needs access to that project.

### Start

```bash
az login
node server.mjs                          # port 8768, reads ./.env
node server.mjs --env-file /path/to/.env --port 8778
node server.mjs --preview --port 8779    # page only, no Azure calls
```

The log ends with `Created Voice Agent ...` or `Reusing Voice Agent ...`, then
`Ignite planner (browser-direct voice) on http://127.0.0.1:<port>`.

The Agent name, `ignite-web-demo-js-<hash>`, is derived from the prompt, tools,
voice and catalog version. While they are unchanged the same Agent is reused;
any change creates a new Agent and leaves the old one in Foundry. Delete Agents
you no longer use in Foundry; the sample does not delete them.

Page files are re-read on every request, so after editing `web/` just reload
the browser. Restart the server after changing `agent/`, `data/` or
`server.mjs`.

### Use the page

1. Open `http://localhost:8768` (or your port). Only `localhost` and
   `127.0.0.1` are accepted; forward the port if the server runs remotely.
2. Select **Ask Ignite**. The voice bar opens and connects; allow the
   microphone. Headphones keep the microphone from picking up the Agent. Select
   **⌨** to type instead.
3. Select **♪** to play a local test tone if you hear nothing.
4. Select the statistics strip at the bottom of the voice bar to see the 14
   functions, the Agent's recent actions and connection details. **▶** next to a
   function runs it with sample arguments.
5. **↓ Export my agenda** downloads the saved agenda as
   `ignite-2026-my-agenda.ics` for Outlook or Google Calendar.
6. Ask "How do you control this web page? Walk me through it." to open the
   explainer panel; answer "Yes, show me live." for two real calls.

To rehearse without Azure, run this in the browser console; it takes the same
path as a real Agent call:

```js
igniteDemo.simulateAgentCall('ignite_rank_sessions', {interests: ['voice agents']})
```

### Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| Token error when connecting | `az login` expired. Run `az login` again; no restart needed |
| `This prototype accepts loopback Host only.` | The page was opened on an address other than `localhost` or `127.0.0.1` |
| `EADDRINUSE` at startup | Another process uses the port; stop it or pass `--port` |
| The Agent ignores a prompt change | Restart the server after editing `agent/` |

## Try these turns

- "I build voice agents and care about contact centers. What's on Thursday?"
- "Tell me more about BRK244. Who are the speakers?"
- Select a card, then ask "Is this one good for me?"
- "Which sessions is e when wrong speaking in?" (a misheard name; pick the
  right speaker from the suggestions)
- "What can I fit into my free time on Wednesday?"
- "BRK241 or BRK248, which one should I attend? I hire engineers."
- "I'm into computer vision and movies." (no direct matches; expect five
  looser suggestions)

## Tests

```bash
node --test tests/*.mjs                                   # unit tests
python3 -m unittest discover -s tests -p 'test_*.py'      # snapshot refresh script
```

Page tests use Playwright:

```bash
python3 -m venv .venv && .venv/bin/pip install -r tests/requirements.txt
.venv/bin/playwright install chromium
node server.mjs --preview --port 8779 &
.venv/bin/python tests/browser/test_ui_browser.py --url http://127.0.0.1:8779
.venv/bin/python tests/browser/test_infinite_scroll_browser.py --url http://127.0.0.1:8779
.venv/bin/python tests/browser/test_playback_buffer_browser.py --url http://127.0.0.1:8779
.venv/bin/python tests/browser/test_bulk_agenda_browser.py --url http://127.0.0.1:8779
.venv/bin/python tests/browser/test_live_browser.py --url http://127.0.0.1:8768   # real Azure, uses quota
```

Screenshots, logs and the microphone recording are written to `artifacts/`
(ignored by Git). `test_live_browser.py --scenario <name>` runs one scenario.

The parity tests between `web/name-search.mjs` and the Python matcher, and
`tools/eval_name_search.mjs`, need that matcher: set `NAMESEARCH_REFERENCE` to
its directory and `NAMESEARCH_PYTHON` to a Python with `rapidfuzz>=3.9,<4`.
Without them the parity test is skipped and every other test runs.

## Hosting the page elsewhere

`node tools/export_hosted.mjs <empty-directory>` writes the static files another
host needs to serve the page: the page files, the generated `catalog.json` and
`session-details.json`, and `agent.json` (the Agent name and definition). That
host must create the Agent and relay the page's voice WebSocket with its own
credentials and access control; Node is not needed at run time.

## Files

| File | Purpose |
| --- | --- |
| `server.mjs` | URL allowlist, `/api/config`, `/api/token`, `/catalog.json`, `/session-details.json` |
| `agent/agent.mjs` | Agent definition and name, create and enable calls, `az` token cache |
| `agent/prompt.txt`, `agent/tools.json`, `agent/knowledge-tools.json` | Prompt and the schemas of the 10 page functions and 4 query functions |
| `data/` | Snapshot, generated catalog and name tables, `catalog.mjs` and `session-details.mjs`; see [data/README.md](data/README.md) |
| `web/app.mjs`, `web/index.html`, `web/styles.css` | Page, theme, animations and page logic |
| `web/voice-session.mjs` | Turn scheduling, interruption and page events |
| `web/session-index.mjs` | Search and interest ranking |
| `web/page-tools.mjs` | Page actions |
| `web/audio.mjs`, `web/pcm-capture.js` | Playback (levels and spectrum) and the microphone worklet |
| `web/name-search.mjs` | Phonetic speaker search |
| `web/wireframe.mjs`, `web/effects.mjs` | Voice orb, logo, beams and particles |
| `web/ics.mjs` | `.ics` export (RFC 5545) |
| `web/explainer.mjs` | Explainer panel |
| `web/conversation-log.mjs` | In-page conversation log |
| `tools/session_catalog.py` | `--build` generates `data/catalog.json`; its `SessionIndex` is the Python reference for `web/session-index.mjs` |
| `tools/refresh_snapshot.py`, `tools/add_descriptions.py` | Refresh the public snapshot and the official descriptions |
| `tools/build_name_search_data.py`, `tools/eval_name_search.mjs` | Export the name-matcher tables; offline accuracy evaluation |
| `tools/probe_browser_auth.mjs` | Re-check the browser WebSocket handshakes |
| `tools/export_hosted.mjs` | Export the page for another host |

## Limits

- Not yet tested with a live microphone and speaker by a person; voice and
  interruption tests use recorded audio, and speaker search uses typed
  misrecognitions.
- Reply length varies; some answers are longer than the prompt asks.
- No live updates (room changes, full sessions), wayfinding, FAQ or languages
  other than English. The data is a static snapshot.
- `server.mjs` is for a single developer's machine (see
  [Authentication](#authentication)).
- The browser handshake relies on a preview `api-version` and the gateway's
  subprotocol handling, which work today but are not a long-term contract.
- Drag and drop needs a desktop browser.
- Speaker search covers only speakers with an ID in the snapshot, and its
  phoneme rules follow English spelling, so names from other languages more
  often get a "Did you mean" question.
- Free time is computed for 9:00–18:00 Pacific time with no walking time
  between venues.
