import * as THREE from "three";

/**
 * CognitiveMirrorEngine — the WebGL knowledge sphere. Phase 4 (live): the sphere
 * is built from the REAL graph (`loadData`), the command line runs a REAL vector
 * search over it (`runLiveQuery`), and the background animates REAL activity from
 * the MCP event stream (`applyLiveEvent`). The geodesic shell + idle motion are
 * retained from the imported prototype as atmosphere.
 */
export interface TraceLine {
  n: string;
  label: string;
  detail: string;
  accent: string;
}
export interface Callout {
  id: string;
  tag: string;
  type: string;
  line: string;
}
export interface Source {
  label: string;
  id: string;
}

/** One directly-connected node offered as the next step of a traversal. */
export interface FocusNeighbour {
  id: string;
  title: string;
  type: string;
  /** Edge label, already read in the direction the user is travelling. */
  relation: string;
  /** false when the edge points at the focused node rather than away from it. */
  outgoing: boolean;
  /** false when this neighbour exists in the graph but isn't placed on the sphere. */
  placed: boolean;
}

/**
 * Focus mode (design §"walk the graph"): one node is selected, only its direct
 * neighbours remain visible, and clicking one of them walks there. `trail` is the
 * path taken to get here, so a walk can be stepped back.
 */
export interface FocusState {
  id: string;
  title: string;
  type: string;
  domain: string;
  /** Capped at FOCUS_MAX_NEIGHBOURS; `total` is the real degree. */
  neighbours: FocusNeighbour[];
  total: number;
  trail: Array<{ id: string; title: string }>;
}

/** User-tunable look of the sphere, persisted by the HUD. */
export interface GraphAppearance {
  /** Multiplier on every connection tube's radius. 1 = the tuned default. */
  linkWidth: number;
  /** Hex override for data node dots, or null to follow the theme. */
  nodeColor: string | null;
  /** Hex override for connection lines, or null to keep the semantic palette. */
  linkColor: string | null;
}

export interface ViewState {
  queryInput: string;
  queryState: "idle" | "querying" | "returning" | "answered";
  showAnswer: boolean;
  answerText: string;
  traverseStage: string;
  nodeReadout: string;
  traceLines: TraceLine[];
  callout: Callout | null;
  speedLabel: string;
  sources: Source[];
  /** true when the query had no sufficiently-close match — offer web research. */
  noMatch: boolean;
  /** true when the answer on screen was synthesised over the graph rather than
   *  read off the nearest node. The two claim different things, so the UI says
   *  which one it is instead of labelling both "answered". */
  answerGrounded: boolean;
  /** Non-null while traversing: the selected node and the neighbours to step to. */
  focus: FocusState | null;
}

/**
 * What a drawn arc represents. Arcs are re-coloured on a theme switch, so each
 * one carries its role rather than a baked-in hex.
 *  - `relates`     cross-domain RELATES_TO — gold, the signature connection
 *  - `contradicts` CONTRADICTS — crimson, kept distinct because "these two ideas
 *                  conflict" is a different claim from "these two ideas connect"
 *  - `query`       a live traversal hop during a search — cyan, transient
 */
export type ArcRole = "relates" | "contradicts" | "query";

// Cosine DISTANCE threshold for "this query is actually in the graph" (lower is
// closer). Above this the nearest node is too unrelated for the RETRIEVAL
// fallback to claim it as an answer — it only governs that claim, never whether
// the question gets answered at all.
const MATCH_MAX_DISTANCE = 0.4;
/**
 * How far out the traversal will still walk.
 *
 * Deliberately looser than `MATCH_MAX_DISTANCE`, because a QUESTION embeds
 * further from every note than the topic it asks about does. "How many repos I
 * have for ML?" scored 0.411–0.432 against the `machine-learning` repo, the
 * `Machine Learning Project` concept and `TensorFlow Framework` — exactly the
 * right nodes, all of them just past a threshold tuned for typing a topic. One
 * threshold was doing two jobs, and the question-shaped half failed.
 *
 * The animation only shows where it looked; what the answer may claim is
 * decided separately, below.
 */
const TRAVERSE_MAX_DISTANCE = 0.55;

export interface GraphNodeDto {
  id: string;
  title: string;
  type: string;
  domain: string;
  summary: string;
}
export interface GraphEdgeDto {
  from: string;
  to: string;
  type: string;
}
export interface SearchHit {
  id: string;
  title: string;
  summary: string;
  type: string;
  score: number;
}

/**
 * A synthesised answer from `/api/answer`. Every failure arrives as
 * `ok: false` with a reason rather than a thrown error, because the retrieval
 * hits are already on screen by then — no synthesis means the templated summary
 * stands, not that the ask failed.
 */
export interface AnswerDto {
  ok: boolean;
  reason?: string;
  answer?: string;
  citations?: Array<{ id: string; title: string; type: string }>;
  /** false when the answer is "your graph does not hold this" — still a real
   *  answer, and still the case where offering to research the web is useful. */
  inGraph?: boolean;
}

type Patch = Partial<ViewState> | ((s: ViewState) => Partial<ViewState>);

/**
 * Cluster directions down a golden-angle spiral. The original eight hand-placed
 * directions were right for a demo graph, but a real one grows to a few hundred
 * distinct domains and cycling eight slots stacked whole domains on top of each
 * other — "Cryptography" landed exactly where "Education" already was. The spiral
 * gives every domain its own evenly-spread direction for any count we reach.
 */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** Van der Corput radical inverse — bit-reversal of `i` mapped into [0,1). */
function radicalInverse(i: number): number {
  let bits = i + 1; // +1 so slot 0 isn't exactly on a pole
  let out = 0;
  let denom = 1;
  while (bits > 0) {
    denom *= 2;
    out += (bits % 2) / denom;
    bits = Math.floor(bits / 2);
  }
  return out;
}

/**
 * Direction for cluster `i`. Longitude walks the golden angle, latitude follows
 * the radical inverse — which matters because clusters are created lazily, in
 * whatever order domains first appear. A plain `i / TOTAL` ramp needs the final
 * count up front, and guessing it high (512 slots for ~300 real domains) packed
 * every cluster into the top of the sphere and left the bottom bare. The radical
 * inverse is progressive: any prefix of the sequence already covers the full
 * sphere, so the layout looks right at 5 domains and at 500.
 */
function clusterDir(i: number): { tc: number; pc: number } {
  const y = 1 - 2 * radicalInverse(i);
  return { tc: GOLDEN_ANGLE * i, pc: Math.acos(Math.max(-1, Math.min(1, y))) };
}

const LABELLED_TYPES = new Set(["Concept", "Insight", "Synthesis"]);

/** How many nodes get a sprite. Above this the scene turns into draw-call soup. */
const MAX_PLACED = 800;
/**
 * How many ambient connection arcs are drawn at once.
 *
 * A mature graph has well over a thousand cross-domain relations, and drawing
 * them all produces an opaque gold ball at ANY tube width — the lines stop being
 * readable as lines. The cap keeps the sphere legible; nothing is lost, because
 * the arcs were always atmosphere and focus mode is how you actually read a
 * node's connections. CONTRADICTS is exempt: there are only ever a handful and
 * "these two notes disagree" is the single most interesting claim on the sphere.
 */
const MAX_ARCS = 420;
/** Neighbours offered in the focus panel; hubs can have hundreds. */
const FOCUS_MAX_NEIGHBOURS = 48;
/**
 * Region labels, for the biggest domains only. A real graph has a few hundred
 * distinct domain strings; labelling them all turned the sphere into a wall of
 * text that hid the thing it was annotating.
 */
const MAX_CLUSTER_LABELS = 12;

/**
 * Depth = cross-domain reach. A node whose neighbours all sit in its own domain
 * stays on the shell; one whose neighbours are scattered across many domains
 * sinks toward the core, because it belongs to no single surface region.
 *
 * Reach is read from the COMPOSITION of a node's neighbourhood, never from where
 * the layout happened to put things. An earlier version averaged the angle to
 * each neighbour, which looked principled and measured nothing: cluster
 * directions come off a golden-angle spiral in order of first appearance, so two
 * domains are ~90° apart whether they are "cryptography" and "AES" or
 * "cryptography" and "gardening". That term read 0.95 at the median — it was
 * detecting "has any out-of-domain neighbour at all", which is nearly everyone,
 * and it sank the whole graph into one gold ball.
 *
 * The two terms that survive are real graph properties:
 *  - DOMINANCE  1 − (share of neighbours in their most common domain). A node
 *               with 80% of its links in one domain is not a bridge.
 *  - VARIETY    how many distinct domains the neighbourhood touches.
 * Both are inflated by small samples — three neighbours in three domains looks
 * maximally diverse — so the result is shrunk by a confidence factor on degree.
 * CONFIDENCE_K is the degree at which a node is credited half its raw reach.
 */
const REACH_W_DOMINANCE = 0.5;
const REACH_W_VARIETY = 0.5;
const REACH_VARIETY_SAT = 5;
const CONFIDENCE_K = 4;
/**
 * Raw reach is compressed in practice (p90 ≈ 0.44 on a real graph), so it is
 * divided by this before use. Tuned against the live graph for roughly a quarter
 * of nodes on the shell, a populated middle, and a seventh of them deep.
 */
const REACH_GAIN = 0.55;
/** Deepest a node may sink, as a fraction of the shell radius. */
const MAX_SINK = 0.6;

/**
 * Resting world-space size of a data node dot, before depth and legibility
 * adjustment. Halved from the original 0.12: at 800 placed nodes the sphere read
 * as overlapping blobs rather than points.
 */
const NODE_BASE = 0.06;
/**
 * Short side (css px) of a canvas that needs no legibility compensation. Below
 * this, marks are scaled up — see `_legibility`.
 */
const LEGIBILITY_REF = 820;
/** >1 keeps the shell populated; a linear map lifted almost everything off it. */
const SINK_CURVE = 1.25;

/**
 * Closest automatic framing that still holds the whole sphere, as a multiple of
 * `_fitZ()`. `_fitZ` frames a half-extent of `R * 1.18` — the shell plus halo
 * headroom — so the shell itself exactly touches the frame at `1 / 1.18`, and
 * this leaves 6% over for sprite half-heights and hover growth.
 *
 * Every push-in used to be a tuned magic number, and three of them cropped: the
 * live query at 0.73 cut 16% of the sphere radius off the constrained axis,
 * focus mode 13%, windowed explore 9%. That read as cinematic while the graph
 * was a full-bleed background and reads as broken now that it is a discrete
 * object on the right of the dashboard. Deliberate wheel zoom is still free to
 * crop — that one is the user's own doing.
 */
const FRAME_FLOOR = 1.06 / 1.18;

export class CognitiveMirrorEngine {
  private onView: (v: ViewState) => void;
  state: ViewState = {
    queryInput: "",
    queryState: "idle",
    showAnswer: false,
    answerText: "",
    answerGrounded: false,
    traverseStage: "",
    nodeReadout: "connecting…",
    traceLines: [],
    callout: null,
    speedLabel: "1×",
    sources: [],
    noMatch: false,
    focus: null,
  };

  private mouseX = 0;
  private mouseY = 0;
  // Direct manipulation: drag to orbit (with release inertia), wheel to zoom,
  // hover to highlight, click to select. `explore` = the user pressed "Enter the
  // graph", so we stop the ambient auto-spin and let them inspect freely.
  private onSelect: ((id: string) => void) | null = null;
  private dragging = false;
  private didDrag = false;
  private lastPX = 0;
  private lastPY = 0;
  private downPX = 0;
  private downPY = 0;
  private velX = 0;
  private velY = 0;
  private explore = false;
  private hoverId: string | null = null;
  private packets: any[] = [];
  private nodeFlashes: Record<string, any> = {};
  private transients: any[] = [];
  private visited = new Set<string>();
  private trail: any[] = [];
  private _timers: any[] = [];
  private focusQuat: THREE.Quaternion | null = null;
  private speed = 1;
  private lastQuery = "";
  /** In-flight synthesis for the current question, started as soon as retrieval
   *  returns so the model thinks while the sphere animates the hops. */
  private answerPending: Promise<AnswerDto | null> | null = null;
  /** Bumped by every traversal reset. The reveal awaits a network call, which
   *  `clearTimeout` cannot take back, so it checks this before writing state —
   *  otherwise a replay during synthesis gets the abandoned question's answer. */
  private traversalGen = 0;
  private lastIdleEvent = 0;
  private targetCamZ = 5.8;
  /** Current framing as a multiple of `_fitZ()`; 1 = the whole sphere in frame. */
  private camMult = 1;
  /** true when the graph owns the viewport rather than sitting in its panel. */
  private fullscreen = false;
  private _ro: ResizeObserver | null = null;
  private _resizeArcTimer: any = null;
  private idleToggle = 0;
  private reduceMotion = false;
  private R = 2.5;

  private T = THREE;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private cam!: THREE.PerspectiveCamera;
  private group!: THREE.Group;
  private dotMat: any = null;
  private lineMat: any = null;
  private haloMat: any = null;
  private verts: number[][] = [];
  /** Placed nodes: world position, cluster index, and `depth` (0 shell → 1 core). */
  private nmap: Record<string, { pos: THREE.Vector3; cl: number; depth: number }> = {};
  private nodeMeta: Record<string, GraphNodeDto> = {};
  /**
   * The surface direction a node would sit at if it had no cross-domain pull —
   * its cluster direction plus its own deterministic jitter. Kept separately from
   * `nmap` because depth is computed FROM these, so they all have to exist first.
   */
  private baseDirs: Record<string, THREE.Vector3> = {};
  /**
   * Full adjacency over every edge type, including edges whose endpoints never
   * got a sprite. Focus mode walks this, not the drawn arcs — `MENTIONS` and
   * `DERIVED_FROM` are real connections even though drawing them all would bury
   * the sphere.
   */
  private adj = new Map<string, Map<string, { type: string; outgoing: boolean }>>();
  private sprites: Record<string, any> = {};
  private labels: any[] = [];
  private nodeLabels: any[] = [];
  private arcs: any[] = [];
  private clusters: Array<{ name: string; tc: number; pc: number }> = [];
  private clusterIndex = new Map<string, number>();
  private arcKeys = new Set<string>();
  private labelledCount = 0;
  /** Domain keys big enough to earn a region label this load. */
  private labelKeys = new Set<string>();

  // ── appearance (user-tunable from the graph widget) ──────────────────────
  private linkWidth = 1;
  private nodeColorOverride: string | null = null;
  private linkColorOverride: string | null = null;
  private arcRebuildQueued = false;

  // ── focus mode (walk the graph one hop at a time) ────────────────────────
  private focusId: string | null = null;
  private focusSet = new Set<string>();
  private focusArcs: any[] = [];
  private focusTrail: Array<{ id: string; title: string }> = [];
  private _dotShared: any = null;
  private rafId = 0;
  private uScale = 1;
  private _lt = 0;
  private _YAX: THREE.Vector3 | null = null;
  private dataLoaded = false;

  private CYAN = "#0E86A8";
  private CRIMSON = "#C2557A";
  // Cross-domain connection lines are gold (design brief §"cross-domain arcs").
  // Two shades because the arcs sit on very different backgrounds: the bright
  // #D8A63E (the same gold as the synthesis flare) disappears against the white
  // theme, so the light theme uses a deeper, less luminous gold.
  private GOLD_LIGHT = "#B07B16";
  private GOLD_DARK = "#D8A63E";

  /** Current gold for the active theme. */
  private _gold(): string {
    return this.dark ? this.GOLD_DARK : this.GOLD_LIGHT;
  }

  /**
   * The colour a persistent arc should currently be, given what it represents.
   * A user link colour replaces the gold of ordinary connections — the colour
   * that covers the overwhelming majority of arcs — but leaves `contradicts`
   * crimson and `query` cyan alone, because those two carry meaning a palette
   * preference shouldn't be able to erase.
   */
  private _arcColor(role: ArcRole): string {
    if (role === "contradicts") return this.CRIMSON;
    if (role === "query") return this.CYAN;
    return this.linkColorOverride ?? this._gold();
  }

  // Theme: light renders dark-ink dots on a white sphere; dark inverts the
  // grayscale ramps in the shaders and lightens the data nodes/labels.
  private dark = false;

  /** Current foreground color for data dots/packets (dark ink vs light on dark). */
  private _fg(): number {
    return this.dark ? 0xe6e9f0 : 0x0c0c0c;
  }

  /** Colour for data node dots — the user's override if set, else the theme's. */
  private _nodeColor(): THREE.ColorRepresentation {
    return this.nodeColorOverride ?? this._fg();
  }

  // ── appearance controls (driven by the graph widget) ──────────────────────
  /** Scale every connection tube. 1 = the tuned default; clamped to a sane range. */
  setLinkWidth(mult: number) {
    const next = Math.max(0.25, Math.min(5, Number.isFinite(mult) ? mult : 1));
    if (next === this.linkWidth) return;
    this.linkWidth = next;
    this._queueArcRebuild();
  }

  /** Recolour data nodes. `null` restores the theme default. */
  setNodeColor(hex: string | null) {
    this.nodeColorOverride = hex;
    const c = this._nodeColor();
    for (const id in this.sprites) this.sprites[id]?.material?.color?.set(c);
  }

  /** Recolour ordinary connection lines. `null` restores the gold palette. */
  setLinkColor(hex: string | null) {
    this.linkColorOverride = hex;
    for (const a of this.arcs) a.mat.color.set(this._arcColor(a.role));
    for (const a of this.focusArcs) a.mat.color.set(this._arcColor(a.role));
  }

  getAppearance(): GraphAppearance {
    return {
      linkWidth: this.linkWidth,
      nodeColor: this.nodeColorOverride,
      linkColor: this.linkColorOverride,
    };
  }

  /** Apply a whole saved appearance at once (on mount, from localStorage). */
  applyAppearance(a: Partial<GraphAppearance>) {
    if (typeof a.linkWidth === "number") this.setLinkWidth(a.linkWidth);
    if (a.nodeColor !== undefined) this.setNodeColor(a.nodeColor);
    if (a.linkColor !== undefined) this.setLinkColor(a.linkColor);
  }

  /**
   * Tube radius is baked into geometry, so a width change means rebuilding every
   * arc. Coalesced to one rebuild per frame so dragging the slider doesn't
   * regenerate a thousand tubes per pointer-move event.
   */
  private _queueArcRebuild() {
    if (this.arcRebuildQueued) return;
    this.arcRebuildQueued = true;
    requestAnimationFrame(() => {
      this.arcRebuildQueued = false;
      for (const a of this.arcs.concat(this.focusArcs)) this._regenArc(a);
    });
  }

  private _regenArc(a: { mesh: THREE.Mesh; curve: any; base: number }) {
    const geo = new this.T.TubeGeometry(
      a.curve,
      40,
      a.base * this.linkWidth * this._legibility(),
      8,
      false,
    );
    a.mesh.geometry.dispose();
    a.mesh.geometry = geo;
  }

  constructor(onView: (v: ViewState) => void) {
    this.onView = onView;
    this.onMove = this.onMove.bind(this);
    this._onResize = this._onResize.bind(this);
    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._onWheel = this._onWheel.bind(this);
  }

  /**
   * Set the camera framing as a multiple of "whole sphere in frame", clamped at
   * `FRAME_FLOOR` so no automatic move crops the sphere. The clamped value is
   * what gets stored, so a later re-measure on resize reproduces this framing
   * rather than re-deriving it from a multiplier that was never honoured.
   */
  private _frame(mult: number) {
    this.camMult = Math.max(FRAME_FLOOR, mult);
    this.targetCamZ = this._zoom(this.camMult);
  }

  /** React passes the node-detail opener so a click on the sphere opens the card. */
  setOnSelect(cb: (id: string) => void) {
    this.onSelect = cb;
  }

  /** Switch the whole WebGL scene between light and dark palettes. */
  setTheme(dark: boolean) {
    this.dark = dark;
    const u = dark ? 1 : 0;
    if (this.renderer) this.renderer.setClearColor(dark ? 0x0b0d12 : 0xffffff, 1);
    if (this.dotMat?.uniforms?.uDark) this.dotMat.uniforms.uDark.value = u;
    if (this.haloMat?.uniforms?.uDark) this.haloMat.uniforms.uDark.value = u;
    if (this.lineMat?.uniforms?.uDark) this.lineMat.uniforms.uDark.value = u;
    const fg = this._nodeColor();
    for (const id in this.sprites) this.sprites[id]?.material?.color?.set(fg);
    // Gold is theme-dependent, so persistent arcs have to be re-tinted too.
    for (const a of this.arcs.concat(this.focusArcs)) a.mat.color.set(this._arcColor(a.role));
    this._applyTint();
    this._rebuildLabels();
  }

  // ── lifecycle ──────────────────────────────────────────────────────────────
  mount() {
    this.reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this._applyTint();
    window.addEventListener("mousemove", this.onMove);
    window.addEventListener("resize", this._onResize);
    window.addEventListener("pointerdown", this._onPointerDown);
    window.addEventListener("pointermove", this._onPointerMove);
    window.addEventListener("pointerup", this._onPointerUp);
    window.addEventListener("wheel", this._onWheel, { passive: false });
    const center = document.getElementById("cm-center");
    if (center) center.style.transform = "translateX(-50%)";
    const mount = document.getElementById("cm-canvas-mount");
    if (mount) mount.style.filter = "blur(0.35px)";
    this._initGL();
    this.emit();
  }

  dispose() {
    cancelAnimationFrame(this.rafId);
    this._ro?.disconnect();
    this._ro = null;
    clearTimeout(this._resizeArcTimer);
    this._timers.forEach((id) => {
      clearTimeout(id);
    });
    window.removeEventListener("mousemove", this.onMove);
    window.removeEventListener("resize", this._onResize);
    window.removeEventListener("pointerdown", this._onPointerDown);
    window.removeEventListener("pointermove", this._onPointerMove);
    window.removeEventListener("pointerup", this._onPointerUp);
    window.removeEventListener("wheel", this._onWheel);
    document.body.style.cursor = "";
    this._releaseSelection();
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer = null;
    }
    const mount = document.getElementById("cm-canvas-mount");
    if (mount) mount.innerHTML = "";
  }

  // ── state plumbing ──────────────────────────────────────────────────────────
  private setState(patch: Patch) {
    const next = typeof patch === "function" ? patch(this.state) : patch;
    this.state = { ...this.state, ...next };
    this.emit();
  }
  private emit() {
    this.onView({ ...this.state });
  }

  // ── public API ──────────────────────────────────────────────────────────────
  setQuery(v: string) {
    this.setState({ queryInput: v });
  }
  submit() {
    if (this.state.queryInput.trim()) void this.runLiveQuery(this.state.queryInput);
  }
  runDefault() {
    void this.runLiveQuery("What connects my thinking across domains?");
  }
  cycleSpeed() {
    const ns = this.speed === 1 ? 2 : 1;
    this.speed = ns;
    this.setState({ speedLabel: `${ns}×` });
  }
  replay() {
    this._resetTraversal();
    this.setState({
      queryState: "idle",
      showAnswer: false,
      traceLines: [],
      callout: null,
      sources: [],
    });
    void this.runLiveQuery(this.lastQuery || "What connects my thinking across domains?");
  }
  closeAnswer() {
    const mount = document.getElementById("cm-canvas-mount");
    if (mount) mount.style.filter = "blur(0.35px)";
    this._resetTraversal();
    this.setState({
      showAnswer: false,
      queryState: "idle",
      traceLines: [],
      callout: null,
      traverseStage: "",
      sources: [],
    });
  }
  flash(id: string, pk = 2) {
    if (this.nmap[id]) this._flash(id, pk, performance.now() / 1000);
  }

  /** "Enter the graph": drop into free-orbit inspection — pull in, stop the ambient
   *  spin, unblur — so drag/zoom/click feel like handling a real object. */
  enterGraph() {
    this.explore = true;
    this._frame(this.reduceMotion ? 0.95 : FRAME_FLOOR);
    const mount = document.getElementById("cm-canvas-mount");
    if (mount) mount.style.filter = "blur(0px)";
  }

  /** The widget expanded or collapsed — reframe so the sphere fits its new canvas. */
  setFullscreen(full: boolean) {
    this.fullscreen = full;
    // Fullscreen has the whole viewport to work with, so it frames wider than the
    // windowed explore zoom — that one is tuned for a canvas constrained on its
    // long axis and crops the sphere top and bottom when given a 4:3 viewport.
    if (full && this.explore) this._frame(this.reduceMotion ? 1 : 0.94);
    // The mount is mid-transition; re-measure once it has settled as well.
    this._onResize();
    setTimeout(() => this._onResize(), 420);
  }

  exitGraph() {
    this.clearFocus();
    this.explore = false;
    this._frame(1);
    this.hoverId = null;
    this.dragging = false;
    this._releaseSelection();
    this.velX = this.velY = 0;
    document.body.style.cursor = "";
    const mount = document.getElementById("cm-canvas-mount");
    if (mount) mount.style.filter = "blur(0.35px)";
    if (this.state.queryState === "idle") this.setState({ callout: null });
  }

  /** When a query had no match, research it live on the web → new notes spawn on the sphere. */
  async researchCurrent() {
    const topic = this.lastQuery;
    if (!topic) return;
    this.setState({
      noMatch: false,
      traverseStage: "researching the web…",
      answerText: `Searching the web for “${topic}” and taking notes…`,
    });
    try {
      const res = await fetch("/api/research", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ topic }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        summary?: string;
        conceptsAdded?: number;
        conceptTitles?: string[];
        error?: string;
      };
      if (data.ok) {
        const titles = data.conceptTitles ?? [];
        // Log the nodes it created (browser console).
        console.log(`[research] "${topic}" → created ${data.conceptsAdded ?? 0} concepts:`, titles);
        this.setState({
          traverseStage: "",
          answerText: `${data.summary ?? ""}\n\n— Added ${data.conceptsAdded ?? 0} notes to your graph (watch them appear on the sphere).`,
          sources: titles.map((t) => ({ label: t, id: "" })),
        });
      } else {
        this.setState({
          traverseStage: "",
          answerText: `Research failed: ${data.error ?? "unknown error"}`,
        });
      }
    } catch {
      this.setState({
        traverseStage: "",
        answerText: "Research failed — is the reasoning daemon running?",
      });
    }
  }

  /**
   * Initial full load: clear and place all nodes (no spawn flash).
   *
   * Three phases, in this order for a reason. Depth is derived from where a
   * node's NEIGHBOURS sit, so every node needs a surface direction before any
   * node can be given its final radius, and arcs need final positions.
   */
  loadData(data: { nodes: GraphNodeDto[]; edges: GraphEdgeDto[] }) {
    if (!this.renderer || this.verts.length === 0) {
      setTimeout(() => this.loadData(data), 150); // GL not ready yet
      return;
    }
    this._clearData();
    this._indexEdges(data.edges);
    // Metadata for EVERY node, not just the ones that get a sprite — focus mode
    // has to be able to name a neighbour that fell outside the drawn slice, or it
    // silently under-reports a node's connections.
    for (const n of data.nodes) this.nodeMeta[n.id] = n;
    const placing = data.nodes.slice(0, MAX_PLACED);
    this.labelKeys = this._topDomains(placing);
    for (const n of placing) this._prepareNode(n);
    for (const n of placing) this._placeNode(n, false);
    for (const e of data.edges) this._addArc(e);
    this.dataLoaded = data.nodes.length > 0;
  }

  /**
   * Incrementally add any nodes/edges not already on the sphere, spawning the new
   * ones with a flash — so research/enrichment/maintenance nodes appear LIVE as
   * the daemon creates them. Returns the number of nodes added.
   */
  mergeData(data: { nodes: GraphNodeDto[]; edges: GraphEdgeDto[] }): number {
    if (!this.renderer || this.verts.length === 0) return 0;
    this._indexEdges(data.edges);
    for (const n of data.nodes) this.nodeMeta[n.id] = n;
    // Keyed on nmap, not nodeMeta: meta now exists for undrawn nodes too.
    const fresh = data.nodes.slice(0, MAX_PLACED).filter((n) => !this.nmap[n.id]);
    // Same two phases as loadData: a batch of new nodes that reference each other
    // needs every base direction in place before any of them is given a depth.
    for (const n of fresh) this._prepareNode(n);
    for (const n of fresh) this._placeNode(n, true);
    for (const e of data.edges) this._addArc(e);
    if (fresh.length > 0) this.dataLoaded = true;
    return fresh.length;
  }

  /** The domain keys with the most nodes — the only ones that get a region label. */
  private _topDomains(nodes: GraphNodeDto[]): Set<string> {
    const counts = new Map<string, number>();
    for (const n of nodes) {
      const k = this._keyOf(n);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return new Set(
      [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, MAX_CLUSTER_LABELS)
        .map(([k]) => k),
    );
  }

  /** Record every edge in both directions so focus mode can walk either way. */
  private _indexEdges(edges: GraphEdgeDto[]) {
    for (const e of edges) {
      if (!e.from || !e.to || e.from === e.to) continue;
      let out = this.adj.get(e.from);
      if (!out) {
        out = new Map();
        this.adj.set(e.from, out);
      }
      if (!out.has(e.to)) out.set(e.to, { type: e.type, outgoing: true });
      let back = this.adj.get(e.to);
      if (!back) {
        back = new Map();
        this.adj.set(e.to, back);
      }
      if (!back.has(e.from)) back.set(e.from, { type: e.type, outgoing: false });
    }
  }

  private _keyOf(n: GraphNodeDto): string {
    return n.domain || n.type || "misc";
  }

  private _sharedDot() {
    if (!this._dotShared) this._dotShared = this.dotTex();
    return this._dotShared;
  }

  /** Ensure a cluster exists for a domain/type key (creating its region label on first sight). */
  private _ensureCluster(key: string): number {
    const existing = this.clusterIndex.get(key);
    if (existing !== undefined) return existing;
    const idx = this.clusters.length;
    const d = clusterDir(idx);
    this.clusters.push({ name: key, tc: d.tc, pc: d.pc });
    this.clusterIndex.set(key, idx);
    if (!this.labelKeys.has(key)) return idx; // a long-tail domain: cluster, no label
    const T = this.T;
    const dir = new T.Vector3(
      Math.sin(d.pc) * Math.cos(d.tc),
      Math.cos(d.pc),
      Math.sin(d.pc) * Math.sin(d.tc),
    );
    const sp = new T.Sprite(
      new T.SpriteMaterial({
        map: this.labelTex(key, 32, this._labelCol("cluster")),
        transparent: true,
        opacity: 0.5,
        depthTest: false,
        depthWrite: false,
      }),
    );
    sp.position.copy(dir.clone().multiplyScalar(this.R * 1.34));
    sp.scale.set(1.3, 0.2, 1);
    this.group.add(sp);
    this.labels.push({ sprite: sp, dir, text: key, size: 32, kind: "cluster" });
    return idx;
  }

  /**
   * Phase one of layout: give the node its cluster and the surface direction it
   * would occupy on a flat, shell-only sphere. No geometry yet — depth needs
   * every node in the batch to have one of these first.
   */
  private _prepareNode(n: GraphNodeDto) {
    if (this.baseDirs[n.id]) return;
    const ci = this._ensureCluster(this._keyOf(n));
    const cl = this.clusters[ci]!;
    const h = hash(n.id);
    const dt = ((h % 1000) / 1000 - 0.5) * 1.3;
    const dp = (((h >> 10) % 1000) / 1000 - 0.5) * 1.3;
    const th = cl.tc + dt;
    const ph = cl.pc + dp;
    this.baseDirs[n.id] = new this.T.Vector3(
      Math.sin(ph) * Math.cos(th),
      Math.cos(ph),
      Math.sin(ph) * Math.sin(th),
    ).normalize();
    this.nodeMeta[n.id] = n;
    (this.nodeMeta[n.id] as any).__cl = ci; // only drawn nodes carry a cluster
  }

  /**
   * How far a node's connections reach, in [0,1] — the sphere's third dimension.
   *
   * Two things make an idea "deep": its neighbours sit a long way round the
   * sphere from it (distance), and they sit in many different places rather than
   * one (spread). A note about Git that only links to other Git notes scores 0
   * and stays on the shell. A note like "append-only logs" that links to
   * databases, event sourcing and audit compliance scores high and sinks toward
   * the core, where the graph's genuine bridge concepts collect.
   *
   * Returns `{ reach, pull }` — `pull` is the neighbourhood's mean direction, used
   * to slide the node toward the domains it bridges as it sinks, so it ends up
   * physically between them rather than merely deeper under its own cluster.
   */
  private _reachOf(id: string): { reach: number; pull: THREE.Vector3 | null } {
    const own = this.baseDirs[id];
    const nbrs = this.adj.get(id);
    if (!own || !nbrs || nbrs.size < 2) return { reach: 0, pull: null };
    const pull = new this.T.Vector3();
    const perCluster = new Map<number, number>();
    let seen = 0;
    for (const nid of nbrs.keys()) {
      const d = this.baseDirs[nid];
      if (!d) continue; // neighbour isn't on the sphere — it can't pull
      seen++;
      pull.add(d);
      const ci = (this.nodeMeta[nid] as any)?.__cl;
      if (typeof ci === "number") perCluster.set(ci, (perCluster.get(ci) ?? 0) + 1);
    }
    if (seen < 2 || perCluster.size === 0) return { reach: 0, pull: null };

    const biggest = Math.max(...perCluster.values());
    const dominance = 1 - biggest / seen;
    const variety = Math.min(1, (perCluster.size - 1) / REACH_VARIETY_SAT);
    const confidence = seen / (seen + CONFIDENCE_K);
    const raw = confidence * (REACH_W_DOMINANCE * dominance + REACH_W_VARIETY * variety);
    const reach = Math.max(0, Math.min(1, raw / REACH_GAIN));
    return { reach, pull: pull.lengthSq() > 1e-6 ? pull.normalize() : null };
  }

  /** Phase two: resolve depth, build the sprite, and label it if it earns one. */
  private _placeNode(n: GraphNodeDto, spawn: boolean) {
    if (this.nmap[n.id]) return;
    const T = this.T;
    this._prepareNode(n);
    const base = this.baseDirs[n.id]!;
    const ci = ((this.nodeMeta[n.id] as any).__cl as number) ?? 0;

    const { reach, pull } = this._reachOf(n.id);
    // Slide toward the neighbourhood as it sinks: a bridge concept should sit
    // between the regions it joins, not merely below its own one.
    const dir = base.clone();
    if (pull && reach > 0) dir.lerp(pull, 0.45 * reach);
    if (dir.lengthSq() < 1e-6) dir.copy(base);
    dir.normalize();
    const radius = this.R * (1 - MAX_SINK * reach ** SINK_CURVE);
    const pos = dir.multiplyScalar(radius);

    this.nmap[n.id] = { pos, cl: ci, depth: reach };
    const sp = new T.Sprite(
      new T.SpriteMaterial({
        map: this._sharedDot(),
        color: this._nodeColor(),
        transparent: true,
        opacity: 1,
        depthTest: false,
        depthWrite: false,
      }),
    );
    sp.position.copy(pos);
    sp.scale.setScalar(spawn ? 0.01 : this._nodeScale(n.id));
    this.group.add(sp);
    this.sprites[n.id] = sp;
    // Interior nodes are seen through the shell, so they'd clutter it with text;
    // only shell-ish nodes get a label.
    if (LABELLED_TYPES.has(n.type) && this.labelledCount < 60 && reach < 0.45) {
      this.labelledCount++;
      const kind = n.type === "Insight" ? "insight" : "node";
      const lab = new T.Sprite(
        new T.SpriteMaterial({
          map: this.labelTex(n.title, 24, this._labelCol(kind)),
          transparent: true,
          opacity: 0.7,
          depthTest: false,
          depthWrite: false,
        }),
      );
      const off = base.clone().multiplyScalar(this.R + 0.34);
      off.y += 0.12;
      lab.position.copy(off);
      lab.scale.set(1.0, 0.156, 1);
      this.group.add(lab);
      this.nodeLabels.push({ sprite: lab, dir: base, text: n.title, size: 24, kind });
    }
    if (spawn) this._flash(n.id, 2.8, performance.now() / 1000); // pop into existence
  }

  /** Resting sprite size — deeper nodes shrink slightly so the shell stays readable. */
  private _nodeScale(id: string): number {
    const d = this.nmap[id]?.depth ?? 0;
    return NODE_BASE * (1 - 0.25 * d) * this._legibility();
  }

  /** Cross-domain RELATES_TO (gold) + CONTRADICTS (crimson) arcs — deduped. */
  private _addArc(e: GraphEdgeDto) {
    const a = this.nodeMeta[e.from];
    const b = this.nodeMeta[e.to];
    if (!a || !b || !this.nmap[e.from] || !this.nmap[e.to]) return;
    const key = `${e.from}->${e.to}:${e.type}`;
    if (this.arcKeys.has(key)) return;
    if (e.type === "CONTRADICTS") {
      const arc = this._makeArc(e.from, e.to, 0.011, "contradicts");
      if (arc) {
        this.arcs.push(arc);
        this.arcKeys.add(key);
      }
    } else if (
      e.type === "RELATES_TO" &&
      a.domain &&
      b.domain &&
      a.domain !== b.domain &&
      this.arcs.length < MAX_ARCS
    ) {
      const arc = this._makeArc(e.from, e.to, 0.007, "relates");
      if (arc) {
        this.arcs.push(arc);
        this.arcKeys.add(key);
      }
    }
  }

  // ── focus mode: walk the graph one hop at a time ──────────────────────────
  /**
   * Isolate one node and its direct neighbours. Everything else on the sphere is
   * hidden — not dimmed — because the point is to answer "what is this actually
   * connected to?" without a thousand unrelated dots arguing with the answer.
   *
   * `step` continues an existing walk (pushing the previous node onto the trail);
   * a fresh selection starts a new one.
   */
  focusNode(id: string, step = false) {
    const meta = this.nodeMeta[id];
    if (!meta || !this.nmap[id]) return;
    if (step && this.focusId && this.focusId !== id) {
      const prev = this.nodeMeta[this.focusId];
      if (prev) this.focusTrail = [...this.focusTrail, { id: this.focusId, title: prev.title }];
    } else if (!step) {
      this.focusTrail = [];
    }

    this._clearFocusGeometry();
    this.focusId = id;

    const nbrs = this.adj.get(id) ?? new Map();
    const all: FocusNeighbour[] = [];
    for (const [nid, e] of nbrs) {
      const nm = this.nodeMeta[nid];
      if (!nm) continue; // in the graph but outside the placed slice
      all.push({
        id: nid,
        title: nm.title,
        type: nm.type,
        relation: e.type,
        outgoing: e.outgoing,
        placed: !!this.nmap[nid],
      });
    }
    // Rank by how much the edge says: a contradiction is the most interesting
    // thing one note can claim about another, a bare mention the least.
    const weight = (r: string) =>
      r === "CONTRADICTS" ? 0 : r === "RELATES_TO" ? 1 : r === "DERIVED_FROM" ? 2 : 3;
    all.sort((a, b) => weight(a.relation) - weight(b.relation) || a.title.localeCompare(b.title));
    const neighbours = all.slice(0, FOCUS_MAX_NEIGHBOURS);

    this.focusSet = new Set(neighbours.filter((n) => n.placed).map((n) => n.id));
    this.focusSet.add(id);

    // Only the focused node's own connections are drawn, each as its own arc.
    for (const n of neighbours) {
      if (!n.placed) continue;
      const role: ArcRole = n.relation === "CONTRADICTS" ? "contradicts" : "relates";
      const arc = this._makeArc(id, n.id, role === "contradicts" ? 0.011 : 0.008, role);
      if (arc) this.focusArcs.push(arc);
    }

    this._applyFocusVisibility();
    this._focusNode(id); // swing it to the front
    this._frame(this.reduceMotion ? 0.95 : FRAME_FLOOR);
    this.explore = true;
    const mount = document.getElementById("cm-canvas-mount");
    if (mount) mount.style.filter = "blur(0px)";
    this._flash(id, 2.4, performance.now() / 1000);

    this.setState({
      focus: {
        id,
        title: meta.title,
        type: meta.type,
        domain: meta.domain,
        neighbours,
        total: all.length,
        trail: this.focusTrail,
      },
    });
  }

  /**
   * Step back to the previous node of the walk; clears focus at the start.
   * Returns the node landed on so the caller can bring its detail card along.
   */
  focusBack(): string | null {
    const prev = this.focusTrail[this.focusTrail.length - 1];
    if (!prev) {
      this.clearFocus();
      return null;
    }
    this.focusTrail = this.focusTrail.slice(0, -1);
    const back = this.focusTrail;
    this.focusNode(prev.id, false);
    // focusNode(step=false) wipes the trail, so restore the shortened one.
    this.focusTrail = back;
    this.setState((st) => ({ focus: st.focus ? { ...st.focus, trail: back } : null }));
    return prev.id;
  }

  clearFocus() {
    if (!this.focusId) return;
    this._clearFocusGeometry();
    this.focusId = null;
    this.focusSet = new Set();
    this.focusTrail = [];
    this._applyFocusVisibility();
    this.focusQuat = null;
    this.setState({ focus: null });
  }

  isFocused(): boolean {
    return this.focusId !== null;
  }

  private _clearFocusGeometry() {
    for (const a of this.focusArcs) {
      this.group?.remove(a.mesh);
      a.mesh.geometry?.dispose?.();
      a.mat?.dispose?.();
    }
    this.focusArcs = [];
  }

  /**
   * Show exactly the focused neighbourhood, or restore everything. Persistent
   * arcs and labels go with it — a gold shell of unrelated connections in front
   * of the three nodes you asked about defeats the purpose.
   */
  private _applyFocusVisibility() {
    const on = this.focusId !== null;
    for (const id in this.sprites) {
      this.sprites[id].visible = !on || this.focusSet.has(id);
    }
    for (const a of this.arcs) a.mesh.visible = !on;
    for (const l of this.nodeLabels) l.sprite.visible = !on;
    for (const l of this.labels) l.sprite.visible = !on;
  }

  setReadout(text: string) {
    this.setState({ nodeReadout: text });
  }

  /** Animate real background activity from the MCP event stream (design §3). */
  applyLiveEvent(evt: { type: string; detail?: Record<string, unknown> }) {
    if (this.state.queryState !== "idle") return;
    const d = evt.detail ?? {};
    const ids = [d.id, d.from, d.to].filter(
      (x): x is string => typeof x === "string" && !!this.nmap[x],
    );
    const now = performance.now() / 1000;
    if (evt.type === "write" && ids.length >= 2) {
      this._hop(ids[0]!, ids[1]!, evt.detail?.type === "CONTRADICTS" ? "contradicts" : "relates");
    }
    for (const id of ids) this._flash(id, 1.8, now);
  }

  private _clearData() {
    for (const id in this.sprites) this.group?.remove(this.sprites[id]);
    for (const l of this.labels.concat(this.nodeLabels)) this.group?.remove(l.sprite);
    for (const a of this.arcs) this.group?.remove(a.mesh);
    this._clearFocusGeometry();
    this.sprites = {};
    this.nmap = {};
    this.nodeMeta = {};
    this.baseDirs = {};
    this.adj = new Map();
    this.labels = [];
    this.nodeLabels = [];
    this.arcs = [];
    this.clusters = [];
    this.clusterIndex = new Map();
    this.arcKeys = new Set();
    this.labelledCount = 0;
    this.labelKeys = new Set();
  }

  private _applyTint() {
    const h = new Date().getHours();
    const el = document.getElementById("cm-tint");
    if (!el) return;
    let c: string;
    if (this.dark) {
      // Additive glow (screen) so the wash reads against the near-black sphere.
      el.style.mixBlendMode = "screen";
      if (h >= 5 && h < 11)
        c = "radial-gradient(ellipse 80% 70% at 50% 30%, rgba(60,46,24,.5), rgba(0,0,0,0) 70%)";
      else if (h >= 11 && h < 17)
        c = "radial-gradient(ellipse 80% 70% at 50% 30%, rgba(28,40,66,.45), rgba(0,0,0,0) 70%)";
      else if (h >= 17 && h < 21)
        c = "radial-gradient(ellipse 80% 70% at 50% 30%, rgba(52,28,52,.5), rgba(0,0,0,0) 70%)";
      else c = "radial-gradient(ellipse 80% 70% at 50% 30%, rgba(24,30,60,.55), rgba(0,0,0,0) 70%)";
    } else {
      el.style.mixBlendMode = "multiply";
      if (h >= 5 && h < 11)
        c =
          "radial-gradient(ellipse 80% 70% at 50% 30%, rgba(255,247,232,.5), rgba(250,248,244,0) 70%)";
      else if (h >= 11 && h < 17)
        c =
          "radial-gradient(ellipse 80% 70% at 50% 30%, rgba(240,246,255,.4), rgba(248,250,252,0) 70%)";
      else if (h >= 17 && h < 21)
        c =
          "radial-gradient(ellipse 80% 70% at 50% 30%, rgba(250,240,248,.45), rgba(250,247,250,0) 70%)";
      else
        c =
          "radial-gradient(ellipse 80% 70% at 50% 30%, rgba(234,238,250,.5), rgba(244,246,252,0) 70%)";
    }
    el.style.background = c;
  }

  private onMove(e: MouseEvent) {
    // Normalised against the window: this drives the HUD's parallax as well as
    // the camera's, and the HUD is still the whole page.
    this.mouseX = (e.clientX / innerWidth - 0.5) * 2;
    this.mouseY = (e.clientY / innerHeight - 0.5) * 2;
    const h = document.getElementById("cm-hud");
    if (h) h.style.transform = `translate(${this.mouseX * 5}px,${this.mouseY * 3}px)`;
    const c = document.getElementById("cm-center");
    if (c && this.state.queryState === "idle" && !this.dragging && !this.explore)
      c.style.transform = `translateX(-50%) rotateY(${-this.mouseX * 2.2}deg) rotateX(${this.mouseY * 1.5}deg)`;
  }

  // ── direct manipulation (orbit / zoom / select) ───────────────────────────────
  /** A pointer event over empty sphere space (the HUD backdrop or canvas), not a
   *  HUD widget — so dragging a card or clicking a button never moves the sphere. */
  private _isSphereSpace(e: { target: EventTarget | null; clientX?: number; clientY?: number }) {
    const t = e.target as HTMLElement | null;
    if (!t) return false;
    if (
      t.tagName === "CANVAS" ||
      t.id === "cm-canvas-mount" ||
      t.id === "cm-tint" ||
      t.id === "cm-stage"
    )
      return true;
    // The sphere is a BACKGROUND element again, so #cm-hud lies over it and
    // swallows every pointer event aimed at it. Treat the HUD backdrop as sphere
    // space, but only where the canvas actually is — otherwise dragging empty
    // space on the left half would spin a sphere sitting over on the right.
    if (t.id !== "cm-hud") return false;
    if (this.fullscreen) return true;
    const r = this.renderer?.domElement.getBoundingClientRect();
    if (!r || e.clientX === undefined || e.clientY === undefined) return false;
    return (
      e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom
    );
  }

  private _busy(): boolean {
    return this.state.queryState === "querying" || this.state.queryState === "returning";
  }

  /**
   * Whether the sphere accepts orbit / zoom / click at all.
   *
   * On the dashboard the graph is ambient wallpaper sitting behind the HUD, and
   * reacting to every stray drag across it was noise — you'd knock it out of
   * alignment reaching for a card. It becomes interactive only once it has been
   * opened, which `enterGraph` marks and `exitGraph` clears.
   */
  private _interactive(): boolean {
    return this.explore;
  }

  private _onPointerDown(e: PointerEvent) {
    if (!this._interactive() || this._busy() || !this._isSphereSpace(e)) return;
    // The sphere sits BEHIND the HUD, so a drag across it is, to the browser, a
    // drag across the glass cards on top — which selects their text and leaves
    // it highlighted. Suppressing the default pointerdown stops the selection
    // from starting; the user-select lock covers the rest of the gesture.
    e.preventDefault();
    document.body.style.userSelect = "none";
    (document.body.style as CSSStyleDeclaration & { webkitUserSelect?: string }).webkitUserSelect =
      "none";
    this.dragging = true;
    this.didDrag = false;
    this.downPX = this.lastPX = e.clientX;
    this.downPY = this.lastPY = e.clientY;
    this.velX = this.velY = 0;
  }

  private _onPointerMove(e: PointerEvent) {
    if (this.dragging) {
      const dx = e.clientX - this.lastPX;
      const dy = e.clientY - this.lastPY;
      this.lastPX = e.clientX;
      this.lastPY = e.clientY;
      if (Math.abs(e.clientX - this.downPX) + Math.abs(e.clientY - this.downPY) > 4)
        this.didDrag = true;
      const k = 0.006;
      this._rotateGroup(dx * k, dy * k);
      this.velX = dx * k;
      this.velY = dy * k;
      return;
    }
    if (this._busy()) return;
    this._updateHover(e);
  }

  private _onPointerUp(e: PointerEvent) {
    if (this.dragging && !this.didDrag && this._isSphereSpace(e)) {
      // a clean click (not a drag) selects the nearest node under the cursor
      const id = this._pickNode(e.clientX, e.clientY);
      if (id) {
        this.flash(id, 2.4);
        this.onSelect?.(id);
      }
    }
    this.dragging = false;
    this._releaseSelection();
  }

  /** Give text selection back once the gesture is over. */
  private _releaseSelection() {
    document.body.style.userSelect = "";
    (document.body.style as CSSStyleDeclaration & { webkitUserSelect?: string }).webkitUserSelect =
      "";
  }

  private _onWheel(e: WheelEvent) {
    if (!this._interactive() || this._busy() || !this._isSphereSpace(e)) return;
    e.preventDefault();
    const fit = this._fitZ();
    const step = (e.deltaY > 0 ? 0.08 : -0.08) * fit;
    // Clamped against the fitting distance so the limits mean the same thing in
    // the panel as at fullscreen.
    this.targetCamZ = Math.max(fit * 0.5, Math.min(fit * 1.6, this.targetCamZ + step));
    this.camMult = this.targetCamZ / fit;
  }

  /** Trackball-style world-space rotation: yaw about world-Y, pitch about world-X. */
  private _rotateGroup(yaw: number, pitch: number) {
    const T = this.T;
    const qx = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), yaw);
    const qy = new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), pitch);
    this.group.quaternion.premultiply(qx).premultiply(qy);
  }

  /** Nearest front-facing node within a pixel radius of (cx,cy), or null. */
  private _pickNode(cx: number, cy: number): string | null {
    if (!this.renderer || !this.cam || !this.group) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const v = new this.T.Vector3();
    let best: string | null = null;
    let bestD = 24 * 24; // px² hit radius
    for (const id in this.sprites) {
      const n = this.nmap[id];
      if (!n || !this.sprites[id].visible) continue;
      const wp = n.pos.clone().applyQuaternion(this.group.quaternion);
      // Skip nodes hidden on the far side — but only shell nodes. An interior one
      // is visible straight through the sphere, so culling it by hemisphere would
      // make the core unclickable.
      const shellBound = wp.length() > this.R * 0.72;
      if (
        shellBound &&
        wp.clone().normalize().dot(this.cam.position.clone().sub(wp).normalize()) < 0
      )
        continue;
      v.copy(wp).project(this.cam);
      if (v.z >= 1) continue;
      const sx = (v.x * 0.5 + 0.5) * rect.width + rect.left;
      const sy = (-v.y * 0.5 + 0.5) * rect.height + rect.top;
      const dx = sx - cx;
      const dy = sy - cy;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    }
    return best;
  }

  private _updateHover(e: PointerEvent) {
    const id =
      this._interactive() && this._isSphereSpace(e) ? this._pickNode(e.clientX, e.clientY) : null;
    if (id === this.hoverId) return;
    this.hoverId = id;
    document.body.style.cursor = id ? "pointer" : "";
    if (id) {
      const m = this.nodeMeta[id];
      if (m)
        this.setState({
          callout: {
            id,
            tag: m.title,
            type: (m.type || "").toUpperCase(),
            line: (m.summary || "").slice(0, 120),
          },
        });
    } else if (this.state.queryState === "idle") {
      this.setState({ callout: null });
    }
  }

  /**
   * The canvas is sized by its MOUNT, not the window — the graph lives in a panel
   * on the dashboard and only fills the viewport when expanded.
   */
  private _canvasSize(): { w: number; h: number } {
    const mount = document.getElementById("cm-canvas-mount");
    const w = mount?.clientWidth || (typeof window === "undefined" ? 1 : innerWidth);
    const h = mount?.clientHeight || (typeof window === "undefined" ? 1 : innerHeight);
    return { w: Math.max(1, w), h: Math.max(1, h) };
  }

  /**
   * Mark-size multiplier for small canvases. Everything in the scene is in world
   * units, so shrinking the canvas shrinks every dot and tube with it — in the
   * dashboard panel the sphere became an unreadable smudge. Marks are scaled back
   * up sub-linearly (^0.6): enough to stay legible, not so much that the panel
   * turns back into overlapping blobs. 1× on any comfortably large canvas.
   */
  private _legibility(): number {
    const { w, h } = this._canvasSize();
    const short = Math.min(w, h);
    return Math.max(1, Math.min(2.4, (LEGIBILITY_REF / short) ** 0.6));
  }

  /**
   * Distance at which the sphere and its halo exactly fill the canvas. Every
   * camera move is a multiple of this rather than an absolute Z, so the same
   * framing holds in a 300px panel and at fullscreen.
   */
  private _fitZ(): number {
    const { w, h } = this._canvasSize();
    const fov = this.cam?.fov ?? 52;
    const tanV = Math.tan((fov * Math.PI) / 360);
    const tanH = tanV * (w / h);
    return (this.R * 1.18) / Math.max(1e-3, Math.min(tanV, tanH));
  }

  /**
   * A framing distance. `mult` < 1 pushes in; 1 is the whole sphere in frame.
   *
   * This used to ease every zoom back toward the fitting distance on canvases
   * under 520px, on the grounds that a small panel has no room to crop into —
   * which was the right observation applied to the wrong axis. A canvas has no
   * room to crop into at any size, so the limit belongs in `_frame` as a floor
   * on the multiplier, not here as a size-conditional fudge. This is now just
   * the multiplier-to-distance map.
   */
  private _zoom(mult: number): number {
    return this._fitZ() * mult;
  }

  private _onResize() {
    if (!this.renderer) return;
    const { w, h } = this._canvasSize();
    const d2 = Math.min(devicePixelRatio, 2);
    this.renderer.setSize(w, h);
    this.cam.aspect = w / h;
    this.cam.updateProjectionMatrix();
    this.uScale = h * d2 * 0.5 * this._legibility();
    if (this.dotMat) this.dotMat.uniforms.uScale.value = this.uScale;
    if (this.haloMat) this.haloMat.uniforms.uScale.value = this.uScale;
    // Resting distances are relative to the canvas, so re-derive the current one.
    this.targetCamZ = this._zoom(this.camMult);
    // Tube radius is baked into geometry and legibility just changed with it.
    // Debounced: a CSS size transition fires the observer every frame.
    clearTimeout(this._resizeArcTimer);
    this._resizeArcTimer = setTimeout(() => this._queueArcRebuild(), 180);
  }

  private rng(seed: number) {
    let s = seed;
    return () => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
  }

  // ── textures ────────────────────────────────────────────────────────────────
  /**
   * The dot sprite/point mask. WHITE, not black — `SpriteMaterial` multiplies the
   * texture's RGB by `color`, so a black texel renders black whatever colour is
   * set on it. This was filled `#000`, which silently pinned every data node to
   * black: the dark theme's lighter node colour never showed, and neither would
   * the widget's node picker. The two shaders that also use this texture sample
   * only its alpha, so they are unaffected.
   */
  private dotTex() {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const x = c.getContext("2d")!;
    x.beginPath();
    x.arc(32, 32, 25, 0, Math.PI * 2);
    x.fillStyle = "#fff";
    x.fill();
    return new this.T.CanvasTexture(c);
  }
  private softTex() {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const x = c.getContext("2d")!;
    const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, "rgba(0,0,0,.5)");
    g.addColorStop(0.5, "rgba(0,0,0,.18)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = g;
    x.fillRect(0, 0, 128, 128);
    return new this.T.CanvasTexture(c);
  }
  private ringTex() {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const x = c.getContext("2d")!;
    x.strokeStyle = "#ffffff";
    x.lineWidth = 4;
    x.beginPath();
    x.arc(64, 64, 46, 0, Math.PI * 2);
    x.stroke();
    return new this.T.CanvasTexture(c);
  }
  private discTex() {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const x = c.getContext("2d")!;
    x.beginPath();
    x.arc(32, 32, 26, 0, Math.PI * 2);
    x.fillStyle = "#fff";
    x.fill();
    return new this.T.CanvasTexture(c);
  }
  private glowTexW() {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const x = c.getContext("2d")!;
    const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.4, "rgba(255,255,255,.6)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = g;
    x.fillRect(0, 0, 128, 128);
    return new this.T.CanvasTexture(c);
  }
  private labelTex(text: string, size: number, col: string) {
    const c = document.createElement("canvas");
    c.width = 512;
    c.height = 80;
    const x = c.getContext("2d")! as any;
    x.font = `500 ${size}px "Space Grotesk", system-ui, sans-serif`;
    x.textAlign = "center";
    x.textBaseline = "middle";
    try {
      x.letterSpacing = "4px";
    } catch {}
    // Glow behind the text matches the background so labels stay legible on the
    // sphere in both themes (light halo on white, dark halo on near-black).
    x.shadowColor = this.dark ? "rgba(8,10,14,0.95)" : "rgba(255,255,255,0.95)";
    x.shadowBlur = 10;
    x.fillStyle = col;
    const t = (text || "").toUpperCase().slice(0, 28);
    x.fillText(t, 256, 42);
    x.fillText(t, 256, 42);
    return new this.T.CanvasTexture(c);
  }

  /** Theme-aware label text color, by label kind. */
  private _labelCol(kind: "cluster" | "insight" | "node"): string {
    if (kind === "cluster") return this.dark ? "#9aa0ab" : "#8a8a8a";
    if (kind === "insight") return this.dark ? "#d9b35a" : "#9a7b2a";
    return this.dark ? "#aeb4bf" : "#3a3a3a";
  }

  /** Regenerate every label texture for the current theme (cluster + node labels). */
  private _rebuildLabels() {
    for (const l of this.labels.concat(this.nodeLabels)) {
      if (!l.kind) continue;
      const tex = this.labelTex(l.text, l.size, this._labelCol(l.kind));
      const old = l.sprite.material.map;
      l.sprite.material.map = tex;
      l.sprite.material.needsUpdate = true;
      old?.dispose?.();
    }
  }

  // ── scene construction ──────────────────────────────────────────────────────
  private _initGL() {
    const T = this.T;
    const mount = document.getElementById("cm-canvas-mount");
    if (!mount) return;
    mount.innerHTML = "";
    const el = document.createElement("canvas");
    el.style.cssText = "position:absolute;top:0;left:0;display:block";
    mount.appendChild(el);

    const { w: W, h: H } = this._canvasSize();
    const dpr = Math.min(devicePixelRatio, 2);
    this.renderer = new T.WebGLRenderer({
      canvas: el,
      antialias: true,
      preserveDrawingBuffer: true,
      alpha: false,
    });
    this.renderer.setSize(W, H);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setClearColor(this.dark ? 0x0b0d12 : 0xffffff, 1);

    this.scene = new T.Scene();
    this.cam = new T.PerspectiveCamera(52, W / H, 0.1, 200);
    this.group = new T.Group();
    this.scene.add(this.group);

    this.uScale = H * dpr * 0.5 * this._legibility();
    this.cam.position.z = this._fitZ();
    this.targetCamZ = this.cam.position.z;
    this._buildBackground();
    this._buildHalo();
    // The panel resizes without the window doing so (expand/collapse, sidebars),
    // and a window `resize` listener alone never hears about it.
    if (typeof ResizeObserver !== "undefined") {
      this._ro = new ResizeObserver(() => this._onResize());
      this._ro.observe(mount);
    }
    this._rafLoop();
  }

  private _dotShader(extraFront: number) {
    const T = this.T;
    return new T.ShaderMaterial({
      uniforms: {
        uTex: { value: this.dotTex() },
        uScale: { value: this.uScale },
        uDark: { value: this.dark ? 1 : 0 },
      },
      vertexShader: `attribute float aSize; varying float vDepth; uniform float uScale;
        void main(){ vec4 mv=modelViewMatrix*vec4(position,1.0); float dist=-mv.z;
        vDepth=clamp((dist-3.2)/5.0,0.0,1.0); gl_PointSize=aSize*uScale/dist; gl_Position=projectionMatrix*mv; }`,
      fragmentShader: `uniform sampler2D uTex; uniform float uDark; varying float vDepth;
        void main(){ float m=texture2D(uTex,gl_PointCoord).a; if(m<0.5) discard;
        float g=mix(${(0.03 + (extraFront || 0)).toFixed(2)},0.8,vDepth);
        float gd=mix(0.95,0.06,vDepth); g=mix(g,gd,uDark); gl_FragColor=vec4(vec3(g),1.0); }`,
      transparent: false,
      depthTest: true,
      depthWrite: true,
    });
  }

  private _buildBackground() {
    const T = this.T;
    const R = this.R;
    const r = this.rng(11);
    const ico = new T.IcosahedronGeometry(R, 3);
    const vp = ico.attributes.position;
    const seen = new Set<string>();
    this.verts = [];
    for (let i = 0; i < vp.count; i++) {
      const x = vp.getX(i);
      const y = vp.getY(i);
      const z = vp.getZ(i);
      const key = `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
      if (!seen.has(key)) {
        seen.add(key);
        this.verts.push([x, y, z]);
      }
    }
    const dpos: number[] = [];
    const dsize: number[] = [];
    for (const v of this.verts) {
      dpos.push(v[0]!, v[1]!, v[2]!);
      dsize.push(r() < 0.08 ? 0.08 + r() * 0.06 : 0.026 + r() * 0.022);
    }
    const dGeo = new T.BufferGeometry();
    dGeo.setAttribute("position", new T.BufferAttribute(new Float32Array(dpos), 3));
    dGeo.setAttribute("aSize", new T.BufferAttribute(new Float32Array(dsize), 1));
    this.dotMat = this._dotShader(0);
    this.group.add(new T.Points(dGeo, this.dotMat));

    const wf = new T.WireframeGeometry(ico);
    this.lineMat = new T.ShaderMaterial({
      uniforms: { uDark: { value: this.dark ? 1 : 0 } },
      vertexShader: `varying float vDepth; void main(){ vec4 mv=modelViewMatrix*vec4(position,1.0);
        vDepth=clamp((-mv.z-3.2)/5.0,0.0,1.0); gl_Position=projectionMatrix*mv; }`,
      fragmentShader: `uniform float uDark; varying float vDepth;
        void main(){ float g=mix(0.42,0.9,vDepth); float gd=mix(0.55,0.14,vDepth); g=mix(g,gd,uDark);
        float a=mix(0.52,0.07,vDepth); gl_FragColor=vec4(vec3(g),a); }`,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.group.add(new T.LineSegments(wf, this.lineMat));
  }

  private _buildHalo() {
    const T = this.T;
    const R = this.R;
    const r = this.rng(91);
    const N = 240;
    const pos: number[] = [];
    const sz: number[] = [];
    const shade: number[] = [];
    for (let i = 0; i < N; i++) {
      const rad = R * (1.0 + r() * 0.3);
      const th = r() * Math.PI * 2;
      const ph = Math.acos(2 * r() - 1);
      pos.push(
        rad * Math.sin(ph) * Math.cos(th),
        rad * Math.cos(ph),
        rad * Math.sin(ph) * Math.sin(th),
      );
      sz.push(0.02 + r() * 0.045);
      shade.push(r() < 0.22 ? 0.0 : 0.45 + r() * 0.45);
    }
    const g = new T.BufferGeometry();
    g.setAttribute("position", new T.BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute("aSize", new T.BufferAttribute(new Float32Array(sz), 1));
    g.setAttribute("aShade", new T.BufferAttribute(new Float32Array(shade), 1));
    this.haloMat = new T.ShaderMaterial({
      uniforms: {
        uTex: { value: this.dotTex() },
        uScale: { value: this.uScale },
        uDark: { value: this.dark ? 1 : 0 },
      },
      vertexShader: `attribute float aSize; attribute float aShade; varying float vD; uniform float uScale;
        void main(){ vec4 mv=modelViewMatrix*vec4(position,1.0); float dist=-mv.z;
        vD=clamp(max((dist-3.2)/5.0, aShade),0.0,1.0); gl_PointSize=aSize*uScale/dist; gl_Position=projectionMatrix*mv; }`,
      fragmentShader: `uniform sampler2D uTex; uniform float uDark; varying float vD;
        void main(){ float m=texture2D(uTex,gl_PointCoord).a; if(m<0.5) discard;
        float g=mix(0.08,0.9,vD); float gd=mix(0.9,0.07,vD); g=mix(g,gd,uDark); gl_FragColor=vec4(vec3(g),1.0); }`,
      transparent: false,
      depthTest: true,
      depthWrite: true,
    });
    this.group.add(new T.Points(g, this.haloMat));

    const soft = this.softTex();
    for (let i = 0; i < 16; i++) {
      const rad = R * (1.02 + r() * 0.4);
      const th = r() * Math.PI * 2;
      const ph = Math.acos(2 * r() - 1);
      const sp = new T.Sprite(
        new T.SpriteMaterial({
          map: soft,
          color: 0x000000,
          transparent: true,
          opacity: 0.022 + r() * 0.04,
          depthTest: false,
          depthWrite: false,
        }),
      );
      sp.position.set(
        rad * Math.sin(ph) * Math.cos(th),
        rad * Math.cos(ph),
        rad * Math.sin(ph) * Math.sin(th),
      );
      sp.scale.setScalar(0.35 + r() * 0.8);
      this.group.add(sp);
    }
  }

  /**
   * A connection rendered as a solid tube (linewidth is ignored in WebGL, so a
   * tube gives real thickness). `radius` sets the thickness; `role` the tint,
   * which is re-resolved on a theme switch rather than baked in.
   * A gentle opacity breathe is applied per-frame in the render loop.
   */
  private _makeArc(aId: string, bId: string, radius: number, role: ArcRole) {
    const T = this.T;
    const na = this.nmap[aId];
    const nb = this.nmap[bId];
    if (!na || !nb) return null;
    const mid = na.pos.clone().add(nb.pos).multiplyScalar(0.5);
    // Shell-to-shell arcs bow outward over the surface — the signature look. An
    // arc touching an interior node keeps close to a straight chord instead, so a
    // bridge concept reads as wired THROUGH the sphere rather than over it.
    const shellness = Math.min(na.pos.length(), nb.pos.length()) / this.R;
    const bow = na.pos.distanceTo(nb.pos) * 0.32 * shellness;
    if (mid.lengthSq() > 1e-6) mid.setLength(Math.min(mid.length() + bow, this.R + 1.0));
    const curve = new T.QuadraticBezierCurve3(na.pos.clone(), mid, nb.pos.clone());
    const geo = new T.TubeGeometry(
      curve,
      40,
      radius * this.linkWidth * this._legibility(),
      8,
      false,
    );
    const mat = new T.MeshBasicMaterial({
      color: new T.Color(this._arcColor(role)),
      transparent: true,
      opacity: 0.85,
      depthTest: false,
      depthWrite: false,
    });
    const mesh = new T.Mesh(geo, mat);
    this.group.add(mesh);
    return { mesh, mat, curve, role, base: radius };
  }

  // ── render loop ─────────────────────────────────────────────────────────────
  private _rafLoop() {
    this.rafId = requestAnimationFrame(() => this._rafLoop());
    if (!this.renderer) return;
    const now = performance.now() / 1000;
    const dt = Math.min(now - (this._lt || now), 0.05);
    this._lt = now;
    const rot = this.reduceMotion ? 0.006 : 0.026;
    if (this.group) {
      if (this.state.queryState === "querying" && this.focusQuat) {
        this.group.quaternion.slerp(this.focusQuat, 0.07);
      } else if (this.dragging) {
        /* rotation is driven live by the pointer-move handler */
      } else if (Math.abs(this.velX) > 1e-4 || Math.abs(this.velY) > 1e-4) {
        // fling inertia after releasing a drag
        this._rotateGroup(this.velX, this.velY);
        this.velX *= 0.93;
        this.velY *= 0.93;
      } else if (!this.explore && !this.reduceMotion) {
        // ambient auto-spin only when not actively exploring
        if (!this._YAX) this._YAX = new this.T.Vector3(0, 1, 0);
        const qy = new this.T.Quaternion().setFromAxisAngle(this._YAX, dt * rot);
        this.group.quaternion.multiply(qy);
      }
    }
    const focusing = this.state.queryState !== "idle" || this.dragging || this.explore;
    const mx = focusing ? 0 : this.mouseX;
    const my = focusing ? 0 : this.mouseY;
    this.cam.position.x += (mx * 0.45 - this.cam.position.x) * 0.05;
    this.cam.position.y += (-my * 0.32 - this.cam.position.y) * 0.05;
    this.cam.position.z += (this.targetCamZ - this.cam.position.z) * 0.045;
    this.cam.lookAt(0, 0, 0);
    for (const l of this.labels.concat(this.nodeLabels)) {
      const wp = new this.T.Vector3();
      l.sprite.getWorldPosition(wp);
      const toCam = this.cam.position.clone().sub(wp).normalize();
      const facing = wp.clone().normalize().dot(toCam);
      const max = l.sprite.scale.x > 1.1 ? 0.46 : 0.66;
      l.sprite.material.opacity = Math.max(0, Math.min(max, (facing - 0.05) * 1.4));
    }
    for (const id in this.sprites) {
      const sp = this.sprites[id];
      if (this.visited.has(id)) {
        sp.material.opacity = 1;
        if (!this.nodeFlashes[id]) sp.scale.setScalar(this._nodeScale(id) * 1.42);
        continue;
      }
      if (this.nodeFlashes[id]) continue;
      if (!sp.visible) continue;
      const wp = new this.T.Vector3();
      sp.getWorldPosition(wp);
      const facing = wp.clone().normalize().dot(this.cam.position.clone().sub(wp).normalize());
      // A deep node is seen THROUGH the shell from every angle, so it never fades
      // out the way a surface node does when it rotates behind.
      const depth = this.nmap[id]?.depth ?? 0;
      sp.material.opacity = Math.max(0.22 + 0.34 * depth, Math.min(1, facing + 0.4));
      if (this.focusId) {
        // In focus mode the handful of survivors are the whole picture: hold them
        // at full strength and swell the focused node itself.
        sp.material.opacity = 1;
        sp.scale.setScalar(this._nodeScale(id) * (id === this.focusId ? 2.1 : 1.5));
      }
    }
    for (const a of this.focusArcs) {
      a.mat.opacity = 0.78 + 0.18 * Math.sin(now * 1.6 + a.curve.v1.x);
    }
    if (this.state.callout) {
      const el = document.getElementById("cm-callout");
      const n = this.nmap[this.state.callout.id];
      if (el && n) {
        const v = n.pos.clone().applyQuaternion(this.group.quaternion).project(this.cam);
        // Offset by the canvas rect — it is a panel in the corner, not the page.
        const r = this.renderer.domElement.getBoundingClientRect();
        el.style.left = `${r.left + (v.x * 0.5 + 0.5) * r.width}px`;
        el.style.top = `${r.top + (-v.y * 0.5 + 0.5) * r.height}px`;
        el.style.opacity = v.z < 1 ? "1" : "0";
      }
    }
    for (const a of this.arcs) {
      a.mat.opacity = 0.72 + 0.16 * Math.sin(now * 1.1 + a.curve.v1.x);
    }
    this._tickPackets(now);
    this._tickFlashes(now);
    this._tickTransients(now);
    this._tickIdle(now);
    this.renderer.render(this.scene!, this.cam);
  }

  private _mkDot(op: number) {
    const T = this.T;
    return new T.Sprite(
      new T.SpriteMaterial({
        map: this.dotTex(),
        color: this._fg(),
        transparent: true,
        opacity: op || 1,
        depthTest: false,
        depthWrite: false,
      }),
    );
  }

  private _tickPackets(now: number) {
    const done: any[] = [];
    for (const p of this.packets) {
      const t = Math.min((now - p.t0) / p.dur, 1);
      if (p.curve) p.curve.getPoint(t, p.sp.position);
      else p.sp.position.lerpVectors(p.a, p.b, t);
      const base = p.group ? 1 : 0.11;
      p.sp.scale.setScalar(base * (0.5 + 0.9 * Math.sin(t * Math.PI)));
      if (t >= 1) done.push(p);
    }
    for (const p of done) {
      this.group.remove(p.sp);
      this.scene!.remove(p.sp);
      this.packets.splice(this.packets.indexOf(p), 1);
      if (p.onArrive) p.onArrive();
      else if (p.to) this._flash(p.to, 2.0, now);
    }
  }

  private _tickFlashes(now: number) {
    for (const [id, f] of Object.entries(this.nodeFlashes)) {
      const t = (now - (f as any).t0) / (f as any).dur;
      const sp = this.sprites[id];
      const rest = this._nodeScale(id);
      if (t >= 1) {
        if (sp) {
          sp.scale.setScalar(this.visited.has(id) ? rest * 1.42 : rest);
          sp.material.opacity = 1;
        }
        delete this.nodeFlashes[id];
        continue;
      }
      if (sp) {
        sp.scale.setScalar(rest * (1 + Math.sin(t * Math.PI) * (f as any).pk));
        sp.material.opacity = 1;
      }
    }
  }

  private _tickTransients(now: number) {
    const done: any[] = [];
    for (const tr of this.transients) {
      const t = (now - tr.t0) / tr.dur;
      if (t >= 1) {
        done.push(tr);
        continue;
      }
      tr.update(t);
    }
    for (const tr of done) {
      tr.cleanup();
      this.transients.splice(this.transients.indexOf(tr), 1);
    }
  }

  private _tickIdle(now: number) {
    if (this.state.queryState !== "idle" || this.reduceMotion || !this.dataLoaded) return;
    if (!this.lastIdleEvent) {
      this.lastIdleEvent = now;
      return;
    }
    if (now - this.lastIdleEvent > 13 + Math.random() * 5) {
      this.lastIdleEvent = now;
      this.idleToggle = (this.idleToggle + 1) % 3;
      if (this.idleToggle === 0) this._idleMerge(now);
      else if (this.idleToggle === 1) this._idleArcSnap(now);
      else this._idleTrace(now);
    }
  }

  private _flash(id: string, pk: number, now: number) {
    this.nodeFlashes[id] = { t0: now, dur: 1.6, pk: pk || 1.4 };
  }

  private _launch(fromId: string, toId: string, curve?: any) {
    const na = this.nmap[fromId];
    const nb = this.nmap[toId];
    if (!na || !nb) return;
    const sp = this._mkDot(1);
    sp.position.copy(na.pos);
    sp.scale.setScalar(0.06);
    this.group.add(sp);
    this.packets.push({
      sp,
      a: na.pos.clone(),
      b: nb.pos.clone(),
      curve,
      t0: performance.now() / 1000,
      dur: curve ? 1.2 : 1.0,
      to: toId,
    });
  }

  private _randIds(): string[] {
    return Object.keys(this.nmap);
  }

  private _idleTrace(now: number) {
    const ids = this._randIds();
    if (ids.length < 2) return;
    const a = ids[Math.floor(Math.random() * ids.length)]!;
    const b = ids[Math.floor(Math.random() * ids.length)]!;
    if (a !== b) {
      this._launch(a, b);
      this._flash(a, 1.2, now);
    }
  }

  private _idleMerge(now: number) {
    const ids = this._randIds();
    if (ids.length < 2) return;
    const a = ids[Math.floor(Math.random() * ids.length)]!;
    let b = ids[Math.floor(Math.random() * ids.length)]!;
    let guard = 0;
    while (b === a && guard++ < 8) b = ids[Math.floor(Math.random() * ids.length)]!;
    const na = this.nmap[a];
    const nb = this.nmap[b];
    if (!na || !nb) return;
    const mid = na.pos.clone().add(nb.pos).multiplyScalar(0.5);
    const p1 = this._mkDot(1);
    const p2 = this._mkDot(1);
    p1.position.copy(na.pos);
    p2.position.copy(nb.pos);
    p1.scale.setScalar(0.1);
    p2.scale.setScalar(0.1);
    this.group.add(p1);
    this.group.add(p2);
    const ring = new this.T.Sprite(
      new this.T.SpriteMaterial({
        map: this.ringTex(),
        color: this._fg(),
        transparent: true,
        opacity: 0,
        depthTest: false,
        depthWrite: false,
      }),
    );
    ring.position.copy(mid);
    ring.scale.setScalar(0.1);
    this.group.add(ring);
    this.transients.push({
      t0: now,
      dur: 2.0,
      update: (t: number) => {
        const conv = Math.min(t / 0.55, 1);
        p1.position.lerpVectors(na.pos, mid, conv);
        p2.position.lerpVectors(nb.pos, mid, conv);
        if (t < 0.55) {
          p1.material.opacity = 1;
          p2.material.opacity = 1;
        } else {
          const f = 1 - (t - 0.55) / 0.45;
          p1.material.opacity = f;
          p2.material.opacity = f;
        }
        if (t > 0.5) {
          const rt = (t - 0.5) / 0.5;
          ring.material.opacity = (1 - rt) * 0.7;
          ring.scale.setScalar(0.1 + rt * 1.9);
        }
      },
      cleanup: () => {
        this.group.remove(p1);
        this.group.remove(p2);
        this.group.remove(ring);
      },
    });
    this._flash(a, 1.4, now);
    setTimeout(() => this._flash(b, 1.4, performance.now() / 1000), 300);
  }

  private _idleArcSnap(now: number) {
    const ids = this._randIds();
    if (ids.length < 2) return;
    const a = ids[Math.floor(Math.random() * ids.length)]!;
    let b = ids[Math.floor(Math.random() * ids.length)]!;
    let guard = 0;
    while (b === a && guard++ < 8) b = ids[Math.floor(Math.random() * ids.length)]!;
    const arc = this._makeArc(a, b, 0.007, "relates");
    if (!arc) return;
    arc.mat.opacity = 0;
    this._flash(a, 1.8, now);
    setTimeout(() => this._flash(b, 1.8, performance.now() / 1000), 120);
    this.transients.push({
      t0: now,
      dur: 5.0,
      update: (t: number) => {
        arc.mat.opacity =
          t < 0.16 ? (t / 0.16) * 0.85 : t > 0.7 ? 0.85 * (1 - (t - 0.7) / 0.3) : 0.85;
      },
      cleanup: () => {
        this.group.remove(arc.mesh);
      },
    });
  }

  // ── live query ──────────────────────────────────────────────────────────────
  async runLiveQuery(q?: string) {
    // Only block while a query is mid-flight; from "idle" or "answered" a new
    // question is allowed (so you can ask again without dismissing first).
    if (this.state.queryState === "querying" || this.state.queryState === "returning") return;
    // Wait for WebGL to be ready, but DON'T block on an empty graph — a query with
    // no matches falls through to the "nothing in your graph yet" answer, which
    // offers to research the web and bootstrap notes into an empty graph.
    if (!this.renderer || this.verts.length === 0) return;
    const query = q || "What connects my thinking across domains?";
    this._resetTraversal();
    this.lastQuery = query;
    this.setState({
      queryState: "querying",
      showAnswer: false,
      noMatch: false,
      answerGrounded: false,
      queryInput: query,
      traverseStage: "searching your graph",
      traceLines: [],
      callout: null,
      sources: [],
    });
    // As close as the traversal can get without clipping the shell — the hops
    // swing nodes to the front, so anything off-frame is a hop you cannot see.
    this._frame(this.reduceMotion ? 0.95 : FRAME_FLOOR);
    const mount = document.getElementById("cm-canvas-mount");
    if (mount) mount.style.filter = "blur(0px)";
    const h = document.getElementById("cm-hud");
    if (h) {
      h.style.transition = "opacity .8s ease,filter .8s ease";
      h.style.opacity = ".06";
      h.style.filter = "blur(7px)";
    }
    const c = document.getElementById("cm-center");
    if (c) c.style.transform = "translateX(-50%) rotateY(0deg) rotateX(0deg) scale(.96)";

    let results: SearchHit[] = [];
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query }),
      });
      results = ((await res.json()) as { results: SearchHit[] }).results ?? [];
    } catch {
      /* offline */
    }
    // Synthesis runs for EVERY question, before any threshold is applied. The
    // daemon does its own, wider retrieval and says so plainly when it finds
    // nothing, so gating it behind the sphere's animation threshold only threw
    // away answers it was perfectly able to give — which is exactly what the
    // no-match branch used to do to any question phrased as a question.
    //
    // Fired now rather than after the animation: the hops take ~3s and a Sonnet
    // call takes about the same, so running them in parallel is the difference
    // between an answer that lands with the last hop and one that makes you
    // wait for a finished animation.
    this.answerPending = this._synthesise(query);

    const hits = results
      .filter((hit) => this.nmap[hit.id] && hit.score <= TRAVERSE_MAX_DISTANCE)
      .slice(0, 6);
    // Whether anything came close enough that "closest in your graph: X" would
    // be an honest thing to say if synthesis is unavailable.
    const close = hits.some((hit) => hit.score <= MATCH_MAX_DISTANCE);

    // Nothing worth walking to. The question can still have a real answer, so
    // skip the traversal and go straight to the reveal rather than declaring a
    // dead end before asking.
    if (hits.length === 0) {
      this._returnGL();
      void this._revealAnswerLive([], false, false);
      return;
    }

    if (this.reduceMotion) {
      hits.forEach((hit) => {
        this.visited.add(hit.id);
      });
      this._returnGL();
      void this._revealAnswerLive(hits, true, close);
      return;
    }

    const S = this.speed || 1;
    let t = 0;
    const at = (gap: number, fn: () => void) => {
      this._timers.push(setTimeout(fn, t / S));
      t += gap;
    };
    hits.forEach((hit, i) => {
      at(i === 0 ? 360 : 660, () => {
        if (i > 0) this._hop(hits[i - 1]!.id, hit.id, "query");
        this._focusNode(hit.id);
        this._visitLive(hit, i);
        this.setState({ traverseStage: `reading · ${hit.type}` });
      });
    });
    at(680, () => {
      this.setState({ traverseStage: "converging" });
      this._converge(hits.map((x) => x.id));
    });
    at(1400, () => {
      this._returnGL();
      this._traceBackId(hits[hits.length - 1]!.id);
    });
    at(900, () => void this._revealAnswerLive(hits, false, close));
  }

  /** Ask the daemon to answer the question from the graph. Never throws — a
   *  missing key, a tripped budget or a stopped daemon all resolve to null. */
  private async _synthesise(question: string): Promise<AnswerDto | null> {
    try {
      const res = await fetch("/api/answer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question }),
      });
      return (await res.json()) as AnswerDto;
    } catch {
      return null;
    }
  }

  private _visitLive(hit: SearchHit, i: number) {
    const now = performance.now() / 1000;
    this._flash(hit.id, 2.6, now);
    this.visited.add(hit.id);
    this.setState({
      callout: {
        id: hit.id,
        tag: hit.title,
        type: hit.type.toUpperCase(),
        line: hit.summary.slice(0, 120),
      },
    });
    const glow = new this.T.Sprite(
      new this.T.SpriteMaterial({
        map: this.glowTexW(),
        color: new this.T.Color(this.CYAN),
        transparent: true,
        opacity: 0.5,
        depthTest: false,
        depthWrite: false,
      }),
    );
    glow.position.copy(this.nmap[hit.id]!.pos);
    glow.scale.setScalar(0.34);
    this.group.add(glow);
    this.trail.push(glow);
    this.setState((s) => ({
      traceLines: [
        ...s.traceLines,
        {
          n: String(i + 1).padStart(2, "0"),
          label: hit.title.toUpperCase(),
          detail: hit.summary.slice(0, 110),
          accent: this.CYAN,
        },
      ],
    }));
  }

  /**
   * Show the answer. `close` says whether any hit was near enough that reading
   * out the nearest node would be an honest fallback; `hits` may be empty, in
   * which case there was nothing to walk to but the question can still have an
   * answer.
   */
  private async _revealAnswerLive(hits: SearchHit[], instant: boolean, close: boolean) {
    const lead = hits[0];
    const others = hits
      .slice(1, 4)
      .map((h) => h.title)
      .join(", ");
    // What the ask bar said before it could reason: the nearest node, read out.
    // Still the fallback when synthesis is unavailable — but only when
    // something was actually close, or "closest in your graph" overstates it.
    const retrieved =
      lead && close
        ? `Closest in your graph: ${lead.title}. ${lead.summary}${others ? `\n\nIt connects to ${others}.` : ""}`
        : null;

    const gen = this.traversalGen;
    const pending = this.answerPending;
    this.answerPending = null;
    let synth: AnswerDto | null = null;
    if (pending) {
      this.setState({ traverseStage: "thinking it through" });
      synth = await pending;
      if (this.traversalGen !== gen) return; // replaced while we were waiting
    }
    const grounded = Boolean(synth?.ok && synth.answer?.trim());
    // A grounded answer can still BE "there is nothing here" — explained far
    // better than the stock line, but the same situation, so it keeps the offer
    // to go and research the topic.
    const gap = grounded && synth?.inGraph === false;

    // No synthesis and nothing close enough to read out: now it is a real dead
    // end, and the honest move is to offer the web rather than to dress up a
    // distant node as an answer.
    if (!grounded && !retrieved) {
      this.setState({
        queryState: "answered",
        showAnswer: true,
        noMatch: true,
        answerGrounded: false,
        answerText: `Nothing in your graph answers “${this.lastQuery}” yet.`,
        traverseStage: "",
        sources: [],
      });
      return;
    }

    const full = grounded ? (synth?.answer as string) : (retrieved as string);
    // Cite what the model actually used, when it used anything; an answer that
    // names the gap cites nothing, and listing the hits under it would imply a
    // support it just told you it did not have.
    const cited = grounded ? (synth?.citations ?? []) : [];
    const sources = grounded
      ? cited.map((c) => ({ label: c.title, id: c.id }))
      : hits.map((h) => ({ label: h.title, id: h.id }));

    this.setState((s) => ({
      traceLines: [
        ...s.traceLines,
        {
          n: String(hits.length + 1).padStart(2, "0"),
          label: grounded ? "ANSWERED FROM YOUR GRAPH" : "RETRIEVED FROM YOUR GRAPH",
          detail: "",
          accent: this._gold(),
        },
      ],
      queryState: "answered",
      showAnswer: true,
      noMatch: gap,
      answerGrounded: grounded,
      callout: null,
      traverseStage: "",
      sources,
      answerText: instant ? full : "",
    }));
    if (instant) return;
    let i = 0;
    const type = () => {
      if (i > full.length) return;
      i += 5;
      this.setState({ answerText: full.slice(0, i) });
      setTimeout(type, 14);
    };
    type();
  }

  private _focusNode(id: string) {
    const n = this.nmap[id];
    if (!n || !this.T) return;
    const dir = n.pos.clone().normalize();
    this.focusQuat = new this.T.Quaternion().setFromUnitVectors(dir, new this.T.Vector3(0, 0, 1));
  }

  private _mkPacket(hex: string) {
    const T = this.T;
    const g = new T.Group();
    const halo = new T.Sprite(
      new T.SpriteMaterial({
        map: this.glowTexW(),
        color: new T.Color(hex),
        transparent: true,
        opacity: 0.6,
        depthTest: false,
        depthWrite: false,
      }),
    );
    halo.scale.setScalar(0.16);
    const core = new T.Sprite(
      new T.SpriteMaterial({
        map: this.discTex(),
        color: new T.Color(hex),
        transparent: true,
        opacity: 1,
        depthTest: false,
        depthWrite: false,
      }),
    );
    core.scale.setScalar(0.06);
    g.add(halo);
    g.add(core);
    return g;
  }

  /**
   * A one-off travelling arc: a real graph write (`relates`/`contradicts`) or a
   * step in a live search traversal (`query`). Writes get the heavier treatment
   * — a fatter, higher-bowed tube and a gold packet — because they're the rarer,
   * more significant event.
   */
  private _hop(fromId: string, toId: string, role: ArcRole) {
    const na = this.nmap[fromId];
    const nb = this.nmap[toId];
    if (!na || !nb) return;
    const now = performance.now() / 1000;
    const major = role !== "query";
    const mid = na.pos.clone().add(nb.pos).multiplyScalar(0.5);
    const bow = na.pos.distanceTo(nb.pos) * (major ? 0.34 : 0.16);
    mid.normalize().multiplyScalar(this.R + bow);
    const curve = new this.T.QuadraticBezierCurve3(na.pos.clone(), mid, nb.pos.clone());
    const geo = new this.T.TubeGeometry(curve, major ? 56 : 42, major ? 0.013 : 0.008, 6, false);
    const mat = new this.T.MeshBasicMaterial({
      color: new this.T.Color(this._arcColor(role)),
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
    });
    const mesh = new this.T.Mesh(geo, mat);
    this.group.add(mesh);
    this.trail.push(mesh);
    this.transients.push({
      t0: now,
      dur: 0.5,
      update: (tt: number) => {
        mat.opacity = tt * (major ? 0.92 : 0.7);
      },
      cleanup: () => {
        mat.opacity = major ? 0.92 : 0.7;
      },
    });
    const sp = this._mkPacket(major ? this.GOLD_DARK : "#19A6CE");
    sp.position.copy(na.pos);
    sp.scale.setScalar(0.6);
    this.group.add(sp);
    this.packets.push({
      sp,
      curve,
      t0: now,
      dur: (major ? 1.0 : 0.74) / (this.speed || 1),
      group: true,
    });
  }

  private _converge(ids: string[]) {
    const now = performance.now() / 1000;
    ids.forEach((id) => {
      this._flash(id, 2.8, now);
    });
    this.setState({ callout: null });
    const present = ids.filter((id) => this.nmap[id]);
    if (present.length < 2) return;
    const a = this.nmap[present[0]!]!.pos;
    const b = this.nmap[present[present.length - 1]!]!.pos;
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const ring = new this.T.Sprite(
      new this.T.SpriteMaterial({
        map: this.ringTex(),
        color: new this.T.Color("#D8A63E"),
        transparent: true,
        opacity: 0.95,
        depthTest: false,
        depthWrite: false,
      }),
    );
    ring.position.copy(mid);
    ring.scale.setScalar(0.14);
    this.group.add(ring);
    this.trail.push(ring);
    const glow = new this.T.Sprite(
      new this.T.SpriteMaterial({
        map: this.glowTexW(),
        color: new this.T.Color("#D8A63E"),
        transparent: true,
        opacity: 0.7,
        depthTest: false,
        depthWrite: false,
      }),
    );
    glow.position.copy(mid);
    glow.scale.setScalar(0.2);
    this.group.add(glow);
    this.trail.push(glow);
    const t0 = now;
    const ex = () => {
      const t = (performance.now() / 1000 - t0) / 1.7;
      if (t >= 1) {
        ring.material.opacity = 0;
        glow.material.opacity = 0;
        return;
      }
      ring.scale.setScalar(0.14 + t * 3.4);
      ring.material.opacity = 0.95 * (1 - t);
      glow.scale.setScalar(0.2 + Math.sin(t * Math.PI) * 0.5);
      glow.material.opacity = 0.7 * (1 - t * 0.4);
      requestAnimationFrame(ex);
    };
    ex();
  }

  private _traceBackId(id: string) {
    const n = this.nmap[id];
    if (!n) return;
    const wp = n.pos.clone().applyQuaternion(this.group.quaternion);
    const dot = this._mkPacket("#D8A63E");
    dot.position.copy(wp);
    dot.scale.setScalar(1.0);
    this.scene!.add(dot);
    const t0 = performance.now() / 1000;
    const ex = () => {
      const t = (performance.now() / 1000 - t0) / 1.0;
      if (t >= 1) {
        this.scene!.remove(dot);
        return;
      }
      dot.position.copy(wp.clone().lerp(this.cam.position, t));
      dot.scale.setScalar(1.0 - t * 0.5);
      requestAnimationFrame(ex);
    };
    ex();
  }

  private _resetTraversal() {
    this.traversalGen++;
    this.answerPending = null;
    if (this._timers)
      this._timers.forEach((id) => {
        clearTimeout(id);
      });
    this._timers = [];
    this.clearFocus();
    if (this.trail) {
      for (const m of this.trail) {
        this.group?.remove(m);
        this.scene?.remove(m);
      }
    }
    this.trail = [];
    this.visited = new Set();
    this.focusQuat = null;
    this.nodeFlashes = {};
    for (const id in this.sprites) this.sprites[id].scale.setScalar(this._nodeScale(id));
  }

  private _returnGL() {
    this._frame(1);
    this.focusQuat = null;
    this.setState({ queryState: "returning" });
    const h = document.getElementById("cm-hud");
    if (h) {
      h.style.transition = "opacity 1.1s ease,filter 1.1s ease";
      h.style.opacity = "1";
      h.style.filter = "blur(0px)";
    }
  }
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}
