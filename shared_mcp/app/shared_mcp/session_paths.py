"""Portable identifiers and paths for the finance session stores."""

from __future__ import annotations

import re
from pathlib import Path


_IDENTIFIER = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]*")
_WINDOWS_DEVICE = re.compile(r"(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])", re.I)


def session_path(state_dir: Path | None, identifier: str) -> Path | None:
    if (
        not isinstance(identifier, str)
        or _IDENTIFIER.fullmatch(identifier) is None
        or _WINDOWS_DEVICE.fullmatch(identifier.split(".", 1)[0]) is not None
    ):
        raise ValueError("invalid_identifier")
    if state_dir is None:
        return None
    path = state_dir / f"{identifier}.json"
    # The directory is administrator-owned; do not follow pre-existing file links.
    if path.is_symlink() or path.resolve().parent != state_dir.resolve():
        raise ValueError("invalid_session_path")
    return path
