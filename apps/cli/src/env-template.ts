/**
 * The `.env` written by `cognitive-mirror init`.
 *
 * Kept here rather than shipped as a file copy so the published package stays
 * self-contained, and so the comments can speak to someone who installed the
 * CLI rather than someone reading the repo.
 */
export const ENV_TEMPLATE = `# Cognitive-mirror configuration.
# Every value here has a working default — you only need the API key.
# Full reference: https://github.com/eternalAbyss/Cognitive-mirror#configuration

# ── Secrets ────────────────────────────────────────────────────────────────
# Needed for enrichment, the daily brief, nightly maintenance, and research.
# On macOS you can keep this out of the file entirely:
#   security add-generic-password -a "$USER" -s cm-anthropic-api-key -w "sk-ant-..."
ANTHROPIC_API_KEY=

# Optional: a classic PAT or fine-grained token with repo read access, to
# ingest your commits. Keychain item: cm-github-token
GITHUB_TOKEN=
GITHUB_REPOS=

# ── Data plane ─────────────────────────────────────────────────────────────
FALKORDB_HOST=127.0.0.1
FALKORDB_PORT=6379
FALKORDB_GRAPH=cognitive_mirror
OLLAMA_URL=http://127.0.0.1:11434
EMBED_MODEL=nomic-embed-text
EMBED_DIM=768

# ── Budget breaker ─────────────────────────────────────────────────────────
# Hard caps on Anthropic spend. Prices for the models below are built in.
DAILY_BUDGET_USD=5
MONTHLY_BUDGET_USD=100
MODEL_ENRICH=claude-haiku-4-5-20251001
MODEL_ADJUDICATE=claude-sonnet-4-6
MODEL_INSIGHT=claude-opus-4-8

# ── Ingestion webhook ──────────────────────────────────────────────────────
# The /ingest endpoint FAILS CLOSED: with no token it returns 401. Give the
# same value to the Apple Shortcut and the browser extension, sent as
# \`Authorization: Bearer <token>\`.
INGEST_TOKEN=
# Set true ONLY for local experimentation to accept unauthenticated posts.
ALLOW_ANONYMOUS_INGEST=false

# ── Off-device access (optional) ───────────────────────────────────────────
# Setting MCP_PUBLIC_URL turns on OAuth and makes it MANDATORY — the MCP server
# refuses to start without a passphrase hash. Set that with:
#   cognitive-mirror auth set-passphrase
# See: https://github.com/eternalAbyss/Cognitive-mirror/blob/main/apps/tunnel/README.md
MCP_PUBLIC_URL=
MCP_AUTH_PASSPHRASE_HASH=

# ── Schedules ──────────────────────────────────────────────────────────────
BRIEF_CRON=0 7 * * *
MAINTENANCE_CRON=30 3 * * *
ARXIV_CATEGORIES=cs.AI,cs.LG,cs.CL
RSS_FEEDS=

# ── Notifications (optional) ───────────────────────────────────────────────
# Set a topic to get push alerts for budget trips and failed jobs via ntfy.sh.
NTFY_TOPIC=
`;
