#!/usr/bin/env bash
#
# Regression guard for the CI failure mode where `tsc --noEmit` passes
# locally (because Expo has already generated `expo-env.d.ts`) but fails on
# a fresh checkout (where `expo-env.d.ts` does not exist, since it is
# gitignored).
#
# This script simulates a fresh checkout by temporarily hiding
# `expo-env.d.ts` (if present), running `tsc --noEmit`, then restoring the
# file (even on failure/interrupt), and fails the check if `tsc` fails.
#
# Usage:
#   ./scripts/check-fresh-checkout-typecheck.sh
#
# Note: the mobile CI workflow (`.github/workflows/ci.yml`) already runs
# `npm run typecheck` against a genuinely fresh `npm ci` checkout on every
# push/PR, which is the standing guard for this failure mode. This script
# lets you reproduce that condition locally before pushing.

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

ENV_FILE="expo-env.d.ts"
TMP_BACKUP="$(mktemp -t expo-env.d.ts.XXXXXX)"
MOVED=0

restore() {
  if [ "$MOVED" -eq 1 ]; then
    mv "$TMP_BACKUP" "$ENV_FILE"
    echo "Restored $ENV_FILE"
  else
    rm -f "$TMP_BACKUP"
  fi
}
trap restore EXIT

if [ -f "$ENV_FILE" ]; then
  mv "$ENV_FILE" "$TMP_BACKUP"
  MOVED=1
  echo "Temporarily removed $ENV_FILE to simulate a fresh checkout..."
else
  echo "$ENV_FILE not present; already simulating a fresh checkout."
fi

echo "Running: npx tsc --noEmit"
if npx tsc --noEmit; then
  echo "PASS: typecheck succeeds without a locally generated $ENV_FILE."
  exit 0
else
  echo "FAIL: typecheck fails without a locally generated $ENV_FILE." >&2
  echo "This reproduces the fresh-checkout CI failure mode." >&2
  exit 1
fi
