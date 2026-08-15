# Contributing

Thanks for looking. This is a personal project that turned out to be generally
useful, so contributions are welcome but the bar is "would I want to maintain
this in a year".

## Getting set up

```bash
git clone https://github.com/eternalAbyss/Cognitive-mirror.git
cd Cognitive-mirror
pnpm install
cp .env.example .env      # add ANTHROPIC_API_KEY if you're touching the daemon
pnpm up                   # Docker data plane + all five services + the UI
```

Node 22+ and Docker are required. `pnpm doctor`'s equivalent is
`pnpm cli doctor` — it reports what's missing rather than hanging.

Before pushing:

```bash
pnpm lint && pnpm typecheck && pnpm test
```

`pnpm format` applies the formatter. CI runs the same three commands on Node 22
and 24, plus a build-and-install of the published tarball.

## The shape of the codebase

A few invariants are worth knowing before you change anything:

**One writer.** `apps/graph-core` is the only thing that talks to FalkorDB. The
daemon and the MCP server both go through its `/execute` endpoint. If you find
yourself opening a database connection somewhere else, that's the wrong turn.

**Every mutation is one batch.** `executeOps` applies each sub-op with a
compensating inverse and rolls the whole batch back on any failure, because
FalkorDB can't wrap a multi-statement batch in a transaction. New op kinds need
an inverse.

**Ops are schema-validated in one place.** `packages/shared/src/ops.ts`. Property
names are constrained there deliberately — the rollback path interpolates them
into Cypher, so that schema is a security boundary, not a formality.

**Config is centralised and typed.** Add new settings to
`packages/shared/src/config.ts`, never read `process.env` directly. A setting
that isn't in that schema doesn't exist: the budget breaker was inert for months
because `MODEL_PRICES` was read from `process.env` and never declared.

## Testing

`vitest`, run from the root. Tests live in `<package>/test/`.

The interesting question is what's worth testing. Roughly:

- **Yes** for anything with an invariant a future change could quietly break —
  schema validation, the queue's state machine, the budget breaker, OAuth.
- **Yes** for every bug fix. Add the failing case first.
- **No** for the WebGL engine. It needs a GPU context to say anything true, so
  it's verified by running it and looking at it.

Test the negative case, especially for anything security-shaped. "The right
token works" is half a test; "the wrong one is rejected" is the other half.

## Packaging

`apps/cli` is the only published package. Everything else is bundled into it.

If you add a runtime dependency to any service, the build will fail until you
also declare it in `apps/cli/package.json` — that check exists because pnpm's
workspace links hide missing declarations until someone actually installs from
npm. Every packaging bug this project has had was invisible until a tarball was
installed outside the repo, so:

```bash
pnpm --filter cognitive-mirror build
cd apps/cli && npm pack --pack-destination /tmp
mkdir -p /tmp/t && cd /tmp/t && npm init -y && npm install /tmp/cognitive-mirror-*.tgz
./node_modules/.bin/cognitive-mirror up
```

CI does this too, but it's much faster to find out locally.

## Style

Formatting is Biome's problem, not yours — run `pnpm format`.

What matters more: **comments should explain why, not what.** The code already
says what it does. A comment earns its place by capturing the reason a
non-obvious choice was made — the constraint, the failure it prevents, the
alternative that didn't work. If a future reader would otherwise "simplify" your
code back into a bug, say so.

Two known gaps you'll see in the config, so you don't think they're accidents:

- `apps/visualiser/components/CognitiveMirror.tsx` has a11y rules disabled. The
  component has clickable non-interactive elements and untitled SVGs. This is a
  real gap, tracked, and a good first contribution.
- `noUnusedTemplateLiteral` is off globally: Cypher queries are consistently
  written as template literals whether or not they interpolate, and flipping
  between the two forms as a query gains parameters is worse than the rule.

## Pull requests

Say what changed and why, and what you actually ran to check it. For anything
touching the graph, the services, or packaging, "it builds" isn't verification —
run it.

## Security

Don't open a public issue for a vulnerability. See [SECURITY.md](SECURITY.md).

## Code of conduct

[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Short version: be decent.
