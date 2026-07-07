#!/usr/bin/env bash
#
# down.sh — stop EVERYTHING this project is running:
#   1. the app services / visualiser (whatever holds ports 4001-4005),
#   2. the Docker data plane (FalkorDB + Ollama).
#
# Data is preserved: Docker named volumes and the local .data/ directory are
# left intact. To wipe the graph + queue + budget state, use `pnpm reset`.
set -uo pipefail
cd "$(dirname "$0")/.."

echo "▶ stopping app services on ports 4001-4005…"
for port in 4001 4002 4003 4004 4005; do
  pids="$(lsof -ti tcp:"$port" 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    echo "    port $port → stopping PID(s): $pids"
    # shellcheck disable=SC2086
    kill $pids 2>/dev/null || true
  fi
done

# Killing the port owners leaves the dev supervisor tree (concurrently + the pnpm
# wrappers) alive when it was detached from a terminal, so tear that down too.
# Patterns are scoped to this project's runners; `down` never matches `dev`.
echo "▶ stopping dev supervisor (concurrently + pnpm wrappers)…"
pkill -f "concurrently -n graph," 2>/dev/null || true
pkill -f "pnpm.cjs --filter @cm/" 2>/dev/null || true
pkill -f "pnpm.cjs dev" 2>/dev/null || true

echo "▶ stopping Docker data plane (FalkorDB + Ollama)…"
docker compose down

echo "✓ all project processes stopped (data preserved — run 'pnpm reset' to wipe)."
