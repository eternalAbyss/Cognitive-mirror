# Claude Design Brief — "The Cognitive Mirror"
### High-fidelity prototype prompt for the Second Brain PKM web app

*Hand this file to Claude Design. It describes the look, spatial model, and signature interactions for a Tron/Jarvis-inspired interface where you watch your second brain think. Scope for this first pass: the **welcome / command glass** and the **knowledge sphere behind it**, plus the live traversal animation that connects them.*

---

## One-line concept

A frosted-glass command surface floating in dark space, behind which a living 3D sphere of your knowledge breathes and rotates — and when you ask a question, you watch threads of light trace from node to node as Claude reaches for the answer, then return it to the glass in front of you.

---

## The pitch (read this first)

Imagine booting into a personal command center. The room is near-black void. In front of you hangs a sheet of luminous glass — your **welcome layer** — showing the things that matter right now: the time, the weather, a short brief of what's worth your attention today, an open thought you left unfinished three weeks ago. It feels like a heads-up display from a film: thin neon edges, instrument-grade readouts, quiet motion.

Behind the glass, in real depth, lives the **knowledge sphere** — every concept, source, conversation, and insight you've ever fed it, arranged as a slowly turning globe of glowing nodes clustered by domain. It is always faintly alive: dim pulses drift across it as the system maintains itself in the background.

Ask it something. The glass parts and recedes, the camera pushes into the sphere, and you *see Claude think* — light packets shoot along edges from node to node, nodes flare as they're read, paths converge, a synthesis moment blooms, and the trace races back to the front where the answer materializes on the glass. This is not a metaphor laid over a chatbot. It is a literal visualization of retrieval and reasoning happening inside the graph.

That dual experience — **ambient glass in front, living sphere behind, traceable thought between them** — is the whole product.

---

## Visual language

**Mood:** Tron Legacy meets the Jarvis/Iron Man HUD. Holographic, instrument-precise, cinematic, calm when idle and electric when active. High craft, zero clutter. It should feel expensive and alive, never like a SaaS dashboard.

**Color**
- **Void base:** near-black with a deep navy/cyan undertone (think `#03060B`–`#0A1018`), subtle radial vignette.
- **Primary glow:** electric cyan (`#22D3EE` / `#38E1FF`) for structure, edges, and active traces.
- **Warm counterpoint (the Tron contrast):** amber/gold (`#FFB347` / `#FFD580`) reserved for *answers*, resolved syntheses, and the highest-value cross-domain edges. Cyan = thinking; gold = arriving.
- **Cluster accents** (each domain cluster gets its own hue so the sphere reads as regions):
  - Technical depth → electric cyan
  - Human systems → violet (`#A78BFA`)
  - Consciousness & inner life → teal-green (`#34D399`)
  - Creative & aesthetic → magenta/rose (`#F472B6`)
  - World signal → amber (`#FBBF24`)
- **Alert/tension:** a restrained crimson (`#FB7185`) only for contradiction arcs.

**Material**
- Glassmorphism done with restraint: frosted translucency, 1px backlit neon borders, faint internal refraction and noise, soft drop bloom. Panels look backlit from within, not flat.
- Behind every block of text on glass, add a subtle dark scrim/blur backstop so readouts stay legible over the bright sphere.

**Typography**
- **Data / labels / readouts:** a technical monospace (e.g. JetBrains Mono / IBM Plex Mono), uppercase micro-labels, wide letter-spacing, instrument feel. Numbers should look like gauges.
- **Headings / brief copy:** a clean geometric sans (e.g. Inter / Space Grotesk).
- Keep body copy sparing — this is a HUD, not an article.

**Lighting & motion principles**
- Everything *breathes*: slow scale/opacity oscillation on glows, gentle parallax between glass and sphere on cursor move, the sphere always drifting in slow rotation.
- Bloom and additive glow on light sources. Fine particle dust in the void for depth.
- Optional subtle scanline/hologram shimmer on the glass — keep it faint.
- Motion is smooth and eased, never bouncy. Think momentum and light, not UI springs.

---

## Spatial model (the depth is the design)

Three z-planes, with real depth-of-field between them:

1. **Foreground glass (HUD / welcome).** Translucent panels floating closest to the viewer. Holds ambient + personal info and the command input.
2. **Mid-space the sphere.** The 3D knowledge graph, softly defocused when the glass is in front, sharpening when you enter it.
3. **The void.** Particle dust, vignette, faint grid horizon — pure atmosphere.

Cursor movement produces parallax across all three. Entering the graph is a *camera move through the glass*, not a page swap.

---

## Screen 1 — The Welcome / Command Glass

The default state on load. Glass dominant and in focus; sphere visible but softly blurred behind it.

**Layout (floating panels, not a rigid grid):**
- **Top-left — identity & time:** a quiet greeting, large live clock, date. Micro-label readouts beneath ("LOCAL · BENGALURU").
- **Top-right — weather:** glanceable current conditions as an instrument card (sample: *Bengaluru · 27° · light rain · humidity 78%*). Minimal icon, monospace figures.
- **Center — the Daily Brief:** 3–5 stacked cards, each a *synthesized observation*, not a link. These are the marquee personal content. Sample cards:
  - *"A new paper on sparse attention builds directly on the transformer work you added last month. The new idea is learned routing. The open question it raises for you: does this change your view on attention as a model of human focus?"*
  - *"You've touched the Consciousness cluster three days running and not opened Technical depth all week. A re-entry point: your unfinished note on probabilistic system design."*
  - *"GitHub: ch04 of HOML is complete in code but the momentum term is still skipped — this will bite in ch05."*
- **Lower-center — Open Loops to resurface (1–2):** a distinct card style (slightly warmer edge) that reads like a returning thought. Sample: *"3 weeks ago you were exploring whether attention mechanisms model anything real about human focus. You left it open. New content connects to it — pick it up?"* with Continue / Park / Close controls.
- **Bottom — the command line:** a wide, glowing input: *"Ask your second brain…"*. This is the trigger for the signature interaction. On focus it brightens and the sphere behind subtly leans in.
- **Edge strip — system vitals (instrument readouts, small):** active concept nodes (e.g. 412 / target 300–600), total edges, today's merges + insights, API spend today, health status dot. Quiet, always-on, like a cockpit telemetry band.

Everything here is the "ambient, changes through the day" layer — note in the prototype that this content is meant to refresh over time (we'll wire real data later; for now seed it with the samples above).

---

## Screen 2 — The Knowledge Sphere (behind the glass)

When you enter the graph, the glass recedes and this becomes the focus.

- **The sphere:** a force-directed 3D graph laid over/within a globe, slowly rotating. Nodes glow in their cluster color; edges are thin luminous lines.
- **Cluster regions:** nodes group into the five colored regions, each with a faint floating label (Technical depth, Human systems, Consciousness & inner life, Creative & aesthetic, World signal).
- **Cross-domain edges = the hero detail:** the long arcs that span *between* clusters render in gold and brighter than ordinary edges — these are the highest-value connections (sample: a gold arc joining *Stoic reserve* in Consciousness to *Probabilistic system design* in Technical depth).
- **Level of detail:** zoomed out → clusters read as glowing blobs with summary labels and counts; zoom in → individual nodes resolve with their titles.
- **Node hover/select:** a glass detail card peels off the node — title, type (Concept / Source / Conversation / Insight / Synthesis), one-line summary, confidence as a small gauge, last-touched, and its strongest connections. Sample nodes to populate: *Gradient Descent*, *SGD*, *Attention mechanisms*, *Transformers*, *Stoic reserve*, *Probabilistic system design*, *HOML ch04*, *CV search pipeline*.
- **Side panels (collapsible glass):** Open Loops, Operation Log (a quiet scroll of background events — "merged 2 nodes," "new cross-domain insight," "pruned to archive"), and the Daily Brief carried through.

---

## The signature interaction — "watching Claude think"

This is the centerpiece. When the user submits a query (or a background process runs), play this beat sheet:

1. **Dim & focus** — the glass dims and slides back; depth-of-field shifts from glass to sphere; the sphere sharpens and leans forward.
2. **Entry pulse** — the most relevant entry node(s) flare brightly.
3. **Traversal** — packets of light travel *along edges* from node to node, like current down Tron lines. Each node lights as it's "read"; each edge brightens as it's "traversed." Multiple threads may branch and explore in parallel.
4. **Convergence** — threads narrow toward the nodes that hold the answer; irrelevant branches fade.
5. **Synthesis bloom** — the answer-bearing nodes brighten together and a soft gold flare marks the moment of synthesis.
6. **Return** — a single bright trace races back toward the viewer, *through* the glass, which re-forms in front.
7. **Answer arrives** — the answer materializes on the glass in gold-accented type, with small "sources" chips that, on hover, ping their nodes back in the sphere.

**A visual vocabulary for different operations** (so the user can read what's happening at a glance):
- **Retrieval / traversal:** cyan light packets along edges.
- **Merge (maintenance):** two nodes drift together and fuse into one with a soft pulse — visible during idle/background runs, making the "self-managing graph" literally watchable.
- **Contradiction detected:** a tense, flickering crimson arc between two nodes.
- **Synthesis / resolution:** the crimson arc cools to gold and collapses into a single node.
- **Cross-domain insight:** a new gold arc snaps into place across clusters with a brief flare — the system's proudest moment, treated as a small event.

---

## The transition between the two screens

- **Enter the graph:** glass parts/recedes, camera dollies forward through it into the sphere. ~1s, heavily eased, with motion blur and DOF rack-focus.
- **Return to glass:** camera pulls back, glass re-forms and re-focuses, sphere blurs out behind. The answer (if any) is already on the glass.
- It must feel like one continuous space, never a page navigation.

---

## Ambient / idle behavior (extra, but it sells the concept)

- **Living idle state:** with no query running, the sphere drifts and occasional faint background traces flicker — the maintenance engine working. Once in a while a visible merge or a new gold cross-domain edge happens on its own. The brain is never frozen.
- **Time-of-day theming:** the scene's lighting temperature shifts through the day to match "the brief changes as the day passes" — cool dawn cyan in the morning, neutral midday, warm amber dusk in the evening. Subtle, atmospheric, not a hard theme switch.
- **Night/maintenance mode (optional):** late hours show more background maintenance activity and a dimmer, calmer palette.

---

## States & edge cases to show

- **First load / empty-ish graph** (sparse sphere) vs. **populated** (the seeded sample above).
- **Query in progress** (the traversal animation) vs. **answer rendered**.
- **No answer found** — traces fan out, find nothing, and the glass returns with an honest "nothing in the graph touches this yet — want to add a source?" rather than a fake answer.
- **Hover/selected node** detail card.
- **Reduced-motion mode** — a calmer, mostly-static fallback for accessibility (important given how animation-heavy this is).

---

## What to prototype in this pass

Keep scope tight and high-fidelity rather than broad:

1. The **welcome / command glass** with the seeded sample data above.
2. The **knowledge sphere** behind it with the five colored clusters, sample nodes, and gold cross-domain edges.
3. The **transition** between them and the **traversal → answer animation** for one scripted sample query (e.g. *"What's the link between Stoic reserve and how I design systems?"* → traces across to the gold edge → returns a synthesized gold answer).
4. The **idle living state** with at least one self-running background event (a merge or a new cross-domain edge).

Everything can be mocked/scripted — no real backend. The goal is to *see what the final product feels like*.

---

## Build notes for Claude Design

- **3D:** a WebGL/Three.js-style force-directed graph for the sphere; the glass HUD as layered DOM/SVG with backdrop-blur over the canvas. Compose them so parallax and depth-of-field read between layers.
- **Performance:** target a believable ~150–400 nodes for the prototype (not thousands); use level-of-detail so it stays smooth. Bloom/glow via post-processing or layered glows.
- **Fidelity bar:** cinematic. Real easing, real depth, real glow. This should look like a hero shot, not a wireframe.
- **Self-contained:** seed all sample data inline so it renders without services.

---

## Tone & anti-patterns

- **Do:** dark, spacious, luminous, instrument-precise, calm-then-electric, one clear focal action.
- **Avoid:** generic admin dashboards, card grids that look like analytics tools, neon overload that hurts legibility, busy chrome, anything that looks like a stock template. Restraint is what makes Tron/Jarvis read as premium rather than gaudy.

---

## If you want a single paragraph to paste

> Build a high-fidelity, Tron/Jarvis-inspired web prototype called "The Cognitive Mirror." A frosted-glass heads-up display floats in dark space showing ambient personal info — live clock, weather, a daily brief of 3–5 synthesized observations, and one resurfaced open thought — plus a glowing "ask your second brain" command line and a quiet strip of system vitals. Behind the glass, in real depth, lives a slowly rotating 3D sphere of glowing knowledge nodes grouped into five color-coded domain clusters, with bright gold arcs marking the high-value cross-domain connections. When the user asks a question, the glass recedes and the camera pushes into the sphere: cyan light packets trace from node to node as Claude "reads" them, paths converge, a gold synthesis flare blooms, and the trace races back through the glass to deliver a gold-accented answer. While idle, the sphere stays alive — faint background traces, occasional self-running merges, and new gold cross-domain edges snapping into place. Cinematic glow, glassmorphism, monospace instrument readouts, time-of-day lighting, and a reduced-motion fallback. Seed it with sample knowledge (Gradient Descent, Attention mechanisms, Stoic reserve, Probabilistic system design) so it renders standalone.

---

*End of brief.*
