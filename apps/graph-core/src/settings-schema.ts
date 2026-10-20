/**
 * The settings the dashboard exposes, grouped the way an operator thinks about
 * them rather than the way `.env` happens to be ordered.
 *
 * `live` is the honest claim, not an aspiration. `loadConfig()` re-reads `.env`
 * whenever it changes (see packages/shared/src/config.ts), so any setting read
 * inside a function takes effect on the next use with no restart. A setting
 * captured once at boot — a bound port, a registered cron, an open database
 * connection — cannot, and is marked `restart` so the UI can say so instead of
 * pretending. Settings that cannot be written at all are refused outright by
 * `IMMUTABLE_KEYS` in the shared env writer.
 */
export type FieldKind = "text" | "number" | "secret" | "boolean" | "textarea";

export interface SettingField {
  key: string;
  label: string;
  kind: FieldKind;
  hint?: string;
  /** false when the value is only read at startup and needs a restart to apply. */
  live: boolean;
  placeholder?: string;
}

export interface SettingGroup {
  id: string;
  label: string;
  /** Key for the icon drawn in the bar; rendered by the client. */
  icon: string;
  blurb: string;
  fields: SettingField[];
}

export const SETTING_GROUPS: SettingGroup[] = [
  {
    id: "access",
    label: "Keys & access",
    icon: "key",
    blurb: "Credentials the reasoning path and ingestion webhook authenticate with.",
    fields: [
      {
        key: "ANTHROPIC_API_KEY",
        label: "Anthropic API key",
        kind: "secret",
        live: true,
        hint: "Read per call — a new key is in effect immediately. May also come from the macOS Keychain.",
      },
      {
        key: "GITHUB_TOKEN",
        label: "GitHub token",
        kind: "secret",
        live: true,
        hint: "Used by repo ingestion and the trending source.",
      },
      {
        key: "INGEST_TOKEN",
        label: "Ingest webhook token",
        kind: "secret",
        live: true,
        hint: "Checked on every /ingest request. Empty means the webhook refuses everything unless anonymous ingest is on.",
      },
      {
        key: "ALLOW_ANONYMOUS_INGEST",
        label: "Allow anonymous ingest",
        kind: "boolean",
        live: true,
        hint: "Local development only — it opens an unauthenticated write endpoint.",
      },
    ],
  },
  {
    id: "models",
    label: "Models",
    icon: "brain",
    blurb: "Which model runs at each tier of the reasoning path.",
    fields: [
      {
        key: "MODEL_ENRICH",
        label: "Enrich",
        kind: "text",
        live: true,
        hint: "Cheapest tier — runs on every captured item.",
      },
      { key: "MODEL_ADJUDICATE", label: "Adjudicate", kind: "text", live: true },
      {
        key: "MODEL_INSIGHT",
        label: "Insight",
        kind: "text",
        live: true,
        hint: "The marquee output. Most expensive tier.",
      },
      {
        key: "MODEL_PRICES",
        label: "Price overrides",
        kind: "textarea",
        live: true,
        placeholder: '{"claude-opus-4-8":{"in":5,"out":25}}',
        hint: "USD per million tokens, merged over the built-in table. A model with no price is costed at $0 and cannot trip the budget breaker.",
      },
    ],
  },
  {
    id: "budget",
    label: "Budget",
    icon: "coin",
    blurb: "Spend ceilings for the circuit breaker, in USD.",
    fields: [
      { key: "DAILY_BUDGET_USD", label: "Daily cap", kind: "number", live: true },
      { key: "MONTHLY_BUDGET_USD", label: "Monthly cap", kind: "number", live: true },
    ],
  },
  {
    id: "embeddings",
    label: "Embeddings",
    icon: "vector",
    blurb: "How text is turned into vectors for semantic search.",
    fields: [
      { key: "OLLAMA_URL", label: "Ollama URL", kind: "text", live: true },
      {
        key: "EMBED_MODEL",
        label: "Embedding model",
        kind: "text",
        live: true,
        hint: "Changing this makes new vectors incomparable with existing ones unless you re-embed.",
      },
      { key: "CHUNK_TOKENS", label: "Chunk size (tokens)", kind: "number", live: true },
      { key: "CHUNK_OVERLAP", label: "Chunk overlap (tokens)", kind: "number", live: true },
    ],
  },
  {
    id: "sources",
    label: "Sources",
    icon: "inbox",
    blurb: "Where the world brief and repo ingestion pull from.",
    fields: [
      {
        key: "GITHUB_REPOS",
        label: "GitHub repos",
        kind: "text",
        live: true,
        placeholder: "owner/repo, owner/other",
        hint: "Comma-separated.",
      },
      {
        key: "ARXIV_CATEGORIES",
        label: "arXiv categories",
        kind: "text",
        live: true,
        placeholder: "cs.AI,cs.LG",
      },
      {
        key: "RSS_FEEDS",
        label: "RSS / Atom feeds",
        kind: "textarea",
        live: true,
        hint: "Comma-separated feed URLs.",
      },
      {
        key: "GITHUB_POLL_INTERVAL_MS",
        label: "Repo poll interval (ms)",
        kind: "number",
        live: false,
        hint: "The poll timer is set up at startup.",
      },
    ],
  },
  {
    id: "brief",
    label: "Daily brief",
    icon: "sun",
    blurb: "The morning world brief and how selective it is.",
    fields: [
      {
        key: "BRIEF_THRESHOLD",
        label: "Relevance threshold",
        kind: "number",
        live: true,
        hint: "Minimum cosine similarity to one of your concepts for a candidate to survive.",
      },
      { key: "BRIEF_MAX_OBSERVATIONS", label: "Max observations", kind: "number", live: true },
      {
        key: "BRIEF_MAX_AGE_HOURS",
        label: "Refresh news after (hours)",
        kind: "number",
        live: true,
        hint: "A staleness trigger, not a schedule — opening the dashboard pulls a fresh brief once the news is older than this.",
      },
      {
        key: "BRIEF_CRON",
        label: "Schedule (cron)",
        kind: "text",
        live: false,
        placeholder: "0 7 * * *",
        hint: "Registered with the scheduler at startup.",
      },
    ],
  },
  {
    id: "maintenance",
    label: "Maintenance",
    icon: "broom",
    blurb: "The nightly engine that merges, archives and synthesises.",
    fields: [
      {
        key: "MERGE_CANDIDATE_DISTANCE",
        label: "Merge distance",
        kind: "number",
        live: true,
        hint: "Cosine DISTANCE — lower is closer. Calibrated for nomic-embed-text.",
      },
      { key: "MAX_INSIGHTS_PER_RUN", label: "Max insights per run", kind: "number", live: true },
      { key: "ARCHIVE_INACTIVITY_DAYS", label: "Archive after (days)", kind: "number", live: true },
      { key: "CONCEPT_TARGET_MIN", label: "Concept target — min", kind: "number", live: true },
      { key: "CONCEPT_TARGET_MAX", label: "Concept target — max", kind: "number", live: true },
      {
        key: "MAINTENANCE_CRON",
        label: "Schedule (cron)",
        kind: "text",
        live: false,
        placeholder: "30 3 * * *",
        hint: "Registered with the scheduler at startup.",
      },
    ],
  },
  {
    id: "notify",
    label: "Alerts",
    icon: "bell",
    blurb: "Health notifications over ntfy.",
    fields: [
      { key: "NTFY_URL", label: "ntfy server", kind: "text", live: true },
      {
        key: "NTFY_TOPIC",
        label: "Topic",
        kind: "text",
        live: true,
        hint: "Empty disables notifications entirely.",
      },
      {
        key: "HEALTH_INTERVAL_MS",
        label: "Health probe interval (ms)",
        kind: "number",
        live: false,
        hint: "The probe timer is set up at startup.",
      },
    ],
  },
  {
    id: "storage",
    label: "Data store",
    icon: "database",
    blurb: "FalkorDB connection. The pool is opened once, so these need a restart.",
    fields: [
      { key: "FALKORDB_HOST", label: "Host", kind: "text", live: false },
      { key: "FALKORDB_PORT", label: "Port", kind: "number", live: false },
      { key: "FALKORDB_GRAPH", label: "Graph name", kind: "text", live: false },
    ],
  },
];

/** Every key the dashboard is allowed to write, for validating a PATCH. */
export const WRITABLE_KEYS = new Set(SETTING_GROUPS.flatMap((g) => g.fields.map((f) => f.key)));

/** Secrets are never sent to the browser — only whether they're set. */
export const SECRET_KEYS = new Set(
  SETTING_GROUPS.flatMap((g) => g.fields.filter((f) => f.kind === "secret").map((f) => f.key)),
);
