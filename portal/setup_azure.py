#!/usr/bin/env python3
# Copyright (c) Microsoft. All rights reserved.
"""Choose and check the Azure settings of the Voice Agent portal, so nobody has to type resource IDs.

  setup_azure.py pick  --mode local|remote   choose your Foundry project from a list (remote: also where the
                                             portal runs and who may open it); saves them in portal/.env
  setup_azure.py check --mode local|remote   check your permissions before anything is created
  setup_azure.py projects [--json]           list the Foundry projects you can see
  setup_azure.py explain FILE                plain-language reason for an Azure CLI error saved in FILE
  setup_azure.py get KEY                     print one saved setting (used by the scripts)
  setup_azure.py locate --resource-group RG  subscription where build.sh made the portal's registry
  setup_azure.py set KEY=VALUE ...           save settings (used by the scripts)
  setup_azure.py roles ...                   roles the portal's managed identity needs (used by the scripts)

Standard library and the Azure CLI only: runs in Azure Cloud Shell as is.
"""

from __future__ import annotations

import argparse
import hashlib
import ipaddress
import json
import os
import sys
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from azure_errors import explain, render, short_scope
from foundry_env import (
    ACA_ALLOWED_IPS, ACA_AUTH, ACA_DEFAULT_NAME, ACA_DEFAULT_RESOURCE_GROUP, ACA_LOCATION, ACA_NAME,
    ACA_RESOURCE_GROUP, ACA_SUBSCRIPTION, ENDPOINT, ENV_FILE, FOUNDRY_DATA_RESOURCE, FOUNDRY_RESOURCE_GROUP,
    FOUNDRY_SUBSCRIPTION, FOUNDRY_USER, PORTAL_IDENTITY_ROLES, PUBLISH_DATA_ACTION, ROLE_ADMINS, AzError,
    allowed, az, az_rest, effective_permissions, find_projects, project_endpoint, read_env, update_env,
)

IN_CLOUD_SHELL = os.getenv("AZUREPS_HOST_ENVIRONMENT", "").startswith("cloud-shell") or bool(os.getenv("ACC_CLOUD"))
MENU_LIMIT = 20


def say(message: str = "") -> None:
    print(message, file=sys.stderr)


def fail(message: str, error: AzError | None = None) -> SystemExit:
    if error is not None:
        say(error.stderr.strip())
        say(render(explain(error.stderr)))
    return SystemExit(f"ERROR: {message}")


def interactive() -> bool:
    return sys.stdin.isatty()


def choose(question: str, options: list[str], default: int = 0, flag: str = "") -> int:
    """Numbered menu; Enter takes the default. Without a terminal the default is used."""
    if len(options) == 1 or not interactive():
        if len(options) > 1 and flag:
            say(f"{question} Using '{options[default]}' (pass {flag} to choose).")
        return default
    say(question)
    for number, option in enumerate(options, 1):
        say(f"  {number}) {option}{'   [default]' if number - 1 == default else ''}")
    while True:
        answer = input(f"Choose 1-{len(options)} [{default + 1}]: ").strip()
        if not answer:
            return default
        if answer.isdigit() and 1 <= int(answer) <= len(options):
            return int(answer) - 1
        say(f"Type a number from 1 to {len(options)}.")


def signed_in() -> dict[str, Any]:
    try:
        account = az("account", "show")
    except AzError as error:
        raise fail("You are not signed in to Azure. Cloud Shell: restart it. Computer: run 'az login'.", error)
    say(f"Signed in as {account['user']['name']} (directory {account['tenantId']}).")
    return account


def subscription_names() -> dict[str, str]:
    try:
        return {item["id"]: item["name"] for item in az("account", "list", "--query", "[].{id:id,name:name}") or []}
    except AzError:
        return {}


def visible_projects() -> list[dict[str, str]]:
    try:
        projects = find_projects()
    except AzError as error:
        raise fail("Could not list your Foundry projects.", error)
    if not projects:
        raise SystemExit(
            "ERROR: No Foundry project is visible to your sign-in in this directory. Usually one of:\n"
            "  - The project is in another directory: Azure portal > account menu (top right) > Switch\n"
            "    directory, then reopen Cloud Shell (on a computer: az login --tenant <tenant id>).\n"
            "  - You have no role on it yet: ask its owner for 'Foundry User' on the project.\n"
            "  - There is no project yet: create one at https://ai.azure.com, then rerun."
        )
    return projects


def describe(project: dict[str, str], names: dict[str, str]) -> str:
    subscription = names.get(project["subscription_id"], project["subscription_id"])
    return f"{project['name']}  (resource {project['account']}, {project['region']}, subscription {subscription})"


def choose_project(projects: list[dict[str, str]], wanted: str, saved: str, current_sub: str) -> dict[str, str]:
    by_endpoint = {project["endpoint"].lower(): project for project in projects}
    for value, source in ((wanted, "--project"), (saved, "saved setting")):
        if not value:
            continue
        match = by_endpoint.get(value.lower().rstrip("/")) or next(
            (p for p in projects if value.lower() in (p["name"].lower(), p["id"].lower())), None)
        if match:
            return match
        if source == "--project":
            raise SystemExit(f"ERROR: No visible Foundry project matches --project {value}. List them: setup_azure.py projects")
        say(f"The saved project {value} is not visible to this sign-in any more; choose again.")
    names = subscription_names()
    pool = sorted(projects, key=lambda p: (p["subscription_id"] != current_sub, p["name"].lower(), p["account"].lower()))
    if len(pool) > 1 and not interactive():
        raise SystemExit("ERROR: Several Foundry projects are visible; pass --project <endpoint or name>. "
                         "List them: setup_azure.py projects")
    while len(pool) > MENU_LIMIT:
        text = input(f"{len(pool)} Foundry projects are visible. Type part of the project or resource name: ").strip().lower()
        matches = [p for p in pool if text and (text in p["name"].lower() or text in p["account"].lower())]
        if matches:
            pool = matches
        else:
            say("No project matches that; try another part of the name.")
    return pool[choose("Which Foundry project should the portal use?", [describe(p, names) for p in pool])]


# ---------- IP allowlist ----------
def public_ip() -> str:
    try:
        with urllib.request.urlopen("https://api.ipify.org", timeout=5) as response:  # noqa: S310 (fixed https URL)
            return response.read().decode().strip()
    except Exception:  # noqa: BLE001 - only a hint; never required
        return ""


def normalize_ips(text: str, cloud_shell_ip: str = "") -> list[str]:
    """'203.0.113.7, 198.51.100.0/24' -> ['203.0.113.7/32', '198.51.100.0/24']; explains bad values."""
    ranges: list[str] = []
    for item in text.replace(",", " ").split():
        if "<" in item or ">" in item:
            raise ValueError(f"'{item}' is a placeholder: use your real office or VPN address.")
        try:
            network = ipaddress.IPv4Network(item if "/" in item else f"{item}/32", strict=False)
        except ValueError:
            raise ValueError(f"'{item}' is not an IPv4 address or range (examples: 203.0.113.7 or 203.0.113.0/24).") from None
        if network.prefixlen == 0:
            raise ValueError(f"{network} would let everyone in. List your office or VPN ranges instead.")
        if network.is_private or network.is_loopback or network.is_link_local:
            raise ValueError(f"{network} is an address inside your own network (what 'ipconfig' shows). The portal "
                             "sees your public address: open https://api.ipify.org in a browser on that network.")
        if cloud_shell_ip and ipaddress.IPv4Address(cloud_shell_ip) in network:
            raise ValueError(f"{network} contains {cloud_shell_ip}, the address of Azure Cloud Shell, not yours. "
                             "Look it up in a browser on your office or VPN network instead.")
        ranges.append(str(network))
    if not ranges:
        raise ValueError("Enter at least one address or range.")
    return list(dict.fromkeys(ranges))


def ask_ips() -> str:
    shell_ip = public_ip() if IN_CLOUD_SHELL else ""
    say("\nThe portal will only open for people whose internet traffic comes from the addresses you list.\n"
        "On a computer in your office (or connected to your VPN), open https://api.ipify.org in a browser:\n"
        "it shows that network's public address. Your network team can give you the full ranges."
        + ("\nDo not use the address of this Cloud Shell: it is an Azure address, not yours." if IN_CLOUD_SHELL else ""))
    while True:
        try:
            return ",".join(normalize_ips(input("Allowed addresses (comma-separated): "), shell_ip))
        except ValueError as error:
            say(str(error))


# ---------- regions ----------
def container_apps_regions() -> dict[str, str]:
    """Short name -> display name of the regions that offer Azure Container Apps environments."""
    display = az("provider", "show", "-n", "Microsoft.App", "--query",
                 "resourceTypes[?resourceType=='managedEnvironments'].locations[] | []") or []
    offered = {name.lower() for name in display}
    names = az("account", "list-locations", "--query", "[].{name:name,displayName:displayName}") or []
    return {item["name"]: item["displayName"] for item in names if item["displayName"].lower() in offered}


# ---------- pick ----------
def summary(updates: dict[str, str], project: dict[str, str], account: dict[str, Any]) -> list[str]:
    lines = [f"Foundry project      : {project['name']} (resource {project['account']}, {project['region']})",
             f"Project endpoint     : {project['endpoint']}"]
    if ACA_RESOURCE_GROUP in updates:
        names = subscription_names()
        auth = ("office/VPN addresses " + updates[ACA_ALLOWED_IPS] if updates[ACA_AUTH] == "ip"
                else "Microsoft Entra sign-in (people in your organization)")
        lines += [f"Portal subscription  : {names.get(updates[ACA_SUBSCRIPTION], updates[ACA_SUBSCRIPTION])}",
                  f"Portal resource group: {updates[ACA_RESOURCE_GROUP]} ({updates[ACA_LOCATION]})",
                  f"Portal app name      : {updates[ACA_NAME]}",
                  f"Who can open it      : {auth}"]
    return lines


def pick(args: argparse.Namespace) -> int:
    env_file = Path(args.env_file)
    saved = {} if args.reconfigure else read_env(env_file)
    account = signed_in()
    while True:
        project = choose_project(visible_projects(), args.project, project_endpoint(saved), account["id"])
        updates = {ENDPOINT: project["endpoint"], FOUNDRY_SUBSCRIPTION: project["subscription_id"],
                   FOUNDRY_RESOURCE_GROUP: project["resource_group"]}
        if args.mode == "remote":
            updates.update(pick_remote(args, saved, project, account))
        say("\n" + "\n".join(summary(updates, project, account)))
        if not interactive() or input("\nIs this right? [Y/n]: ").strip().lower() in ("", "y", "yes"):
            break
        saved, args.project, args.allowed_ip, args.auth = {}, "", "", ""
        say("OK, let's choose again.\n")
    update_env(updates, env_file)
    say(f"Saved to {env_file}. The next scripts read these values; you do not need to type them again.")
    return 0


def pick_remote(args: argparse.Namespace, saved: dict[str, str], project: dict[str, str],
                account: dict[str, Any]) -> dict[str, str]:
    # The portal goes into the subscription selected with 'az account set' (the guide's step 2). If an
    # earlier run chose another one (Cloud Shell can come back on its default subscription), ask.
    subscription = args.subscription or account["id"]
    previous = saved.get(ACA_SUBSCRIPTION, "")
    if not args.subscription and previous and previous.lower() != account["id"].lower():
        names = subscription_names()
        now, before = names.get(account["id"], account["id"]), names.get(previous, previous)
        if choose(f"The portal was set up in subscription '{before}', but you are now using '{now}'. "
                  "Which subscription should the portal use?",
                  [f"{now} (the one you are using now)",
                   f"{before} (where it was set up before)"], flag="--subscription") == 1:
            subscription = previous
    group = args.resource_group or saved.get(ACA_RESOURCE_GROUP) or ACA_DEFAULT_RESOURCE_GROUP
    location = args.location or saved.get(ACA_LOCATION) or ""
    if not location:
        regions = container_apps_regions()
        if project["region"] in regions:
            location = project["region"]
        else:
            preferred = [r for r in ("eastus2", "westus2", "swedencentral", "westeurope", "australiaeast") if r in regions]
            location = preferred[choose(f"Azure Container Apps is not offered in {project['region']}. Where should the portal run?",
                                        [f"{r} ({regions[r]})" for r in preferred], flag="--location")]
    auth = args.auth or saved.get(ACA_AUTH) or ("ip", "entra")[choose(
        "\nWho may open the portal?",
        ["People on my office network or VPN (IP allowlist; recommended, no extra permissions)",
         "People in my organization who sign in with Microsoft Entra (also works off-network; needs "
         "permission to create an app registration)"], flag="--auth")]
    ips = args.allowed_ip or (saved.get(ACA_ALLOWED_IPS) if auth == "ip" else "") or ""
    if ips:
        try:
            ips = ",".join(normalize_ips(ips))
        except ValueError as error:
            raise SystemExit(f"ERROR: {error}") from None
    elif auth == "ip":
        if not interactive():
            raise SystemExit("ERROR: Pass --allowed-ip with your office or VPN public ranges, or --auth entra.")
        ips = ask_ips()
    return {ACA_SUBSCRIPTION: subscription, ACA_RESOURCE_GROUP: group, ACA_LOCATION: location,
            ACA_NAME: args.name or saved.get(ACA_NAME) or ACA_DEFAULT_NAME, ACA_AUTH: auth, ACA_ALLOWED_IPS: ips}


# ---------- check ----------
PIM_AND_DELAY = ("If you use Privileged Identity Management (PIM), activate the role first. New roles can take "
                 "5-10 minutes to apply: then restart Cloud Shell (or 'az login' again) and rerun.")
PROVIDERS = ("Microsoft.App", "Microsoft.ContainerRegistry", "Microsoft.OperationalInsights", "Microsoft.ManagedIdentity")
# What step 1 and step 2 do inside the portal's resource group (all part of Contributor).
GROUP_ACTIONS = (
    "Microsoft.ContainerRegistry/registries/write",
    "Microsoft.ContainerRegistry/registries/scheduleRun/action",
    "Microsoft.ContainerRegistry/registries/listBuildSourceUploadUrl/action",
    "Microsoft.OperationalInsights/workspaces/write",
    "Microsoft.OperationalInsights/workspaces/sharedKeys/action",
    "Microsoft.App/managedEnvironments/write",
    "Microsoft.App/containerApps/write",
    "Microsoft.ManagedIdentity/userAssignedIdentities/write",
    "Microsoft.ManagedIdentity/userAssignedIdentities/assign/action",
)
GRANT = "Microsoft.Authorization/roleAssignments/write"


@dataclass
class Check:
    status: str  # PASS, FAIL (stops before anything is created), WARN (an admin step later), INFO
    title: str
    why: str = ""
    fix: list[str] = field(default_factory=list)


def permissions(scope: str) -> list[dict[str, Any]] | None:
    try:
        return effective_permissions(scope)
    except AzError:
        return None


def writable_groups(subscription: str, limit: int = 25) -> list[str]:
    """Existing resource groups where the signed-in identity can create the portal's resources."""
    try:
        groups = az("group", "list", "--subscription", subscription, "--query", "[].name") or []
    except AzError:
        return []
    found = []
    for group in sorted(groups)[:limit]:
        perms = permissions(f"/subscriptions/{subscription}/resourceGroups/{group}") or []
        if all(allowed(perms, action) for action in GROUP_ACTIONS):
            found.append(group)
    return found


def who_can_grant(scope: str) -> str:
    """' People who can grant this: a@x, b@x.' for up to 5 users who may assign roles at a scope."""
    try:
        rows = az("role", "assignment", "list", "--scope", scope, "--include-inherited", "--query",
                  "[?roleDefinitionName=='Owner' || roleDefinitionName=='User Access Administrator' || "
                  "roleDefinitionName=='Role Based Access Control Administrator'].{n:principalName,t:principalType}") or []
    except AzError:
        return ""
    names = list(dict.fromkeys(row["n"] for row in rows if row.get("t") == "User" and row.get("n")))
    if not names:
        return ""
    return f" People who can grant this: {', '.join(names[:5])}{' and others' if len(names) > 5 else ''}."


def add_role_steps(where: str, role: str, user: str) -> str:
    return (f"In the Azure portal: open {where} > Access control (IAM) > Add > Add role assignment > "
            f"'{role}' > Next > Select members: {user} > Review + assign.")


def check_local(project: dict[str, str], user: str) -> list[Check]:
    checks: list[Check] = []
    if project["public_network_access"].lower() == "disabled":
        checks.append(Check("WARN", "The Foundry resource accepts only private network traffic",
                            "The portal works only on a computer that can reach its private endpoint."))
    perms = permissions(project["id"])
    if perms is not None and not allowed(perms, PUBLISH_DATA_ACTION, data=True):
        checks.append(Check(
            "FAIL", "Create and run Voice Agents in this project",
            f"Your sign-in has no '{FOUNDRY_USER.name}' role on the project; Owner or Contributor of the "
            "resource alone does not include it.",
            ["Ask an Owner of the Foundry resource." + who_can_grant(project["account_id"]),
             add_role_steps(f"the Foundry resource '{project['account']}' (search its name at the top)",
                            FOUNDRY_USER.name, user),
             f"Or the Owner runs: az role assignment create --assignee {user} --role {FOUNDRY_USER.id} "
             f"--scope {project['id']}",
             PIM_AND_DELAY]))
        return checks
    try:
        az_rest("get", f"{project['endpoint']}/agents?api-version=v1&limit=1", resource=FOUNDRY_DATA_RESOURCE)
        checks.append(Check("PASS", "Create and run Voice Agents in this project (the project answered)"))
    except AzError as error:
        hints = explain(error.stderr)
        checks.append(Check("FAIL", "Connect to the Foundry project",
                            hints[0].problem + " " + hints[0].reason if hints else error.stderr.strip()[:400],
                            hints[0].fix if hints else []))
    return checks


def choose_again(mode: str) -> str:
    if mode == "remote":
        return "Rerun skills/portal-remote/scripts/prepare.sh and answer n at 'Is this right?' to choose again."
    return f"Choose again: setup_azure.py pick --mode {mode} --reconfigure"


def check_remote(values: dict[str, str], project: dict[str, str], user: str) -> list[Check]:
    checks: list[Check] = []
    if project["public_network_access"].lower() == "disabled":
        checks.append(Check("FAIL", "Reach the Foundry project from Azure Container Apps",
                            "The Foundry resource accepts only private network traffic, which a Container App "
                            "in this setup cannot use.",
                            ["Run the portal locally on a computer inside that network: skills/portal-local."]))
    subscription = values.get(ACA_SUBSCRIPTION) or project["subscription_id"]
    group = values.get(ACA_RESOURCE_GROUP) or ACA_DEFAULT_RESOURCE_GROUP
    location = values.get(ACA_LOCATION) or project["region"]
    try:
        sub_name = az("account", "show", "--subscription", subscription, "--query", "name")
    except AzError:
        checks.append(Check("FAIL", f"Use subscription {subscription}",
                            "It is not visible to your sign-in in this directory.",
                            [choose_again("remote")]))
        return checks
    sub_scope = f"/subscriptions/{subscription}"
    group_scope = f"{sub_scope}/resourceGroups/{group}"
    sub_perms, group_perms = permissions(sub_scope), permissions(group_scope)
    if sub_perms is None or group_perms is None:
        checks.append(Check("WARN", f"Could not read your permissions in subscription '{sub_name}'",
                            "The scripts will try anyway and explain any refusal."))
        return checks

    states = {item["n"]: item["s"] for item in az("provider", "list", "--subscription", subscription, "--query",
                                                  "[].{n:namespace,s:registrationState}") or []}
    missing = [ns for ns in PROVIDERS if states.get(ns) != "Registered"]
    blocked = [ns for ns in missing if not allowed(sub_perms, f"{ns}/register/action")]
    if blocked:
        checks.append(Check(
            "FAIL", f"Turn on {', '.join(blocked)} in subscription '{sub_name}'",
            "Each Azure service is turned on (registered) once per subscription, which needs Contributor on "
            "the subscription.",
            ["Ask an Owner or Contributor of the subscription." + who_can_grant(sub_scope),
             f"In the Azure portal: Subscriptions > {sub_name} > Settings > Resource providers > select "
             f"{' and '.join(blocked)} > Register.",
             "Or they run: " + " && ".join(f"az provider register --namespace {ns} --subscription {subscription}"
                                           for ns in blocked)]))

    exists = bool(az("group", "exists", "-n", group, "--subscription", subscription))
    can_create_group = exists or allowed(sub_perms, "Microsoft.Resources/subscriptions/resourceGroups/write")
    lacking = [action for action in GROUP_ACTIONS if not allowed(group_perms, action)]
    if can_create_group and not lacking:
        checks.append(Check("PASS", f"Create the portal's resources in resource group '{group}' "
                                    f"({'existing' if exists else 'new'}, subscription '{sub_name}', {location})"))
    else:
        others = [g for g in writable_groups(subscription) if g != group]
        fix = [f"Ask an Owner of subscription '{sub_name}' to make you Contributor on resource group '{group}'."
               + who_can_grant(group_scope if exists else sub_scope)]
        contributor = "Contributor (tab: Privileged administrator roles)"
        if exists:
            fix.append(add_role_steps(f"Resource groups > {group}", contributor, user))
        else:
            fix.append(f"In the Azure portal they first create it: Resource groups > Create > subscription "
                       f"'{sub_name}', name {group}, region {location}; then "
                       + add_role_steps(f"Resource groups > {group}", contributor, user))
        fix.append("Or they run: " + ("" if exists else f"az group create -n {group} -l {location} --subscription "
                                     f"{subscription} && ") + f"az role assignment create --assignee {user} "
                   f"--role Contributor --scope {group_scope}")
        if others:
            fix.append(f"Or use a group where you can already create resources ({', '.join(others)}): "
                       "rerun prepare.sh with --resource-group <that group>.")
        fix.append(PIM_AND_DELAY)
        checks.append(Check("FAIL", f"Create the portal's resources in resource group '{group}'",
                            "This needs Contributor on the resource group" + ("" if exists else " (or on the subscription, to create it)")
                            + (f"; missing for example '{lacking[0]}'." if lacking else "."), fix))

    account_perms = permissions(project["account_id"]) or []
    need_admin = [(where, scope) for where, scope, perms in (
        (f"Resource groups > {group}", group_scope, group_perms),
        (f"the Foundry resource '{project['account']}' (search its name at the top)", project["account_id"], account_perms),
    ) if not allowed(perms, GRANT)]
    roles = ", ".join(role.name for role in PORTAL_IDENTITY_ROLES)
    if need_admin:
        fix = ["Option 1 (smoothest): get 'Role Based Access Control Administrator' there now, then rerun prepare.sh."]
        for where, scope in need_admin:
            fix.append(add_role_steps(where, "Role Based Access Control Administrator (tab: Privileged "
                                      "administrator roles)", user) + who_can_grant(scope))
        fix.append("Option 2: continue. deploy.sh creates the portal's identity, then stops and prints the exact "
                   "commands for an admin; after they ran them, run deploy.sh again.")
        checks.append(Check("WARN", f"Give the portal's own identity its roles ({roles})",
                            f"Granting access needs {ROLE_ADMINS}; Contributor is not enough.", fix))
    else:
        checks.append(Check("PASS", f"Give the portal's own identity its roles ({roles})"))

    auth, ips = values.get(ACA_AUTH) or "ip", values.get(ACA_ALLOWED_IPS) or ""
    if auth == "entra":
        checks.append(Check("INFO", "Microsoft Entra sign-in: creating its app registration needs permission in Entra ID",
                            "If your tenant refuses it, the deployment says so and what to ask for."))
    elif not ips:
        checks.append(Check("FAIL", "Limit access to your office or VPN addresses", "No addresses are saved yet.",
                            [choose_again("remote")]))
    else:
        checks.append(Check("PASS", f"Only these addresses can open the portal: {ips}"))
    return checks


def show(checks: list[Check]) -> None:
    say("\nWhat your Azure account can do (checked before anything is created):\n")
    for item in checks:
        say(f"  {item.status:<4}  {item.title}")
        if item.why:
            say(f"        Why: {item.why}")
        for index, step in enumerate(item.fix):
            say(("        Fix: " if index == 0 else "             ") + f"- {step}")


def check(args: argparse.Namespace) -> int:
    values = read_env(Path(args.env_file))
    endpoint = project_endpoint(values)
    if not endpoint:
        raise SystemExit(f"ERROR: No Foundry project chosen yet. Run: setup_azure.py pick --mode {args.mode}")
    account = signed_in()
    user = account["user"]["name"]
    checks = [Check("PASS", f"Signed in as {user}")]
    project = next((p for p in visible_projects() if p["endpoint"].lower() == endpoint.lower()), None)
    if project is None:
        checks.append(Check("FAIL", f"Find Foundry project {endpoint}",
                            "Your sign-in cannot see it: another directory, a typo, or no role on it.",
                            [choose_again(args.mode)]))
    else:
        checks.append(Check("PASS", f"Foundry project '{project['name']}' (resource {project['account']}, {project['region']})"))
        checks += check_local(project, user) if args.mode == "local" else check_remote(values, project, user)
    show(checks)
    if any(item.status == "FAIL" for item in checks):
        say("\nNothing has been created or changed. Fix the FAIL items above (you can send this whole output "
            "to your Azure administrator), then run the same command again.")
        return 1
    say("\nYou can continue; one step will need an admin (see WARN above)." if any(
        item.status == "WARN" for item in checks) else "\nAll checks passed.")
    return 0


# ---------- small commands for the scripts ----------
def projects_command(args: argparse.Namespace) -> int:
    projects = visible_projects()
    if args.endpoint:
        match = next((p for p in projects if p["endpoint"].lower() == args.endpoint.lower().rstrip("/")), None)
        if match is None:
            raise SystemExit(f"ERROR: No Foundry project with endpoint {args.endpoint} is visible to your sign-in. "
                             "Check the directory you signed in to and that you have at least Reader on it.")
        print(f"{match['endpoint']}\t{match['id']}\t{match['account_id']}")
    elif args.json:
        print(json.dumps(projects, indent=2))
    else:
        names = subscription_names()
        for project in projects:
            print(f"{project['endpoint']}\t{describe(project, names)}")
    return 0


def roles_command(args: argparse.Namespace) -> int:
    scopes = {"registry": args.registry_id, "project": args.project_id, "account": args.account_id}
    for role in PORTAL_IDENTITY_ROLES:
        print(f"{role.id}|{role.name}|{scopes[role.scope]}|{role.why}|{'required' if role.required else 'optional'}")
    return 0


def explain_command(args: argparse.Namespace) -> int:
    text = sys.stdin.read() if args.file == "-" else Path(args.file).read_text(encoding="utf-8", errors="replace")
    message = render(explain(text))
    if message:
        print(message)
    return 0


def get_command(args: argparse.Namespace) -> int:
    values = read_env(Path(args.env_file))
    print(project_endpoint(values) if args.key == "endpoint" else values.get(args.key, ""))
    return 0


def registry_name(subscription: str, group: str, name: str) -> str:
    """The registry name build.sh derives: vaportal + 8 hex characters of subscription/group/name."""
    return "vaportal" + hashlib.sha256(f"{subscription}/{group}/{name}".encode()).hexdigest()[:8]


def locate_command(args: argparse.Namespace) -> int:
    """Print the subscription(s) where build.sh made this portal's registry, one per line."""
    if "'" in args.resource_group:
        raise SystemExit("ERROR: Unexpected resource group name.")
    query = ("resources | where type =~ 'microsoft.containerregistry/registries' and name startswith 'vaportal'"
             f" and resourceGroup =~ '{args.resource_group}' | project name, subscriptionId")
    page = az_rest("post", "https://management.azure.com/providers/Microsoft.ResourceGraph/resources"
                   "?api-version=2021-03-01", {"query": query}) or {}
    for row in page.get("data") or []:
        subscription = str(row.get("subscriptionId") or "")
        if str(row.get("name") or "").lower() == registry_name(subscription, args.resource_group, args.name):
            print(subscription)
    return 0


def set_command(args: argparse.Namespace) -> int:
    update_env(dict(pair.split("=", 1) for pair in args.pairs if "=" in pair), Path(args.env_file))
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--env-file", default=str(ENV_FILE), help="Settings file (default: portal/.env)")
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("pick", help="choose the project (and, for remote, where and for whom)")
    p.add_argument("--mode", choices=("local", "remote"), required=True)
    p.add_argument("--project", default="", help="Endpoint, name or resource ID; skips the menu")
    p.add_argument("--subscription", default="", help="remote: subscription for the portal (default: the project's)")
    p.add_argument("--resource-group", default="", help=f"remote: group for the portal (default {ACA_DEFAULT_RESOURCE_GROUP})")
    p.add_argument("--location", default="", help="remote: region (default: the project's, if it offers Container Apps)")
    p.add_argument("--name", default="", help=f"remote: Container App name (default {ACA_DEFAULT_NAME})")
    p.add_argument("--auth", choices=("ip", "entra"), default="", help="remote: who may open the portal")
    p.add_argument("--allowed-ip", default="", help="remote: office/VPN public addresses or ranges, comma-separated")
    p.add_argument("--reconfigure", action="store_true", help="ask again instead of reusing saved values")
    p.set_defaults(handler=pick)
    c = sub.add_parser("check", help="check permissions before anything is created")
    c.add_argument("--mode", choices=("local", "remote"), required=True)
    c.set_defaults(handler=check)
    l = sub.add_parser("projects", help="list visible Foundry projects")
    l.add_argument("--json", action="store_true")
    l.add_argument("--endpoint", default="", help="print 'endpoint<TAB>project id<TAB>account id' of this project")
    l.set_defaults(handler=projects_command)
    r = sub.add_parser("roles", help="roles of the portal's managed identity, one per line")
    for name in ("--registry-id", "--project-id", "--account-id"):
        r.add_argument(name, required=True)
    r.set_defaults(handler=roles_command)
    e = sub.add_parser("explain", help="explain an Azure CLI error saved in a file ('-' = stdin)")
    e.add_argument("file")
    e.set_defaults(handler=explain_command)
    g = sub.add_parser("get", help="print one saved setting ('endpoint' = the project endpoint)")
    g.add_argument("key")
    g.set_defaults(handler=get_command)
    o = sub.add_parser("locate", help="subscription(s) where build.sh made this portal's registry")
    o.add_argument("--resource-group", required=True)
    o.add_argument("--name", default=ACA_DEFAULT_NAME)
    o.set_defaults(handler=locate_command)
    w = sub.add_parser("set", help="save settings: KEY=VALUE ...")
    w.add_argument("pairs", nargs="+")
    w.set_defaults(handler=set_command)
    args = parser.parse_args(argv)
    try:
        return args.handler(args)
    except KeyboardInterrupt:
        say("\nStopped. Nothing else was changed.")
        return 130


if __name__ == "__main__":
    sys.exit(main())
