"""Load one conference dataset: event config, the official session snapshot, and the official FAQ."""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

DATA_ROOT = Path(__file__).resolve().parent / "data"
DEFAULT_DATASET = "ignite2026"
DATASET_ENV = "CONFERENCE_DATASET"
_DATASET_NAME = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
_WORD = re.compile(r"[a-z0-9]+")


def words(text: str) -> list[str]:
    return _WORD.findall(str(text or "").lower())


@dataclass
class Dataset:
    name: str
    event: dict[str, Any]
    snapshot: dict[str, Any]
    sessions: list[dict[str, Any]]
    faq: list[dict[str, Any]]
    by_id: dict[str, dict[str, Any]] = field(default_factory=dict)
    by_code: dict[str, list[dict[str, Any]]] = field(default_factory=dict)

    def __post_init__(self) -> None:
        for session in self.sessions:
            self.by_id[session["id"].upper()] = session
            self.by_code.setdefault(session["code"].upper(), []).append(session)


def _read(path: Path, default: Any) -> Any:
    if not path.is_file():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def dataset_name(environment: dict[str, str] | None = None) -> str:
    values = os.environ if environment is None else environment
    name = (values.get(DATASET_ENV) or DEFAULT_DATASET).strip().lower()
    if not _DATASET_NAME.fullmatch(name):
        raise ValueError(f"{DATASET_ENV} must be a dataset folder name such as {DEFAULT_DATASET}")
    return name


def load_dataset(name: str = DEFAULT_DATASET, root: Path = DATA_ROOT) -> Dataset:
    folder = (root / name).resolve()
    if not folder.is_relative_to(root.resolve()) or not (folder / "event.json").is_file():
        raise FileNotFoundError(f"Conference dataset not found: {name}")
    snapshot = _read(folder / "sessions.json", {"sessions": []})
    return Dataset(
        name=name,
        event=_read(folder / "event.json", {}),
        snapshot={key: value for key, value in snapshot.items() if key != "sessions"},
        sessions=list(snapshot.get("sessions") or []),
        faq=list((_read(folder / "faq.json", {}) or {}).get("entries") or []),
    )
