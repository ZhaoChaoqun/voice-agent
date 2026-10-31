# Copyright (c) Microsoft. All rights reserved.
"""Portal-owned Editor routes and Handoff Graph static assets."""

from __future__ import annotations

from pathlib import Path

from aiohttp import web


STATIC_DIR = Path(__file__).resolve().parent / "static" / "handoff"
HANDOFF_ASSETS = frozenset({
    "handoff-app.js",
    "handoff-core.mjs",
    "js-yaml.mjs",
    "voice-picker.mjs",
    "voice-catalog.mjs",
    "transcription-languages.mjs",
    "anchored-popover.mjs",
    "handoff.css",
    # Optional: written by tools/probe_pipeline_availability.py.
    "pipeline-availability.json",
})


async def editor_index(_request: web.Request) -> web.FileResponse:
    return web.FileResponse(STATIC_DIR / "handoff.html")


async def legacy_handoff_redirect(request: web.Request) -> web.Response:
    location = str(request.rel_url.with_path("/editor/", keep_query=True))
    raise web.HTTPPermanentRedirect(location=location)


async def handoff_asset(request: web.Request) -> web.FileResponse:
    name = request.match_info["asset"]
    if name not in HANDOFF_ASSETS or not (STATIC_DIR / name).is_file():
        raise web.HTTPNotFound()
    return web.FileResponse(STATIC_DIR / name)


def install_handoff_routes(app: web.Application) -> None:
    app.router.add_get("/editor", editor_index)
    app.router.add_get("/editor/", editor_index)
    app.router.add_get("/handoff", legacy_handoff_redirect)
    app.router.add_get("/handoff/", legacy_handoff_redirect)
    app.router.add_get("/static/handoff/{asset}", handoff_asset)
