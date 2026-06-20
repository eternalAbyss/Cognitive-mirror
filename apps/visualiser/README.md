# Visualiser — "The Cognitive Mirror"

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

## Run
```bash
pnpm --filter @cm/visualiser dev     # http://127.0.0.1:4004
pnpm --filter @cm/visualiser build   # production build (verified)
```

## Structure
- `lib/engine.ts` — `CognitiveMirrorEngine`: the Three.js sphere + interaction state machine,
  ported from the prototype's `DCLogic` class. Owns all view state; emits snapshots via `onView`.
- `components/CognitiveMirror.tsx` — the React HUD; renders the glass panels and forwards events
  to the engine. Wrapper elements (`#cm-hud`, `#cm-center`, `#cm-canvas-mount`) have their
  transform/opacity/filter driven imperatively by the engine, so React re-renders don't fight it.
- `design/` — provenance: the original `.dc.html`, the design brief, and reference screenshots.

## Next (not yet wired)
The data is still seeded/scripted (no backend). Wiring it to live data:
- Subscribe to the MCP server's event stream (`GET http://127.0.0.1:4003/events`) to animate real
  traversals (the events are already emitted — see `apps/mcp-server/src/events.ts`).
- Drive the Daily Brief / vitals / answer from the Core Graph Service + reasoning daemon.
