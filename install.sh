#!/usr/bin/env sh
# install.sh <path/to/rs-sdk> [--dry-run] [--no-bun-install] [--force]: wrapper around install.ts (needs bun: https://bun.sh)
set -e
command -v bun >/dev/null 2>&1 || { echo "bun is required: https://bun.sh" >&2; exit 2; }
exec bun "$(dirname "$0")/install.ts" "$@"
