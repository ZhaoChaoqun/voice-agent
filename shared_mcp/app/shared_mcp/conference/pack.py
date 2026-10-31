from __future__ import annotations

import os

from mcp.server.fastmcp import FastMCP

from .dataset import dataset_name, load_dataset
from .refresh import start_live_refresh
from .server import register_tools
from .service import ConferenceService

LIVE_REFRESH_ENV = "CONFERENCE_LIVE_REFRESH_MINUTES"


def register(mcp: FastMCP) -> None:
    service = ConferenceService(load_dataset(dataset_name()))
    register_tools(mcp, service)
    minutes = float(os.environ.get(LIVE_REFRESH_ENV, "0") or 0)
    if minutes > 0:
        start_live_refresh(service, minutes)