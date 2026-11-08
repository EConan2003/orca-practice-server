#!/bin/sh
# Smoke test: poll GET <base-url>/health for up to 30 s; succeed only on HTTP 200.
# Usage: deploy/smoke.sh [base-url]   (default: http://localhost:${PORT:-3000})
set -u
BASE_URL="${1:-http://localhost:${PORT:-3000}}"
URL="${BASE_URL%/}/health"
TIMEOUT=30
start=$(date +%s)
code=000
while :; do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "$URL" || true)
  if [ "$code" = "200" ]; then
    echo "smoke: GET $URL -> 200 after $(( $(date +%s) - start ))s"
    curl -s --max-time 2 "$URL"; echo
    exit 0
  fi
  if [ $(( $(date +%s) - start )) -ge "$TIMEOUT" ]; then
    echo "smoke: GET $URL did not return 200 within ${TIMEOUT}s (last status: $code)" >&2
    exit 1
  fi
  sleep 1
done
