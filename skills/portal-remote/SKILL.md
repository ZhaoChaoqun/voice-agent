---
name: portal-remote
description: >-
  Deploy the Voice Agent portal to an Azure Container App in the user's own
  subscription, behind an IP allowlist or Microsoft Entra sign-in, connected to
  their Foundry project. Use when asked to share the portal with a team, host it
  on Azure, give it a URL, change who can open it, upgrade or remove it, or when
  a deployment fails on permissions, Azure Policy, or networking.
---

# Voice Agent portal on Azure Container Apps

The human guide is [README.md](README.md); follow its order. Three commands, run from the repository root with the subscription already chosen (`az account set --subscription <name or id>`):

1. `skills/portal-remote/scripts/prepare.sh` finds the Foundry projects, asks the user to choose, saves the choices to `portal/.env`, then checks permissions, resource providers and network access before anything is created. It exits 1 on any FAIL.
2. `skills/portal-remote/scripts/build.sh` builds the image in the user's own Azure Container Registry. No parameters.
3. `skills/portal-remote/scripts/deploy.sh` creates the Container Apps environment (with its own virtual network when a policy requires one), the managed identity, its roles, and the app. No parameters.

## Running it for the user

- When the user asks whether the portal works, what is missing, or after any of the three steps, run `skills/portal-remote/scripts/status.sh`. It needs no options and changes nothing. It checks each resource, the identity's roles, the access protection, and whether the app answers. It exits 0 when the portal is running, and otherwise ends with `Next:`, the command to run.
- Never guess values. Without a terminal `prepare.sh` cannot ask, so pass every choice: `--project <endpoint or name> --resource-group <rg> --auth ip --allowed-ip <CIDR,...>` (or `--auth entra`), optionally `--location` and `--name`. List the projects first with `python3 portal/setup_azure.py projects` and let the user choose; ask the user for their office/VPN ranges. Never use the Cloud Shell or agent machine's own IP as the allowlist.
- Read FAIL and WARN lines to the user as they are: they already say what is missing, where to click, and who can grant it.
- Granting roles (`deploy.sh` without `--skip-roles`) needs Owner, User Access Administrator or Role Based Access Control Administrator. If the user does not have it, or your environment does not allow you to grant roles, run `deploy.sh --skip-roles`: it stops after creating the identity and writes `~/voice-agent-portal-admin-steps.txt`. Give that to the user for their admin, then run `deploy.sh` again after they confirm.
- When an Azure command fails, the scripts print What happened / Why / What to do. `python3 portal/setup_azure.py explain <file>` explains any other saved Azure CLI error.
- In Cloud Shell, "HTTP 403" at the end is the expected result with an IP allowlist.

## Shared settings

`portal/.env` is shared with running the portal locally: `AZURE_VOICE_AGENTS_ENDPOINT`, `AZURE_SUBSCRIPTION_ID` and `AZURE_RESOURCE_GROUP` describe the Foundry project; the `PORTAL_ACA_*` keys describe the deployment. Read one with `python3 portal/setup_azure.py get <KEY>`.
