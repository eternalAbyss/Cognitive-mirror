# @cm/graph-client

A typed HTTP client for [graph-core](../../apps/graph-core). Used by the
reasoning daemon and the MCP server, which is how the single-writer rule is kept:
neither of them can reach FalkorDB except through this.

Thin by design — no caching, no retries, no local state. If you find yourself
wanting logic here, it probably belongs in graph-core where the database is.
