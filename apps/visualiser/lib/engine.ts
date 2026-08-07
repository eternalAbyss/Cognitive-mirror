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

// Cosine DISTANCE threshold for "this query is actually in the graph" (lower = closer).
// Above this, the nearest node is too unrelated to claim as an answer.
const MATCH_MAX_DISTANCE = 0.4;

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

type Patch = Partial<ViewState> | ((s: ViewState) => Partial<ViewState>);

const CLUSTER_DIRS: Array<{ tc: number; pc: number }> = [
  { tc: 0.4, pc: 1.0 },
  { tc: 2.4, pc: 0.9 },
  { tc: 4.7, pc: 1.5 },
  { tc: 1.5, pc: 2.2 },
  { tc: 3.6, pc: 0.5 },
  { tc: 5.6, pc: 1.7 },
  { tc: 0.9, pc: 2.6 },
  { tc: 2.9, pc: 2.4 },
];
const LABELLED_TYPES = new Set(["Concept", "Insight", "Synthesis"]);

export class CognitiveMirrorEngine {
  private onView: (v: ViewState) => void;
  state: ViewState = {
    queryInput: "",
    queryState: "idle",
    showAnswer: false,
    answerText: "",
    traverseStage: "",
    nodeReadout: "connecting…",
    traceLines: [],
    callout: null,
    speedLabel: "1×",
    sources: [],
    noMatch: false,
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
  private lastIdleEvent = 0;
  private targetCamZ = 5.8;
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
  private nmap: Record<string, { pos: THREE.Vector3; cl: number }> = {};
  private nodeMeta: Record<string, GraphNodeDto> = {};
  private sprites: Record<string, any> = {};
  private labels: any[] = [];
  private nodeLabels: any[] = [];
  private arcs: any[] = [];
  private clusters: Array<{ name: string; tc: number; pc: number }> = [];
  private clusterIndex = new Map<string, number>();
  private arcKeys = new Set<string>();
  private labelledCount = 0;
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

  /** The colour a persistent arc should currently be, given what it represents. */
  private _arcColor(role: ArcRole): string {
    return role === "contradicts" ? this.CRIMSON : role === "query" ? this.CYAN : this._gold();
  }

  // Theme: light renders dark-ink dots on a white sphere; dark inverts the
  // grayscale ramps in the shaders and lightens the data nodes/labels.
  private dark = false;

  /** Current foreground color for data dots/packets (dark ink vs light on dark). */
  private _fg(): number {
    return this.dark ? 0xe6e9f0 : 0x0c0c0c;
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
    const fg = this._fg();
    for (const id in this.sprites) this.sprites[id]?.material?.color?.set(fg);
    // Gold is theme-dependent, so persistent arcs have to be re-tinted too.
    for (const a of this.arcs) a.mat.color.set(this._arcColor(a.role));
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
    this._timers.forEach((id) => clearTimeout(id));
    window.removeEventListener("mousemove", this.onMove);
    window.removeEventListener("resize", this._onResize);
    window.removeEventListener("pointerdown", this._onPointerDown);
    window.removeEventListener("pointermove", this._onPointerMove);
    window.removeEventListener("pointerup", this._onPointerUp);
    window.removeEventListener("wheel", this._onWheel);
    document.body.style.cursor = "";
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
    this.setState({ speedLabel: ns + "×" });
  }
  replay() {
    this._resetTraversal();
    this.setState({ queryState: "idle", showAnswer: false, traceLines: [], callout: null, sources: [] });
    void this.runLiveQuery(this.lastQuery || "What connects my thinking across domains?");
  }
  closeAnswer() {
    const mount = document.getElementById("cm-canvas-mount");
    if (mount) mount.style.filter = "blur(0.35px)";
    this._resetTraversal();
    this.setState({ showAnswer: false, queryState: "idle", traceLines: [], callout: null, traverseStage: "", sources: [] });
  }
  flash(id: string, pk = 2) {
    if (this.nmap[id]) this._flash(id, pk, performance.now() / 1000);
  }

  /** "Enter the graph": drop into free-orbit inspection — pull in, stop the ambient
   *  spin, unblur — so drag/zoom/click feel like handling a real object. */
  enterGraph() {
    this.explore = true;
    this.targetCamZ = this.reduceMotion ? 5.0 : 4.6;
    const mount = document.getElementById("cm-canvas-mount");
    if (mount) mount.style.filter = "blur(0px)";
  }

  exitGraph() {
    this.explore = false;
    this.targetCamZ = 5.8;
    this.hoverId = null;
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
    this.setState({ noMatch: false, traverseStage: "researching the web…", answerText: `Searching the web for “${topic}” and taking notes…` });
    try {
      const res = await fetch("/api/research", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ topic }),
      });
      const data = (await res.json()) as { ok?: boolean; summary?: string; conceptsAdded?: number; conceptTitles?: string[]; error?: string };
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
        this.setState({ traverseStage: "", answerText: `Research failed: ${data.error ?? "unknown error"}` });
      }
    } catch {
      this.setState({ traverseStage: "", answerText: "Research failed — is the reasoning daemon running?" });
    }
  }

  /** Initial full load: clear and place all nodes (no spawn flash). */
  loadData(data: { nodes: GraphNodeDto[]; edges: GraphEdgeDto[] }) {
    if (!this.renderer || this.verts.length === 0) {
      setTimeout(() => this.loadData(data), 150); // GL not ready yet
      return;
    }
    this._clearData();
    for (const n of data.nodes.slice(0, 400)) this._placeNode(n, false);
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
    let added = 0;
    for (const n of data.nodes.slice(0, 600)) {
      if (!this.nodeMeta[n.id]) {
        this._placeNode(n, true);
        added++;
      }
    }
    for (const e of data.edges) this._addArc(e);
    if (added > 0) this.dataLoaded = true;
    return added;
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
    const d = CLUSTER_DIRS[idx % CLUSTER_DIRS.length]!;
    this.clusters.push({ name: key, tc: d.tc, pc: d.pc });
    this.clusterIndex.set(key, idx);
    const T = this.T;
    const dir = new T.Vector3(Math.sin(d.pc) * Math.cos(d.tc), Math.cos(d.pc), Math.sin(d.pc) * Math.sin(d.tc));
    const sp = new T.Sprite(new T.SpriteMaterial({ map: this.labelTex(key, 32, this._labelCol("cluster")), transparent: true, opacity: 0.5, depthTest: false, depthWrite: false }));
    sp.position.copy(dir.clone().multiplyScalar(this.R * 1.34));
    sp.scale.set(1.3, 0.2, 1);
    this.group.add(sp);
    this.labels.push({ sprite: sp, dir, text: key, size: 32, kind: "cluster" });
    return idx;
  }

  private _placeNode(n: GraphNodeDto, spawn: boolean) {
    if (this.nodeMeta[n.id]) return;
    const T = this.T;
    const ci = this._ensureCluster(this._keyOf(n));
    const cl = this.clusters[ci]!;
    const h = hash(n.id);
    const dt = ((h % 1000) / 1000 - 0.5) * 1.3;
    const dp = (((h >> 10) % 1000) / 1000 - 0.5) * 1.3;
    const th = cl.tc + dt, ph = cl.pc + dp;
    const dir = new T.Vector3(Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th));
    let best = this.verts[0]!;
    let bd = 1e9;
    for (const v of this.verts) {
      const dx = v[0]! - dir.x * this.R, dy = v[1]! - dir.y * this.R, dz = v[2]! - dir.z * this.R;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bd) {
        bd = d;
        best = v;
      }
    }
    const pos = new T.Vector3(best[0], best[1], best[2]);
    this.nmap[n.id] = { pos, cl: ci };
    this.nodeMeta[n.id] = n;
    const sp = new T.Sprite(new T.SpriteMaterial({ map: this._sharedDot(), color: this._fg(), transparent: true, opacity: 1, depthTest: false, depthWrite: false }));
    sp.position.copy(pos);
    sp.scale.setScalar(spawn ? 0.01 : 0.12);
    this.group.add(sp);
    this.sprites[n.id] = sp;
    if (LABELLED_TYPES.has(n.type) && this.labelledCount < 60) {
      this.labelledCount++;
      const kind = n.type === "Insight" ? "insight" : "node";
      const lab = new T.Sprite(new T.SpriteMaterial({ map: this.labelTex(n.title, 24, this._labelCol(kind)), transparent: true, opacity: 0.7, depthTest: false, depthWrite: false }));
      const off = dir.clone().multiplyScalar(this.R + 0.34);
      off.y += 0.12;
      lab.position.copy(off);
      lab.scale.set(1.0, 0.156, 1);
      this.group.add(lab);
      this.nodeLabels.push({ sprite: lab, dir, text: n.title, size: 24, kind });
    }
    if (spawn) this._flash(n.id, 2.8, performance.now() / 1000); // pop into existence
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
    } else if (e.type === "RELATES_TO" && a.domain && b.domain && a.domain !== b.domain) {
      const arc = this._makeArc(e.from, e.to, 0.009, "relates");
      if (arc) {
        this.arcs.push(arc);
        this.arcKeys.add(key);
      }
    }
  }

  setReadout(text: string) {
    this.setState({ nodeReadout: text });
  }

  /** Animate real background activity from the MCP event stream (design §3). */
  applyLiveEvent(evt: { type: string; detail?: Record<string, unknown> }) {
    if (this.state.queryState !== "idle") return;
    const d = evt.detail ?? {};
    const ids = [d.id, d.from, d.to].filter((x): x is string => typeof x === "string" && !!this.nmap[x]);
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
    this.sprites = {};
    this.nmap = {};
    this.nodeMeta = {};
    this.labels = [];
    this.nodeLabels = [];
    this.arcs = [];
    this.clusters = [];
    this.clusterIndex = new Map();
    this.arcKeys = new Set();
    this.labelledCount = 0;
  }

  private _applyTint() {
    const h = new Date().getHours();
    const el = document.getElementById("cm-tint");
    if (!el) return;
    let c: string;
    if (this.dark) {
      // Additive glow (screen) so the wash reads against the near-black sphere.
      el.style.mixBlendMode = "screen";
      if (h >= 5 && h < 11) c = "radial-gradient(ellipse 80% 70% at 50% 30%, rgba(60,46,24,.5), rgba(0,0,0,0) 70%)";
      else if (h >= 11 && h < 17) c = "radial-gradient(ellipse 80% 70% at 50% 30%, rgba(28,40,66,.45), rgba(0,0,0,0) 70%)";
      else if (h >= 17 && h < 21) c = "radial-gradient(ellipse 80% 70% at 50% 30%, rgba(52,28,52,.5), rgba(0,0,0,0) 70%)";
      else c = "radial-gradient(ellipse 80% 70% at 50% 30%, rgba(24,30,60,.55), rgba(0,0,0,0) 70%)";
    } else {
      el.style.mixBlendMode = "multiply";
      if (h >= 5 && h < 11) c = "radial-gradient(ellipse 80% 70% at 50% 30%, rgba(255,247,232,.5), rgba(250,248,244,0) 70%)";
      else if (h >= 11 && h < 17) c = "radial-gradient(ellipse 80% 70% at 50% 30%, rgba(240,246,255,.4), rgba(248,250,252,0) 70%)";
      else if (h >= 17 && h < 21) c = "radial-gradient(ellipse 80% 70% at 50% 30%, rgba(250,240,248,.45), rgba(250,247,250,0) 70%)";
      else c = "radial-gradient(ellipse 80% 70% at 50% 30%, rgba(234,238,250,.5), rgba(244,246,252,0) 70%)";
    }
    el.style.background = c;
  }

  private onMove(e: MouseEvent) {
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
  private _isSphereSpace(e: { target: EventTarget | null }): boolean {
    const t = e.target as HTMLElement | null;
    if (!t) return false;
    return t.id === "cm-hud" || t.id === "cm-canvas-mount" || t.id === "cm-tint" || t.tagName === "CANVAS";
  }

  private _busy(): boolean {
    return this.state.queryState === "querying" || this.state.queryState === "returning";
  }

  private _onPointerDown(e: PointerEvent) {
    if (this._busy() || !this._isSphereSpace(e)) return;
    this.dragging = true;
    this.didDrag = false;
    this.downPX = this.lastPX = e.clientX;
    this.downPY = this.lastPY = e.clientY;
    this.velX = this.velY = 0;
  }

  private _onPointerMove(e: PointerEvent) {
    if (this.dragging) {
      const dx = e.clientX - this.lastPX, dy = e.clientY - this.lastPY;
      this.lastPX = e.clientX;
      this.lastPY = e.clientY;
      if (Math.abs(e.clientX - this.downPX) + Math.abs(e.clientY - this.downPY) > 4) this.didDrag = true;
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
  }

  private _onWheel(e: WheelEvent) {
    if (this._busy() || !this._isSphereSpace(e)) return;
    e.preventDefault();
    const step = e.deltaY > 0 ? 0.45 : -0.45;
    this.targetCamZ = Math.max(3.0, Math.min(9.0, this.targetCamZ + step));
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
      if (!n) continue;
      const wp = n.pos.clone().applyQuaternion(this.group.quaternion);
      // skip nodes on the far side of the sphere
      if (wp.clone().normalize().dot(this.cam.position.clone().sub(wp).normalize()) < 0) continue;
      v.copy(wp).project(this.cam);
      if (v.z >= 1) continue;
      const sx = (v.x * 0.5 + 0.5) * rect.width + rect.left;
      const sy = (-v.y * 0.5 + 0.5) * rect.height + rect.top;
      const dx = sx - cx, dy = sy - cy, d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    }
    return best;
  }

  private _updateHover(e: PointerEvent) {
    const id = this._isSphereSpace(e) ? this._pickNode(e.clientX, e.clientY) : null;
    if (id === this.hoverId) return;
    this.hoverId = id;
    document.body.style.cursor = id ? "pointer" : "";
    if (id) {
      const m = this.nodeMeta[id];
      if (m) this.setState({ callout: { id, tag: m.title, type: (m.type || "").toUpperCase(), line: (m.summary || "").slice(0, 120) } });
    } else if (this.state.queryState === "idle") {
      this.setState({ callout: null });
    }
  }

  private _onResize() {
    if (!this.renderer) return;
    const W2 = innerWidth, H2 = innerHeight, d2 = Math.min(devicePixelRatio, 2);
    this.renderer.setSize(W2, H2);
    this.cam.aspect = W2 / H2;
    this.cam.updateProjectionMatrix();
    this.uScale = H2 * d2 * 0.5;
    if (this.dotMat) this.dotMat.uniforms.uScale.value = this.uScale;
    if (this.haloMat) this.haloMat.uniforms.uScale.value = this.uScale;
  }

  private rng(seed: number) {
    let s = seed;
    return () => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
  }

  // ── textures ────────────────────────────────────────────────────────────────
  private dotTex() {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const x = c.getContext("2d")!;
    x.beginPath();
    x.arc(32, 32, 25, 0, Math.PI * 2);
    x.fillStyle = "#000";
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
    } catch (e) {}
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

    const W = innerWidth, H = innerHeight, dpr = Math.min(devicePixelRatio, 2);
    this.renderer = new T.WebGLRenderer({ canvas: el, antialias: true, preserveDrawingBuffer: true, alpha: false });
    this.renderer.setSize(W, H);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setClearColor(this.dark ? 0x0b0d12 : 0xffffff, 1);

    this.scene = new T.Scene();
    this.cam = new T.PerspectiveCamera(52, W / H, 0.1, 200);
    this.cam.position.z = 5.8;
    this.group = new T.Group();
    this.scene.add(this.group);

    this.uScale = H * dpr * 0.5;
    this._buildBackground();
    this._buildHalo();
    this._rafLoop();
  }

  private _dotShader(extraFront: number) {
    const T = this.T;
    return new T.ShaderMaterial({
      uniforms: { uTex: { value: this.dotTex() }, uScale: { value: this.uScale }, uDark: { value: this.dark ? 1 : 0 } },
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
    const T = this.T, R = this.R, r = this.rng(11);
    const ico = new T.IcosahedronGeometry(R, 3);
    const vp = ico.attributes.position, seen = new Set<string>();
    this.verts = [];
    for (let i = 0; i < vp.count; i++) {
      const x = vp.getX(i), y = vp.getY(i), z = vp.getZ(i);
      const key = `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
      if (!seen.has(key)) {
        seen.add(key);
        this.verts.push([x, y, z]);
      }
    }
    const dpos: number[] = [], dsize: number[] = [];
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
    const T = this.T, R = this.R, r = this.rng(91);
    const N = 240, pos: number[] = [], sz: number[] = [], shade: number[] = [];
    for (let i = 0; i < N; i++) {
      const rad = R * (1.0 + r() * 0.3), th = r() * Math.PI * 2, ph = Math.acos(2 * r() - 1);
      pos.push(rad * Math.sin(ph) * Math.cos(th), rad * Math.cos(ph), rad * Math.sin(ph) * Math.sin(th));
      sz.push(0.02 + r() * 0.045);
      shade.push(r() < 0.22 ? 0.0 : 0.45 + r() * 0.45);
    }
    const g = new T.BufferGeometry();
    g.setAttribute("position", new T.BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute("aSize", new T.BufferAttribute(new Float32Array(sz), 1));
    g.setAttribute("aShade", new T.BufferAttribute(new Float32Array(shade), 1));
    this.haloMat = new T.ShaderMaterial({
      uniforms: { uTex: { value: this.dotTex() }, uScale: { value: this.uScale }, uDark: { value: this.dark ? 1 : 0 } },
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
      const rad = R * (1.02 + r() * 0.4), th = r() * Math.PI * 2, ph = Math.acos(2 * r() - 1);
      const sp = new T.Sprite(new T.SpriteMaterial({ map: soft, color: 0x000000, transparent: true, opacity: 0.022 + r() * 0.04, depthTest: false, depthWrite: false }));
      sp.position.set(rad * Math.sin(ph) * Math.cos(th), rad * Math.cos(ph), rad * Math.sin(ph) * Math.sin(th));
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
    const T = this.T, na = this.nmap[aId], nb = this.nmap[bId];
    if (!na || !nb) return null;
    const mid = na.pos.clone().add(nb.pos).multiplyScalar(0.5);
    const bow = na.pos.distanceTo(nb.pos) * 0.32;
    mid.normalize().multiplyScalar(Math.min(this.R + bow, this.R + 1.0));
    const curve = new T.QuadraticBezierCurve3(na.pos.clone(), mid, nb.pos.clone());
    const geo = new T.TubeGeometry(curve, 40, radius, 8, false);
    const mat = new T.MeshBasicMaterial({ color: new T.Color(this._arcColor(role)), transparent: true, opacity: 0.85, depthTest: false, depthWrite: false });
    const mesh = new T.Mesh(geo, mat);
    this.group.add(mesh);
    return { mesh, mat, curve, role };
  }

  // ── render loop ─────────────────────────────────────────────────────────────
  private _rafLoop() {
    this.rafId = requestAnimationFrame(() => this._rafLoop());
    if (!this.renderer) return;
    const now = performance.now() / 1000, dt = Math.min(now - (this._lt || now), 0.05);
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
    const mx = focusing ? 0 : this.mouseX, my = focusing ? 0 : this.mouseY;
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
        if (!this.nodeFlashes[id]) sp.scale.setScalar(0.17);
        continue;
      }
      if (this.nodeFlashes[id]) continue;
      const wp = new this.T.Vector3();
      sp.getWorldPosition(wp);
      const facing = wp.clone().normalize().dot(this.cam.position.clone().sub(wp).normalize());
      sp.material.opacity = Math.max(0.22, Math.min(1, facing + 0.4));
    }
    if (this.state.callout) {
      const el = document.getElementById("cm-callout");
      const n = this.nmap[this.state.callout.id];
      if (el && n) {
        const v = n.pos.clone().applyQuaternion(this.group.quaternion).project(this.cam);
        el.style.left = (v.x * 0.5 + 0.5) * window.innerWidth + "px";
        el.style.top = (-v.y * 0.5 + 0.5) * window.innerHeight + "px";
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
    return new T.Sprite(new T.SpriteMaterial({ map: this.dotTex(), color: this._fg(), transparent: true, opacity: op || 1, depthTest: false, depthWrite: false }));
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
      const t = (now - (f as any).t0) / (f as any).dur, sp = this.sprites[id];
      if (t >= 1) {
        if (sp) {
          sp.scale.setScalar(this.visited.has(id) ? 0.17 : 0.12);
          sp.material.opacity = 1;
        }
        delete this.nodeFlashes[id];
        continue;
      }
      if (sp) {
        sp.scale.setScalar(0.12 * (1 + Math.sin(t * Math.PI) * (f as any).pk));
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
    const na = this.nmap[fromId], nb = this.nmap[toId];
    if (!na || !nb) return;
    const sp = this._mkDot(1);
    sp.position.copy(na.pos);
    sp.scale.setScalar(0.06);
    this.group.add(sp);
    this.packets.push({ sp, a: na.pos.clone(), b: nb.pos.clone(), curve, t0: performance.now() / 1000, dur: curve ? 1.2 : 1.0, to: toId });
  }

  private _randIds(): string[] {
    return Object.keys(this.nmap);
  }

  private _idleTrace(now: number) {
    const ids = this._randIds();
    if (ids.length < 2) return;
    const a = ids[Math.floor(Math.random() * ids.length)]!, b = ids[Math.floor(Math.random() * ids.length)]!;
    if (a !== b) {
      this._launch(a, b);
      this._flash(a, 1.2, now);
    }
  }

  private _idleMerge(now: number) {
    const ids = this._randIds();
    if (ids.length < 2) return;
    const a = ids[Math.floor(Math.random() * ids.length)]!;
    let b = ids[Math.floor(Math.random() * ids.length)]!, guard = 0;
    while (b === a && guard++ < 8) b = ids[Math.floor(Math.random() * ids.length)]!;
    const na = this.nmap[a], nb = this.nmap[b];
    if (!na || !nb) return;
    const mid = na.pos.clone().add(nb.pos).multiplyScalar(0.5);
    const p1 = this._mkDot(1), p2 = this._mkDot(1);
    p1.position.copy(na.pos);
    p2.position.copy(nb.pos);
    p1.scale.setScalar(0.1);
    p2.scale.setScalar(0.1);
    this.group.add(p1);
    this.group.add(p2);
    const ring = new this.T.Sprite(new this.T.SpriteMaterial({ map: this.ringTex(), color: this._fg(), transparent: true, opacity: 0, depthTest: false, depthWrite: false }));
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
    let b = ids[Math.floor(Math.random() * ids.length)]!, guard = 0;
    while (b === a && guard++ < 8) b = ids[Math.floor(Math.random() * ids.length)]!;
    const arc = this._makeArc(a, b, 0.009, "relates");
    if (!arc) return;
    arc.mat.opacity = 0;
    this._flash(a, 1.8, now);
    setTimeout(() => this._flash(b, 1.8, performance.now() / 1000), 120);
    this.transients.push({
      t0: now,
      dur: 5.0,
      update: (t: number) => {
        arc.mat.opacity = t < 0.16 ? (t / 0.16) * 0.85 : t > 0.7 ? 0.85 * (1 - (t - 0.7) / 0.3) : 0.85;
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
    this.setState({ queryState: "querying", showAnswer: false, noMatch: false, queryInput: query, traverseStage: "searching your graph", traceLines: [], callout: null, sources: [] });
    this.targetCamZ = this.reduceMotion ? 5.6 : 4.3;
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
      const res = await fetch("/api/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query }) });
      results = ((await res.json()) as { results: SearchHit[] }).results ?? [];
    } catch {
      /* offline */
    }
    // Only count a hit if it's actually close — otherwise the "nearest" node is
    // unrelated and we should admit we don't know rather than fake an answer.
    const hits = results
      .filter((hit) => this.nmap[hit.id] && hit.score <= MATCH_MAX_DISTANCE)
      .slice(0, 6);

    if (hits.length === 0) {
      this._returnGL();
      this.setState({
        queryState: "answered",
        showAnswer: true,
        noMatch: true,
        answerText: `Nothing in your graph answers “${query}” yet.`,
        traverseStage: "",
        sources: [],
      });
      return;
    }

    if (this.reduceMotion) {
      hits.forEach((hit) => this.visited.add(hit.id));
      this._returnGL();
      this._revealAnswerLive(hits, true);
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
    at(900, () => this._revealAnswerLive(hits, false));
  }

  private _visitLive(hit: SearchHit, i: number) {
    const now = performance.now() / 1000;
    this._flash(hit.id, 2.6, now);
    this.visited.add(hit.id);
    this.setState({ callout: { id: hit.id, tag: hit.title, type: hit.type.toUpperCase(), line: hit.summary.slice(0, 120) } });
    const glow = new this.T.Sprite(new this.T.SpriteMaterial({ map: this.glowTexW(), color: new this.T.Color(this.CYAN), transparent: true, opacity: 0.5, depthTest: false, depthWrite: false }));
    glow.position.copy(this.nmap[hit.id]!.pos);
    glow.scale.setScalar(0.34);
    this.group.add(glow);
    this.trail.push(glow);
    this.setState((s) => ({
      traceLines: [...s.traceLines, { n: String(i + 1).padStart(2, "0"), label: hit.title.toUpperCase(), detail: hit.summary.slice(0, 110), accent: this.CYAN }],
    }));
  }

  private _revealAnswerLive(hits: SearchHit[], instant: boolean) {
    const lead = hits[0]!;
    const others = hits.slice(1, 4).map((h) => h.title).join(", ");
    const full =
      `Closest in your graph: ${lead.title}. ${lead.summary}` +
      (others ? `\n\nIt connects to ${others}.` : "");
    this.setState((s) => ({
      traceLines: [...s.traceLines, { n: String(hits.length + 1).padStart(2, "0"), label: "RETRIEVED FROM YOUR GRAPH", detail: "", accent: this._gold() }],
      queryState: "answered",
      showAnswer: true,
      noMatch: false,
      callout: null,
      traverseStage: "",
      sources: hits.map((h) => ({ label: h.title, id: h.id })),
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
    const T = this.T, g = new T.Group();
    const halo = new T.Sprite(new T.SpriteMaterial({ map: this.glowTexW(), color: new T.Color(hex), transparent: true, opacity: 0.6, depthTest: false, depthWrite: false }));
    halo.scale.setScalar(0.16);
    const core = new T.Sprite(new T.SpriteMaterial({ map: this.discTex(), color: new T.Color(hex), transparent: true, opacity: 1, depthTest: false, depthWrite: false }));
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
    const na = this.nmap[fromId], nb = this.nmap[toId];
    if (!na || !nb) return;
    const now = performance.now() / 1000;
    const major = role !== "query";
    const mid = na.pos.clone().add(nb.pos).multiplyScalar(0.5);
    const bow = na.pos.distanceTo(nb.pos) * (major ? 0.34 : 0.16);
    mid.normalize().multiplyScalar(this.R + bow);
    const curve = new this.T.QuadraticBezierCurve3(na.pos.clone(), mid, nb.pos.clone());
    const geo = new this.T.TubeGeometry(curve, major ? 56 : 42, major ? 0.013 : 0.008, 6, false);
    const mat = new this.T.MeshBasicMaterial({ color: new this.T.Color(this._arcColor(role)), transparent: true, opacity: 0, depthTest: false, depthWrite: false });
    const mesh = new this.T.Mesh(geo, mat);
    this.group.add(mesh);
    this.trail.push(mesh);
    this.transients.push({ t0: now, dur: 0.5, update: (tt: number) => { mat.opacity = tt * (major ? 0.92 : 0.7); }, cleanup: () => { mat.opacity = major ? 0.92 : 0.7; } });
    const sp = this._mkPacket(major ? this.GOLD_DARK : "#19A6CE");
    sp.position.copy(na.pos);
    sp.scale.setScalar(0.6);
    this.group.add(sp);
    this.packets.push({ sp, curve, t0: now, dur: (major ? 1.0 : 0.74) / (this.speed || 1), group: true });
  }

  private _converge(ids: string[]) {
    const now = performance.now() / 1000;
    ids.forEach((id) => this._flash(id, 2.8, now));
    this.setState({ callout: null });
    const present = ids.filter((id) => this.nmap[id]);
    if (present.length < 2) return;
    const a = this.nmap[present[0]!]!.pos, b = this.nmap[present[present.length - 1]!]!.pos;
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const ring = new this.T.Sprite(new this.T.SpriteMaterial({ map: this.ringTex(), color: new this.T.Color("#D8A63E"), transparent: true, opacity: 0.95, depthTest: false, depthWrite: false }));
    ring.position.copy(mid);
    ring.scale.setScalar(0.14);
    this.group.add(ring);
    this.trail.push(ring);
    const glow = new this.T.Sprite(new this.T.SpriteMaterial({ map: this.glowTexW(), color: new this.T.Color("#D8A63E"), transparent: true, opacity: 0.7, depthTest: false, depthWrite: false }));
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
    if (this._timers) this._timers.forEach((id) => clearTimeout(id));
    this._timers = [];
    if (this.trail) {
      for (const m of this.trail) {
        this.group && this.group.remove(m);
        this.scene && this.scene.remove(m);
      }
    }
    this.trail = [];
    this.visited = new Set();
    this.focusQuat = null;
    this.nodeFlashes = {};
    for (const id in this.sprites) this.sprites[id].scale.setScalar(0.12);
  }

  private _returnGL() {
    this.targetCamZ = 5.8;
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
