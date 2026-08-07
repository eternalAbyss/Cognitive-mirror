# reasoning-daemon — the autonomous path

The part that thinks while you aren't watching. It's the only component that
calls the Anthropic API, and it never writes to FalkorDB directly — everything
goes through [graph-core](../graph-core).

Runs on `127.0.0.1:4005` (status and research endpoints).

## What it does

| | When | Model tier |
|---|---|---|
| **Enrichment** | Whenever the queue has work | Haiku — high volume, mechanical distillation |
| **Daily brief** | `BRIEF_CRON`, 07:00 by default | Haiku + scoring against your concepts |
| **Nightly maintenance** | `MAINTENANCE_CRON`, 03:30 by default | Sonnet to adjudicate, Opus for insights |
| **Live research** | On demand, via the `research_topic` MCP tool | Sonnet + web search |

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
