#!/usr/bin/env bash
#
# Prepare a QA account with enough reward points to demonstrate redemption.
#
# WHY THIS IS A SHELL SCRIPT AND NOT A BUTTON IN THE APP
# ------------------------------------------------------
# The backend exposes `POST /dev/rewards/grant`, but only behind
# `DEV_TOOLS_ENABLED=true`, which the server refuses to boot with outside
# `development`/`test`. Calling it from the mobile client would mean shipping
# the code path to credit a wallet inside every build of the app - including
# the release APK handed to founders. Even gated behind `__DEV__` that is a
# "give me 1500 points" affordance living one flag away from production, and
# a reviewer reading the bundle could not tell it apart from a real earn path.
#
# So the demo shortcut lives here instead: outside the app, run by an
# operator, against a local server they control. The mobile client contains
# no dev-tools route at all - see the header of
# `src/services/rewards/rewards-service.ts`.
#
# It also does NOT weaken any backend gate. If `DEV_TOOLS_ENABLED` is off the
# server answers 404 `DEV_TOOLS_DISABLED` and this script simply reports that.
#
# The grant is a REAL ledger movement, not a poked number: same append-only
# entry, same idempotency key, same `balanceAfter` arithmetic as a check-in.
# Re-running it with the same key credits nothing a second time, which is why
# the key is required even here.
#
# USAGE
#   ./scripts/dev-grant-reward-points.sh <email> <password> [points] [api-base-url]
#
# EXAMPLE (local demo backend on the LAN)
#   ./scripts/dev-grant-reward-points.sh qa@example.com 'Passw0rd!' 1500 http://192.168.1.20:3000
#
# The backend must be running with REWARDS_ENABLED=true and
# DEV_TOOLS_ENABLED=true.

set -euo pipefail

EMAIL="${1:-}"
PASSWORD="${2:-}"
POINTS="${3:-1500}"
API_BASE_URL="${4:-${EXPO_PUBLIC_API_BASE_URL:-http://localhost:3000}}"

if [[ -z "$EMAIL" || -z "$PASSWORD" ]]; then
  echo "usage: $0 <email> <password> [points] [api-base-url]" >&2
  exit 64
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "error: jq is required (brew install jq)" >&2
  exit 69
fi

API_BASE_URL="${API_BASE_URL%/}"

echo "==> signing in as $EMAIL at $API_BASE_URL"
LOGIN_RESPONSE="$(curl -fsS -X POST "$API_BASE_URL/auth/login" \
  -H 'Content-Type: application/json' \
  -d "$(jq -nc --arg e "$EMAIL" --arg p "$PASSWORD" '{email:$e,password:$p}')")"

ACCESS_TOKEN="$(printf '%s' "$LOGIN_RESPONSE" | jq -r '.accessToken // empty')"

if [[ -z "$ACCESS_TOKEN" ]]; then
  echo "error: login succeeded but returned no accessToken" >&2
  exit 65
fi

# Stamped with the point value so re-running with a DIFFERENT amount is a new
# grant, while re-running the same command is an idempotent no-op rather than
# a second credit. Charset matches the server's [A-Za-z0-9_:-]{8,128} rule.
IDEMPOTENCY_KEY="demo-grant-$(date +%Y%m%d)-${POINTS}"

echo "==> granting $POINTS points (key: $IDEMPOTENCY_KEY)"
GRANT_RESPONSE="$(curl -fsS -X POST "$API_BASE_URL/dev/rewards/grant" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d "$(jq -nc --argjson pts "$POINTS" --arg key "$IDEMPOTENCY_KEY" \
        '{points:$pts,idempotencyKey:$key}')")"

echo "==> wallet now:"
printf '%s\n' "$GRANT_RESPONSE" | jq '{balancePoints, lifetimeEarnedPoints, version, updatedAt}'

echo
echo "Reconcile (ledger sum vs projection):"
curl -fsS "$API_BASE_URL/dev/rewards/reconcile" \
  -H "Authorization: Bearer $ACCESS_TOKEN" | jq '.'
