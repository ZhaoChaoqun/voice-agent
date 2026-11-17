# Copyright (c) Microsoft. All rights reserved.
"""Shared Azure setup contract for the portal and its two setup skills.

One place for the settings file and its variable names, how Foundry projects are found,
the roles the portal needs, and effective-permission checks. Standard library only, so
Azure Cloud Shell's python3 can run it before any portal dependency is installed.
Used by the portal itself (project picker), skills/portal-local and skills/portal-remote.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from dataclasses import dataclass
from fnmatch import fnmatchcase
from pathlib import Path
from typing import Any, Iterable

PORTAL_DIR = Path(__file__).resolve().parent
ENV_FILE = PORTAL_DIR / ".env"
ENV_EXAMPLE = PORTAL_DIR / ".env.example"

# Shared settings: the portal reads them; both setup skills write them.
ENDPOINT = "AZURE_VOICE_AGENTS_ENDPOINT"
ENDPOINT_NAMES = ("AZURE_AI_PROJECT_ENDPOINT", ENDPOINT)  # the order the portal reads them
FOUNDRY_SUBSCRIPTION = "AZURE_SUBSCRIPTION_ID"  # subscription of the Foundry resource
FOUNDRY_RESOURCE_GROUP = "AZURE_RESOURCE_GROUP"  # resource group of the Foundry resource

# Container App settings (skills/portal-remote only; the portal ignores them).
ACA_SUBSCRIPTION = "PORTAL_ACA_SUBSCRIPTION_ID"
ACA_RESOURCE_GROUP = "PORTAL_ACA_RESOURCE_GROUP"  # the portal's own group, not the Foundry one
ACA_LOCATION = "PORTAL_ACA_LOCATION"
ACA_NAME = "PORTAL_ACA_NAME"
ACA_AUTH = "PORTAL_ACA_AUTH"
ACA_ALLOWED_IPS = "PORTAL_ACA_ALLOWED_IPS"
ACA_DEFAULT_NAME = "voice-agent-portal"
ACA_DEFAULT_RESOURCE_GROUP = "voice-agent-portal"

ARM = "https://management.azure.com"
FOUNDRY_DATA_RESOURCE = "https://ai.azure.com"
PUBLISH_DATA_ACTION = "Microsoft.CognitiveServices/accounts/AIServices/agents/write"

# Foundry projects visible to the caller. The endpoint comes from the resource itself:
# an account's custom subdomain can differ from its name, so it is never built from names.
PROJECTS_QUERY = (
    "resources"
    " | where type =~ 'microsoft.cognitiveservices/accounts/projects'"
    " | extend endpoint = tostring(properties.endpoints['AI Foundry API'])"
    " | where isnotempty(endpoint)"
    " | extend projectName = tostring(split(name, '/')[1]), accountName = tostring(split(name, '/')[0]),"
    " accountKey = tolower(tostring(split(id, '/projects/')[0]))"
    " | join kind=leftouter (resources"
    " | where type =~ 'microsoft.cognitiveservices/accounts'"
    " | project accountKey = tolower(id), publicNetworkAccess = tostring(properties.publicNetworkAccess))"
    " on accountKey"
    " | project id, projectName, accountName, endpoint, resourceGroup, subscriptionId, location, publicNetworkAccess"
    " | order by projectName asc"
)


def project_from_row(row: dict[str, Any]) -> dict[str, str]:
    """One Resource Graph row of PROJECTS_QUERY as the portal's project record."""
    project_id = str(row.get("id") or "")
    name, account = str(row.get("projectName") or ""), str(row.get("accountName") or "")
    return {
        "name": name,
        "account": account,
        "label": f"{name} · {account}",
        "endpoint": str(row.get("endpoint") or "").rstrip("/"),
        "subscription_id": str(row.get("subscriptionId") or ""),
        "resource_group": str(row.get("resourceGroup") or ""),
        "region": str(row.get("location") or ""),
        "id": project_id,
        "account_id": project_id.split("/projects/")[0],
        "public_network_access": str(row.get("publicNetworkAccess") or ""),
    }


@dataclass(frozen=True)
class Role:
    id: str
    name: str
    scope: str  # "registry", "project" or "account"
    why: str
    required: bool


# Roles of the portal's managed identity (Container App mode). Built-in IDs never change;
# display names do (53ca6127 was "Azure AI User" before it became "Foundry User").
PORTAL_IDENTITY_ROLES = (
    Role("7f951dda-4ed3-4680-a7ca-43fe172d538d", "AcrPull", "registry", "pull the portal image", True),
    Role("53ca6127-db72-4b80-b1b0-d745d6d5456d", "Foundry User", "project",
         "create, read and run Voice Agents in the project", True),
    Role("f2dc8367-1007-4938-bd23-fe263f013447", "Cognitive Services Speech User", "account",
         "live voice list (optional; a bundled list is used otherwise)", False),
    Role("acdd72a7-3385-48ef-bd42-f606fba81ae7", "Reader", "account",
         "project picker and region lookup (optional)", False),
)
FOUNDRY_USER = PORTAL_IDENTITY_ROLES[1]
ROLE_ADMINS = "Owner, User Access Administrator or Role Based Access Control Administrator"


# ---------- settings file ----------
def read_env(path: Path = ENV_FILE) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.is_file():
        return values
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if key.startswith("export "):
            key = key[len("export "):].strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
            value = value[1:-1]
        values[key] = value
    return values


def project_endpoint(values: dict[str, str]) -> str:
    return next((values[name] for name in ENDPOINT_NAMES if values.get(name)), "").rstrip("/")


def update_env(updates: dict[str, str], path: Path = ENV_FILE) -> None:
    """Set keys in the settings file, keeping every other line and comment as it is."""
    if path.is_file():
        lines = path.read_text(encoding="utf-8").splitlines()
    elif path == ENV_FILE and ENV_EXAMPLE.is_file():
        lines = ENV_EXAMPLE.read_text(encoding="utf-8").splitlines()
    else:
        lines = []
    pending = dict(updates)
    for index, line in enumerate(lines):
        key = line.split("=", 1)[0].strip() if "=" in line and not line.lstrip().startswith("#") else ""
        if key in pending:
            lines[index] = f"{key}={pending.pop(key)}"
    if pending:
        if any(key.startswith("PORTAL_ACA_") for key in pending) and not any("PORTAL_ACA_" in line for line in lines):
            lines += ["", "# Container App deployment (skills/portal-remote); the portal ignores these."]
        lines += [f"{key}={value}" for key, value in pending.items()]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    path.chmod(0o600)


# ---------- permissions ----------
def _match(patterns: Iterable[str], operation: str) -> bool:
    return any(fnmatchcase(operation.lower(), pattern.lower()) for pattern in patterns)


def allowed(permissions: list[dict[str, Any]], operation: str, *, data: bool = False) -> bool:
    """Whether effective permissions (Microsoft.Authorization/permissions) allow an operation."""
    key, not_key = ("dataActions", "notDataActions") if data else ("actions", "notActions")
    return any(
        _match(entry.get(key) or [], operation) and not _match(entry.get(not_key) or [], operation)
        for entry in permissions
    )


# ---------- Azure CLI ----------
class AzError(RuntimeError):
    def __init__(self, args: list[str], stderr: str):
        super().__init__(stderr.strip() or f"az {' '.join(args)} failed")
        self.stderr = stderr


def az_path() -> str:
    path = shutil.which("az")
    if not path:
        raise SystemExit(
            "The Azure CLI (az) is not installed. Azure Cloud Shell already has it; on your computer, "
            "install it from https://aka.ms/installazurecli and run 'az login'."
        )
    return path


def az(*args: str) -> Any:
    """Run an az command and return its JSON output (None when it prints nothing)."""
    argv = [az_path(), *args, "--only-show-errors", "-o", "json"]
    proc = subprocess.run(argv, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if proc.returncode != 0:
        raise AzError(list(args), proc.stderr)
    return json.loads(proc.stdout) if proc.stdout.strip() else None


def az_rest(method: str, url: str, body: dict[str, Any] | None = None, resource: str = "") -> Any:
    args = ["rest", "--method", method, "--url", url]
    if body is not None:
        args += ["--body", json.dumps(body), "--headers", "Content-Type=application/json"]
    if resource:
        args += ["--resource", resource]
    return az(*args)


def effective_permissions(scope: str) -> list[dict[str, Any]]:
    """What the signed-in identity may do at a scope, including group and inherited roles.

    Works for a resource group that does not exist yet (it returns what is inherited).
    """
    url = f"{ARM}{scope}/providers/Microsoft.Authorization/permissions?api-version=2022-04-01"
    entries: list[dict[str, Any]] = []
    while url:
        page = az_rest("get", url) or {}
        entries += page.get("value") or []
        url = page.get("nextLink") or ""
    return entries


def find_projects() -> list[dict[str, str]]:
    """Foundry projects the signed-in identity can read, in all subscriptions of its tenant."""
    projects: list[dict[str, str]] = []
    options: dict[str, Any] = {"$top": 1000}
    while True:
        page = az_rest("post", f"{ARM}/providers/Microsoft.ResourceGraph/resources?api-version=2021-03-01",
                       {"query": PROJECTS_QUERY, "options": options}) or {}
        projects += [project_from_row(row) for row in page.get("data") or []]
        if not page.get("$skipToken"):
            return projects
        options = {"$top": 1000, "$skipToken": page["$skipToken"]}
