"""Pure helpers for materializing portable Voice Agent definitions."""

from __future__ import annotations

import copy
from typing import Any

ENTRYPOINT_ID = "$entrypoint"
# Subagent identity and routing metadata; every other field is node behavior.
_SUBAGENT_METADATA_FIELDS = frozenset(
    {"id", "description", "source", "interface", "handoff_conditions"}
)
# Behavior an implicit legacy entrypoint takes from the top-level definition.
_ENTRYPOINT_SESSION_FIELDS = ("tools", "tool_choice", "parallel_tool_calls")


def _subagent_instructions(
    base_instructions: str | None, subagent: dict[str, Any]
) -> str | None:
    inherit = subagent.get("inherit_base_instructions", True)
    if not isinstance(inherit, bool):
        raise ValueError("inherit_base_instructions must be a boolean.")
    instructions = subagent.get("instructions")
    if instructions is not None and not isinstance(instructions, str):
        raise ValueError("Subagent instructions must be a string or null.")
    if not inherit or not base_instructions:
        return instructions
    if not instructions:
        return base_instructions
    return f"{base_instructions}\n\n{instructions}"


def _legacy_edge(source: str, condition: dict[str, Any]) -> dict[str, Any]:
    edge = {
        "id": condition["id"],
        "source": source,
        "target": condition["target"],
        "description": condition["condition"],
    }
    edge.update(
        (key, copy.deepcopy(value))
        for key, value in condition.items()
        if key not in {"id", "target", "condition"}
    )
    return edge


def uses_inline_subagents(definition: Any) -> bool:
    config = definition.get("subagent_config") if isinstance(definition, dict) else None
    return isinstance(config, dict) and config.get("subagent_type") == "inline"


def project_inline_subagents(definition: dict[str, Any]) -> dict[str, Any]:
    """Project inline subagent authoring onto the legacy handoff graph.

    The entrypoint becomes the top-level session, as in a legacy graph, and each
    other subagent becomes a node whose instructions already include the base.
    """
    config = definition.get("subagent_config")
    if not isinstance(config, dict) or config.get("subagent_type") != "inline":
        return definition
    subagents = config.get("subagents")
    if (
        not isinstance(subagents, list)
        or len(subagents) < 2
        or not all(isinstance(subagent, dict) for subagent in subagents)
        or subagents[0].get("id") != ENTRYPOINT_ID
    ):
        raise ValueError(
            "Inline subagents must be objects, start with $entrypoint, "
            "and include at least one specialist."
        )
    base_instructions = definition.get("instructions")
    if base_instructions is not None and not isinstance(base_instructions, str):
        raise ValueError("Voice Agent instructions must be a string or null.")

    entrypoint = subagents[0]
    unsupported = entrypoint.keys() - _SUBAGENT_METADATA_FIELDS - {
        "instructions",
        "inherit_base_instructions",
        *_ENTRYPOINT_SESSION_FIELDS,
    }
    if unsupported:
        raise ValueError(
            "The legacy graph cannot express $entrypoint fields: "
            + ", ".join(sorted(unsupported))
        )

    nodes = []
    edges = []
    for subagent in subagents:
        edges.extend(
            _legacy_edge(subagent["id"], condition)
            for condition in subagent.get("handoff_conditions") or []
        )
        if subagent is entrypoint:
            continue
        if "audio_output" in subagent:
            raise ValueError(
                f"Subagent {subagent['id']} audio_output has no legacy graph projection."
            )
        node_config = {
            key: copy.deepcopy(value)
            for key, value in subagent.items()
            if key not in _SUBAGENT_METADATA_FIELDS
            and key != "inherit_base_instructions"
        }
        node_config["instructions"] = _subagent_instructions(
            base_instructions, subagent
        )
        nodes.append(
            {
                "id": subagent["id"],
                "description": subagent.get("description"),
                "config": node_config,
            }
        )

    del definition["subagent_config"]
    definition["instructions"] = _subagent_instructions(base_instructions, entrypoint)
    for field in _ENTRYPOINT_SESSION_FIELDS:
        if field in entrypoint:
            definition[field] = copy.deepcopy(entrypoint[field])
    definition["handoff"] = {
        **copy.deepcopy(config.get("handoff_policy") or {}),
        "nodes": nodes,
        "edges": edges,
    }
    return definition


def materialize_handoff_instruction_inheritance(
    definition: dict[str, Any],
    *,
    project_inline: bool = True,
) -> dict[str, Any]:
    """Expand shared instructions for service versions that reject them.

    With project_inline, inline subagents are also projected onto the legacy
    handoff graph; without it they are kept as authored."""
    if project_inline:
        project_inline_subagents(definition)
    handoff = definition.get("handoff")
    if not isinstance(handoff, dict):
        return definition
    nodes = handoff.get("nodes")
    if not isinstance(nodes, list):
        return definition

    base_instructions = definition.get("instructions")
    for node in nodes:
        if not isinstance(node, dict):
            continue
        config = node.get("config")
        if not isinstance(config, dict):
            continue
        inherit = config.pop("inherit_from_base_instructions", None)
        if inherit is None:
            continue
        if not isinstance(inherit, bool):
            raise ValueError(
                "handoff node inherit_from_base_instructions must be a boolean."
            )
        if not inherit:
            continue
        node_instructions = config.get("instructions")
        if base_instructions is not None and not isinstance(base_instructions, str):
            raise ValueError("Voice Agent instructions must be a string or null.")
        if node_instructions is not None and not isinstance(node_instructions, str):
            raise ValueError("Handoff node instructions must be a string or null.")
        if not node_instructions:
            config["instructions"] = base_instructions
        elif base_instructions:
            config["instructions"] = f"{base_instructions}\n\n{node_instructions}"

    return definition
