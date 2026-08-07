# @cm/shared

Types and cross-cutting concerns every service needs.

| | |
|---|---|
| `schema.ts` | Node and edge types, and the `NewNode` shape |
| `ops.ts` | `GraphOp` — the mutation vocabulary, and the schema every write passes through |
| `config.ts` | The zod-validated environment, and `CM_HOME` resolution |
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

**`config.ts` is the only place `process.env` is read.** A setting that isn't in
that schema effectively doesn't exist: the budget breaker was inert for months
because `MODEL_PRICES` was read directly from `process.env` and never declared.
