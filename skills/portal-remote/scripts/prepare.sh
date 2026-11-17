#!/usr/bin/env bash
# Copyright (c) Microsoft. All rights reserved.
# Step 1 of 3: choose your Foundry project, where the portal runs and who may open it, check your
# permissions, and save it all in portal/.env. Creates nothing in Azure. Safe to rerun.
#   --reconfigure   choose everything again instead of reusing the saved values
#   other options (--project, --resource-group, --location, --auth, --allowed-ip ...): see --help
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
case "${1:-}" in -h|--help) python3 "$SETUP" pick --help; exit 0 ;; esac

python3 "$SETUP" --env-file "$ENV_FILE" pick --mode remote "$@"
python3 "$SETUP" --env-file "$ENV_FILE" check --mode remote || exit 1
printf '\nNext: skills/portal-remote/scripts/build.sh\n' >&2
