# Visualiser — "The Cognitive Mirror"

> 📖 Part of Cognitive-mirror — see the [full documentation](../../docs/architecture.md) for
> architecture, setup, the API endpoints, and how this fits the whole system.

The navigable, real-time display layer — a Next.js app rendering the live graph and the
reasoning traces over it.

**Aesthetic:** **light monochrome** by default — a white void, dark wireframe knowledge sphere
behind frosted-white glass HUD panels (JetBrains Mono + Space Grotesk), with muted cyan
(`#0E86A8`) for "thinking" traces and gold for both cross-domain connections and "arriving"
syntheses. A dark theme inverts the grayscale ramps.

**Connection lines** are tubes, not lines — WebGL ignores `linewidth`, so thickness is the tube
radius. Three roles, distinguished by colour *and* weight so they stay readable at a glance:

| Role | Colour | Tube radius |
|---|---|---|
| Cross-domain `RELATES_TO` | gold — `#B07B16` light / `#D8A63E` dark | `0.007` |
| `CONTRADICTS` | crimson `#C2557A` | `0.011` — the heaviest, deliberately |
| Live query traversal | cyan `#0E86A8` | `0.008`, transient |

`0.007` was picked by looking at a real graph, not by taste. A mature graph has
well over a thousand cross-domain arcs, and they overlap: at `0.009` the sphere
fills in to an opaque gold shell that hides the nodes entirely, while `0.006`
(the original) reads as a hairline once a single arc is isolated. `0.007` keeps
individual strands traceable and the node dots visible through them. If you
change it, check against a populated graph — it looks fine at any width when
there are only a dozen edges.

Gold is theme-dependent: `#D8A63E` (the same gold as the synthesis flare) is illegible on the
white theme, so the light theme drops to a deeper, less luminous gold. `setTheme()` re-tints
existing arcs, which is why each one carries an `ArcRole` rather than a baked-in hex.

## What's implemented
- **Welcome / command glass:** live clock, weather card, 3-card Daily Brief, the Open-Loop
  resurfacing card, the "Ask your second brain…" command line, and the cockpit status bar.
- **Knowledge sphere:** a Three.js icosphere of glowing nodes in five domain clusters, named
  nodes with labels, gold cross-domain connection lines, depth-faded wireframe, drifting
  rotation, mouse parallax, and time-of-day tint.
- **"Watch Claude think":** the scripted query traversal (cyan packets → cross-domain hop →
  convergence ring → gold synthesis flare → trace-back), the Reasoning-Trace console, anchored
  node callouts, and the gold-accented Synthesis answer with source chips.
- **Idle living state:** background merges, arc-snaps, and traces while idle.
- **Reduced-motion** fallback (instant trace, calmer rotation).
- **Curation (edit / delete / markdown):** every card (Daily Brief notes, the node-detail card,
  and the type-list panels) renders summaries as **GitHub-flavoured markdown** and has a **delete**
  (soft-delete / archive) button. The node-detail card has an **Edit** mode with a live **Preview**
  toggle and **Save** — saving marks the note `edited` and re-embeds it server-side.
- **Clickable type tabs:** the status-bar vitals (**Concepts / Insights / Syntheses / World
  Events**) open a list panel; rows open the detail card or can be deleted inline.
- **Cleanup approvals:** when the autonomous maintenance engine wants to merge or delete a note
  **you've edited**, it pauses and a card appears at the top of the brief panel asking to **Allow**
  or **Reject** — nothing destructive happens to your edits without consent.

## Live data (wired)
The UI is no longer scripted — it runs against the local services. Next API routes under
`app/api/*` proxy the localhost-only services so the browser stays same-origin and
graph-core / daemon / mcp are never exposed (see `lib/services.ts`):
- **Knowledge sphere** ← `/api/graph` (Core Graph Service snapshot), refreshed periodically.
- **Live reasoning traces** ← `/api/events` (SSE proxy of the MCP server's event stream).
- **Daily Brief / vitals / open loops / op log / status** ← `/api/brief`, `/api/vitals`,
  `/api/loops`, `/api/oplog`, `/api/status` (Core Graph Service + reasoning-daemon).
- **Command line** ← `/api/search` + `/api/concepts` (Ollama-embedded semantic search);
  node detail ← `/api/node/[id]`; research ← `/api/research`.
- **Curation** ← `/api/node/[id]` `DELETE` (soft-delete) and `PATCH` (edit + server-side re-embed);
  type lists ← `/api/nodes?type=`; cleanup approvals ← `/api/approvals` (list) and
  `/api/approvals/[id]/resolve` (allow/reject).

Markdown is rendered with `react-markdown` + `remark-gfm`, themed via `.cm-md` in `globals.css`.
Every panel degrades gracefully: `getJson` returns a fallback if a service is down, so the
UI still renders when the backend isn't running.

## Run

The simplest path is `pnpm up` from the repo root, which starts the data plane and **all** services
including this one. To run just the visualiser (point it at an already-running backend):

```bash
pnpm --filter @cm/visualiser dev     # http://127.0.0.1:4004
pnpm --filter @cm/visualiser build   # production build (verified)
```
For live data the backend must be up (`pnpm up`, or `pnpm dev` at the repo root). See the root
[README](../../README.md#commands) for the full command reference.

## Structure
- `lib/engine.ts` — `CognitiveMirrorEngine`: the Three.js sphere + interaction state machine,
  owns all view state and emits snapshots via `onView`.
- `components/CognitiveMirror.tsx` — the React HUD; renders the glass panels and forwards events
  to the engine. Wrapper elements (`#cm-hud`, `#cm-center`, `#cm-canvas-mount`) have their
  transform/opacity/filter driven imperatively by the engine, so React re-renders don't fight it.
- `design/screenshots/` — reference screenshots from the original design pass.

## Known gaps

Accessibility. Several controls are clickable `<div>`s without keyboard handlers,
and the decorative SVGs have no titles — the Biome a11y rules are switched off
for `components/CognitiveMirror.tsx` to keep that visible rather than pretending
it's clean. One list there is also keyed by array index. It's a well-scoped
contribution if you want one.
