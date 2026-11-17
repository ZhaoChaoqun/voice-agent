# Copyright (c) Microsoft. All rights reserved.
# Shared by prepare.sh, build.sh and deploy.sh (sourced, not run).
LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$LIB_DIR/../../.." && pwd)"
SETUP="$REPO_ROOT/portal/setup_azure.py"
# prepare.sh saves every value here; build.sh and deploy.sh read them, so they need no options.
ENV_FILE="${PORTAL_ENV_FILE:-$REPO_ROOT/portal/.env}"

log() { printf '\n==> %s\n' "$*" >&2; }
warn() { printf 'WARNING: %s\n' "$*" >&2; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

command -v python3 >/dev/null || die "python3 is required (Azure Cloud Shell has it)."
command -v az >/dev/null || die "The Azure CLI (az) is required: use Azure Cloud Shell, or install it from https://aka.ms/installazurecli."

# One saved setting ('endpoint' = the Foundry project endpoint).
setting() { python3 "$SETUP" --env-file "$ENV_FILE" get "$1"; }

# Every az call shows its output as usual and, if it fails, explains the error in plain words
# (which role is missing and who can grant it, a blocking policy, an unregistered provider...).
# Requires `set -o pipefail` in the calling script.
az() {
  local err rc=0
  err="$(mktemp)"
  { command az "$@" 2>&1 1>&3 3>&- | tee "$err" 1>&2; } 3>&1 || rc=$?
  if (( rc != 0 )); then python3 "$SETUP" explain "$err" >&2 || true; fi
  rm -f "$err"
  return $rc
}
