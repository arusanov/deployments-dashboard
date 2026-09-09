#!/usr/bin/env bash
# Explicitly seed and prepare the demo with API writers stopped.
set -euo pipefail

if [[ $# -gt 1 || ($# -eq 1 && $1 != --reset) ]]; then
  echo "Usage: bash scripts/demo.sh [--reset]" >&2
  exit 2
fi

cd "$(dirname "${BASH_SOURCE[0]}")/.."
compose=(docker compose --project-directory "$PWD" -f "$PWD/docker-compose.yml")
# Do not activate the seed service during the final ordinary startup.
export COMPOSE_PROFILES=
child=

interrupt() {
  if [[ -n $child ]]; then
    kill -TERM "$child" 2>/dev/null || true
    wait "$child" 2>/dev/null || true
  fi
  exit "$1"
}
trap 'interrupt 130' INT
trap 'interrupt 143' TERM

run() {
  local status=0
  "${compose[@]}" "$@" &
  child=$!
  wait "$child" || status=$?
  child=
  return "$status"
}

run stop frontend backend
run run --build --rm seed python /seed/seed.py "$@"
run run --build --rm backend-init
run up --build -d --wait
