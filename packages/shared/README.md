# @cm/shared

Types and cross-cutting concerns every service needs.

| | |
|---|---|
| `schema.ts` | Node and edge types, and the `NewNode` shape |
| `ops.ts` | `GraphOp` — the mutation vocabulary, and the schema every write passes through |
| `config.ts` | The zod-validated environment, `CM_HOME` resolution, and hot reload |
| `env-file.ts` | Writes `.env` in place for the dashboard's settings editor |
| `logger.ts` | pino, writing to **stderr** so the stdio MCP protocol stream stays clean |
| `keychain.ts` | Best-effort macOS Keychain reads, so secrets needn't sit in `.env` |
| `notify.ts` | ntfy push for budget trips and failed jobs |
| `ingest.ts` | The ingestion payload shape |

Two things here are load-bearing beyond their size:

**`ops.ts` is a security boundary.** Property names are constrained to plain
identifiers because graph-core's rollback path interpolates them into Cypher, and
a set of protected keys (`id`, `type`, `archived`, `createdAt`, `externalId`,
`summary_embedding`) can't be patched at all — each one is an invariant something
else depends on.

**`config.ts` hot-reloads.** The cache is keyed on the `.env` file's mtime+size rather
than being invalidated by a watcher, so a settings change made in the dashboard
takes effect in every service on its next config access — no IPC, no restart.
This only works because call sites call `loadConfig()` *inside* a function rather
than capturing at module scope; keep it that way. Anything genuinely read once at
boot (a bound port, a registered cron, an open connection pool) can't hot-reload,
and `IMMUTABLE_KEYS` in `env-file.ts` refuses to write those at all rather than
pretending.

Precedence survives the reload: a value exported in the shell still beats the
file. The loader only writes a key into `process.env` when it is unset or still
holds exactly what the loader last put there. An earlier attempt compared against
a snapshot of `process.env` taken at import, which looks equivalent and is not —
it treats everything assigned *after* import as fair game, and quietly clobbered
it.

**`config.ts` is the only place `process.env` is read.** A setting that isn't in
that schema effectively doesn't exist: the budget breaker was inert for months
because `MODEL_PRICES` was read directly from `process.env` and never declared.
