# reasoning-daemon — the autonomous path

The part that thinks while you aren't watching. It's the only component that
calls the Anthropic API, and it never writes to FalkorDB directly — everything
goes through [graph-core](../graph-core).

Runs on `127.0.0.1:4005` (status, answer and research endpoints).

## What it does

| | When | Model tier |
|---|---|---|
| **Enrichment** | Whenever the queue has work | Haiku — high volume, mechanical distillation |
| **Daily brief** | `BRIEF_CRON`, 07:00 by default — **plus** on demand when the dashboard finds the news older than `BRIEF_MAX_AGE_HOURS` | Haiku + scoring against your concepts |
| **Nightly maintenance** | `MAINTENANCE_CRON`, 03:30 by default | Sonnet to adjudicate, Opus for insights |
| **Live research** | On demand, via the `research_topic` MCP tool | Sonnet + web search |
| **Asking the graph** | On demand, whenever someone uses the dashboard's ask bar | Sonnet over retrieved nodes |

The brief's on-demand path lives in `news-freshness.ts` and is exposed as
`GET /news/freshness` and `POST /news/refresh`. It is a staleness trigger, not a
second schedule: nothing fires on a clock, the dashboard asks when someone looks.
Automatic refreshes dedup on a `BRIEF_MAX_AGE_HOURS`-wide time bucket so polling
can't stack briefs up — the dedup lives in the durable queue, so it survives a
restart. A forced refresh (the panel's button) uses a unique hash, because a
refresh that silently does nothing is worse than no button.

## Asking the graph

`answer.ts` + `POST /answer` are what make the dashboard's ask bar answer rather
than just retrieve. It is retrieval-augmented generation with the retrieval done
over the graph:

1. **Retrieve twice.** A vector search on the embedded question (over-fetched —
   graph-core filters *after* the index returns a global top-k, so a tight `k`
   loses real matches) alongside a literal text search. Exact names — "FalkorDB",
   "Van der Corput" — are precisely what embeddings blur away, so neither search
   alone is enough. Results merge on best score per node.
2. **Expand along edges.** The top four hits get a one-hop traverse. "What
   connects to what" is the question this graph exists to answer, so the edges
   have to be in the context, not just the summaries.
3. **Add the totals.** Whole-graph counts by type, which are exact, go in
   alongside the retrieved sample, which is not.
4. **Synthesise**, then resolve the model's citations back to node ids.

The retrieval here is deliberately **not** the visualiser's. The sphere animates
only the nodes it has placed (800 of them); an answer should not be capped by
what happens to be drawn. Both halves start from the same question, so the hops
you watch and the answer you read are about the same ideas.

**Grounding is the feature.** The prompt ranks its rules: ground every claim in
the retrieved nodes; when they do not answer the question, say so and name what
is missing rather than reaching for the nearest loosely-related note; never state
an exact count of a subset from a sample; and remember the graph holds what was
*ingested*, not a live connection to anybody's accounts. Asked "how many repos
are there in my github for machine learning", it answers that there is no live
GitHub connection, lists the ML repos that were ingested as "at least three", and
sends you to GitHub for the real total. A second brain that confabulates is worse
than one that admits the gap, because the gap is itself the finding.

The reply carries **`in_graph`** beside the answer and its citations: false when
the graph simply does not hold what was asked, true whenever it answered from
the graph — including a partial answer, and including one that had to say the
total could not be known. The visualiser turns a false into its "research this
on the web" offer, so the field is the difference between an explained gap and a
dead end. It defaults to **true** when the model omits it, because the failure
that matters is announcing a gap that isn't there.

Everything that can stop synthesis — no `ANTHROPIC_API_KEY`, an open budget
breaker, a failed call — returns `{ ok: false, reason }` rather than throwing.
The visualiser already has the raw hits on screen by then and falls back to
reading out the nearest node, labelled "retrieved" instead of "answered". No key
configured is a normal state for this project, not an error worth a red box.

**Enrichment** turns a captured artifact into durable concepts and the relations
between them — the reusable ideas, not a summary of the text.

**Maintenance** is the interesting one. It looks for concept pairs that are close
in embedding space and asks a model to decide: are these the same thing (merge),
in tension (record a contradiction), related across domains (create the gold
cross-domain edge), or neither? It also archives what's gone cold and generates
insights from cross-domain pairs.

Anything destructive that touches a note **you hand-edited** goes to the approval
queue instead of happening. Purely model-generated concepts are merged on the
model's own judgement — see [SECURITY.md](../../SECURITY.md) for why that's a
deliberate trade rather than an oversight.

## The budget breaker

`budget.ts` counts spend against a built-in price table and throws
`BudgetExceededError` once `DAILY_BUDGET_USD` or `MONTHLY_BUDGET_USD` is reached.
State is write-through persisted, so bouncing the process doesn't reset it.

A model with no price contributes $0 and is warned about loudly on first use.
That matters: the breaker was silently inert for months because the price table
was never populated, and a cap that quietly does nothing is worse than no cap.

Hitting the cap **releases** the job rather than failing it — the job was never
attempted, so it shouldn't burn a retry.

## Untrusted input

Everything this daemon feeds a model is third-party: READMEs, RSS bodies,
scraped descriptions, web-search results. It's fenced in the prompt and the model
is told to treat it as data, and the model's output still drives graph writes.
Read the trust model in [SECURITY.md](../../SECURITY.md) before extending this.
