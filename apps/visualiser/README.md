# Visualiser — "The Cognitive Mirror"

> 📖 Part of Cognitive-mirror — see the [full documentation](../../documentation.md) for
> architecture, setup, the API endpoints, and how this fits the whole system.

The navigable, real-time display layer (design §15 Phase 4). This is a faithful port of the
Claude Design prototype the user handed off (`design/original.dc.html`) into a Next.js app.

**Aesthetic:** the final design is **light monochrome** — a white void, dark wireframe knowledge
sphere behind frosted-white glass HUD panels (JetBrains Mono + Space Grotesk), with muted cyan
(`#0E86A8`) for "thinking" traces and gold (`#B07B16`) for "arriving" syntheses. (This refines
away from the dark-Tron look in `design/design-brief.md` — match the HTML, not the brief.)

## What's implemented (this pass)
- **Welcome / command glass:** live clock, weather card, 3-card Daily Brief, the Open-Loop
  resurfacing card, the "Ask your second brain…" command line, and the cockpit status bar.
- **Knowledge sphere:** a Three.js icosphere of glowing nodes in five domain clusters, named
  nodes with labels, gold cross-domain arcs, depth-faded wireframe, drifting rotation, mouse
  parallax, and time-of-day tint.
- **"Watch Claude think":** the scripted query traversal (cyan packets → gold cross-domain hop →
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
  ported from the prototype's `DCLogic` class. Owns all view state; emits snapshots via `onView`.
- `components/CognitiveMirror.tsx` — the React HUD; renders the glass panels and forwards events
  to the engine. Wrapper elements (`#cm-hud`, `#cm-center`, `#cm-canvas-mount`) have their
  transform/opacity/filter driven imperatively by the engine, so React re-renders don't fight it.
- `design/` — provenance: the original `.dc.html`, the design brief, and reference screenshots.

## Still open
See the root [TODO.md](../../TODO.md). The visualiser itself is feature-complete against the
prototype and live-wired; the remaining gaps are backend (off-device access, atomicity) rather
than UI.
