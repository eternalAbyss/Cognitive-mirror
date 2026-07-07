#!/usr/bin/env bash
#
# up.sh — start the ENTIRE Cognitive-mirror stack with one command:
#   1. the data plane (FalkorDB + Ollama) in Docker,
#   2. the embedding model (pulled on first run only),
#   3. all app services + the visualiser, in the foreground.
#
# Ctrl-C stops the app services; the Docker data plane keeps running
# (use `pnpm down` to stop that too). Data is never wiped here.
set -euo pipefail
cd "$(dirname "$0")/.."

# Resolve the embedding model from .env if present (falls back to the default).
EMBED_MODEL="$(grep -E '^EMBED_MODEL=' .env 2>/dev/null | cut -d= -f2- | tr -d '"' | tr -d "'" | xargs || true)"
EMBED_MODEL="${EMBED_MODEL:-nomic-embed-text}"

echo "▶ starting data plane (FalkorDB + Ollama)…"
docker compose up -d

echo -n "▶ waiting for FalkorDB"
until docker exec cm-falkordb redis-cli PING >/dev/null 2>&1; do echo -n "."; sleep 1; done
echo " ready"

echo -n "▶ waiting for Ollama"
until curl -sf http://127.0.0.1:11434/api/tags >/dev/null 2>&1; do echo -n "."; sleep 1; done
echo " ready"

if ! docker exec cm-ollama ollama list 2>/dev/null | grep -q "$EMBED_MODEL"; then
  echo "▶ pulling embedding model '$EMBED_MODEL' (first run only)…"
  docker exec cm-ollama ollama pull "$EMBED_MODEL"
fi

echo "▶ launching services:"
echo "    graph-core :4001   ingestion :4002   mcp :4003   visualiser :4004   daemon :4005"
exec pnpm dev:all
