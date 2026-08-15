# graph-core — the graph service

**The only thing that writes to FalkorDB.** The reasoning daemon and the MCP
server both go through this service's HTTP API; neither opens a database
connection of its own. That single-writer rule is what makes the atomicity and
op-log guarantees below possible at all.

Runs on `127.0.0.1:4001`.

## Why one writer

FalkorDB guarantees atomicity within a single Cypher query, but a meaningful
change is usually several — a merge is a create, some edge re-pointing, and a
tombstone. So `executeOps` applies each sub-op alongside a **compensating
inverse**, and if any sub-op throws, the inverses collected so far run in reverse.
Callers see all-or-nothing.

The one best-effort case is documented in `execute.ts`: edges re-pointed onto a
survivor during a merge are not un-pointed on rollback.

## The op log

Every batch writes one entry, with a 24-hour undo window for automated
destructive operations. Deletes are soft — `archived = true` — so "delete" is
always recoverable until maintenance prunes it.

## Notable files

| | |
|---|---|
| `execute.ts` | The mutation primitive: batches, compensating inverses, rollback |
| `repo.ts` | Reads — get, traverse, semantic/keyword search |
| `oplog.ts` | Append-only log + undo |
| `approvals.ts` | The consent queue for destructive actions on hand-edited notes |
| `maintenance.ts` | Queries backing the nightly engine (merge candidates, cross-domain pairs, archival) |
| `indexes.ts` | Index bootstrap — exact, full-text, and vector |
| `falkor.ts` | The FalkorDB connection and query helpers |

## A note on Cypher

Cypher has no bind parameter for a *property name* or a *label*, so those few
places interpolate. Every one of them either validates against an allowlist
(`NODE_TYPES`, `EDGE_TYPES`) or against the identifier pattern in
`cypherProperty`. Everything else — every id, every value — goes through `$params`.

If you add a query that interpolates anything, that is a security-relevant change
and needs the same treatment. See [CONTRIBUTING.md](../../CONTRIBUTING.md).
