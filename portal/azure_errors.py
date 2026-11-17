# Copyright (c) Microsoft. All rights reserved.
"""Turn Azure CLI and Foundry error text into a plain explanation: what failed, why, what to do.

Most setup failures are missing permissions, and the raw messages ("AuthorizationFailed ...
over scope ...") rarely say which role is missing or who can grant it. Standard library only.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

try:
    from .foundry_env import FOUNDRY_USER, ROLE_ADMINS
except ImportError:
    from foundry_env import FOUNDRY_USER, ROLE_ADMINS

PIM_TIP = ("If your organization uses Privileged Identity Management (PIM), activate your eligible "
           "role first: Azure portal > Privileged Identity Management > My roles.")
REFRESH_TIP = ("A role granted in the last few minutes may not apply yet: wait 5-10 minutes, then "
               "restart Cloud Shell (or run 'az login' again on your computer) and rerun.")


@dataclass
class Hint:
    problem: str
    reason: str
    fix: list[str] = field(default_factory=list)


def short_scope(scope: str) -> str:
    """'/subscriptions/x/resourceGroups/rg/providers/A/b/name' -> "b 'name' (resource group 'rg')"."""
    parts = scope.strip().strip("'").strip("/").split("/")
    lower = [part.lower() for part in parts]
    if "providers" in lower and len(parts) >= lower.index("providers") + 4:
        kind, name = parts[-2], parts[-1]
        group = parts[lower.index("resourcegroups") + 1] if "resourcegroups" in lower else ""
        return f"{kind} '{name}'" + (f" (resource group '{group}')" if group else "")
    if "resourcegroups" in lower and len(parts) > lower.index("resourcegroups") + 1:
        return f"resource group '{parts[lower.index('resourcegroups') + 1]}'"
    if lower[:1] == ["subscriptions"] and len(parts) > 1:
        return f"subscription {parts[1]}"
    return scope


def role_for(action: str) -> str:
    action = action.lower()
    if action.startswith("microsoft.authorization/roleassignments/"):
        return f"{ROLE_ADMINS} (Contributor is not enough to grant access)"
    if action.startswith("microsoft.cognitiveservices/") and "/aiservices/" in action:
        return f"{FOUNDRY_USER.name} on the Foundry project"
    if action == "microsoft.resources/subscriptions/resourcegroups/write":
        return "Contributor on the subscription (or an existing resource group where you are Contributor)"
    if action.endswith("/register/action"):
        return "Contributor on the subscription, or an admin who registers the resource provider once"
    return "Contributor"


def _authorization(text: str) -> Hint | None:
    match = re.search(r"does not have (?:authorization|permission) to perform action(?:\(s\))? "
                      r"'([^']+)'(?: on the linked scope\(s\)| over scope) '([^']+)'", text)
    if not match:
        return None
    action, scope = match.group(1).split(",")[0].strip(), match.group(2).split(",")[0].strip()
    where = short_scope(scope)
    return Hint(
        f"Your account is not allowed to do '{action}' on {where}.",
        f"This step needs {role_for(action)} there.",
        [f"Ask an Owner of {where} to give you that role, or to run this step for you.",
         PIM_TIP, REFRESH_TIP],
    )


def _data_plane(text: str) -> Hint | None:
    match = re.search(r"lacks the required data action\s*[`']?([\w./*-]+)", text)
    if not match and "PermissionDenied" not in text:
        return None
    action = match.group(1) if match else "Voice Agent operations"
    return Hint(
        f"The Foundry project refused '{action}' for this identity.",
        f"Creating, reading and running Voice Agents needs the '{FOUNDRY_USER.name}' role on the project; "
        "Owner or Contributor of the resource alone does not include it.",
        [f"Ask an Owner of the Foundry resource to grant '{FOUNDRY_USER.name}' on the project: "
         f"az role assignment create --assignee <your sign-in or the portal identity> "
         f"--role {FOUNDRY_USER.id} --scope <project resource ID>",
         PIM_TIP, REFRESH_TIP],
    )


def _network(text: str) -> Hint | None:
    if not re.search(r"[Pp]ublic (?:network )?access is disabled|not from an approved private endpoint|"
                     r"Virtual Network/Firewall rules", text):
        return None
    return Hint(
        "The Foundry resource does not accept connections from here.",
        "Its networking allows only private endpoints or selected networks, so Cloud Shell and Azure "
        "Container Apps cannot reach it.",
        ["Run the portal locally on a computer that can reach the private endpoint "
         "(skills/portal-local), or ask the resource's admin to allow your network."],
    )


def _policy(text: str) -> Hint | None:
    if "RequestDisallowedByPolicy" not in text and "disallowed by policy" not in text:
        return None
    names = re.findall(r'"policy(?:Definition|Assignment)DisplayName"\s*:\s*"([^"]+)"', text)
    names += re.findall(r'"policyAssignment"\s*:\s*\{\s*"name"\s*:\s*"([^"]+)"', text)
    named = ", ".join(dict.fromkeys(names)) or "see the message above"
    reason = re.search(r"Reasons?: '([^']+)'", text)
    return Hint(
        "An Azure Policy of your organization blocked this resource.",
        f"Policy: {named}." + (f" Its reason: {reason.group(1)}" if reason else "")
        + " Policies are set by your Azure administrators, not by these scripts.",
        ["Required tags: in the Azure portal, create the portal's resource group (voice-agent-portal by default) "
         "with those tags, then rerun this step.",
         "Allowed regions only: in the Azure portal, create that resource group in an allowed region, "
         "then rerun prepare.sh.",
         "Container Apps must use your own virtual network, or public endpoints are denied: this setup "
         "is not supported there; run the portal locally (skills/portal-local).",
         "Otherwise send the policy name above to your Azure administrator."],
    )


def _provider(text: str) -> Hint | None:
    match = re.search(r"not registered to use namespace '([^']+)'|MissingSubscriptionRegistration|"
                      r"NoRegisteredProviderFound", text)
    if not match:
        return None
    namespace = match.group(1) or "<the namespace named in the message>"
    return Hint(
        f"The subscription is not set up for {namespace} yet.",
        "Each Azure service is registered once per subscription; that needs Contributor on the subscription.",
        [f"Ask an admin to run once: az provider register --namespace {namespace} --subscription <subscription id>",
         "Then rerun this command."],
    )


SIMPLE_RULES: tuple[tuple[str, Hint], ...] = (
    (r"TasksOperationsNotAllowed|ACR Tasks requests .* not permitted|Tasks? (?:are|is) not supported",
     Hint("This subscription cannot build images in Azure Container Registry (ACR Tasks).",
          "Some subscription types (for example free trials) and some organizations turn ACR Tasks off.",
          ["Use another subscription (rerun the setup and pick it), or ask your admin to allow ACR Tasks."])),
    (r"QuotaExceeded|MaxNumberOfRegionalEnvironmentsInSubAndRegionExceeded|EnvironmentCountQuota",
     Hint("A subscription limit was reached.",
          "Each subscription can have only a few Container Apps environments per region.",
          ["Request more quota in the Azure portal (Quotas), or delete Container Apps environments you "
           "no longer use in this region; then rerun this step."])),
    (r"SubscriptionNotFound|InvalidAuthenticationTokenTenant|subscription '[^']+' could not be found",
     Hint("That subscription is not in the directory you are signed in to.",
          "Azure accounts can belong to several directories (tenants); each Cloud Shell session uses one.",
          ["Azure portal: top-right account menu > Switch directory, then reopen Cloud Shell. "
           "On a computer: az login --tenant <tenant id>."])),
    (r"AADSTS(?:53003|530084|53000|53001)",
     Hint("Your organization's sign-in rules (Conditional Access) blocked this request from here.",
          "Some tenants allow Azure management only from managed devices or from Azure Cloud Shell.",
          ["Run the setup in Azure Cloud Shell (shell.azure.com), or from a device your organization manages."])),
    (r"AADSTS(?!53003|530084|53000|53001)\d+|Please run 'az login'|refresh token has expired",
     Hint("Your Azure sign-in is missing or expired.",
          "The Azure CLI needs a fresh sign-in for this tenant.",
          ["Cloud Shell: restart it (the power icon). On a computer: az login (add --tenant <tenant id> "
           "if you belong to several directories)."])),
    (r"Authorization_RequestDenied|Insufficient privileges to complete the operation",
     Hint("You cannot create or change app registrations in Microsoft Entra ID.",
          "Your tenant lets only some roles register applications.",
          ["Use office/VPN access instead (no app registration needed): rerun skills/portal-remote/scripts/prepare.sh, "
           "answer n at 'Is this right?' and choose it. Or ask an Application Administrator to add sign-in as described in "
           "skills/portal-remote/README.md."])),
    (r"ScopeLocked",
     Hint("A resource lock blocks this change.",
          "A read-only or delete lock is set on the resource, its group or the subscription.",
          ["Ask an Owner to remove or adjust the lock (resource > Settings > Locks), then rerun."])),
    (r"PrincipalNotFound",
     Hint("The new managed identity is not visible to role assignment yet.",
          "New identities take a minute to replicate.",
          ["Wait a minute and rerun the same command."])),
    (r"LocationNotAvailableForResourceType|is not available in (?:the )?(?:location|region)",
     Hint("This Azure service is not offered in the chosen region.",
          "Not every region offers Azure Container Apps or Container Registry.",
          ["In the Azure portal, create the portal's resource group (voice-agent-portal by default) in "
           "another region, for example eastus2 or swedencentral, then rerun prepare.sh."])),
)


def explain(text: str) -> list[Hint]:
    hints = [hint for rule in (_authorization, _data_plane, _network, _policy, _provider)
             if (hint := rule(text))]
    hints += [hint for pattern, hint in SIMPLE_RULES if re.search(pattern, text)]
    return hints[:2]


def render(hints: list[Hint]) -> str:
    if not hints:
        return ""
    bar = "-" * 72
    lines = [bar]
    for hint in hints:
        lines += [f"What happened : {hint.problem}", f"Why           : {hint.reason}"]
        lines += [("What to do    : " if i == 0 else "                ") + f"- {step}"
                  for i, step in enumerate(hint.fix)]
        lines.append(bar)
    return "\n".join(lines)
