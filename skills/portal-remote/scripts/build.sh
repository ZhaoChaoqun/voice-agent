#!/usr/bin/env bash
# Copyright (c) Microsoft. All rights reserved.
# Step 2 of 3: build the Voice Agent portal image in YOUR Azure Container Registry.
#
# Needs no options: it reads what prepare.sh saved in portal/.env. The build runs in Azure
# (az acr build), so neither Cloud Shell nor your network needs Docker, PyPI or Docker Hub.
# It builds the commit checked out here: git pull (or git checkout <tag>) first to change version.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

usage() {
  cat <<'EOF'
Usage: skills/portal-remote/scripts/build.sh [options]
Every value defaults to what prepare.sh saved; options override it for this run only.
  --resource-group RG   Resource group for the registry and the portal (created if missing)
  --location REGION     Region, used only when the resource group does not exist yet
  --name NAME           Portal name (default voice-agent-portal)
  --subscription ID     Subscription
  --acr NAME            Registry name (default derived from subscription, group and name; created if missing)
  --tag KEY=VALUE       Resource-group tag your policy requires, repeatable; merged into an existing group
EOF
}
# The portal runs in the resource group's region (deploy.sh default), so it must offer Container Apps.
check_region() {
  local display
  display="$(az account list-locations --query "[?name=='$1'].displayName | [0]" -o tsv)"
  [[ -n "$display" ]] || die "Unknown region '$1'. Use a short name such as westus2, eastus2 or swedencentral."
  az provider show -n Microsoft.App --query "resourceTypes[?resourceType=='managedEnvironments'].locations[]" -o tsv \
    | grep -qixF "$display" || die "Azure Container Apps is not available in $1 ($display). Rerun prepare.sh, answer n at 'Is this right?' and choose again."
}

RG="$(setting PORTAL_ACA_RESOURCE_GROUP)" LOCATION="$(setting PORTAL_ACA_LOCATION)"
NAME="$(setting PORTAL_ACA_NAME)" SUBSCRIPTION="$(setting PORTAL_ACA_SUBSCRIPTION_ID)" ACR="" TAGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --resource-group) RG="$2"; shift 2 ;;
    --location) LOCATION="$2"; shift 2 ;;
    --name) NAME="$2"; shift 2 ;;
    --subscription) SUBSCRIPTION="$2"; shift 2 ;;
    --acr) ACR="$2"; shift 2 ;;
    --tag) TAGS+=("$2"); shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) usage; die "Unknown option: $1" ;;
  esac
done
NAME="${NAME:-voice-agent-portal}"
[[ -n "$RG" ]] || die "Nothing prepared yet: run skills/portal-remote/scripts/prepare.sh first."
LOCATION="$(printf '%s' "$LOCATION" | tr -d ' ' | tr '[:upper:]' '[:lower:]')"   # "West US 2" -> westus2
[[ "$NAME" =~ ^[a-z][a-z0-9-]{0,30}[a-z0-9]$ ]] || die "--name must be 2-32 lowercase letters, digits or hyphens."
for tool in git tar; do command -v "$tool" >/dev/null || die "$tool is required (Azure Cloud Shell has it)."; done
[[ -f "$REPO_ROOT/portal/demo_server.py" ]] || die "$REPO_ROOT is not a voice-agent checkout (portal/demo_server.py missing)."
git -C "$REPO_ROOT" rev-parse --git-dir >/dev/null 2>&1 || die "$REPO_ROOT is not a git checkout: get the code with git clone."

log "Checking Azure sign-in"
[[ -z "$SUBSCRIPTION" ]] || az account set --subscription "$SUBSCRIPTION"
SUB_ID="$(az account show --query id -o tsv)" || die "Not signed in: restart Cloud Shell, or run az login on your computer."
log "Subscription '$(az account show --query name -o tsv)' ($SUB_ID)"
az provider register --namespace Microsoft.ContainerRegistry --only-show-errors >/dev/null

# deploy.sh derives the same registry name from the same inputs.
SUFFIX="$(printf '%s' "$SUB_ID/$RG/$NAME" | { sha256sum 2>/dev/null || shasum -a 256; } | cut -c1-8)"
ACR="${ACR:-vaportal$SUFFIX}"

# Never re-PUT an existing group: "az group create" replaces its tags (and policy may deny that).
if [[ "$(az group exists -n "$RG" -o tsv)" == "true" ]]; then
  log "Resource group $RG (existing; its tags are kept)"
  if [[ ${#TAGS[@]} -gt 0 ]]; then
    az tag update --resource-id "$(az group show -n "$RG" --query id -o tsv)" --operation Merge \
      --tags "${TAGS[@]}" --only-show-errors -o none
  fi
  LOCATION="$(az group show -n "$RG" --query location -o tsv)"
  check_region "$LOCATION"
else
  [[ -n "$LOCATION" ]] || die "Resource group $RG does not exist and no region is saved: rerun prepare.sh."
  check_region "$LOCATION"
  log "Creating resource group $RG ($LOCATION)"
  TAG_ARGS=()
  if [[ ${#TAGS[@]} -gt 0 ]]; then TAG_ARGS=(--tags "${TAGS[@]}"); fi
  az group create -n "$RG" -l "$LOCATION" ${TAG_ARGS[@]+"${TAG_ARGS[@]}"} --only-show-errors -o none \
    || die "Cannot create resource group $RG (see above). If a policy requires tags, create resource group $RG with those tags in the Azure portal, then rerun build.sh."
fi

log "Container registry $ACR"
if ! az acr show -n "$ACR" -o none 2>/dev/null; then
  az acr create -n "$ACR" -g "$RG" -l "$LOCATION" --sku Basic --admin-enabled false --only-show-errors -o none \
    || die "Cannot create the container registry (see above)."
fi
ACR_LOGIN="$(az acr show -n "$ACR" --query loginServer -o tsv)"

# Tracked files only (including uncommitted edits to them): never ships .env, virtual environments,
# node_modules or local logs. `git stash create` snapshots the working tree without touching it.
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
REV="$(git -C "$REPO_ROOT" rev-parse --short HEAD)"
DIRTY="$(git -C "$REPO_ROOT" status --porcelain -- portal samples docs | head -1)"
SNAPSHOT="$(git -C "$REPO_ROOT" stash create 2>/dev/null || true)"
mkdir -p "$WORK/context"
git -C "$REPO_ROOT" archive --format=tar "${SNAPSHOT:-HEAD}" -- portal samples docs \
  ':(exclude)portal/web' ':(exclude)portal/tests' ':(exclude)portal/tools' | tar -xf - -C "$WORK/context"
TAG="$REV${DIRTY:+-dirty}-$(date -u +%Y%m%d%H%M%S)"
IMAGE="$ACR_LOGIN/voice-agent-portal:$TAG"
log "Building $IMAGE in Azure (voice-agent $REV${DIRTY:+, with local changes}); about 2 minutes"
az acr build --registry "$ACR" --image "voice-agent-portal:$TAG" --platform linux/amd64 \
  --file portal/deploy/aca/Dockerfile "$WORK/context" --only-show-errors -o none \
  || die "The image build failed (see above)."

NEXT="skills/portal-remote/scripts/deploy.sh"
[[ "$ACR" == "vaportal$SUFFIX" ]] || NEXT+=" --acr $ACR"
printf '\nImage : %s\nNext  : %s\n' "$IMAGE" "$NEXT" >&2
