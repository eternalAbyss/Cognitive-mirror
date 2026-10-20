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

These are the *defaults*. The graph widget's line-weight slider multiplies every
radius (`setLinkWidth`), so the table above is the 1× column. Width is baked into
tube geometry, so a change rebuilds every arc — coalesced to one rebuild per
frame, or dragging the slider would regenerate a thousand tubes per pointer event.

Ambient arcs are capped at `MAX_ARCS` (420). Past that the sphere turns into an
opaque ball at *any* width and the lines stop reading as lines. Nothing is lost:
the arcs were always atmosphere, and focus mode is how a node's connections are
actually read. `CONTRADICTS` is exempt from the cap — there are only ever a
handful, and "these two notes disagree" is the most interesting claim on the
sphere.

Gold is theme-dependent: `#D8A63E` (the same gold as the synthesis flare) is illegible on the
white theme, so the light theme drops to a deeper, less luminous gold. `setTheme()` re-tints
existing arcs, which is why each one carries an `ArcRole` rather than a baked-in hex. A user
link colour from the widget replaces the gold of ordinary connections but leaves crimson and
cyan alone — those two carry meaning a palette preference shouldn't erase.

The dot sprite texture is filled **white**. `SpriteMaterial` multiplies the texture's RGB by
`color`, so the `#000` fill it used to have pinned every data node to black regardless — the
dark theme's lighter node colour never actually showed. The two shaders sharing that texture
sample only its alpha, so they don't care either way.

## News

The panel shows `WorldEvent` nodes — the daily brief's synthesised observations, kept only when
they score within `BRIEF_THRESHOLD` of one of your Concepts or Interests.

Reading `/api/news` is what triggers a refresh: when the newest observation is older than
`BRIEF_MAX_AGE_HOURS` (12 by default) the daemon queues a brief. That is deliberately **not** a
second cron. `BRIEF_CRON` still runs nightly; this exists so an app that isn't open all day
doesn't greet you with yesterday's news the moment you do open it. Automatic refreshes dedup on
a time bucket inside the durable queue, so polling can't stack briefs up — verified by hammering
the endpoint and watching it return `already-queued` with the queue flat. The refresh button
forces one with a unique hash, because a refresh button that silently no-ops is worse than none.

Staleness is measured from `createdAt`, not `asOf`: `asOf` is the date the event is *about* and
is stored date-only, so a brief pulled at 09:00 would read as midnight and look stale by evening
of the same day.

The centre panel ("from your graph") shows your most active Concepts and Interests. It used to
prefer `WorldEvent` observations and fall back to concepts only when none existed — with news in
its own panel, that meant both panels showed the same five cards the moment the first brief
landed. The split now follows the labels.

## Settings

The bar writes to the installation's `.env` through `PATCH /api/settings`, which proxies
graph-core (`apps/graph-core/src/settings.ts`). It lives there rather than in a Next route for
the usual reason — the visualiser is a client of localhost services, not a second home for
business logic — and because Turbopack won't resolve `@cm/shared`'s `.js`-suffixed ESM source.

**Real-time is a real claim, not a hopeful one.** `loadConfig()` caches on the `.env` file's
mtime+size, so every service re-reads the file on its next config access with no watcher, no IPC
and no restart. That works because nearly every call site already calls `loadConfig()` *inside* a
function rather than capturing at boot. What can't work is marked `restart` in the UI and says so
on the field: a bound port, a registered cron, an open database pool. Settings that can't be
written safely at all — ports, `EMBED_DIM`, the MCP auth material — are refused outright by
`IMMUTABLE_KEYS` in the shared env writer.

Two properties worth not breaking:

- **Precedence.** A value exported in the shell still beats the file. The writer only replaces a
  key in `process.env` when it is unset or still holds exactly what the loader last put there, so
  a dashboard edit can never silently overwrite something set deliberately on the command line.
  (An earlier version compared against a snapshot of `process.env` taken at import, which looked
  equivalent and wasn't — it treated everything assigned after import as fair game.)
- **Secrets never reach the browser.** graph-core sends a sentinel meaning "set, withheld". The
  field renders as `set — type to replace`, and the sentinel is dropped on the way back in, so
  saving a card you didn't retype the key into can't overwrite a working key with a placeholder.

`updateEnvFile` rewrites values in place and appends only what's new, so the file keeps the
comments and grouping `.env.example` ships with. The write is atomic (temp file + rename),
because five services read that file and a torn write would take all of them down at once. It is
covered by `packages/shared/test/env-file.test.ts`, including the injection cases — a key or
value containing a line break is refused rather than escaped.

## Layout: three columns

The canvas is sized by its mount element (`#cm-stage`), never by the window, and the engine
watches it with a `ResizeObserver` — the region resizes without the window doing so, and a
`resize` listener alone never hears about it. The same scene therefore serves the dashboard and
fullscreen with no second code path.

Because the sphere sits *behind* the HUD, `#cm-hud` lies over it and swallows pointer events
aimed at it. `_isSphereSpace` therefore accepts the HUD backdrop, but only where the pointer is
actually inside the canvas rect — otherwise dragging empty space on the left would spin a sphere
sitting over on the right. For the same reason, orbiting the sphere is, to the browser, a drag
across the glass cards on top of it: `_onPointerDown` calls `preventDefault()` and locks
`user-select` for the gesture, or every orbit left a trail of highlighted card text behind it.

The left column is a real flex column rather than three absolutely-placed cards, so the news
panel takes whatever height is left instead of being pinned to an offset that only lines up at
one viewport height. The op log and the news panel each take `flex: 1 1 0` and scroll internally.

The middle column centres on the **viewport** and is sized to clear the fixed columns. Glass over
the sphere is the intended look; glass over glass is not.

Because the graph stopped being a backdrop, everything that used to be drawn over it had to be
given a home:

| Column | Holds |
|---|---|
| Left | a flex column: clock, then the **activity slot** (op log normally, swapped for the reasoning trace or the focus list while either is live), then news |
| Centre | your graph's brief, the command line, the node-detail card, the answer overlay |
| Right | the graph, the weather card, and the settings bar at the bottom |

The trace and focus panels share the left slot rather than stacking above the graph panel, which
left them barely 100px tall at 768px of viewport height.

The middle used to be centred in the **gap** between the two side columns rather than on the
viewport. Those columns are different widths — 340 left, 236 right — so that put the brief cards
and the command bar **52px right of true centre**, which the wordmark, sitting at a plain
`left: 50%`, gave away immediately: the heading and the stack under it visibly disagreed. They
now share one centre.

Centring on the viewport changes which clearance binds. A box centred at `50vw` clears both
columns only while its half-width fits the **narrower** side's gap, so the cap is
`100vw - 2 * MID_LEFT` rather than the asymmetric gap. That costs some width on a small display
— 548px at 1440, but pinched below about 1330 — and being visibly off-centre was the worse
trade. Transient modals (the detail card, the answer) were already at `left: 50%` and did not
move.

Expanding and collapsing are symmetric on purpose. Expanding is also what makes the sphere
interactive, so collapsing has to undo *both* — an earlier version only set the flag on the way
in, and coming back from fullscreen left the dashboard with its centre column still hidden and
the sphere still zoomed.

Camera distances are **multiples of `_fitZ()`** — the distance at which the sphere exactly fills
the current canvas — rather than the absolute Z values they used to be. That is what keeps a
traversal framed: with fixed distances, a query zoomed in and then rotated the node straight out
of a 350px panel.

`_frame()` clamps every one of those multipliers at **`FRAME_FLOOR`**, so no automatic camera
move can crop the sphere. `_fitZ()` frames a half-extent of `R * 1.18` — the shell plus halo
headroom — so the shell itself touches the frame edge at `1 / 1.18`, and `FRAME_FLOOR` is
`1.06 / 1.18 ≈ 0.898`, leaving 6% over for sprite half-heights and hover growth. Each push-in
used to be its own tuned number and three of them cropped: measured against the node shell, the
live query at `0.73` cut **16%** of the sphere radius off the constrained axis, focus mode at
`0.75` cut 13%, and windowed explore at `0.78` cut 9%. That read as cinematic while the graph
was a full-bleed background and reads as broken now that it is a discrete object on the right of
the dashboard, so all three are now `FRAME_FLOOR` and the sphere settles at 94% of the frame's
short axis in every one of them. Fullscreen explore keeps its own `0.94`, which is already
inside the floor.

An earlier version eased push-ins back toward the fitting distance only on canvases under 520px,
on the grounds that a small panel has no room to crop into. That was the right observation on
the wrong axis — a canvas has no room to crop into at *any* size, and the sizes where it failed
were precisely the mid and large ones the easing skipped. The floor replaces it. Deliberate
wheel zoom is still free to crop past the floor; that one is the user's own doing, and the
stored `camMult` keeps it across a resize.

`_legibility()` scales marks up on small canvases (`^0.6`, capped at 2.4×). Everything in the
scene is in world units, so shrinking the canvas shrinks every dot and tube with it and the
panel became an unreadable smudge; the sub-linear curve restores legibility without turning the
panel back into overlapping blobs. It feeds node sprites, tube radii and the point shaders'
`uScale`, and a resize rebuilds arc geometry on a 180ms debounce because a CSS size transition
fires the observer every frame.

`NODE_BASE` is `0.06` — half the original `0.12`. At 800 placed nodes the sphere read as
overlapping blobs rather than points.

## Depth: the sphere has an inside

Nodes are not all on the shell. A node's radius is set by its **cross-domain reach**: a note
whose neighbours all sit in its own domain stays on the surface, and one whose neighbours are
spread across many domains sinks toward the core. Depth reads as *how far an idea reaches* —
the centre fills with the graph's genuine bridge concepts. A sinking node also slides toward
its neighbourhood's mean direction, so a bridge ends up physically between the regions it
joins rather than merely below its own one.

Reach is computed from neighbourhood **composition** only:

| Term | Meaning |
|---|---|
| `dominance` | 1 − share of neighbours in their most common domain |
| `variety` | distinct domains touched, saturating at 6 |
| `confidence` | `deg / (deg + 4)` — three neighbours in three domains look maximally diverse, and aren't |

An earlier version also averaged the *angle* to each neighbour. It looked principled and
measured nothing: cluster directions come off a golden-angle spiral in order of first
appearance, so two domains sit ~90° apart whether they're "cryptography" and "AES" or
"cryptography" and "gardening". That term read 0.95 at the median — it was really detecting
"has any out-of-domain neighbour at all", which is nearly every node, and it collapsed the
whole graph into one gold ball. If you add a geometric term, check it against a real graph's
percentile spread first.

`REACH_GAIN`, `MAX_SINK` and `SINK_CURVE` were tuned against the live graph for roughly a
quarter of nodes on the shell, a populated middle, and a seventh of them deep. Arcs touching an
interior node stay near-straight chords instead of bowing over the surface, so a bridge concept
reads as wired *through* the sphere.

**Cluster directions** use a van der Corput radical inverse for latitude, not a `i / TOTAL`
ramp. Clusters are created lazily as domains first appear, so the final count isn't known up
front; guessing it high packed every cluster into the top of the sphere and left the bottom
bare. The radical inverse is progressive — any prefix already covers the full sphere, so the
layout looks right at 5 domains and at 500. Only the `MAX_CLUSTER_LABELS` (12) largest domains
get a region label; a real graph has a few hundred distinct domain strings and labelling them
all buried the sphere in text.

## The ask bar answers, it doesn't just search

Typing a question does two things at once. `/api/search` returns the hits the
sphere animates; `/api/answer` hands the question to the reasoning daemon, which
runs its own wider retrieval and synthesises over what it finds (see
[reasoning-daemon](../reasoning-daemon) for the retrieval and the grounding
rules). Both calls start from the same question, so the hops you watch and the
answer you read are about the same ideas.

Synthesis runs for **every** question, before any threshold is applied. It did not at first, and
that bug is worth keeping written down: the engine filtered search hits at `MATCH_MAX_DISTANCE`
(cosine 0.4) and, finding none, took a "nothing in your graph" branch that never called
`/api/answer` at all. Asked *"How many repos I have for ML?"*, retrieval returned exactly the
right nodes — the `machine-learning` repo, `Machine Learning Project`, `TensorFlow Framework` —
scoring 0.411, 0.424 and 0.419. All three were thrown away for being 0.011 too far, and the
daemon, which answers that question correctly, was never asked.

The cause is that **a question embeds further from every note than the topic it asks about does.**
Question words, pronouns and syntax all push the vector away, so a threshold tuned for typing a
topic rejects the question form of the same thing. One constant was doing two jobs, so it is now
two:

| | | |
|---|---|---|
| `TRAVERSE_MAX_DISTANCE` | 0.55 | how far the traversal will still walk — the animation only shows *where it looked* |
| `MATCH_MAX_DISTANCE` | 0.4 | whether the retrieval fallback may claim "closest in your graph: X" |

Neither one gates answering any more. The daemon's own retrieval is wider than the sphere's and
reports its own gaps, so the only thing left to decide locally is what the *fallback* may claim.

The synthesis is fired **the moment retrieval returns**, not after the animation.
The hops take about three seconds and a Sonnet call takes about the same, so
running them in parallel is the difference between an answer that lands with the
last hop and one that makes you wait for a finished animation. If the model is
still working when the hops end, the stage label says so.

"Your graph does not hold this" is a real answer, not a failure, so the model returns `in_graph:
false` alongside it and the card keeps its **Research the web** offer — the one useful thing to do
about a gap. Inferring that from an empty citation list was tempting and wrong: an answer taken
from the exact whole-graph counts legitimately cites nothing, and would have been mislabelled a
gap. The dead end is only reached when there is no synthesis *and* nothing close enough to read
out; then the stock line stands in.

When synthesis is unavailable — no API key, open budget breaker, daemon stopped —
the answer falls back to the templated read-out of the nearest node, and the
trace line and the hint both say **"retrieved"** rather than **"answered"**.
Those claim different things, so `ViewState.answerGrounded` carries which one it
was instead of labelling both the same. An answer that names a gap in the graph
cites nothing, and the source chips stay empty rather than implying support it
just told you it did not have.

The reveal awaits a network call, which `clearTimeout` cannot take back, so a
`traversalGen` counter is checked after the await: replaying during synthesis
must not get the abandoned question's answer.

## What's implemented
- **Welcome / command glass:** live clock, weather card, 3-card Daily Brief, the Open-Loop
  resurfacing card, the "Ask your second brain…" command line, and the cockpit status bar.
- **Knowledge sphere:** a Three.js icosphere of glowing nodes spread over one cluster per
  domain, placed at a depth set by their cross-domain reach, named nodes with labels, gold
  cross-domain connection lines, depth-faded wireframe, drifting rotation, mouse parallax, and
  time-of-day tint.
- **"Watch Claude think":** the scripted query traversal (cyan packets → cross-domain hop →
  convergence ring → gold synthesis flare → trace-back), the Reasoning-Trace console, anchored
  node callouts, and the gold-accented Synthesis answer with source chips.
- **Settings bar:** the bottom-right bar carries one icon per group of runtime variables, in
  **two rows** (eleven icons in a single row ran most of the way across the screen) —
  keys, models, budget, embeddings, sources, brief, maintenance, alerts, data store. Clicking one
  opens a card that edits the installation's `.env` directly, and **every service picks the
  change up without a restart** (see "Settings" below). The same bar holds the graph's appearance
  controls and the fullscreen toggle.
- **Latest news:** world observations the daemon kept because they scored close to one of your
  concepts, in the left stack under the op log. It refreshes **on staleness, not on a clock** —
  see "News" below — and has a refresh button that forces a brief immediately.
- **Graph:** the sphere is a **background element on the right of the page**, full viewport
  height, with the glass HUD floating over it. On the dashboard it is **ambient only** — it
  ignores drag, zoom and click, because reacting to every stray gesture across it meant knocking
  it out of alignment while reaching for a card. It becomes interactive when **expanded from the
  settings bar** (or via **⦿ Connections** on a card, which expands it too) — plus **expand to
  fullscreen**
  (every HUD panel clears and the command line collapses to a pill that reopens over the
  graph), a **line-weight slider**, and **colour pickers for nodes and lines** (presets, a
  free-choice well, and "follow the theme"). Links default to `#0E86A8`; nodes default to
  following the theme rather than a fixed hex, since a pinned near-white would vanish against
  the light theme's white void. Settings persist in `localStorage` under
  `cm-graph-appearance` and are read *after* mount, never during render — seeding state from
  `localStorage` would be a hydration mismatch.
- **Focus mode (walk the graph):** clicking a node on the sphere, or **⦿ Connections** on any
  detail card, hides everything except that node and its direct neighbours, draws its own edges,
  and lists them in a side panel ordered by how much the edge claims (`CONTRADICTS` first, bare
  `MENTIONS` last). Clicking a neighbour walks there, keeping a breadcrumb trail; **← Back**
  steps the walk — and the sphere and the open card move together, so the two never disagree.
  Adjacency is indexed over *every* edge type, and node metadata over *every* node, not just the
  `MAX_PLACED` (800) that get a sprite — otherwise a neighbour outside the drawn slice can't
  even be named and the panel silently under-reports a node's degree. Those are labelled
  `off-sphere`.
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
- **Command line** ← `/api/search` + `/api/concepts` (Ollama-embedded semantic search) for the
  traversal, `/api/answer` for the answer; node detail ← `/api/node/[id]`;
  research ← `/api/research`.
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
