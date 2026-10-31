# `conference` pack

Stateless MCP tools for a conference concierge Voice Agent. Event data lives in
one dataset folder; `ignite2026` (Microsoft Ignite 2026) is the default. Datasets
hold only official data: the public session catalog and the official FAQ. Used by [Example 35: Conference Concierge](../../../../samples/example35_conference_concierge/README.md).

Route: `/mcp/conference`. Every tool name starts with `conference_`. Results carry
`tool`, `ok`, and `error` (`{code, message}`); business failures such as an unknown
session are `ok: false`, not MCP errors. Invalid arguments are schema errors.

## State

Nothing a caller sends is stored. The agenda is a list of session IDs the agent
passes to every agenda tool; each call returns the new list. The agenda argument is
required and unconstrained in the schema on purpose (Voice Live dispatched an
optional, constrained array as a plain function call); the service caps it at 30.

## Data (`data/<dataset>/`)

| File | Content |
| --- | --- |
| `event.json` | Name, dates, IANA time zone, dev-mode facts |
| `sessions.json` | Trimmed snapshot of the public catalog. **Times are UTC** (`Z`), converted to the event time zone for answers. Repeated session codes get instance IDs `CODE-1`, `CODE-2` |
| `faq.json` | Answers with keywords, paraphrasing the official FAQ (all topics on the get-help page), event guide (badge pickup, shuttles, parking, security, lunch, Celebration, accessibility, charging, coffee), and the pointer to the official interactive map; each has its source `url` |

Room and time changes and sessions added to or removed from the catalog are detected
by comparing the live catalog with the snapshot. There are no route, amenity, booth,
full-room, or cancellation tools, because no official source exists.

Refresh the Ignite snapshot (public API, no sign-in):

```bash
cd shared_mcp/app
python -m shared_mcp.conference.refresh            # or --source raw.json
```

## Clock

The tools use the real time in the event time zone and report `event_phase`
(`before_event`, `during_event`, `after_event`). `CONFERENCE_NOW=<ISO>` fixes the time
(`simulated: true`) for rehearsals and tests. `CONFERENCE_DATASET` selects another
dataset folder.

## Live catalog and time zones

`CONFERENCE_LIVE_REFRESH_MINUTES=N` (or `--live-refresh-minutes N` locally) fetches the
public catalog at start and every N minutes in a background thread. A failed fetch keeps
the last good sessions (the snapshot at first) and is reported in
`conference_get_event_info` under `catalog_snapshot`. Session, recommendation, agenda, and
event-info tools take an optional `time_zone` (IANA name, a city such as `Beijing`, or
`UTC+8`) and add `your_time` next to the Pacific event time.

## Run locally

```bash
cd shared_mcp/app
python -m shared_mcp.conference --port 18787 --allowed-host '*'
```

Serves `http://127.0.0.1:18787/mcp/conference` (stateless Streamable HTTP, no auth)
and `/healthz`. Without `--allowed-host`, only loopback Host headers are accepted.
Tests: `python -m unittest tests.test_conference` from `shared_mcp/`.

The pack is not yet part of the hosted no-auth MCP image or `noauth/contracts.json`;
adding it there is a separate, reviewed release.
