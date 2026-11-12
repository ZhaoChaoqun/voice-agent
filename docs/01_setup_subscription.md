# 01 - Set up a Microsoft Foundry subscription

## Conclusion

This guide selects an existing Microsoft Foundry Project or creates one in an
empty Azure subscription. It is the shared source of truth for subscription,
Project endpoint, permissions, model mode, and region eligibility. Do not
continue to an example until those values are verified.

Access is the step most often left incomplete. Voice Agent work needs roles at
four separate scopes, and a role at one scope grants nothing at another: the
Foundry resource (build Agents, deploy models, change connections), the
subscription (quota), the Application Insights resource connected to the
Project (traces, monitoring, trace-based evaluation), and, for the Project
managed identity, both the Foundry resource and Application Insights. Use
[section 8](#8-assign-the-required-roles) when you create the Project and every
time you add a teammate to an existing one.

After completing the criteria below, choose the path you need:

- Default Portal and Templates: follow the [Portal guide](../portal/README.md).
  They use the public no-auth MCP and need no local MCP or Dev Tunnel setup.
- Optional customer-owned MCP for CLI samples or tool development: continue
  with [02: MCP settings, deployment, and development](./02_mcp_settings.md).
  Dev Tunnel is needed only for the documented locally hosted option, not an
  already deployed MCP.

## Completion criteria

- The selected Azure subscription is correct and enabled.
- The Voice Agent team has confirmed the subscription and region are eligible.
- `Microsoft.CognitiveServices` reports `Registered`.
- The resource group, AIServices account, and Project report `Succeeded`.
- Every person who uses the Project has the roles in
  [section 8](#8-assign-the-required-roles) for their work: Foundry User on the
  Foundry resource; Foundry Account Owner on the Foundry resource and
  Cognitive Services Usages Reader on the subscription to deploy models; and
  Owner or Log Analytics Reader on the connected Application Insights resource
  to see traces.
- The Project managed identity has Foundry User on the Foundry resource and
  Reader on the connected Application Insights resource.
- Section 9 reports no `MISSING` role.
- `PROJECT_ENDPOINT`, `PROJECT_ID`, `FOUNDRY_SCOPE`, and `APP_INSIGHTS_ID` are
  populated.
- The Finance definitions' `model_type` and exact `model` identifier match a
  mode available to the Project.

## 1. Confirm preview and region eligibility

Voice Agent availability is region- and subscription-gated. Ask the Voice Agent
service owner to confirm both before creating resources. Do not copy a region
from this repository: the current repository overview names `swedencentral`
and `francecentral`, but availability can change and customer subscriptions can
have different enablement.

Do not silently substitute a normal prompt Agent or change to self-deployed
mode when `kind: voice` or the requested managed realtime model is unavailable.

The two Finance definitions default to this versioned service-managed Voice
Agent model:

```json
"model_type": "managed",
"model": "gpt-realtime-2.1"
```

This does not reference a customer-created account deployment. Managed model
identifiers vary by Project. Start with `gpt-realtime-2.1`. If publication
reports it unsupported, explicitly set `VOICE_AGENT_MODEL=gpt-realtime-1.5`
and retry. If neither is enabled, use another exact managed identifier
confirmed for that Project, such as `gpt-realtime-2.1-mini`; do not use the
unversioned `gpt-realtime` alias as a compatibility fallback.

Set the same `VOICE_AGENT_MODEL` value in both Finance sample `.env` files and
the portal `.env`. If every confirmed versioned identifier fails, use a
Project in an eligible region or ask the Voice Agent service owner to confirm
the subscription-region-model combination. Do not change the sample to
self-deployed mode to work around a managed-model failure.

## 2. Install tools and sign in

Install:

- [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli)
- Git
- Python 3.10 or later
- Bash 4 or later
- `curl` and `jq`

On Windows, use WSL for the Bash commands.

Sign in and select the customer subscription:

```bash
az login

SUBSCRIPTION="<subscription-name-or-id>"
az account set --subscription "${SUBSCRIPTION}"

az account show \
  --query "{name:name,id:id,tenantId:tenantId,state:state}" \
  --output table
```

Stop if the displayed subscription is not the one the customer intends to use.

Subscription aliases used in conversation or internal documentation may not
be accepted by Azure CLI. Resolve the exact name or ID with a structured query:

```bash
az account list --all \
  --query "[?contains(name, 'Online') || contains(name, 'Meeting')].{name:name,id:id,state:state,isDefault:isDefault}" \
  --output table
```

Use words relevant to the customer's subscription instead of `Online` and
`Meeting`. Then set `SUBSCRIPTION` to the returned exact name or ID.

## Existing Project fast path

Do this before creating resources when the customer already has a Foundry
Project. Project names are nested ARM resource names, so a plain
`az resource list --name <project>` can return no result even when the Project
exists.

When the Project name is unknown, enumerate all Projects in the active
subscription first:

```bash
az resource list \
  --resource-type Microsoft.CognitiveServices/accounts/projects \
  --query "[].{name:name,resourceGroup:resourceGroup,location:location,id:id}" \
  --output table
```

Select only a Project whose account, resource group, workload owner, purpose,
and confirmed Voice Agent region match the customer setup. Resource discovery
does not prove that an unrelated Project is approved for this workload. Ask
the customer for the intended Project ARM ID when those criteria do not select
one unambiguously.

```bash
FOUNDRY_PROJECT="<existing-project-name>"

PROJECT_ID="$(
  az resource list \
    --resource-type Microsoft.CognitiveServices/accounts/projects \
    --query "[?ends_with(name, '/${FOUNDRY_PROJECT}')].id | [0]" \
    --output tsv
)"

: "${PROJECT_ID:?Project was not found in the active subscription}"

PROJECT_ENDPOINT="$(
  az rest \
    --method get \
    --url "https://management.azure.com${PROJECT_ID}?api-version=2025-06-01" \
    --query 'properties.endpoints."AI Foundry API"' \
    --output tsv
)"

FOUNDRY_SCOPE="${PROJECT_ID%/projects/*}"
FOUNDRY_RESOURCE="${FOUNDRY_SCOPE##*/}"
RESOURCE_GROUP="${PROJECT_ID#*/resourceGroups/}"
RESOURCE_GROUP="${RESOURCE_GROUP%%/*}"
LOCATION="$(
  az rest \
    --method get \
    --url "https://management.azure.com${PROJECT_ID}?api-version=2025-06-01" \
    --query location \
    --output tsv
)"

printf 'PROJECT_ENDPOINT=%s\nPROJECT_ID=%s\nFOUNDRY_SCOPE=%s\nRESOURCE_GROUP=%s\nFOUNDRY_RESOURCE=%s\nLOCATION=%s\n' \
  "${PROJECT_ENDPOINT}" \
  "${PROJECT_ID}" \
  "${FOUNDRY_SCOPE}" \
  "${RESOURCE_GROUP}" \
  "${FOUNDRY_RESOURCE}" \
  "${LOCATION}"
```

If multiple Projects with the same name are visible, query all matches and
select by account, resource group, and subscription instead of taking `[0]`:

```bash
az resource list \
  --resource-type Microsoft.CognitiveServices/accounts/projects \
  --query "[?ends_with(name, '/${FOUNDRY_PROJECT}')].{name:name,id:id,resourceGroup:resourceGroup,location:location}" \
  --output table
```

Verify the returned endpoint has this exact shape:

```text
https://<account>.services.ai.azure.com/api/projects/<project>
```

Then continue with identity and role verification in sections 7 through 11.
Do not run the resource creation sections for an existing Project.

## 3. Choose names

The Foundry account name must be globally unique because it becomes part of the
service endpoint.

```bash
LOCATION="<confirmed-supported-region>"
RESOURCE_GROUP="rg-voice-agent-samples"
FOUNDRY_RESOURCE="<globally-unique-foundry-resource-name>"
FOUNDRY_PROJECT="voice-agent-samples"
```

Keep the variables in the same shell for the rest of this guide.

## 4. Register the provider

```bash
az provider register \
  --namespace Microsoft.CognitiveServices \
  --wait

az provider show \
  --namespace Microsoft.CognitiveServices \
  --query registrationState \
  --output tsv
```

The final output must be:

```text
Registered
```

## 5. Create the resource group and Foundry account

```bash
az group create \
  --name "${RESOURCE_GROUP}" \
  --location "${LOCATION}"
```

Create an AIServices account with Project management and a system-assigned
identity:

```bash
az cognitiveservices account create \
  --resource-group "${RESOURCE_GROUP}" \
  --name "${FOUNDRY_RESOURCE}" \
  --kind AIServices \
  --sku S0 \
  --location "${LOCATION}" \
  --custom-domain "${FOUNDRY_RESOURCE}" \
  --assign-identity \
  --allow-project-management true \
  --yes
```

Verify:

```bash
az cognitiveservices account show \
  --resource-group "${RESOURCE_GROUP}" \
  --name "${FOUNDRY_RESOURCE}" \
  --query "{location:location,state:properties.provisioningState,projectManagement:properties.allowProjectManagement,id:id}" \
  --output table
```

Expected values are the chosen location, `Succeeded`, and `true`.

Make those expectations hard gates:

```bash
ACCOUNT_STATE="$(
  az cognitiveservices account show \
    --resource-group "${RESOURCE_GROUP}" \
    --name "${FOUNDRY_RESOURCE}" \
    --query properties.provisioningState \
    --output tsv
)"
PROJECT_MANAGEMENT="$(
  az cognitiveservices account show \
    --resource-group "${RESOURCE_GROUP}" \
    --name "${FOUNDRY_RESOURCE}" \
    --query properties.allowProjectManagement \
    --output tsv
)"

test "${ACCOUNT_STATE}" = "Succeeded"
test "${PROJECT_MANAGEMENT,,}" = "true"
```

## 6. Create the Foundry Project

```bash
az cognitiveservices account project create \
  --resource-group "${RESOURCE_GROUP}" \
  --name "${FOUNDRY_RESOURCE}" \
  --project-name "${FOUNDRY_PROJECT}" \
  --location "${LOCATION}"
```

Capture the identifiers used by SDK and management-plane commands:

```bash
PROJECT_ENDPOINT="$(
  az cognitiveservices account project show \
    --resource-group "${RESOURCE_GROUP}" \
    --name "${FOUNDRY_RESOURCE}" \
    --project-name "${FOUNDRY_PROJECT}" \
    --query "properties.endpoints.\"AI Foundry API\"" \
    --output tsv
)"

PROJECT_ID="$(
  az cognitiveservices account project show \
    --resource-group "${RESOURCE_GROUP}" \
    --name "${FOUNDRY_RESOURCE}" \
    --project-name "${FOUNDRY_PROJECT}" \
    --query id \
    --output tsv
)"

FOUNDRY_SCOPE="$(
  az cognitiveservices account show \
    --resource-group "${RESOURCE_GROUP}" \
    --name "${FOUNDRY_RESOURCE}" \
    --query id \
    --output tsv
)"

printf 'PROJECT_ENDPOINT=%s\nPROJECT_ID=%s\nFOUNDRY_SCOPE=%s\n' \
  "${PROJECT_ENDPOINT}" \
  "${PROJECT_ID}" \
  "${FOUNDRY_SCOPE}"
```

Expected formats:

```text
PROJECT_ENDPOINT=https://<account>.services.ai.azure.com/api/projects/<project>
PROJECT_ID=/subscriptions/<id>/resourceGroups/<rg>/providers/Microsoft.CognitiveServices/accounts/<account>/projects/<project>
FOUNDRY_SCOPE=/subscriptions/<id>/resourceGroups/<rg>/providers/Microsoft.CognitiveServices/accounts/<account>
```

Require all three values:

```bash
: "${PROJECT_ENDPOINT:?Project endpoint was not returned}"
: "${PROJECT_ID:?Project ARM ID was not returned}"
: "${FOUNDRY_SCOPE:?Foundry account ARM ID was not returned}"

PROJECT_STATE="$(
  az cognitiveservices account project show \
    --resource-group "${RESOURCE_GROUP}" \
    --name "${FOUNDRY_RESOURCE}" \
    --project-name "${FOUNDRY_PROJECT}" \
    --query properties.provisioningState \
    --output tsv
)"
test "${PROJECT_STATE}" = "Succeeded"
```

Account deployment lists describe customer-created deployments. They do not
prove whether the service-managed Voice Agent model is enabled. Use the
publication and session gates in [03: Start and run the samples](./03_run_samples.md)
after preview eligibility and region support are confirmed.

## 7. Resolve identity object IDs without Microsoft Graph

Decode the deployment identity's object ID from an ARM access token. This
avoids requiring a separate Microsoft Graph sign-in:

```bash
ARM_ACCESS_TOKEN="$(
  az account get-access-token \
    --resource https://management.azure.com/ \
    --query accessToken \
    --output tsv
)"

USER_OBJECT_ID="$(
  ARM_ACCESS_TOKEN="${ARM_ACCESS_TOKEN}" python3 - <<'PY'
import base64
import json
import os

payload = os.environ["ARM_ACCESS_TOKEN"].split(".")[1]
payload += "=" * (-len(payload) % 4)
print(json.loads(base64.urlsafe_b64decode(payload))["oid"])
PY
)"

unset ARM_ACCESS_TOKEN

PROJECT_PRINCIPAL_ID="$(
  az cognitiveservices account project show \
    --resource-group "${RESOURCE_GROUP}" \
    --name "${FOUNDRY_RESOURCE}" \
    --project-name "${FOUNDRY_PROJECT}" \
    --query identity.principalId \
    --output tsv
)"

: "${USER_OBJECT_ID:?Could not determine deployment user object ID}"
: "${PROJECT_PRINCIPAL_ID:?The Project has no managed identity principal ID}"
```

`USER_OBJECT_ID` is the identity signed in to Azure CLI. Section 8 grants roles
to `ASSIGNEE_OBJECT_ID`, which defaults to that identity:

```bash
ASSIGNEE_OBJECT_ID="${USER_OBJECT_ID}"
```

To grant access to a teammate instead, ask them to run the `USER_OBJECT_ID`
snippet above while signed in as themselves and send you the value. An object
ID is an identifier, not a credential. If your tenant allows Microsoft Graph
reads, `az ad user show --id <their-sign-in-name> --query id --output tsv`
returns the same value. Then set `ASSIGNEE_OBJECT_ID="<their-object-id>"`.

## 8. Assign the required roles

Run this section when you create the Project, and again for every teammate you
add to an existing Project. Each row names its own scope; a role at one scope
grants nothing at another.

| Work | Role | Scope | Assign to |
| --- | --- | --- | --- |
| Create, publish, and run Voice Agents; use the playground; run the Portal and CLI samples; run conversation simulation | Foundry User | Foundry resource (`FOUNDRY_SCOPE`) | Every developer, and the Project managed identity |
| Deploy or change model deployments, including simulator and evaluator models; create or change Project connections such as MCP and Application Insights | Foundry Account Owner | Foundry resource (`FOUNDRY_SCOPE`), not the Project | Developers who deploy models or change connections |
| See available quota and pass deployment eligibility checks | Cognitive Services Usages Reader | Subscription (`SUBSCRIPTION_SCOPE`) | The same developers as the previous row |
| Open **Traces** and the voice **Monitor** tab, review trace-based evaluation results, run `download_conversation_traces.py`, and grant this access to others | Owner | Connected Application Insights resource (`APP_INSIGHTS_ID`) | Project team members who manage access |
| The same trace access, read-only | Log Analytics Reader | Connected Application Insights resource | Other developers who debug sessions |
| Let trace-based evaluation read traces | Reader | Connected Application Insights resource | The Project managed identity |
| Read trace content stored in protected tables | Privileged Monitoring Data Reader | Connected Application Insights resource | Each identity above that reads protected content |
| Grant the roles in this table | Owner or Role Based Access Control Administrator | Each scope in this table | The person running this section |

What the table does not make obvious:

- **Model deployment belongs to the Foundry resource, not the Project.**
  Foundry User, Foundry Project Manager, or an owner role on the Project does
  not let a user deploy a model. Assign Foundry Account Owner on the parent
  Foundry resource; some portals still call it Azure AI Account Owner.
- **Foundry Account Owner cannot build Agents.** It has no Agent data-plane
  permissions, so a developer who deploys models and builds Agents needs both
  Foundry User and Foundry Account Owner. Foundry Owner (assigned on the
  Foundry resource or its parent resource group) combines both in one
  assignment, whereas Azure's built-in Owner and Contributor roles lack Agent
  `dataActions` and cannot create or run Agents. Foundry Account Owner is also
  broader than deployment (it can create Projects and grant some roles); use a
  custom role if you need deployment-only access.
- **Application Insights is often in another resource group or
  subscription.** A role on the Foundry resource or its resource group does
  not reach it, and **Traces** then fails with HTTP 401 and `does not have
  authorization to perform action 'Microsoft.Insights/components/read'`.
  Section 8.4 finds the actual resource. Granting roles on it needs Owner or
  Role Based Access Control Administrator on that resource; owning the Foundry
  resource is not enough, so ask the Application Insights owner.
- **Quota needs a subscription-scope assignment.** Resource group, Foundry
  resource, and Project assignments do not authorize the quota (Usages) API.
- **"Publish" in these samples means creating an Agent version**, which
  Foundry User covers. The *Publish agents* column of the Foundry RBAC article
  refers to publishing an Agent application, which needs Foundry Project
  Manager.
- **Projects created with the CLI get no automatic role.** The Foundry portal
  assigns Foundry User automatically only when someone who can assign roles
  creates the Project in the portal.
- **The Foundry roles were renamed** from Azure AI User, Azure AI Account
  Owner, Azure AI Project Manager, and Azure AI Owner. The commands below use
  role definition IDs, which did not change.
- Earlier versions of this guide assigned Cognitive Services Contributor and
  Cognitive Services User. Foundry RBAC guidance does not use Cognitive
  Services roles except Cognitive Services Usages Reader, and neither old role
  covers quota or traces. You can remove those assignments after section 9
  passes.

### 8.1 Set role IDs and scopes

```bash
FOUNDRY_USER_ROLE="53ca6127-db72-4b80-b1b0-d745d6d5456d"
FOUNDRY_ACCOUNT_OWNER_ROLE="e47c6f54-e4a2-4754-9501-8e0985b135e1"
FOUNDRY_OWNER_ROLE="c883944f-8b7b-4483-af10-35834be79c4a"
USAGES_READER_ROLE="bba48692-92b0-4667-a9ad-c31c7b334ac2"
OWNER_ROLE="8e3af657-a8ff-443c-a75c-2fe8c4bcb635"
LOG_ANALYTICS_READER_ROLE="73c42c96-874c-492b-b04d-ab87d138a893"
READER_ROLE="acdd72a7-3385-48ef-bd42-f606fba81ae7"
PRIVILEGED_MONITORING_DATA_READER_ROLE="dbc9c667-e97f-4491-aee6-90b9cf960190"

SUBSCRIPTION_SCOPE="/subscriptions/$(cut -d/ -f3 <<<"${FOUNDRY_SCOPE}")"

: "${ASSIGNEE_OBJECT_ID:?Set ASSIGNEE_OBJECT_ID as described in section 7}"
: "${PROJECT_PRINCIPAL_ID:?Run section 7 first}"
```

### 8.2 Developer roles

```bash
# Build, publish, and run Voice Agents.
az role assignment create \
  --assignee-object-id "${ASSIGNEE_OBJECT_ID}" \
  --assignee-principal-type User \
  --role "${FOUNDRY_USER_ROLE}" \
  --scope "${FOUNDRY_SCOPE}"

# Deploy models and change Project connections.
az role assignment create \
  --assignee-object-id "${ASSIGNEE_OBJECT_ID}" \
  --assignee-principal-type User \
  --role "${FOUNDRY_ACCOUNT_OWNER_ROLE}" \
  --scope "${FOUNDRY_SCOPE}"

# Read quota while deploying models.
az role assignment create \
  --assignee-object-id "${ASSIGNEE_OBJECT_ID}" \
  --assignee-principal-type User \
  --role "${USAGES_READER_ROLE}" \
  --scope "${SUBSCRIPTION_SCOPE}"
```

Skip the last two commands for a developer who only builds and runs Agents
against models someone else deploys. The subscription assignment needs Owner
or Role Based Access Control Administrator on the subscription; ask the
subscription administrator if you hold it only on the resource group.

### 8.3 Project managed identity

Once per Project:

```bash
az role assignment create \
  --assignee-object-id "${PROJECT_PRINCIPAL_ID}" \
  --assignee-principal-type ServicePrincipal \
  --role "${FOUNDRY_USER_ROLE}" \
  --scope "${FOUNDRY_SCOPE}"
```

The identity's Application Insights role is in section 8.4.

### 8.4 Application Insights access

Foundry writes traces to the Application Insights resource connected to the
Project; tracing stays off until one is connected. Resolve it from the
Project's connections, falling back to the Foundry resource's connections:

```bash
CONNECTIONS_API_VERSION="2025-06-01"

app_insights_connection() {
  az rest \
    --method get \
    --url "https://management.azure.com$1/connections?api-version=${CONNECTIONS_API_VERSION}" \
    --query "value[?properties.category=='AppInsights'] | [0] | properties.metadata.ResourceId || properties.target" \
    --output tsv
}

APP_INSIGHTS_ID="$(app_insights_connection "${PROJECT_ID}")"
if [ -z "${APP_INSIGHTS_ID}" ]; then
  APP_INSIGHTS_ID="$(app_insights_connection "${FOUNDRY_SCOPE}")"
fi
: "${APP_INSIGHTS_ID:?No Application Insights resource is connected; connect one first}"

LOG_ANALYTICS_WORKSPACE_ID="$(
  az rest \
    --method get \
    --url "https://management.azure.com${APP_INSIGHTS_ID}?api-version=2020-02-02" \
    --query properties.WorkspaceResourceId \
    --output tsv
)"

printf 'APP_INSIGHTS_ID=%s\nLOG_ANALYTICS_WORKSPACE_ID=%s\n' \
  "${APP_INSIGHTS_ID}" \
  "${LOG_ANALYTICS_WORKSPACE_ID}"
```

If no resource is connected, connect one in the Foundry portal: open the
Project and select **Build** > **Agents** > **Traces** > **Connect**, or
**Manage** > **Project details** > **Connected resources** > **Add
connection** > **Application Insights**. Connecting needs Foundry Account
Owner (or Foundry Project Manager) on the Foundry resource and read access to
the Application Insights resource. Then rerun the block above.

Compare the resource group in `APP_INSIGHTS_ID` with `${RESOURCE_GROUP}`. When
they differ, roles on the Foundry resource group do not cover traces.

Grant the person and the Project managed identity their roles:

```bash
# Project team member: read traces and grant trace access to others.
# For a read-only developer, use "${LOG_ANALYTICS_READER_ROLE}" instead.
TRACE_ROLE="${OWNER_ROLE}"

az role assignment create \
  --assignee-object-id "${ASSIGNEE_OBJECT_ID}" \
  --assignee-principal-type User \
  --role "${TRACE_ROLE}" \
  --scope "${APP_INSIGHTS_ID}"

# Once per Project: let trace-based evaluation read traces.
az role assignment create \
  --assignee-object-id "${PROJECT_PRINCIPAL_ID}" \
  --assignee-principal-type ServicePrincipal \
  --role "${READER_ROLE}" \
  --scope "${APP_INSIGHTS_ID}"
```

Two cases need more:

- **Protected tables.** If captured trace content is stored in protected
  tables, also assign `${PRIVILEGED_MONITORING_DATA_READER_ROLE}` on
  `${APP_INSIGHTS_ID}` to each person and to the Project managed identity.
  Owner does not include this access.
- **Workspace permissions required.** If the linked workspace requires
  workspace permissions, assign the same roles on
  `${LOG_ANALYTICS_WORKSPACE_ID}`. This command prints `false` in that case:

  ```bash
  az rest \
    --method get \
    --url "https://management.azure.com${LOG_ANALYTICS_WORKSPACE_ID}?api-version=2022-10-01" \
    --query properties.features.enableLogAccessUsingOnlyResourcePermissions \
    --output tsv
  ```

`${APP_INSIGHTS_ID}` is also the value of
`AZURE_VOICE_AGENTS_APP_INSIGHTS_RESOURCE_ID` used by
[`download_conversation_traces.py`](../samples/download_conversation_traces.py).

### 8.5 Customer-hosted MCP on Azure Container Apps

Only for the optional Azure path in
[guide 02](./02_mcp_settings.md#deploy-to-azure-container-apps):

| Work | Role | Scope |
| --- | --- | --- |
| Create the MCP Project connections | Foundry Account Owner or Foundry Project Manager | Foundry resource |
| Run `deploy.sh`, which also writes an `AcrPull` role assignment | Owner, or Contributor plus Role Based Access Control Administrator | Subscription, or the MCP resource group when it already exists |
| Push a new image to an MCP someone else deployed, without rerunning `deploy.sh` | Contributor, and AcrPush | The MCP resource group, and its Container Registry |

### 8.6 Add a teammate to an existing Project

1. The teammate runs the `USER_OBJECT_ID` snippet in section 7 while signed in
   as themselves and sends you the value.
2. In your own shell, run the [Existing Project fast path](#existing-project-fast-path)
   and section 7, then set `ASSIGNEE_OBJECT_ID` to the teammate's value.
3. Run sections 8.1 and 8.2, and the person assignment in 8.4. Section 8.3
   and the managed-identity assignment in 8.4 are once per Project.
4. Run section 9. It checks `ASSIGNEE_OBJECT_ID`, so it verifies the teammate.
5. After a few minutes, the teammate signs out of the Foundry portal, signs
   back in, and reruns `az login`. A token issued before the assignment does
   not carry it.

### 8.7 Who can grant these roles

The person running section 8 needs `Microsoft.Authorization/roleAssignments/write`
at each scope, normally through Owner or Role Based Access Control
Administrator. Foundry Account Owner can grant only Foundry User, ACR, and
monitoring roles, and only where it is assigned. If an organization uses ABAC
conditions or privileged identity management, an administrator may need to
perform or activate the assignment; an eligible assignment grants nothing
until it is activated.

Organizations can replace these roles with custom least-privilege roles. A
replacement must keep the Agent data actions
(`Microsoft.CognitiveServices/accounts/AIServices/agents/*`), the model
deployment actions (`Microsoft.CognitiveServices/accounts/deployments/*`) for
whoever deploys models, `Microsoft.CognitiveServices/locations/usages/read` at
subscription scope, and read and query access to Application Insights.

## 9. Verify roles and provisioning

Use ARM REST for role verification. Unlike `az role assignment list`, these
queries do not ask Microsoft Graph to resolve principal display information.
`has_role` counts an assignment at the checked scope or at a parent scope.
Run this as the person who granted the roles: a developer who holds only the
roles above might not be allowed to list subscription-level assignments, which
shows as `MISSING`.

```bash
AUTHORIZATION_API_VERSION="2022-04-01"
CHECK_OBJECT_ID="${ASSIGNEE_OBJECT_ID}"
MISSING_ROLES=0
# Owner and Contributor on the subscription also include quota read.
CONTRIBUTOR_ROLE="b24988ac-6180-42a0-ab88-20f7382dd24c"

# Succeeds when the principal holds the role at the scope or a parent scope.
has_role() {
  local target_scope="${1,,}" principal_id="$2" role_guid="${3,,}"
  local assigned_scope role_definition_id
  while IFS=$'\t' read -r assigned_scope role_definition_id; do
    assigned_scope="${assigned_scope,,}"
    role_definition_id="${role_definition_id,,}"
    [[ "${role_definition_id}" == */"${role_guid}" ]] || continue
    if [[ "${target_scope}" == "${assigned_scope}" ||
          "${target_scope}" == "${assigned_scope}"/* ||
          "${assigned_scope}" == / ||
          "${assigned_scope}" == /providers/microsoft.management/* ]]; then
      return 0
    fi
  done < <(
    az rest \
      --method get \
      --url "https://management.azure.com$1/providers/Microsoft.Authorization/roleAssignments?api-version=${AUTHORIZATION_API_VERSION}" \
      --url-parameters "\$filter=principalId eq '${principal_id}'" \
      --query "value[].[properties.scope, properties.roleDefinitionId]" \
      --output tsv
  )
  return 1
}

# Prints ok when the principal holds any of the listed roles.
check_role() {
  local label="$1" scope="$2" principal_id="$3" role_guid
  shift 3
  for role_guid in "$@"; do
    if has_role "${scope}" "${principal_id}" "${role_guid}"; then
      printf 'ok       %s\n' "${label}"
      return
    fi
  done
  printf 'MISSING  %s\n' "${label}"
  MISSING_ROLES=1
}

check_role "Foundry User on the Foundry resource" \
  "${FOUNDRY_SCOPE}" "${CHECK_OBJECT_ID}" \
  "${FOUNDRY_USER_ROLE}" "${FOUNDRY_OWNER_ROLE}"
check_role "Foundry Account Owner on the Foundry resource (deploy models)" \
  "${FOUNDRY_SCOPE}" "${CHECK_OBJECT_ID}" \
  "${FOUNDRY_ACCOUNT_OWNER_ROLE}" "${FOUNDRY_OWNER_ROLE}"
check_role "Cognitive Services Usages Reader on the subscription (quota)" \
  "${SUBSCRIPTION_SCOPE}" "${CHECK_OBJECT_ID}" \
  "${USAGES_READER_ROLE}" "${OWNER_ROLE}" "${CONTRIBUTOR_ROLE}"
check_role "Owner or Log Analytics Reader on Application Insights (traces)" \
  "${APP_INSIGHTS_ID}" "${CHECK_OBJECT_ID}" \
  "${OWNER_ROLE}" "${LOG_ANALYTICS_READER_ROLE}"
check_role "Project identity: Foundry User on the Foundry resource" \
  "${FOUNDRY_SCOPE}" "${PROJECT_PRINCIPAL_ID}" \
  "${FOUNDRY_USER_ROLE}" "${FOUNDRY_OWNER_ROLE}"
check_role "Project identity: Reader on Application Insights (trace evaluation)" \
  "${APP_INSIGHTS_ID}" "${PROJECT_PRINCIPAL_ID}" \
  "${READER_ROLE}" "${LOG_ANALYTICS_READER_ROLE}" "${OWNER_ROLE}"

test "${MISSING_ROLES}" = 0

az cognitiveservices account project show \
  --resource-group "${RESOURCE_GROUP}" \
  --name "${FOUNDRY_RESOURCE}" \
  --project-name "${FOUNDRY_PROJECT}" \
  --query "{state:properties.provisioningState,endpoint:properties.endpoints.\"AI Foundry API\",id:id,principalId:identity.principalId}" \
  --output json
```

Expected output when everything is in place:

```text
ok       Foundry User on the Foundry resource
ok       Foundry Account Owner on the Foundry resource (deploy models)
ok       Cognitive Services Usages Reader on the subscription (quota)
ok       Owner or Log Analytics Reader on Application Insights (traces)
ok       Project identity: Foundry User on the Foundry resource
ok       Project identity: Reader on Application Insights (trace evaluation)
```

The Account Owner and Usages Reader lines may stay `MISSING` for a developer
who does not deploy models. The check reads only direct assignments, so these
cases also show `MISSING`:

- **Roles granted through a Microsoft Entra group.** Check another person
  with **Access control (IAM)** > **Check access** in the Azure portal. Check
  yourself with the command below: `Microsoft.CognitiveServices/*` under
  `actions` covers model deployment and connections, and under `dataActions`
  covers Agents. Run it with `${APP_INSIGHTS_ID}` in place of
  `${FOUNDRY_SCOPE}` to check trace access: `*` or `*/read` covers it.
- **Assignments from an earlier version of this guide** (Cognitive Services
  Contributor and Cognitive Services User). Add the Foundry roles.
- **Built-in Azure Owner or Contributor inherited from the subscription or
  resource group**, for the two Foundry rows: neither grants Agent
  `dataActions`. Assign the Foundry roles (or Foundry Owner) explicitly.
- **Any role on the Project only.** A Project-scope Owner or Foundry Project
  Manager does not count for the Foundry resource rows, because it does not
  reach the parent resource.

```bash
az rest \
  --method get \
  --url "https://management.azure.com${FOUNDRY_SCOPE}/providers/Microsoft.Authorization/permissions?api-version=${AUTHORIZATION_API_VERSION}" \
  --query "value[].{actions:actions,dataActions:dataActions}" \
  --output json
```

Role assignments can take several minutes to propagate. Wait, sign out of the
Foundry portal and back in, and retry before changing the role set. An error
ending in `If access was recently granted, please refresh your credentials`
means the token predates the assignment. If the Azure CLI is signed in as the
wrong identity or tenant, run `az login` again and reselect `${SUBSCRIPTION}`.
Then restore the shell variables or rerun the capture commands above.

### Access errors

| Symptom | Missing access | Fix |
| --- | --- | --- |
| The Foundry portal does not let you deploy a model, or evaluation cannot add a simulator or evaluator model | Foundry Account Owner on the Foundry resource | Section 8.2 |
| Deployment shows no quota or fails its eligibility check | Cognitive Services Usages Reader on the subscription | Section 8.2 |
| **Traces** fails with HTTP 401 and `Microsoft.Insights/components/read` | Any role on the connected Application Insights resource, which is often in another resource group | Section 8.4 |
| `download_conversation_traces.py` returns 403 | Log Analytics Reader or Owner on Application Insights, or on the workspace when it requires workspace permissions | Section 8.4 |
| Trace content stored in protected tables cannot be read | Privileged Monitoring Data Reader | Section 8.4 |
| Trace-based evaluation finds no trace data although **Traces** lists the conversation | Reader for the Project managed identity on Application Insights | Section 8.4; also wait for ingestion and widen the time range |
| Agent publish or session start returns 401 or 403 | Foundry User on the Foundry resource for the identity actually in use | Section 8.2; confirm the identity with `az account show` |
| Creating an MCP or Application Insights connection is denied | Foundry Account Owner or Foundry Project Manager on the Foundry resource | Section 8.2 |
| Section 8 fails on `Microsoft.Authorization/roleAssignments/write` | Owner or Role Based Access Control Administrator at that scope | Ask that scope's owner, or activate an eligible assignment |

## 10. Preserve the non-secret outputs

Store these values in a password manager, deployment system, or protected
customer setup record:

```text
SUBSCRIPTION
LOCATION
RESOURCE_GROUP
FOUNDRY_RESOURCE
FOUNDRY_PROJECT
PROJECT_ENDPOINT
PROJECT_ID
FOUNDRY_SCOPE
APP_INSIGHTS_ID
LOG_ANALYTICS_WORKSPACE_ID
```

They are identifiers, not bearer credentials, but they still disclose customer
topology and should not be added to a reusable public sample.

## 11. Point a sample at this Project

Do not copy an endpoint from a demo, TIP, or another customer's subscription.
Use the `${PROJECT_ENDPOINT}` produced above as
`AZURE_AI_PROJECT_ENDPOINT` in the selected example's ignored `.env`. To
download traces with
[`download_conversation_traces.py`](../samples/download_conversation_traces.py),
also set `AZURE_VOICE_AGENTS_APP_INSIGHTS_RESOURCE_ID` to `${APP_INSIGHTS_ID}`
(see [`samples/.env.example`](../samples/.env.example)).

Continue in exactly one scenario README:

- [02: MCP settings, deployment, and development](./02_mcp_settings.md)
- [03: Start and run the samples](./03_run_samples.md)
- [Example 1: Finance with Handoff - Realtime](../samples/example1_finance_with_handoff_realtime/README.md)
- [Example 1: Finance with Handoff - Cascade](../samples/example1_finance_with_handoff_cascade/README.md)
- [Example 2: Finance with OTP and Officer Search](../samples/example2_finance_with_OTP_and_Officer_Search/README.md)
- [Voice Agent portal](../portal/README.md)
- [Finance examples architecture and documentation index](./README.md)

Those directories are self-contained after subscription setup. They own their
MCP endpoint and connection requirements, SDK installation, publication,
readback, runtime validation, and troubleshooting. Keeping those steps with the
scenario prevents a shared guide from drifting away from its `agent.json` and
`sample.py`.

## References

- [Create Microsoft Foundry Projects](https://learn.microsoft.com/azure/foundry/how-to/create-projects)
- [Microsoft Foundry RBAC](https://learn.microsoft.com/azure/foundry/concepts/rbac-foundry)
- [Set up tracing for agents](https://learn.microsoft.com/azure/foundry/observability/how-to/trace-agent-setup)
- [Voice agent tracing, monitoring, and evaluation](https://learn.microsoft.com/azure/foundry/agents/concepts/voice-agent-observability)
- [Voice Agent quickstart](https://learn.microsoft.com/azure/ai-services/speech-service/voice-live-agents-quickstart)
