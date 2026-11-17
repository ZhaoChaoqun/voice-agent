#!/usr/bin/env bash
# Copyright (c) Microsoft. All rights reserved.
# Is the portal running? Checks, without changing anything, every resource prepare.sh, build.sh and
# deploy.sh create, the roles of the portal's identity, who can open it, and whether it answers.
# Needs no options: it reads what prepare.sh saved in portal/.env. Exit code 0 means running.
set -uo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
case "${1:-}" in
  -h|--help) echo "Usage: skills/portal-remote/scripts/status.sh   (no options; read-only)"; exit 0 ;;
  "") ;;
  *) die "status.sh takes no options." ;;
esac

# Read-only Azure queries: no explanations or retries, an empty answer means "not there".
q() { command az "$@" --only-show-errors -o tsv 2>/dev/null; }
line() { printf '  %-8s %s\n' "$1" "$2"; [[ -z "${3:-}" ]] || printf '           %s\n' "$3"; }
NEXT="" PROBLEMS=0
next() { [[ -n "$NEXT" ]] || NEXT="$1"; }
ok() { line OK "$1" "${2:-}"; }
warn_() { line WARN "$1" "${2:-}"; }
bad() { line "$1" "$2" "${3:-}"; PROBLEMS=$((PROBLEMS + 1)); }
S=skills/portal-remote/scripts

RG="$(setting PORTAL_ACA_RESOURCE_GROUP)" NAME="$(setting PORTAL_ACA_NAME)"
SUBSCRIPTION="$(setting PORTAL_ACA_SUBSCRIPTION_ID)" AUTH="$(setting PORTAL_ACA_AUTH)"
SAVED_IPS="$(setting PORTAL_ACA_ALLOWED_IPS)" PROJECT_ENDPOINT="$(setting endpoint)"
NAME="${NAME:-voice-agent-portal}" AUTH="${AUTH:-ip}"
[[ -n "$RG" && -n "$PROJECT_ENDPOINT" ]] || die "Nothing prepared yet: run $S/prepare.sh first."

echo
echo "Voice Agent portal status (read-only; nothing is changed)"
echo
[[ -z "$SUBSCRIPTION" ]] || command az account set --subscription "$SUBSCRIPTION" 2>/dev/null \
  || die "Subscription $SUBSCRIPTION is not visible to this sign-in. In Cloud Shell, switch directory in the Azure portal and restart it."
SUB_ID="$(q account show --query id)" || die "Not signed in: restart Cloud Shell, or run az login on your computer."
# Cloud Shell can come back on another subscription: look where build.sh made the resources (read-only).
MOVED=""
if [[ "$(q group exists -n "$RG")" != "true" ]]; then
  FOUND="$(python3 "$SETUP" locate --resource-group "$RG" --name "$NAME" 2>/dev/null || true)"
  if [[ -n "$FOUND" && "$FOUND" != *$'\n'* && "$FOUND" != "$SUB_ID" ]] && command az account set --subscription "$FOUND" 2>/dev/null; then
    MOVED="$(q account show --subscription "$SUB_ID" --query name)" SUB_ID="$FOUND"
  fi
fi
ok "Signed in as $(q account show --query user.name), subscription '$(q account show --query name)'"
[[ -z "$MOVED" ]] || warn_ "The portal's resources are in this subscription, not in '$MOVED' saved by prepare.sh" \
  "status.sh checks them here. deploy.sh switches here and saves it on its next run."
command az extension show --name containerapp >/dev/null 2>&1 \
  || command az extension add --name containerapp --only-show-errors -y >/dev/null 2>&1 || true

# ---------- resources, in the order the scripts create them ----------
ACR="" ACR_ID="" NEWEST="" APP=false ID_PRINCIPAL=""
if [[ "$(q group exists -n "$RG")" != "true" ]]; then
  bad MISSING "Resource group $RG" "Created by build.sh."; next "$S/build.sh, then $S/deploy.sh"
else
  ok "Resource group $RG ($(q group show -n "$RG" --query location))"
  # Same name as build.sh derives; otherwise the one registry in the group (build.sh --acr).
  SUFFIX="$(printf '%s' "$SUB_ID/$RG/$NAME" | { sha256sum 2>/dev/null || shasum -a 256; } | cut -c1-8)"
  ACR="vaportal$SUFFIX"
  ACR_ID="$(q acr show -n "$ACR" -g "$RG" --query id)"
  if [[ -z "$ACR_ID" ]]; then
    ACR="$(q acr list -g "$RG" --query '[0].name')"
    [[ -z "$ACR" ]] || ACR_ID="$(q acr show -n "$ACR" -g "$RG" --query id)"
  fi
  if [[ -z "$ACR_ID" ]]; then
    bad MISSING "Container registry" "Created by build.sh."; next "$S/build.sh, then $S/deploy.sh"
  else
    NEWEST="$(q acr repository show-tags -n "$ACR" --repository voice-agent-portal --orderby time_desc --top 1)"
    if [[ -z "$NEWEST" ]]; then
      bad MISSING "Portal image in registry $ACR" "build.sh did not finish."; next "$S/build.sh, then $S/deploy.sh"
    else
      ok "Registry $ACR, newest image voice-agent-portal:$NEWEST"
    fi
  fi
  ENV_STATE="$(q containerapp env show -n "$NAME-env" -g "$RG" --query properties.provisioningState)"
  case "$ENV_STATE" in
    "") bad MISSING "Container Apps environment $NAME-env" "Created by deploy.sh."; next "$S/deploy.sh" ;;
    Succeeded) ok "Container Apps environment $NAME-env" ;;
    *) bad FAIL "Container Apps environment $NAME-env is '$ENV_STATE'" "Wait a few minutes, then run status.sh again; if it stays, run deploy.sh again."; next "$S/deploy.sh" ;;
  esac
  ID_PRINCIPAL="$(q identity show -n "$NAME-id" -g "$RG" --query principalId)"
  if [[ -z "$ID_PRINCIPAL" ]]; then
    bad MISSING "Managed identity $NAME-id" "Created by deploy.sh."; next "$S/deploy.sh"
  else
    ok "Managed identity $NAME-id"
  fi
fi

# ---------- roles of the portal's identity ----------
if [[ -n "$ID_PRINCIPAL" && -n "$ACR_ID" ]]; then
  IFS=$'\t' read -r _ PROJECT_ID ACCOUNT_ID < <(python3 "$SETUP" projects --endpoint "$PROJECT_ENDPOINT" 2>/dev/null || true)
  if [[ -z "${PROJECT_ID:-}" ]]; then
    bad FAIL "Foundry project $PROJECT_ENDPOINT is not visible to this sign-in" \
      "Rerun $S/prepare.sh and answer n at 'Is this right?' to choose a project you can see."
  else
    while IFS='|' read -r role_id role scope why need <&4; do
      if [[ -n "$(q role assignment list --scope "$scope" --fill-principal-name false --fill-role-definition-name false \
          --query "[?principalId=='$ID_PRINCIPAL' && ends_with(roleDefinitionId, '$role_id')].id | [0]")" ]]; then
        ok "Role '$role' on ${scope##*/} ($why)"
      elif [[ "$need" == required ]]; then
        bad FAIL "Role '$role' on ${scope##*/} is missing ($why)" "Run deploy.sh again; if you cannot grant roles, send ~/voice-agent-portal-admin-steps.txt to an admin."
        next "$S/deploy.sh (or ask your admin for the roles)"
      else
        warn_ "Optional role '$role' on ${scope##*/} is missing ($why)"
      fi
    done 4< <(python3 "$SETUP" roles --registry-id "$ACR_ID" --project-id "$PROJECT_ID" --account-id "$ACCOUNT_ID")
  fi
fi

# ---------- the app: Azure's view ----------
FQDN="" EXTERNAL="" IPS="" ENTRA=false HEALTHY=false
if [[ "$(q group exists -n "$RG")" == "true" ]]; then
  APP_INFO="$(q containerapp show -n "$NAME" -g "$RG" --query "join('|', [properties.provisioningState || '', properties.runningStatus || '', to_string(properties.configuration.ingress.external), properties.configuration.ingress.fqdn || '', properties.template.containers[0].image || ''])")"
  if [[ -z "$APP_INFO" ]]; then
    bad MISSING "Container App $NAME" "Created by deploy.sh."; next "$S/deploy.sh"
  else
    APP=true
    IFS='|' read -r PROV RUN EXTERNAL FQDN IMAGE <<<"$APP_INFO"
    if [[ "$PROV" == Succeeded ]]; then ok "Container App $NAME ($RUN)"
    else bad FAIL "Container App $NAME is '$PROV'" "If a deployment is in progress, wait; otherwise run deploy.sh again."; next "$S/deploy.sh"; fi
    if [[ -n "$NEWEST" && "${IMAGE##*:}" != "$NEWEST" ]]; then
      warn_ "It runs image ${IMAGE##*:}, not the newest ($NEWEST)" "Run deploy.sh to move it to the newest image."
    fi
    REVS="$(q containerapp revision list -n "$NAME" -g "$RG" \
      --query "[?properties.active].join('|', [name, properties.healthState || '', properties.runningState || '', to_string(properties.replicas)])")"
    while IFS='|' read -r rev health state replicas; do
      [[ -n "$rev" ]] || continue
      if [[ "$health" == Healthy && "${replicas:-0}" != 0 && "$replicas" != null ]]; then
        HEALTHY=true; ok "Revision $rev: $health, $state, $replicas replica(s)"
      else
        bad FAIL "Revision $rev: health '$health', state '$state', replicas '$replicas'" \
          "See why: az containerapp logs show -n $NAME -g $RG --type system"
      fi
    done <<<"$REVS"
    [[ -n "$REVS" ]] || bad FAIL "No active revision" "Run deploy.sh again."
    $HEALTHY || next "az containerapp logs show -n $NAME -g $RG --type system   (then $S/deploy.sh)"

    # ---------- who can open it ----------
    IPS="$(q containerapp ingress access-restriction list -n "$NAME" -g "$RG" --query "[?action=='Allow'].ipAddressRange" | paste -sd, -)"
    [[ "$(q containerapp auth show -n "$NAME" -g "$RG" --query "to_string(platform.enabled)")" == "true" ]] && ENTRA=true
    if [[ "$EXTERNAL" != "true" ]]; then
      bad FAIL "No public address yet (internal only)" "deploy.sh adds it last, after the protection; run deploy.sh again."; next "$S/deploy.sh"
    elif $ENTRA; then
      ok "Microsoft Entra sign-in is on${IPS:+, and only from $IPS}"
    elif [[ -n "$IPS" ]]; then
      ok "Only these addresses can open it: $IPS"
      [[ "$AUTH" != ip || "$IPS" == "$SAVED_IPS" ]] || warn_ "Saved addresses differ: $SAVED_IPS" "Run deploy.sh to apply what prepare.sh saved."
    else
      bad FAIL "Anyone with the address can open it (no IP list, no sign-in)" "Run deploy.sh to apply the protection prepare.sh saved."; next "$S/deploy.sh"
    fi
  fi
fi

# ---------- the app: does it answer here? ----------
CODE=""
if $APP && [[ -n "$FQDN" && "$EXTERNAL" == "true" ]]; then
  CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "https://$FQDN/healthz" || true)"
  case "$CODE" in
    200) ok "https://$FQDN answers from this machine (HTTP 200)" ;;
    403) if $HEALTHY; then ok "https://$FQDN refuses this machine (HTTP 403): its address is not in the list" \
           "Expected in Cloud Shell. Open the portal from your office network or VPN."
         else bad FAIL "https://$FQDN answers 403 and Azure does not report it healthy"; fi ;;
    302|401) ok "https://$FQDN asks for Microsoft Entra sign-in (HTTP $CODE)" ;;
    *) bad FAIL "https://$FQDN did not answer (HTTP ${CODE:-none})" "See: az containerapp logs show -n $NAME -g $RG --follow" ;;
  esac
fi

echo
if $HEALTHY && [[ $PROBLEMS -eq 0 ]]; then
  echo "Running. Open https://$FQDN/editor/ $( $ENTRA && echo 'and sign in with your work account.' || echo 'from your office network or VPN.')"
  exit 0
fi
echo "Not running yet: $PROBLEMS problem(s) above."
[[ -z "$NEXT" ]] || echo "Next: $NEXT"
exit 1
