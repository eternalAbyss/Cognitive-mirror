"use client";

import { type CSSProperties, useEffect, useRef, useState } from "react";
import { CognitiveMirrorEngine, type GraphAppearance, type ViewState } from "../lib/engine";
import Markdown from "./Markdown";

const INITIAL_VIEW: ViewState = {
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
  answerGrounded: false,
  focus: null,
};

/**
 * The graph's region: the right of the page, full viewport height. It is a
 * BACKGROUND element — no frame, no card, no vertical bound — so the glass HUD
 * floats over it as it did when the sphere filled the viewport, and the halo
 * fades out on its own rather than being clipped against a box edge. Only the
 * width is constrained; that is what "aligned right" means here.
 *
 * The reasoning trace and the focus list share the left column's activity slot
 * rather than covering it.
 */
const GRAPH_W = "min(52vw, 820px)";
/**
 * The dashboard tiles into columns over the graph. Glass over the sphere is the
 * intended look; glass over glass is not, so the middle column is sized from
 * what the fixed columns leave rather than centred on the viewport and allowed
 * to run under them.
 *
 * The left column is the stack — clock, op log, then news — because the right
 * is the graph's. A news panel on the right would have sat directly on top of
 * the sphere, which is the one thing the dashboard is meant to show.
 */
const LEFT_COL_W = 340;
/** Weather only — the rest of the right belongs to the graph. */
const RIGHT_COL_W = 236;
const COL_GUTTER = 20;
/** Where the left column stops — and, because the middle centres on the
 *  viewport, the only clearance that constrains the middle's width. */
const MID_LEFT = 32 + LEFT_COL_W + COL_GUTTER;
/**
 * The middle column centres on the **viewport**, not on the gap between the two
 * side columns. Those columns are different widths (340 vs 236), so centring in
 * the gap put the cards and the command bar 52px right of true centre — which
 * the wordmark, sitting at a plain `left: 50%`, gave away immediately.
 *
 * Centring on the viewport means the clearance that matters is the NARROWER
 * side's: a box centred at 50vw clears both columns only while its half-width
 * fits `50vw - MID_LEFT`, so the cap is `100vw - 2 * MID_LEFT`. That gives up
 * some width on a small display versus filling the gap asymmetrically, and
 * being visibly off-centre was the worse trade.
 */
const MID_CENTER = "50vw";
const MID_W = (max: number) => `min(${max}px, calc(100vw - ${2 * MID_LEFT}px))`;

/** Defaults for the graph widget's appearance controls. `null` = follow the theme. */
/**
 * `nodeColor: null` means "follow the theme" — dark ink on the light theme, near
 * white on the dark one — which is why it isn't pinned to a hex here: a fixed
 * near-white would vanish against the light theme's white void.
 */
const DEFAULT_APPEARANCE: GraphAppearance = {
  linkWidth: 1,
  nodeColor: null,
  linkColor: "#0E86A8",
};
const APPEARANCE_KEY = "cm-graph-appearance";

/**
 * Swatches offered by the colour pickers. A native <input type="color"> is also
 * available behind the last chip for anything not in the list.
 */
const NODE_SWATCHES = ["#0C0C0C", "#E6E9F0", "#0E86A8", "#D8A63E", "#C2557A", "#5B8C5A"];
const LINK_SWATCHES = ["#D8A63E", "#B07B16", "#0E86A8", "#8E7CC3", "#C2557A", "#4A4A4A"];

function readAppearance(): GraphAppearance {
  try {
    const raw = localStorage.getItem(APPEARANCE_KEY);
    if (!raw) return DEFAULT_APPEARANCE;
    const p = JSON.parse(raw) as Partial<GraphAppearance>;
    return {
      linkWidth: typeof p.linkWidth === "number" ? Math.max(0.25, Math.min(5, p.linkWidth)) : 1,
      nodeColor: typeof p.nodeColor === "string" ? p.nodeColor : null,
      linkColor: typeof p.linkColor === "string" ? p.linkColor : null,
    };
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

const MONO = "'JetBrains Mono',monospace";
const SANS = "'Space Grotesk',sans-serif";

// Theme tokens — defined as rgb triplets in globals.css and flipped via the
// <html data-theme> attribute. Helpers keep the inline styles readable.
const ink = (a: number) => `rgba(var(--ink),${a})`;
const INK = "rgb(var(--ink))";
const surface = (a: number) => `rgba(var(--surface),${a})`;
const ACCENT = "rgb(var(--accent))";
const ACCENT_FG = "rgb(var(--accent-fg))";
const LINK = "rgb(var(--link))";
const BG = "rgb(var(--bg))";

interface BriefItem {
  id: string;
  title: string;
  summary: string;
  asOf: string;
  kind?: "world" | "concept" | "interest";
}
interface LoopItem {
  id: string;
  title: string;
  summary: string;
}
interface OpEntry {
  id: string;
  ts: string;
  reason: string;
  ops: number;
}
interface ListItem {
  id: string;
  title: string;
  summary: string;
}
interface ApprovalItem {
  id: string;
  ts: string;
  action: "merge" | "delete";
  title: string;
  detail: string;
  subjectIds: string[];
}
interface Vitals {
  counts: Record<string, number>;
  budget: { spendUsd: number; dailyCap: number } | null;
}
interface Status {
  services: { graphCore?: boolean; mcp?: boolean; daemon?: boolean };
  budget: { spendUsd: number; dailyCap: number } | null;
}
interface NewsItem {
  id: string;
  title: string;
  summary: string;
  asOf: string;
  url: string;
}
interface NewsFeed {
  items: NewsItem[];
  lastFetchedAt: string | null;
  ageHours: number | null;
  stale: boolean;
  maxAgeHours: number;
  refreshing: boolean;
}

interface SettingField {
  key: string;
  label: string;
  kind: "text" | "number" | "secret" | "boolean" | "textarea";
  hint?: string;
  /** false when the value is only read at startup and needs a restart to apply. */
  live: boolean;
  placeholder?: string;
}
interface SettingGroup {
  id: string;
  label: string;
  icon: string;
  blurb: string;
  fields: SettingField[];
}
type SettingValue = string | boolean;

/** Stand-in graph-core sends for a secret that is set. Never a real value. */
const SECRET_SET = "__set__";

interface NodeDetail {
  props: Record<string, unknown>;
  labels: string[];
  edges: Array<{ type: string; to: string; toTitle: string | null }>;
}

async function getJson<T>(url: string, fallback: T): Promise<T> {
  try {
    const r = await fetch(url, { cache: "no-store" });
    return r.ok ? ((await r.json()) as T) : fallback;
  } catch {
    return fallback;
  }
}

export default function CognitiveMirror() {
  const engineRef = useRef<CognitiveMirrorEngine | null>(null);
  const [view, setView] = useState<ViewState>(INITIAL_VIEW);
  // Adopt whatever theme the pre-paint script in layout.tsx already applied.
  const [dark, setDark] = useState<boolean>(
    () => typeof document !== "undefined" && document.documentElement.dataset.theme === "dark",
  );
  const [clock, setClock] = useState({ time: "--:--:--", date: "", greeting: "evening" });
  const [vitals, setVitals] = useState<Vitals>({ counts: {}, budget: null });
  const [brief, setBrief] = useState<BriefItem[]>([]);
  const [briefSource, setBriefSource] = useState<"world" | "graph">("world");
  const [loops, setLoops] = useState<LoopItem[]>([]);
  const [oplog, setOplog] = useState<OpEntry[]>([]);
  const [status, setStatus] = useState<Status>({ services: {}, budget: null });
  const [explore, setExplore] = useState(false);
  const [listPanel, setListPanel] = useState<{ type: string; label: string } | null>(null);
  const [listItems, setListItems] = useState<ListItem[]>([]);
  const [detail, setDetail] = useState<NodeDetail | null>(null);
  const [approvals, setApprovals] = useState<ApprovalItem[]>([]);
  // Graph widget: expanded fills the viewport and minimizes every HUD panel.
  const [graphFull, setGraphFull] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  // Read from localStorage after mount, never during render — the server has no
  // localStorage, and seeding state from it would be a hydration mismatch.
  const [appearance, setAppearance] = useState<GraphAppearance>(DEFAULT_APPEARANCE);
  // Runtime settings, read from and written straight to the installation's .env.
  const [settingGroups, setSettingGroups] = useState<SettingGroup[]>([]);
  const [settingValues, setSettingValues] = useState<Record<string, SettingValue>>({});
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [news, setNews] = useState<NewsFeed>({
    items: [],
    lastFetchedAt: null,
    ageHours: null,
    stale: false,
    maxAgeHours: 12,
    refreshing: false,
  });
  const [newsBusy, setNewsBusy] = useState(false);
  // Latest panel-refresh fn, set inside the mount effect so handlers can trigger it.
  const refreshRef = useRef<() => void>(() => {});

  // Keep the document attribute, persistence and the WebGL scene in sync with the toggle.
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "";
    try {
      localStorage.setItem("cm-theme", dark ? "dark" : "light");
    } catch {
      /* ignore */
    }
    engineRef.current?.setTheme(dark);
  }, [dark]);

  useEffect(() => {
    const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const MON = [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ];
    const tick = () => {
      const d = new Date();
      const p = (n: number) => String(n).padStart(2, "0");
      setClock({
        time: `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`,
        date: `${DAYS[d.getDay()]}, ${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}`,
        greeting: d.getHours() < 12 ? "morning" : d.getHours() < 17 ? "afternoon" : "evening",
      });
    };
    tick();
    const ci = setInterval(tick, 1000);

    const engine = new CognitiveMirrorEngine(setView);
    engineRef.current = engine;
    // Clicking a node on the sphere focuses it — only its direct connections stay
    // visible — and opens its detail card. Clicking one of those walks there.
    engine.setOnSelect(async (id) => {
      engine.focusNode(id, engine.isFocused());
      const d = await getJson<NodeDetail | null>(`/api/node/${encodeURIComponent(id)}`, null);
      if (d?.props?.id) setDetail(d);
    });
    engine.mount();
    // Apply the current theme to the freshly-built scene.
    engine.setTheme(document.documentElement.dataset.theme === "dark");
    const saved = readAppearance();
    setAppearance(saved);
    engine.applyAppearance(saved);
    // Inlined rather than calling the outer loadSettings, so this mount-only
    // effect keeps its empty dependency list.
    void getJson<{ groups: SettingGroup[]; values: Record<string, SettingValue> }>(
      "/api/settings",
      { groups: [], values: {} },
    ).then((d) => {
      setSettingGroups(d.groups);
      setSettingValues(d.values);
    });

    // Load the real graph, then keep it growing as the daemon creates nodes.
    void getJson<{ nodes: any[]; edges: any[] }>("/api/graph", { nodes: [], edges: [] }).then(
      (g) => {
        engine.loadData(g);
        engine.setReadout(`${g.nodes.length} nodes · ${g.edges.length} edges · live`);
      },
    );
    // Poll the graph and merge in new nodes — they spawn live on the sphere
    // (research, ingestion, maintenance all surface here within a few seconds).
    const graphPoll = setInterval(async () => {
      const g = await getJson<{ nodes: any[]; edges: any[] }>("/api/graph", {
        nodes: [],
        edges: [],
      });
      const added = engine.mergeData(g);
      if (added > 0) engine.setReadout(`${g.nodes.length} nodes · ${g.edges.length} edges · live`);
    }, 3500);

    // News has its own, slower loop: a GET is what triggers a staleness refresh,
    // so it has no business running at the 6-second panel cadence.
    const pullNews = async () => {
      const d = await getJson<NewsFeed>("/api/news", {
        items: [],
        lastFetchedAt: null,
        ageHours: null,
        stale: false,
        maxAgeHours: 12,
        refreshing: false,
      });
      setNews(d);
    };
    void pullNews();
    const newsPoll = setInterval(pullNews, 90_000);

    const refresh = async () => {
      const [v, b, l, o, s, a] = await Promise.all([
        getJson<Vitals>("/api/vitals", { counts: {}, budget: null }),
        getJson<{ items: BriefItem[]; source?: "world" | "graph" }>("/api/brief", { items: [] }),
        getJson<{ items: LoopItem[] }>("/api/loops", { items: [] }),
        getJson<{ entries: OpEntry[] }>("/api/oplog", { entries: [] }),
        getJson<Status>("/api/status", { services: {}, budget: null }),
        getJson<{ approvals: ApprovalItem[] }>("/api/approvals", { approvals: [] }),
      ]);
      setVitals(v);
      setBrief(b.items);
      setBriefSource(b.source ?? "world");
      setLoops(l.items);
      setOplog(o.entries);
      setStatus(s);
      setApprovals(a.approvals);
    };
    refreshRef.current = refresh;
    void refresh();
    const poll = setInterval(refresh, 6000);

    // Live activity from the MCP event stream.
    let es: EventSource | null = null;
    try {
      es = new EventSource("/api/events");
      es.onmessage = (e) => {
        try {
          engine.applyLiveEvent(JSON.parse(e.data));
        } catch {
          /* ignore */
        }
      };
    } catch {
      /* SSE unavailable */
    }

    return () => {
      clearInterval(ci);
      clearInterval(poll);
      clearInterval(graphPoll);
      clearInterval(newsPoll);
      es?.close();
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  const e = () => engineRef.current;
  const c = vitals.counts;

  // Push one appearance change into the engine and remember it for next time.
  const patchAppearance = (patch: Partial<GraphAppearance>) => {
    setAppearance((prev) => {
      const next = { ...prev, ...patch };
      e()?.applyAppearance(patch);
      try {
        localStorage.setItem(APPEARANCE_KEY, JSON.stringify(next));
      } catch {
        /* private mode — the controls still work, they just won't persist */
      }
      return next;
    });
  };

  /**
   * Expand or collapse the graph. Expanding is also what makes it interactive —
   * see `enterGraph` — so collapsing has to undo BOTH, or the dashboard comes
   * back with its centre column still hidden and the sphere still zoomed in.
   */
  const toggleGraphFull = () => {
    setGraphFull((wasFull) => {
      const full = !wasFull;
      if (full) {
        openGraph();
      } else {
        setExplore(false);
        setChatOpen(false);
        e()?.exitGraph(); // resets framing + focus before the resize re-measures
        e()?.setFullscreen(false);
      }
      return full;
    });
  };

  // Walk to a neighbour: re-focus the sphere and swap the detail card to it.
  const walkTo = async (id: string) => {
    e()?.focusNode(id, true);
    const d = await getJson<NodeDetail | null>(`/api/node/${encodeURIComponent(id)}`, null);
    if (d?.props?.id) setDetail(d);
  };

  // Stepping back moves the sphere AND the open card, so the two never disagree.
  const walkBack = async () => {
    const id = e()?.focusBack();
    if (!id) return;
    const d = await getJson<NodeDetail | null>(`/api/node/${encodeURIComponent(id)}`, null);
    if (d?.props?.id) setDetail(d);
  };

  /** Open the graph for exploration: expanded, interactive, HUD out of the way. */
  const openGraph = () => {
    setGraphFull(true);
    setExplore(true);
    setChatOpen(false);
    e()?.enterGraph();
    e()?.setFullscreen(true);
  };

  // "Connections" on a card is also opening the graph — route it through the same
  // path, so focus mode can't be the one way to get an interactive sphere while
  // the dashboard still shows it as wallpaper.
  const focusFrom = (id: string) => {
    openGraph();
    e()?.focusNode(id, false);
  };

  // Rebuild the sphere from the live graph — reflects deletions/edits immediately
  // (the periodic poll only *adds* nodes; this also drops archived ones).
  const reloadGraph = async () => {
    const g = await getJson<{ nodes: any[]; edges: any[] }>("/api/graph", { nodes: [], edges: [] });
    e()?.loadData(g);
    e()?.setReadout(`${g.nodes.length} nodes · ${g.edges.length} edges · live`);
  };

  const loadSettings = async () => {
    const d = await getJson<{ groups: SettingGroup[]; values: Record<string, SettingValue> }>(
      "/api/settings",
      { groups: [], values: {} },
    );
    setSettingGroups(d.groups);
    setSettingValues(d.values);
  };

  /** Write a patch to .env. Every service re-reads on its next config access. */
  const saveSettings = async (patch: Record<string, SettingValue>) => {
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    const r = (await res.json().catch(() => ({ ok: false }))) as { ok?: boolean; error?: string };
    await loadSettings();
    // Budget caps and model names show up in the status bar, so reconcile those too.
    refreshRef.current();
    return r;
  };

  /**
   * Force a fresh world brief now. The daemon synthesises observations with the
   * Anthropic path, so this spends from the daily budget — hence a deliberate
   * button rather than an automatic retry.
   */
  const refreshNews = async () => {
    setNewsBusy(true);
    try {
      await fetch("/api/news", { method: "POST" });
      // The brief runs as a queued job, so the new observations land a little
      // later; poll a few times rather than showing a stale panel as "done".
      for (let i = 0; i < 6; i++) {
        await new Promise((r) => setTimeout(r, 2500));
        const d = await getJson<NewsFeed>("/api/news", news);
        setNews(d);
        if (d.lastFetchedAt && d.lastFetchedAt !== news.lastFetchedAt) break;
      }
    } finally {
      setNewsBusy(false);
    }
  };

  const refreshList = async (type: string) => {
    const { nodes } = await getJson<{ nodes: ListItem[] }>(
      `/api/nodes?type=${encodeURIComponent(type)}`,
      { nodes: [] },
    );
    setListItems(nodes);
  };

  // Open / toggle the list panel for a node type (Concepts, Insights, Syntheses…).
  const openList = async (type: string, label: string) => {
    if (listPanel?.type === type) {
      setListPanel(null);
      return;
    }
    setListPanel({ type, label });
    void refreshList(type);
  };

  // Soft-delete (archive) a node, then reconcile every surface.
  const deleteNode = async (id: string) => {
    if (!id) return;
    await fetch(`/api/node/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (detail?.props?.id === id) setDetail(null);
    setListItems((items) => items.filter((n) => n.id !== id));
    await reloadGraph();
    refreshRef.current();
  };

  // Save an edited note (re-embeds server-side), then refresh the open detail + lists.
  const saveEdit = async (id: string, title: string, summary: string) => {
    await fetch(`/api/node/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, summary }),
    });
    const d = await getJson<NodeDetail | null>(`/api/node/${encodeURIComponent(id)}`, null);
    if (d?.props?.id) setDetail(d);
    if (listPanel) void refreshList(listPanel.type);
    await reloadGraph();
    refreshRef.current();
  };

  const resolveApprovalAction = async (id: string, decision: "approve" | "reject") => {
    setApprovals((a) => a.filter((x) => x.id !== id)); // optimistic
    await fetch(`/api/approvals/${encodeURIComponent(id)}/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision }),
    });
    await reloadGraph();
    refreshRef.current();
  };

  // Open a node's full detail (and ping it on the sphere).
  const openNode = async (id: string) => {
    if (!id) return;
    e()?.flash(id, 2.4);
    const d = await getJson<NodeDetail | null>(`/api/node/${encodeURIComponent(id)}`, null);
    if (d?.props?.id) setDetail(d);
  };
  const spend = (status.budget ?? vitals.budget)?.spendUsd;
  const healthy = status.services.graphCore && status.services.mcp && status.services.daemon;

  const queryHint =
    view.queryState === "idle"
      ? "↵ ask your real graph  ·  expand the graph from Settings to explore it"
      : view.queryState === "querying"
        ? "traversing your knowledge graph…"
        : view.queryState === "answered"
          ? view.answerGrounded
            ? "answered from your graph"
            : "retrieved from your graph"
          : "";
  const showTrace =
    view.traceLines.length > 0 ||
    view.queryState === "querying" ||
    view.queryState === "returning" ||
    view.queryState === "answered";

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        background: BG,
        overflow: "hidden",
        position: "relative",
        fontFamily: SANS,
      }}
    >
      {/* Graph stage. The canvas is sized by THIS element, not the window — the
          engine measures the mount and observes it for resizes — so the same
          scene serves both the dashboard panel and fullscreen. zIndex 11 puts it
          over the HUD backdrop (10) but under the trace console, cards and the
          widget bar, which must stay reachable while the graph is expanded. */}
      <div
        id="cm-stage"
        style={
          graphFull
            ? {
                position: "absolute",
                inset: 0,
                zIndex: 11,
                overflow: "hidden",
                transition: "inset .38s ease",
              }
            : {
                // Background, not a card: no border, no shadow, no panel. Full
                // viewport HEIGHT — only the width is constrained — so the halo
                // and the outer dust fade out naturally instead of being clipped
                // against a box edge partway up the screen.
                position: "absolute",
                right: 0,
                top: 0,
                bottom: 0,
                width: GRAPH_W,
                zIndex: 1,
                overflow: "hidden",
              }
        }
      >
        <div
          id="cm-canvas-mount"
          style={{ position: "absolute", inset: 0, zIndex: 1, transition: "filter .9s ease" }}
        />
        <div
          id="cm-tint"
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            zIndex: 2,
            mixBlendMode: "multiply",
          }}
        />
      </div>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse 90% 90% at 50% 46%,transparent 55%,rgba(0,0,0,.018) 100%)",
          pointerEvents: "none",
          zIndex: 2,
        }}
      />

      <div
        id="cm-hud"
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 10,
          perspective: "2000px",
          transition: "opacity .8s ease,filter .8s ease",
        }}
      >
        {/* Every HUD panel lives in here so expanding the graph can clear them in
            one move. `display:contents` generates no box, so the children keep
            positioning against #cm-hud exactly as before. #cm-hud itself stays
            mounted and interactive either way — it is the backdrop the engine
            reads pointer events from (see `_isSphereSpace`). */}
        <div style={{ display: graphFull ? "none" : "contents" }}>
          {/* Wordmark */}
          <div
            style={{
              position: "absolute",
              top: 30,
              left: "50%",
              transform: "translateX(-50%)",
              textAlign: "center",
              pointerEvents: "none",
            }}
          >
            <div
              style={{
                fontFamily: SANS,
                fontWeight: 500,
                fontSize: 13,
                letterSpacing: 7,
                color: ink(0.72),
                textTransform: "uppercase",
                textShadow: `0 0 12px ${BG},0 0 12px ${BG},0 0 6px ${BG}`,
              }}
            >
              The Cognitive Mirror
            </div>
            <div
              style={{
                fontFamily: MONO,
                fontSize: 8,
                letterSpacing: 4,
                color: ink(0.34),
                textTransform: "uppercase",
                marginTop: 6,
                textShadow: `0 0 8px ${BG},0 0 8px ${BG}`,
              }}
            >
              Second Brain · {view.nodeReadout}
            </div>
          </div>

          {/* Left stack: clock, op log, news. A flex column rather than three
              absolutely-placed cards, so the news panel takes whatever height is
              left over instead of being pinned to a guessed offset that only
              lines up at one viewport height. The wrapper ignores pointer events
              so its empty lower region doesn't block the sphere behind it. */}
          <div
            style={{
              position: "absolute",
              top: 32,
              bottom: 86,
              left: 32,
              width: LEFT_COL_W,
              display: "flex",
              flexDirection: "column",
              gap: 20,
              pointerEvents: "none",
            }}
          >
            {/* Clock */}
            <div
              style={{
                flexShrink: 0,
                pointerEvents: "auto",
                background: surface(0.66),
                backdropFilter: "blur(14px) saturate(1.05)",
                WebkitBackdropFilter: "blur(14px) saturate(1.05)",
                border: `1px solid ${ink(0.07)}`,
                borderRadius: 14,
                padding: "20px 22px",
                boxShadow: `0 10px 34px rgba(0,0,0,.05),inset 0 1px 0 ${surface(0.7)}`,
              }}
            >
              <div
                style={{
                  fontSize: 9,
                  letterSpacing: 3.5,
                  color: ink(0.38),
                  textTransform: "uppercase",
                  marginBottom: 5,
                }}
              >
                Good {clock.greeting}
              </div>
              <div
                style={{
                  fontFamily: MONO,
                  fontSize: 48,
                  fontWeight: 700,
                  color: INK,
                  lineHeight: 1,
                  letterSpacing: -2,
                }}
              >
                {clock.time}
              </div>
              <div
                style={{
                  fontFamily: MONO,
                  fontSize: 10.5,
                  color: ink(0.42),
                  marginTop: 9,
                  letterSpacing: 0.3,
                }}
              >
                {clock.date}
              </div>
              <div
                style={{
                  marginTop: 11,
                  paddingTop: 10,
                  borderTop: `1px solid ${ink(0.08)}`,
                  fontSize: 8,
                  letterSpacing: 3.5,
                  color: ink(0.3),
                  textTransform: "uppercase",
                }}
              >
                LOCAL · BENGALURU
              </div>
            </div>

            {/* Operation log (live maintenance activity) */}
            <div
              style={{
                // Shares the leftover height evenly with the news panel below it
                // (`1 1 0` on both) rather than being sized by its content and then
                // squeezed down to a few rows.
                flex: "1 1 0",
                minHeight: 150,
                pointerEvents: "auto",
                // Steps aside for the focus panel or the reasoning trace, both of
                // which take this slot while they're live.
                display: (view.focus || showTrace) && !graphFull ? "none" : "flex",
                flexDirection: "column",
                overflow: "hidden",
                background: surface(0.6),
                backdropFilter: "blur(13px) saturate(1.05)",
                WebkitBackdropFilter: "blur(13px) saturate(1.05)",
                border: `1px solid ${ink(0.07)}`,
                borderRadius: 14,
                padding: "14px 16px",
                boxShadow: "0 8px 30px rgba(0,0,0,.05)",
              }}
            >
              <div
                style={{
                  fontSize: 7.5,
                  letterSpacing: 3,
                  color: ink(0.4),
                  textTransform: "uppercase",
                  marginBottom: 10,
                  flexShrink: 0,
                }}
              >
                Operation Log
              </div>
              {/* Scrolls rather than clipping: the card's height now comes from
                  the column, so whatever doesn't fit must stay reachable. */}
              <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
                {oplog.length === 0 && (
                  <div style={{ fontFamily: MONO, fontSize: 10, color: ink(0.3) }}>idle</div>
                )}
                {oplog.slice(0, 24).map((o) => (
                  <div
                    key={o.id}
                    style={{
                      display: "flex",
                      gap: 8,
                      padding: "4px 0",
                      borderBottom: `1px solid ${ink(0.05)}`,
                    }}
                  >
                    <span
                      style={{ fontFamily: MONO, fontSize: 8.5, color: ink(0.3), flexShrink: 0 }}
                    >
                      {o.ts.slice(11, 16)}
                    </span>
                    <span
                      style={{
                        fontFamily: MONO,
                        fontSize: 9.5,
                        color: ink(0.66),
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {o.reason.replace(/"/g, "")}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Latest news, scored against your concepts. Refreshes on staleness
              rather than a clock — see /api/news. Takes the rest of the column. */}
            <NewsPanel feed={news} busy={newsBusy} onRefresh={refreshNews} onOpen={openNode} />
          </div>

          {/* Weather (ambient) */}
          <div
            style={{
              position: "absolute",
              top: 32,
              right: 32,
              width: RIGHT_COL_W,
              background: surface(0.66),
              backdropFilter: "blur(14px) saturate(1.05)",
              WebkitBackdropFilter: "blur(14px) saturate(1.05)",
              border: `1px solid ${ink(0.07)}`,
              borderRadius: 14,
              padding: "18px 20px",
              boxShadow: `0 10px 34px rgba(0,0,0,.05),inset 0 1px 0 ${surface(0.7)}`,
            }}
          >
            <div
              style={{
                fontSize: 7.5,
                letterSpacing: 3,
                color: ink(0.34),
                textTransform: "uppercase",
                marginBottom: 11,
              }}
            >
              Bengaluru
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 10, marginBottom: 11 }}>
              <div
                style={{
                  fontFamily: MONO,
                  fontSize: 42,
                  fontWeight: 700,
                  color: INK,
                  lineHeight: 1,
                }}
              >
                27°
              </div>
              <div style={{ paddingBottom: 3 }}>
                <div style={{ fontSize: 12, color: ink(0.58), marginBottom: 2 }}>Light rain</div>
                <div style={{ fontFamily: MONO, fontSize: 10, color: ink(0.36) }}>≋ ↓ 0.4mm/h</div>
              </div>
            </div>
            <div
              style={{
                display: "flex",
                gap: 14,
                paddingTop: 9,
                borderTop: `1px solid ${ink(0.08)}`,
              }}
            >
              {[
                ["Humid", "78%"],
                ["Wind", "12km/h"],
                ["Feels", "25°"],
              ].map(([k, v]) => (
                <div key={k}>
                  <div
                    style={{
                      fontSize: 6.5,
                      letterSpacing: 2,
                      color: ink(0.3),
                      textTransform: "uppercase",
                      marginBottom: 3,
                    }}
                  >
                    {k}
                  </div>
                  <div style={{ fontFamily: MONO, fontSize: 13, color: ink(0.82) }}>{v}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Center: live Daily Brief + open loop */}
          <div
            id="cm-center"
            style={{
              position: "absolute",
              top: 176,
              bottom: 200,
              left: MID_CENTER,
              width: MID_W(548),
              overflowY: "auto",
              overflowX: "hidden",
              transformStyle: "preserve-3d",
              transition: "transform .25s ease-out, opacity .35s ease",
              opacity: explore ? 0 : 1,
              visibility: explore ? "hidden" : "visible",
            }}
          >
            <div
              style={{
                minHeight: "100%",
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                gap: 16,
                padding: "2px 0",
              }}
            >
              {approvals.length > 0 && (
                <div
                  style={{
                    flexShrink: 0,
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                    marginBottom: 6,
                  }}
                >
                  {approvals.map((ap) => (
                    <div
                      key={ap.id}
                      style={{
                        background: surface(0.86),
                        backdropFilter: "blur(13px) saturate(1.05)",
                        WebkitBackdropFilter: "blur(13px) saturate(1.05)",
                        border: `1px solid rgba(var(--accent),.5)`,
                        borderRadius: 12,
                        padding: "14px 16px",
                        boxShadow: "0 10px 34px rgba(0,0,0,.1)",
                      }}
                    >
                      <div
                        style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}
                      >
                        <div
                          style={{
                            width: 7,
                            height: 7,
                            background: INK,
                            transform: "rotate(45deg)",
                            flexShrink: 0,
                            animation: "soft-pulse 2.4s ease-in-out infinite",
                          }}
                        />
                        <span
                          style={{
                            fontSize: 7.5,
                            letterSpacing: 2.5,
                            color: ink(0.6),
                            textTransform: "uppercase",
                          }}
                        >
                          Cleanup needs approval · {ap.action}
                        </span>
                      </div>
                      <div
                        style={{
                          fontSize: 13,
                          color: ink(0.84),
                          lineHeight: 1.45,
                          fontWeight: 600,
                        }}
                      >
                        {ap.title}
                      </div>
                      {ap.detail && (
                        <div
                          style={{ fontSize: 12, color: ink(0.55), lineHeight: 1.5, marginTop: 4 }}
                        >
                          {ap.detail}
                        </div>
                      )}
                      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                        <button
                          type="button"
                          onClick={() => resolveApprovalAction(ap.id, "approve")}
                          className="cm-allow"
                          style={loopBtn(ACCENT, ACCENT_FG, ACCENT)}
                        >
                          Allow
                        </button>
                        <button
                          type="button"
                          onClick={() => resolveApprovalAction(ap.id, "reject")}
                          className="cm-park"
                          style={loopBtn("transparent", ink(0.5), ink(0.18))}
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div
                style={{
                  fontSize: 7.5,
                  letterSpacing: 5,
                  color: ink(0.34),
                  textTransform: "uppercase",
                  textAlign: "center",
                  marginBottom: 2,
                  flexShrink: 0,
                }}
              >
                {briefSource === "graph" ? "From Your Graph" : "Daily Brief"}
              </div>

              {brief.length === 0 && (
                <div style={card}>
                  <div style={{ fontSize: 13, color: ink(0.55), lineHeight: 1.62 }}>
                    Your graph is empty — add concepts via the MCP server or run{" "}
                    <span style={{ fontFamily: MONO, fontSize: 11 }}>pnpm seed</span>, and today's
                    world signal will surface here.
                  </div>
                </div>
              )}
              {brief.map((b, i) => (
                <div
                  key={b.id}
                  onClick={() => openNode(b.id)}
                  style={{ ...card, cursor: "pointer", position: "relative" }}
                >
                  <button
                    type="button"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      void deleteNode(b.id);
                    }}
                    className="cm-trash"
                    title="Delete"
                    style={trashBtn}
                  >
                    <TrashIcon />
                  </button>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      marginBottom: 8,
                      paddingRight: 26,
                    }}
                  >
                    <div
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: i === 0 ? INK : ink(0.4),
                        flexShrink: 0,
                      }}
                    />
                    <span
                      style={{
                        fontSize: 7.5,
                        letterSpacing: 2.5,
                        color: ink(0.46),
                        textTransform: "uppercase",
                      }}
                    >
                      {b.kind === "interest"
                        ? "Interest · "
                        : b.kind === "concept"
                          ? "Concept · "
                          : ""}
                      {b.title}
                    </span>
                  </div>
                  <Markdown style={{ fontSize: 13, color: ink(0.8) }}>{b.summary}</Markdown>
                </div>
              ))}

              {loops[0] && (
                <>
                  <div style={{ flexShrink: 0, height: 8 }} />
                  <div
                    style={{
                      flexShrink: 0,
                      background: surface(0.78),
                      backdropFilter: "blur(13px) saturate(1.05)",
                      WebkitBackdropFilter: "blur(13px) saturate(1.05)",
                      border: `1px solid ${ink(0.16)}`,
                      borderRadius: 12,
                      padding: "16px 18px",
                      boxShadow: "0 8px 30px rgba(0,0,0,.07)",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      <div
                        style={{
                          width: 7,
                          height: 7,
                          background: INK,
                          transform: "rotate(45deg)",
                          flexShrink: 0,
                          animation: "soft-pulse 2.4s ease-in-out infinite",
                        }}
                      />
                      <span
                        style={{
                          fontSize: 7.5,
                          letterSpacing: 2.5,
                          color: ink(0.6),
                          textTransform: "uppercase",
                        }}
                      >
                        Open Loop · resurfacing
                      </span>
                    </div>
                    <div
                      style={{ fontSize: 13, color: ink(0.82), lineHeight: 1.62, marginBottom: 14 }}
                    >
                      {loops[0].summary}
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        type="button"
                        onClick={() => e()?.runDefault()}
                        className="cm-continue"
                        style={loopBtn(ACCENT, ACCENT_FG, ACCENT)}
                      >
                        Continue
                      </button>
                      <button
                        type="button"
                        className="cm-park"
                        style={loopBtn("transparent", ink(0.5), ink(0.18))}
                      >
                        Park
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Command line — live search */}
          <div
            style={{
              position: "absolute",
              bottom: 76,
              left: MID_CENTER,
              transform: "translateX(-50%)",
              width: MID_W(600),
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
            }}
          >
            <form
              onSubmit={(ev) => {
                ev.preventDefault();
                e()?.submit();
              }}
              style={{ position: "relative", width: "100%" }}
            >
              <input
                type="text"
                value={view.queryInput}
                onChange={(ev) => e()?.setQuery(ev.target.value)}
                placeholder="Ask your second brain…"
                className="cm-input"
                style={{
                  width: "100%",
                  background: surface(0.82),
                  border: `1px solid ${ink(0.14)}`,
                  borderRadius: 28,
                  padding: "15px 54px 15px 24px",
                  fontFamily: SANS,
                  fontSize: 14,
                  color: INK,
                  boxShadow: `0 10px 30px rgba(0,0,0,.06),inset 0 1px 0 ${surface(0.8)}`,
                  backdropFilter: "blur(12px)",
                }}
              />
              <button
                type="submit"
                className="cm-submit"
                style={{
                  position: "absolute",
                  right: 13,
                  top: "50%",
                  transform: "translateY(-50%)",
                  background: ACCENT,
                  border: "none",
                  borderRadius: "50%",
                  width: 32,
                  height: 32,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                }}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path
                    d="M2 7h10M8.5 4l3 3-3 3"
                    stroke={ACCENT_FG}
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </form>
            <div
              style={{
                textAlign: "center",
                marginTop: 8,
                fontFamily: MONO,
                fontSize: 7.5,
                letterSpacing: 3,
                color: ink(0.26),
                textTransform: "uppercase",
              }}
            >
              {queryHint}
            </div>
          </div>

          {/* Status bar — live vitals */}
          <div
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              height: 56,
              background: surface(0.78),
              borderTop: `1px solid ${ink(0.08)}`,
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
              display: "flex",
              alignItems: "center",
              padding: "0 28px",
            }}
          >
            <Vital
              value={String(c.Concept ?? 0)}
              label="Concepts"
              dot
              onClick={() => openList("Concept", "Concepts")}
            />
            <Divider />
            <Vital
              value={String(c.Insight ?? 0)}
              label="Insights"
              onClick={() => openList("Insight", "Insights")}
            />
            <Divider />
            <Vital
              value={String(c.Synthesis ?? 0)}
              label="Syntheses"
              onClick={() => openList("Synthesis", "Syntheses")}
            />
            <Divider />
            <Vital
              value={String(c.WorldEvent ?? 0)}
              label="World Events"
              last
              onClick={() => openList("WorldEvent", "World Events")}
            />
            <div style={{ flex: 1 }} />
            <ThemeToggle dark={dark} onToggle={() => setDark((v) => !v)} />
            <Divider />
            <div style={{ paddingRight: 20, textAlign: "right" }}>
              <div style={{ fontFamily: MONO, fontSize: 14, color: ink(0.5), lineHeight: 1 }}>
                {spend != null ? `$${spend.toFixed(2)}` : "—"}
              </div>
              <div
                style={{
                  fontSize: 6.5,
                  letterSpacing: 2,
                  color: ink(0.28),
                  textTransform: "uppercase",
                }}
              >
                API Today
              </div>
            </div>
            <Divider />
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: healthy ? INK : "#C2557A",
                  animation: "soft-pulse 2.4s ease-in-out infinite",
                }}
              />
              <span
                style={{
                  fontSize: 8,
                  letterSpacing: 2.5,
                  color: ink(0.55),
                  textTransform: "uppercase",
                }}
              >
                {healthy ? "Healthy" : "Degraded"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Knowledge-graph widget chrome. Deliberately a sibling of #cm-hud rather
          than a child: it must survive both the query dim and fullscreen, which
          blank everything inside the HUD. */}
      <GraphWidgetBar
        full={graphFull}
        appearance={appearance}
        groups={settingGroups}
        openGroup={openGroup}
        onOpenGroup={(id) => setOpenGroup((cur) => (cur === id ? null : id))}
        onToggleFull={toggleGraphFull}
        onChange={patchAppearance}
        onReset={() => {
          setAppearance(DEFAULT_APPEARANCE);
          e()?.applyAppearance(DEFAULT_APPEARANCE);
          try {
            localStorage.removeItem(APPEARANCE_KEY);
          } catch {
            /* ignore */
          }
        }}
      />

      {/* Settings card for whichever variable group is open */}
      {openGroup && settingGroups.some((g) => g.id === openGroup) && (
        <SettingsCard
          group={settingGroups.find((g) => g.id === openGroup) as SettingGroup}
          values={settingValues}
          onClose={() => setOpenGroup(null)}
          onSave={saveSettings}
        />
      )}

      {/* Focus mode — the selected node's direct connections, as a walkable list */}
      {view.focus && (
        <FocusPanel
          focus={view.focus}
          full={graphFull}
          onWalk={walkTo}
          onBack={walkBack}
          onExit={() => {
            e()?.clearFocus();
            setDetail(null);
          }}
        />
      )}

      {/* Minimized chat — fullscreen hides the command glass, so the command line
          collapses to a pill that expands over the graph when you need it. */}
      {graphFull && (
        <MinimizedChat
          open={chatOpen}
          value={view.queryInput}
          hint={queryHint}
          onOpen={() => setChatOpen((v) => !v)}
          onChange={(v) => e()?.setQuery(v)}
          onSubmit={() => e()?.submit()}
        />
      )}

      {/* Type list (Concepts / Insights / Syntheses / World Events) — click a row to
          open its card, trash to delete */}
      {listPanel && (
        <div
          style={{
            position: "absolute",
            left: 32,
            bottom: 86,
            zIndex: 21,
            width: 320,
            maxHeight: "56vh",
            display: "flex",
            flexDirection: "column",
            background: surface(0.93),
            backdropFilter: "blur(18px) saturate(1.1)",
            WebkitBackdropFilter: "blur(18px) saturate(1.1)",
            border: `1px solid ${ink(0.1)}`,
            borderRadius: 14,
            boxShadow: "0 16px 50px rgba(0,0,0,.12)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "14px 16px 12px",
              borderBottom: `1px solid ${ink(0.07)}`,
            }}
          >
            <span
              style={{
                fontFamily: MONO,
                fontSize: 8,
                letterSpacing: 3,
                color: ink(0.55),
                textTransform: "uppercase",
              }}
            >
              {listPanel.label} · {listItems.length}
            </span>
            <button
              type="button"
              onClick={() => setListPanel(null)}
              style={{
                fontFamily: MONO,
                fontSize: 12,
                lineHeight: 1,
                padding: "2px 9px",
                border: `1px solid ${ink(0.16)}`,
                borderRadius: 6,
                background: "transparent",
                color: ink(0.6),
                cursor: "pointer",
              }}
            >
              ×
            </button>
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "4px 8px 10px" }}>
            {listItems.length === 0 && (
              <div style={{ fontFamily: MONO, fontSize: 10, color: ink(0.3), padding: "10px 8px" }}>
                nothing here yet
              </div>
            )}
            {listItems.map((it) => (
              <div
                key={it.id}
                className="cm-chip"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "5px 6px 5px 10px",
                  borderRadius: 8,
                }}
              >
                <span
                  onClick={() => openNode(it.id)}
                  title={it.summary}
                  style={{
                    flex: 1,
                    fontSize: 12,
                    color: ink(0.78),
                    cursor: "pointer",
                    lineHeight: 1.3,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {it.title}
                </span>
                <button
                  type="button"
                  onClick={() => void deleteNode(it.id)}
                  className="cm-trash"
                  title="Delete"
                  style={{
                    width: 22,
                    height: 22,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    border: `1px solid ${ink(0.12)}`,
                    borderRadius: 6,
                    background: "transparent",
                    cursor: "pointer",
                    padding: 0,
                    flexShrink: 0,
                  }}
                >
                  <TrashIcon />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Node detail card — everything about a concept/source you clicked */}
      {detail && (
        <NodeDetailCard
          detail={detail}
          onClose={() => setDetail(null)}
          onOpen={openNode}
          onFocus={focusFrom}
          onDelete={deleteNode}
          onSave={saveEdit}
        />
      )}

      {/* Answer overlay — wider, with a scrollable body (research briefings are long) */}
      {view.showAnswer && (
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%,-50%)",
            zIndex: 20,
            width: 760,
            maxWidth: "92vw",
            maxHeight: "78vh",
            display: "flex",
            flexDirection: "column",
            background: surface(0.92),
            backdropFilter: "blur(28px) saturate(1.1)",
            WebkitBackdropFilter: "blur(28px) saturate(1.1)",
            border: `1px solid ${ink(0.1)}`,
            borderRadius: 16,
            padding: "26px 30px",
            boxShadow: "0 30px 80px rgba(0,0,0,.14)",
            animation: "float-in-center .55s ease-out",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              marginBottom: 16,
              flexShrink: 0,
            }}
          >
            <div style={{ width: 18, height: 2, background: INK }} />
            <div
              style={{ fontSize: 7, letterSpacing: 5, color: ink(0.5), textTransform: "uppercase" }}
            >
              {view.noMatch ? "Not in your graph" : "Retrieved"}
            </div>
            <div style={{ flex: 1, height: 1, background: ink(0.1) }} />
          </div>
          <div style={{ flex: 1, overflowY: "auto", minHeight: 60, paddingRight: 6 }}>
            <Markdown style={{ fontSize: 14, color: ink(0.86) }}>{view.answerText}</Markdown>
            {view.sources.length > 0 && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 20 }}>
                {view.sources.map((src, i) => (
                  <div
                    key={`${src.id}-${i}`}
                    onClick={() => src.id && openNode(src.id)}
                    className="cm-chip"
                    style={{
                      fontFamily: MONO,
                      fontSize: 9,
                      padding: "5px 13px",
                      background: ink(0.03),
                      border: `1px solid ${ink(0.16)}`,
                      borderRadius: 20,
                      color: ink(0.62),
                      cursor: src.id ? "pointer" : "default",
                      userSelect: "none",
                    }}
                  >
                    {src.label}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 20, flexShrink: 0 }}>
            {view.noMatch && (
              <button
                type="button"
                onClick={() => e()?.researchCurrent()}
                className="cm-continue"
                style={{
                  fontFamily: MONO,
                  fontSize: 8.5,
                  letterSpacing: 2.5,
                  padding: "9px 22px",
                  background: ACCENT,
                  border: `1px solid ${ACCENT}`,
                  borderRadius: 7,
                  color: ACCENT_FG,
                  cursor: "pointer",
                  textTransform: "uppercase",
                }}
              >
                ◈ Research the web
              </button>
            )}
            <button
              type="button"
              onClick={() => e()?.closeAnswer()}
              className="cm-dismiss"
              style={{
                fontFamily: MONO,
                fontSize: 8.5,
                letterSpacing: 2.5,
                padding: "9px 22px",
                background: "transparent",
                border: `1px solid ${ink(0.16)}`,
                borderRadius: 7,
                color: ink(0.5),
                cursor: "pointer",
                textTransform: "uppercase",
              }}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Reasoning trace console */}
      {showTrace && (
        <div
          style={{
            position: "absolute",
            top: graphFull ? 24 : 228,
            // Same reasoning as the focus panel: windowed, the right column is
            // the graph's, so the trace takes the left column's activity slot.
            right: graphFull ? 32 : undefined,
            left: graphFull ? undefined : 32,
            width: 326,
            bottom: graphFull ? 86 : 86,
            zIndex: 12,
            display: "flex",
            flexDirection: "column",
            background: surface(0.82),
            backdropFilter: "blur(18px) saturate(1.1)",
            WebkitBackdropFilter: "blur(18px) saturate(1.1)",
            border: `1px solid ${ink(0.1)}`,
            borderRadius: 14,
            boxShadow: "0 16px 50px rgba(0,0,0,.1)",
            overflow: "hidden",
          }}
        >
          <div style={{ padding: "14px 16px 12px", borderBottom: `1px solid ${ink(0.07)}` }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <span
                style={{
                  fontFamily: MONO,
                  fontSize: 8,
                  letterSpacing: 3,
                  color: ink(0.55),
                  textTransform: "uppercase",
                }}
              >
                Reasoning Trace
              </span>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  type="button"
                  onClick={() => e()?.cycleSpeed()}
                  style={{
                    fontFamily: MONO,
                    fontSize: 8,
                    letterSpacing: 1,
                    padding: "3px 8px",
                    border: `1px solid ${ink(0.16)}`,
                    borderRadius: 6,
                    background: "transparent",
                    color: ink(0.6),
                    cursor: "pointer",
                  }}
                >
                  {view.speedLabel}
                </button>
                <button
                  type="button"
                  onClick={() => e()?.replay()}
                  style={{
                    fontFamily: MONO,
                    fontSize: 10,
                    lineHeight: 1,
                    padding: "3px 9px",
                    border: `1px solid ${ink(0.16)}`,
                    borderRadius: 6,
                    background: "transparent",
                    color: ink(0.6),
                    cursor: "pointer",
                  }}
                >
                  ↻
                </button>
              </div>
            </div>
            <div
              style={{
                fontFamily: MONO,
                fontSize: 8,
                letterSpacing: 1.5,
                color: ink(0.36),
                textTransform: "uppercase",
                marginTop: 8,
                minHeight: 10,
              }}
            >
              {view.traverseStage}
            </div>
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "4px 16px 14px" }}>
            {view.traceLines.map((line) => (
              <div
                key={`${line.n}-${line.label}`}
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "flex-start",
                  padding: "8px 0",
                  borderBottom: `1px solid ${ink(0.05)}`,
                  animation: "float-in .34s ease-out",
                }}
              >
                <span
                  style={{
                    fontFamily: MONO,
                    fontSize: 10,
                    fontWeight: 700,
                    color: line.accent,
                    flexShrink: 0,
                    lineHeight: 1.5,
                  }}
                >
                  {line.n}
                </span>
                <div>
                  <div
                    style={{
                      fontFamily: MONO,
                      fontSize: 10,
                      letterSpacing: 0.4,
                      color: ink(0.82),
                      lineHeight: 1.5,
                    }}
                  >
                    {line.label}
                  </div>
                  {line.detail && (
                    <div
                      style={{
                        fontFamily: SANS,
                        fontSize: 11,
                        color: ink(0.5),
                        lineHeight: 1.5,
                        marginTop: 3,
                        textWrap: "pretty" as CSSProperties["textWrap"],
                      }}
                    >
                      {line.detail}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Active node callout */}
      {view.callout && (
        <div
          id="cm-callout"
          style={{
            position: "absolute",
            zIndex: 13,
            transform: "translate(-50%,-138%)",
            pointerEvents: "none",
            background: `rgba(var(--accent),.9)`,
            border: `1px solid ${`rgba(var(--accent-fg),.14)`}`,
            borderRadius: 9,
            padding: "9px 12px",
            minWidth: 150,
            maxWidth: 236,
            boxShadow: "0 12px 30px rgba(0,0,0,.3)",
            transition: "opacity .25s ease",
          }}
        >
          <div
            style={{
              fontFamily: MONO,
              fontSize: 8.5,
              letterSpacing: 1.5,
              color: ACCENT_FG,
              textTransform: "uppercase",
              lineHeight: 1.4,
            }}
          >
            {view.callout.tag} ·{" "}
            <span style={{ color: `rgba(var(--accent-fg),.5)` }}>{view.callout.type}</span>
          </div>
          <div
            style={{
              fontFamily: SANS,
              fontSize: 11,
              color: `rgba(var(--accent-fg),.74)`,
              lineHeight: 1.45,
              marginTop: 5,
              textWrap: "pretty" as CSSProperties["textWrap"],
            }}
          >
            {view.callout.line}
          </div>
        </div>
      )}
    </div>
  );
}

/** Chrome for the knowledge-graph widget: expand, line weight, and two palettes. */
function GraphWidgetBar({
  full,
  appearance,
  groups,
  openGroup,
  onOpenGroup,
  onToggleFull,
  onChange,
  onReset,
}: {
  full: boolean;
  appearance: GraphAppearance;
  groups: SettingGroup[];
  openGroup: string | null;
  onOpenGroup: (id: string) => void;
  onToggleFull: () => void;
  onChange: (p: Partial<GraphAppearance>) => void;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const dirty = appearance.linkWidth !== 1 || !!appearance.nodeColor || !!appearance.linkColor;
  // Split across two rows counting the two graph controls, so the rows come out
  // even rather than leaving a stub on the second one.
  const perRow = Math.ceil((groups.length + 2) / 2);
  const groupButton = (g: SettingGroup) => (
    <button
      key={g.id}
      type="button"
      onClick={() => onOpenGroup(g.id)}
      className="cm-chip"
      title={`${g.label} — ${g.blurb}`}
      aria-label={g.label}
      aria-expanded={openGroup === g.id}
      style={{
        ...iconBtn,
        background: openGroup === g.id ? ACCENT : "transparent",
        color: openGroup === g.id ? ACCENT_FG : ink(0.6),
      }}
    >
      <SettingIcon name={g.icon} />
    </button>
  );
  return (
    <div
      style={{
        position: "absolute",
        bottom: full ? 22 : 70,
        right: 32,
        zIndex: 24,
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        gap: 8,
        transition: "bottom .35s ease",
      }}
    >
      {open && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 18,
            background: surface(0.93),
            backdropFilter: "blur(18px) saturate(1.1)",
            WebkitBackdropFilter: "blur(18px) saturate(1.1)",
            border: `1px solid ${ink(0.1)}`,
            borderRadius: 14,
            padding: "13px 18px",
            boxShadow: "0 16px 50px rgba(0,0,0,.12)",
            animation: "float-in .3s ease-out",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            <span style={ctrlLabel}>Line weight · {appearance.linkWidth.toFixed(2)}×</span>
            <input
              type="range"
              min={0.25}
              max={4}
              step={0.05}
              value={appearance.linkWidth}
              aria-label="Connection line thickness"
              onChange={(ev) => onChange({ linkWidth: Number(ev.target.value) })}
              className="cm-range"
              style={{ width: 164 }}
            />
          </div>
          <div style={{ width: 1, alignSelf: "stretch", background: ink(0.09) }} />
          <Swatches
            label="Nodes"
            swatches={NODE_SWATCHES}
            value={appearance.nodeColor}
            onPick={(c) => onChange({ nodeColor: c })}
          />
          <div style={{ width: 1, alignSelf: "stretch", background: ink(0.09) }} />
          <Swatches
            label="Lines"
            swatches={LINK_SWATCHES}
            value={appearance.linkColor}
            onPick={(c) => onChange({ linkColor: c })}
          />
          {dirty && (
            <>
              <div style={{ width: 1, alignSelf: "stretch", background: ink(0.09) }} />
              <button type="button" onClick={onReset} className="cm-chip" style={pillBtn}>
                Reset
              </button>
            </>
          )}
        </div>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          background: surface(0.86),
          backdropFilter: "blur(14px) saturate(1.05)",
          WebkitBackdropFilter: "blur(14px) saturate(1.05)",
          border: `1px solid ${ink(0.12)}`,
          borderRadius: 20,
          padding: "9px 12px 9px 16px",
          boxShadow: "0 10px 30px rgba(0,0,0,.08)",
        }}
      >
        <span
          style={{
            fontFamily: MONO,
            fontSize: 7.5,
            letterSpacing: 3,
            color: ink(0.5),
            textTransform: "uppercase",
          }}
        >
          Settings
        </span>
        {/* Two rows. One row of eleven icons ran most of the way across the
            screen; split evenly (counting the two graph controls, which stay on
            the bottom row behind their divider) it is about half as wide. */}
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          <div style={{ display: "flex", gap: 7 }}>{groups.slice(0, perRow).map(groupButton)}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            {groups.slice(perRow).map(groupButton)}
            <div
              style={{ width: 1, alignSelf: "stretch", background: ink(0.12), margin: "0 2px" }}
            />
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="cm-chip"
              title="Appearance"
              aria-label="Graph appearance controls"
              aria-expanded={open}
              style={{ ...iconBtn, background: open ? ink(0.08) : "transparent" }}
            >
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <title>Sliders</title>
                <path
                  d="M2 4h6M11 4h1M2 10h2M7 10h5"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                />
                <circle cx="9.5" cy="4" r="1.6" stroke="currentColor" strokeWidth="1.3" />
                <circle cx="5.5" cy="10" r="1.6" stroke="currentColor" strokeWidth="1.3" />
              </svg>
            </button>
            <button
              type="button"
              onClick={onToggleFull}
              className="cm-chip"
              title={full ? "Restore the dashboard" : "Expand the graph to fullscreen"}
              aria-label={full ? "Restore the dashboard" : "Expand the graph to fullscreen"}
              style={{
                ...iconBtn,
                background: full ? ACCENT : "transparent",
                color: full ? ACCENT_FG : ink(0.6),
              }}
            >
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <title>{full ? "Collapse" : "Expand"}</title>
                {full ? (
                  <path
                    d="M6 1v4a1 1 0 0 1-1 1H1M8 13V9a1 1 0 0 1 1-1h4"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                ) : (
                  <path
                    d="M1 5V2a1 1 0 0 1 1-1h3M13 9v3a1 1 0 0 1-1 1H9M9 1h3a1 1 0 0 1 1 1v3M5 13H2a1 1 0 0 1-1-1V9"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                )}
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Latest world observations the daemon kept because they scored close to one of
 * your concepts.
 *
 * Age is shown rather than hidden: this panel refreshes on staleness, not on a
 * schedule, so "4h ago" is the honest statement of what you're looking at. The
 * refresh button forces a brief immediately — it costs an Anthropic call, which
 * is why it's a button and not an automatic retry.
 */
function NewsPanel({
  feed,
  busy,
  onRefresh,
  onOpen,
}: {
  feed: NewsFeed;
  busy: boolean;
  onRefresh: () => void;
  onOpen: (id: string) => void;
}) {
  const age =
    feed.ageHours == null
      ? "never fetched"
      : feed.ageHours < 1
        ? "just now"
        : feed.ageHours < 24
          ? `${Math.floor(feed.ageHours)}h ago`
          : `${Math.floor(feed.ageHours / 24)}d ago`;
  const working = busy || feed.refreshing;

  return (
    <div
      style={{
        flex: "1 1 0",
        minHeight: 150,
        pointerEvents: "auto",
        display: "flex",
        flexDirection: "column",
        background: surface(0.6),
        backdropFilter: "blur(13px) saturate(1.05)",
        WebkitBackdropFilter: "blur(13px) saturate(1.05)",
        border: `1px solid ${ink(0.07)}`,
        borderRadius: 14,
        boxShadow: "0 8px 30px rgba(0,0,0,.05)",
        overflow: "hidden",
      }}
    >
      <div style={{ padding: "14px 16px 11px", borderBottom: `1px solid ${ink(0.06)}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              fontSize: 7.5,
              letterSpacing: 3,
              color: ink(0.4),
              textTransform: "uppercase",
              flex: 1,
            }}
          >
            Latest News
          </span>
          <span style={{ fontFamily: MONO, fontSize: 8, color: ink(0.3) }}>
            {working ? "fetching…" : age}
          </span>
          <button
            type="button"
            onClick={onRefresh}
            disabled={working}
            className="cm-iconbtn"
            title="Fetch a fresh brief now (uses an Anthropic call)"
            aria-label="Refresh news"
            style={{
              width: 22,
              height: 22,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: `1px solid ${ink(0.14)}`,
              borderRadius: 6,
              background: "transparent",
              color: ink(working ? 0.25 : 0.55),
              cursor: working ? "default" : "pointer",
              padding: 0,
              flexShrink: 0,
            }}
          >
            <svg
              width="11"
              height="11"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              style={{ animation: working ? "cm-spin 1.1s linear infinite" : "none" }}
            >
              <title>Refresh</title>
              <path d="M13.6 7a5.6 5.6 0 1 0-.5 3.4" />
              <path d="M13.9 3.2v3.6h-3.6" />
            </svg>
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "4px 8px 10px" }}>
        {feed.items.length === 0 && (
          <div
            style={{
              fontFamily: MONO,
              fontSize: 9.5,
              color: ink(0.3),
              padding: "12px 8px",
              lineHeight: 1.6,
            }}
          >
            {working
              ? "pulling a brief…"
              : "no observations yet — the brief keeps what scores close to your concepts"}
          </div>
        )}
        {feed.items.map((n) => (
          <button
            key={n.id}
            type="button"
            onClick={() => onOpen(n.id)}
            className="cm-row"
            style={{
              display: "block",
              width: "100%",
              textAlign: "left",
              border: "none",
              background: "transparent",
              padding: "9px 8px",
              borderRadius: 8,
              cursor: "pointer",
            }}
          >
            <div style={{ fontSize: 12, color: ink(0.82), lineHeight: 1.35, fontWeight: 500 }}>
              {n.title}
            </div>
            <div
              style={{
                fontSize: 11,
                color: ink(0.46),
                lineHeight: 1.45,
                marginTop: 4,
                display: "-webkit-box",
                WebkitLineClamp: 3,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {n.summary}
            </div>
            {n.asOf && (
              <div style={{ fontFamily: MONO, fontSize: 8, color: ink(0.28), marginTop: 5 }}>
                {n.asOf.slice(0, 10)}
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Line icons for the settings groups, keyed by the group's `icon`. */
function SettingIcon({ name }: { name: string }) {
  const common = {
    width: 13,
    height: 13,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.3,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  const paths: Record<string, React.ReactNode> = {
    key: (
      <>
        <circle cx="5.5" cy="5.5" r="3" />
        <path d="M7.7 7.7 14 14M11.5 11.5l-1.4 1.4M13 13l-1.2 1.2" />
      </>
    ),
    brain: (
      <>
        <path d="M8 3v10" />
        <path d="M8 4.5A2 2 0 0 0 4 5a2 2 0 0 0-1 3.6A2 2 0 0 0 5 12a2 2 0 0 0 3 .7" />
        <path d="M8 4.5A2 2 0 0 1 12 5a2 2 0 0 1 1 3.6A2 2 0 0 1 11 12a2 2 0 0 1-3 .7" />
      </>
    ),
    coin: (
      <>
        <circle cx="8" cy="8" r="5.5" />
        <path d="M8 5v6M6.5 6.5h2.2a1.1 1.1 0 0 1 0 2.2H6.8a1.1 1.1 0 0 0 0 2.2H9.5" />
      </>
    ),
    vector: (
      <>
        <circle cx="3.5" cy="12.5" r="1.6" />
        <circle cx="12.5" cy="3.5" r="1.6" />
        <path d="M4.9 11.1 11.1 4.9" />
        <path d="M2 8h1.2M8 2v1.2M13.5 8h.5M8 13.5v.5" />
      </>
    ),
    inbox: (
      <>
        <path d="M2 9.5 3.6 3.2A1 1 0 0 1 4.6 2.5h6.8a1 1 0 0 1 1 .7L14 9.5" />
        <path d="M2 9.5h3.2l.8 1.6h4l.8-1.6H14v3a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z" />
      </>
    ),
    sun: (
      <>
        <circle cx="8" cy="8" r="3" />
        <path d="M8 1v1.6M8 13.4V15M15 8h-1.6M2.6 8H1M12.9 3.1l-1.1 1.1M4.2 11.8l-1.1 1.1M12.9 12.9l-1.1-1.1M4.2 4.2 3.1 3.1" />
      </>
    ),
    broom: (
      <>
        <path d="M10.5 2.5 7 6" />
        <path d="M4 12.5c0-2 .8-3.5 2.2-4.4l2.5 2.5C7.8 12 6.2 13 4 13z" />
        <path d="M8.7 10.6 13 6.3a1.5 1.5 0 0 0-2.1-2.1L6.6 8.5" />
      </>
    ),
    bell: (
      <>
        <path d="M4 7a4 4 0 1 1 8 0c0 2.4.6 3.6 1.2 4.3.3.3.1.7-.3.7H3.1c-.4 0-.6-.4-.3-.7C3.4 10.6 4 9.4 4 7z" />
        <path d="M6.6 14a1.6 1.6 0 0 0 2.8 0" />
      </>
    ),
    database: (
      <>
        <ellipse cx="8" cy="3.8" rx="5" ry="2" />
        <path d="M3 3.8v8.4c0 1.1 2.2 2 5 2s5-.9 5-2V3.8" />
        <path d="M3 8c0 1.1 2.2 2 5 2s5-.9 5-2" />
      </>
    ),
  };
  return (
    <svg {...common} aria-hidden="true">
      <title>{name}</title>
      {paths[name] ?? <circle cx="8" cy="8" r="5" />}
    </svg>
  );
}

/**
 * Editor for one group of runtime settings. Writes straight to the
 * installation's `.env`; every service re-reads it on its next config access, so
 * a field marked live is in effect before the card closes.
 *
 * Secrets arrive as a sentinel, never a value. The field shows as "set" and is
 * only sent back when the user actually types a replacement — otherwise saving
 * the card would overwrite a working key with a placeholder.
 */
function SettingsCard({
  group,
  values,
  onClose,
  onSave,
}: {
  group: SettingGroup;
  values: Record<string, SettingValue>;
  onClose: () => void;
  onSave: (patch: Record<string, SettingValue>) => Promise<{ ok?: boolean; error?: string }>;
}) {
  const [draft, setDraft] = useState<Record<string, SettingValue>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // A different group opened in the same card slot: drop any half-typed edits
  // rather than carrying them across to fields they don't belong to.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the group
  useEffect(() => {
    setDraft({});
    setError(null);
    setSaved(false);
  }, [group.id]);

  const current = (f: SettingField): SettingValue => {
    if (f.key in draft) return draft[f.key] as SettingValue;
    const v = values[f.key];
    if (f.kind === "boolean") return v === true || v === "true";
    if (f.kind === "secret") return v === SECRET_SET ? SECRET_SET : "";
    return typeof v === "string" ? v : "";
  };
  const set = (key: string, v: SettingValue) => {
    setSaved(false);
    setDraft((d) => ({ ...d, [key]: v }));
  };

  const dirty = Object.keys(draft).length > 0;
  const needsRestart = Object.keys(draft).some(
    (k) => group.fields.find((f) => f.key === k)?.live === false,
  );

  const submit = async () => {
    setSaving(true);
    setError(null);
    const r = await onSave(draft);
    setSaving(false);
    if (r.ok) {
      setDraft({});
      setSaved(true);
    } else setError(r.error ?? "could not save");
  };

  return (
    <div
      style={{
        position: "absolute",
        right: 32,
        // Clears the two-row settings bar beneath it.
        bottom: 164,
        zIndex: 25,
        width: 372,
        maxHeight: "calc(100vh - 236px)",
        display: "flex",
        flexDirection: "column",
        background: surface(0.95),
        backdropFilter: "blur(20px) saturate(1.1)",
        WebkitBackdropFilter: "blur(20px) saturate(1.1)",
        border: `1px solid ${ink(0.12)}`,
        borderRadius: 14,
        boxShadow: "0 20px 60px rgba(0,0,0,.18)",
        overflow: "hidden",
        animation: "float-in .3s ease-out",
      }}
    >
      <div style={{ padding: "14px 16px 12px", borderBottom: `1px solid ${ink(0.07)}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <span style={{ color: ink(0.6), display: "flex" }}>
            <SettingIcon name={group.icon} />
          </span>
          <span
            style={{
              fontFamily: MONO,
              fontSize: 8,
              letterSpacing: 3,
              color: ink(0.6),
              textTransform: "uppercase",
              flex: 1,
            }}
          >
            {group.label}
          </span>
          <button type="button" onClick={onClose} className="cm-chip" style={pillBtn}>
            Close
          </button>
        </div>
        <div style={{ fontSize: 11, color: ink(0.46), lineHeight: 1.45, marginTop: 8 }}>
          {group.blurb}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "14px 16px" }}>
        {group.fields.map((f) => (
          <div key={f.key} style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 7, marginBottom: 5 }}>
              <span style={{ ...ctrlLabel, letterSpacing: 2 }}>{f.label}</span>
              {!f.live && (
                <span
                  style={{
                    fontFamily: MONO,
                    fontSize: 6.5,
                    letterSpacing: 1.4,
                    color: ink(0.34),
                    border: `1px solid ${ink(0.14)}`,
                    borderRadius: 4,
                    padding: "1px 5px",
                    textTransform: "uppercase",
                  }}
                  title="Read once at startup — this one needs a restart to take effect."
                >
                  restart
                </span>
              )}
            </div>

            {f.kind === "boolean" ? (
              <button
                type="button"
                onClick={() => set(f.key, !(current(f) as boolean))}
                className="cm-chip"
                style={{
                  ...pillBtn,
                  padding: "6px 14px",
                  color: current(f) ? ACCENT_FG : ink(0.55),
                  background: current(f) ? ACCENT : "transparent",
                  borderColor: current(f) ? ACCENT : ink(0.16),
                }}
              >
                {current(f) ? "On" : "Off"}
              </button>
            ) : f.kind === "textarea" ? (
              <textarea
                value={current(f) as string}
                placeholder={f.placeholder}
                onChange={(ev) => set(f.key, ev.target.value)}
                className="cm-edit"
                rows={3}
                style={settingInput}
              />
            ) : (
              <input
                type={f.kind === "secret" ? "password" : "text"}
                inputMode={f.kind === "number" ? "decimal" : undefined}
                value={
                  f.kind === "secret" && current(f) === SECRET_SET ? "" : (current(f) as string)
                }
                placeholder={
                  f.kind === "secret" && current(f) === SECRET_SET
                    ? "•••••••• set — type to replace"
                    : f.placeholder
                }
                onChange={(ev) => set(f.key, ev.target.value)}
                className="cm-edit"
                style={settingInput}
              />
            )}

            {f.hint && (
              <div style={{ fontSize: 10, color: ink(0.38), lineHeight: 1.45, marginTop: 5 }}>
                {f.hint}
              </div>
            )}
          </div>
        ))}
      </div>

      <div
        style={{
          padding: "11px 16px",
          borderTop: `1px solid ${ink(0.07)}`,
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <div style={{ flex: 1, fontSize: 10, color: error ? "#C2557A" : ink(0.42) }}>
          {error ??
            (saved
              ? needsRestart
                ? "Saved — restart to apply"
                : "Saved — live now"
              : dirty
                ? "Unsaved changes"
                : "Writes to .env")}
        </div>
        <button
          type="button"
          onClick={submit}
          disabled={!dirty || saving}
          className="cm-continue"
          style={{
            ...pillBtn,
            padding: "6px 16px",
            background: dirty ? ACCENT : "transparent",
            color: dirty ? ACCENT_FG : ink(0.35),
            borderColor: dirty ? ACCENT : ink(0.14),
            cursor: dirty && !saving ? "pointer" : "default",
          }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

const settingInput: CSSProperties = {
  width: "100%",
  background: ink(0.04),
  border: `1px solid ${ink(0.14)}`,
  borderRadius: 8,
  padding: "8px 11px",
  fontFamily: MONO,
  fontSize: 11.5,
  color: INK,
  resize: "vertical",
};

/** A labelled row of colour chips plus a free-choice well and a "theme default" reset. */
function Swatches({
  label,
  swatches,
  value,
  onPick,
}: {
  label: string;
  swatches: string[];
  value: string | null;
  onPick: (c: string | null) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      <span style={ctrlLabel}>{label}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <button
          type="button"
          onClick={() => onPick(null)}
          title="Follow the theme"
          aria-label={`${label}: follow the theme`}
          style={{
            ...chipBtn,
            background: "transparent",
            borderColor: value === null ? INK : ink(0.2),
            borderWidth: value === null ? 2 : 1,
            color: ink(0.45),
            fontSize: 9,
            lineHeight: 1,
          }}
        >
          A
        </button>
        {swatches.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onPick(c)}
            title={c}
            aria-label={`${label}: ${c}`}
            style={{
              ...chipBtn,
              background: c,
              borderColor: value?.toLowerCase() === c.toLowerCase() ? INK : ink(0.2),
              borderWidth: value?.toLowerCase() === c.toLowerCase() ? 2 : 1,
            }}
          />
        ))}
        <input
          type="color"
          value={value ?? "#888888"}
          aria-label={`${label}: custom colour`}
          title="Custom colour"
          onChange={(ev) => onPick(ev.target.value)}
          className="cm-color"
        />
      </div>
    </div>
  );
}

/**
 * Focus mode panel: the node you selected and every node it directly connects to.
 * Each row is a step — clicking one walks there and re-focuses the sphere.
 */
function FocusPanel({
  focus,
  full,
  onWalk,
  onBack,
  onExit,
}: {
  focus: NonNullable<ViewState["focus"]>;
  full: boolean;
  onWalk: (id: string) => void;
  onBack: () => void;
  onExit: () => void;
}) {
  const hidden = focus.total - focus.neighbours.length;
  return (
    <div
      style={{
        position: "absolute",
        top: full ? 24 : 228,
        // Expanded, the graph owns the page and this floats top-right. Windowed,
        // the right column is the graph's, so focus takes the left column's lower
        // slot — the op log steps aside for the duration of a traversal. Stacking
        // it above the graph panel instead left it ~100px tall on a laptop.
        right: full ? 32 : undefined,
        left: full ? undefined : 32,
        width: full ? 326 : 320,
        bottom: full ? undefined : 86,
        maxHeight: full ? "calc(100vh - 140px)" : undefined,
        zIndex: 23,
        display: "flex",
        flexDirection: "column",
        background: surface(0.93),
        backdropFilter: "blur(18px) saturate(1.1)",
        WebkitBackdropFilter: "blur(18px) saturate(1.1)",
        border: `1px solid ${ink(0.1)}`,
        borderRadius: 14,
        boxShadow: "0 16px 50px rgba(0,0,0,.12)",
        overflow: "hidden",
        animation: "float-in .34s ease-out",
      }}
    >
      <div style={{ padding: "13px 16px 12px", borderBottom: `1px solid ${ink(0.07)}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              fontFamily: MONO,
              fontSize: 7.5,
              letterSpacing: 3,
              color: ink(0.5),
              textTransform: "uppercase",
              flex: 1,
            }}
          >
            Connected · {focus.total}
          </span>
          {focus.trail.length > 0 && (
            <button type="button" onClick={onBack} className="cm-chip" style={pillBtn}>
              ← Back
            </button>
          )}
          <button type="button" onClick={onExit} className="cm-chip" style={pillBtn}>
            Exit
          </button>
        </div>
        <div style={{ fontSize: 14, fontWeight: 600, color: ink(0.88), marginTop: 9 }}>
          {focus.title}
        </div>
        <div
          style={{
            fontFamily: MONO,
            fontSize: 8,
            letterSpacing: 1.5,
            color: ink(0.36),
            textTransform: "uppercase",
            marginTop: 4,
          }}
        >
          {focus.type}
          {focus.domain ? ` · ${focus.domain}` : ""}
        </div>
        {focus.trail.length > 0 && (
          <div
            style={{
              fontFamily: MONO,
              fontSize: 8.5,
              color: ink(0.32),
              marginTop: 8,
              lineHeight: 1.5,
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {focus.trail.map((t) => t.title).join(" › ")} › {focus.title}
          </div>
        )}
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "6px 10px 10px" }}>
        {focus.neighbours.length === 0 && (
          <div style={{ fontFamily: MONO, fontSize: 10, color: ink(0.3), padding: "10px 6px" }}>
            no connections yet
          </div>
        )}
        {focus.neighbours.map((n) => (
          <button
            key={n.id}
            type="button"
            onClick={() => onWalk(n.id)}
            className="cm-row"
            style={{
              display: "block",
              width: "100%",
              textAlign: "left",
              border: "none",
              background: "transparent",
              padding: "7px 8px",
              borderRadius: 8,
              cursor: "pointer",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 7,
                fontFamily: MONO,
                fontSize: 7,
                letterSpacing: 1.6,
                color: n.relation === "CONTRADICTS" ? "#C2557A" : ink(0.33),
                textTransform: "uppercase",
              }}
            >
              <span>{n.outgoing ? "→" : "←"}</span>
              <span>{n.relation.replace(/_/g, " ")}</span>
              <span style={{ color: ink(0.25) }}>· {n.type}</span>
              {!n.placed && <span style={{ color: ink(0.25) }}>· off-sphere</span>}
            </div>
            <div style={{ fontSize: 12, color: ink(0.78), lineHeight: 1.35, marginTop: 2 }}>
              {n.title}
            </div>
          </button>
        ))}
        {hidden > 0 && (
          <div
            style={{
              fontFamily: MONO,
              fontSize: 8.5,
              color: ink(0.3),
              padding: "9px 8px 2px",
            }}
          >
            + {hidden} more connection{hidden === 1 ? "" : "s"}
          </div>
        )}
      </div>
    </div>
  );
}

/** The command line, collapsed to a pill, for when the graph owns the screen. */
function MinimizedChat({
  open,
  value,
  hint,
  onOpen,
  onChange,
  onSubmit,
}: {
  open: boolean;
  value: string;
  hint: string;
  onOpen: () => void;
  onChange: (v: string) => void;
  onSubmit: () => void;
}) {
  // Focused on open via a ref rather than `autoFocus`, which would also steal the
  // caret on a page load that happens to start fullscreen.
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);
  return (
    <div
      style={{
        position: "absolute",
        bottom: 22,
        left: 32,
        zIndex: 24,
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: 8,
      }}
    >
      {open && (
        <form
          onSubmit={(ev) => {
            ev.preventDefault();
            onSubmit();
          }}
          style={{ position: "relative", width: 420, maxWidth: "70vw" }}
        >
          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={(ev) => onChange(ev.target.value)}
            placeholder="Ask your second brain…"
            className="cm-input"
            style={{
              width: "100%",
              background: surface(0.92),
              border: `1px solid ${ink(0.14)}`,
              borderRadius: 24,
              padding: "13px 48px 13px 20px",
              fontFamily: SANS,
              fontSize: 13,
              color: INK,
              backdropFilter: "blur(14px)",
              boxShadow: "0 12px 34px rgba(0,0,0,.1)",
            }}
          />
          <button
            type="submit"
            className="cm-submit"
            aria-label="Ask"
            style={{
              position: "absolute",
              right: 10,
              top: "50%",
              transform: "translateY(-50%)",
              background: ACCENT,
              border: "none",
              borderRadius: "50%",
              width: 28,
              height: 28,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
          >
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <title>Ask</title>
              <path
                d="M2 7h10M8.5 4l3 3-3 3"
                stroke={ACCENT_FG}
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <div
            style={{
              fontFamily: MONO,
              fontSize: 7,
              letterSpacing: 2.5,
              color: ink(0.3),
              textTransform: "uppercase",
              marginTop: 7,
              paddingLeft: 10,
            }}
          >
            {hint}
          </div>
        </form>
      )}
      <button
        type="button"
        onClick={onOpen}
        className="cm-chip"
        style={{
          fontFamily: MONO,
          fontSize: 7.5,
          letterSpacing: 3,
          textTransform: "uppercase",
          color: ink(0.6),
          background: surface(0.86),
          border: `1px solid ${ink(0.12)}`,
          borderRadius: 20,
          padding: "8px 16px",
          cursor: "pointer",
          backdropFilter: "blur(12px)",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span style={{ fontSize: 10, lineHeight: 1 }}>{open ? "▾" : "▴"}</span>
        {open ? "Hide chat" : "Ask your second brain"}
      </button>
    </div>
  );
}

const ctrlLabel: CSSProperties = {
  fontFamily: MONO,
  fontSize: 7,
  letterSpacing: 2.4,
  color: ink(0.4),
  textTransform: "uppercase",
};

const iconBtn: CSSProperties = {
  width: 28,
  height: 28,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  border: `1px solid ${ink(0.14)}`,
  borderRadius: "50%",
  color: ink(0.6),
  cursor: "pointer",
  padding: 0,
};

const chipBtn: CSSProperties = {
  width: 17,
  height: 17,
  borderRadius: "50%",
  borderStyle: "solid",
  cursor: "pointer",
  padding: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const pillBtn: CSSProperties = {
  fontFamily: MONO,
  fontSize: 7.5,
  letterSpacing: 1.6,
  padding: "4px 10px",
  border: `1px solid ${ink(0.16)}`,
  borderRadius: 14,
  background: "transparent",
  color: ink(0.55),
  cursor: "pointer",
  textTransform: "uppercase",
};

const card: CSSProperties = {
  background: surface(0.62),
  backdropFilter: "blur(13px) saturate(1.05)",
  WebkitBackdropFilter: "blur(13px) saturate(1.05)",
  border: `1px solid ${ink(0.08)}`,
  borderRadius: 12,
  padding: "16px 18px",
  boxShadow: "0 8px 30px rgba(0,0,0,.05)",
  flexShrink: 0,
};

const loopBtn = (bg: string, color: string, border: string): CSSProperties => ({
  fontFamily: MONO,
  fontSize: 8.5,
  letterSpacing: 2,
  padding: "7px 16px",
  background: bg,
  border: `1px solid ${border}`,
  borderRadius: 7,
  color,
  cursor: "pointer",
  textTransform: "uppercase",
});

const footBtn = (bg: string, color: string, border: string): CSSProperties => ({
  fontFamily: MONO,
  fontSize: 8.5,
  letterSpacing: 2,
  padding: "9px 18px",
  background: bg,
  border: `1px solid ${border}`,
  borderRadius: 7,
  color,
  cursor: "pointer",
  textTransform: "uppercase",
});

const trashBtn: CSSProperties = {
  position: "absolute",
  top: 12,
  right: 12,
  width: 24,
  height: 24,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  border: `1px solid ${ink(0.12)}`,
  borderRadius: 6,
  background: "transparent",
  cursor: "pointer",
  padding: 0,
};

function TrashIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    </svg>
  );
}

function Divider() {
  return <div style={{ width: 1, height: 24, background: ink(0.1), margin: "0 16px" }} />;
}

function ThemeToggle({ dark, onToggle }: { dark: boolean; onToggle: () => void }) {
  // The real theme is only known on the client (read from the DOM after the
  // pre-paint script runs). Render a fixed icon for SSR + first paint so the
  // markup matches, then swap to the correct one after mount — otherwise the
  // sun/moon SVGs differ and React throws a hydration error that breaks the page.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return (
    <button
      type="button"
      onClick={onToggle}
      className="cm-theme"
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      suppressHydrationWarning
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 30,
        height: 30,
        border: `1px solid ${ink(0.16)}`,
        borderRadius: "50%",
        background: surface(0.5),
        color: ink(0.55),
        cursor: "pointer",
        padding: 0,
      }}
    >
      {mounted && dark ? (
        // sun — click to go light
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        // moon — click to go dark
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      )}
    </button>
  );
}

function NodeDetailCard({
  detail,
  onClose,
  onOpen,
  onFocus,
  onDelete,
  onSave,
}: {
  detail: NodeDetail;
  onClose: () => void;
  onOpen: (id: string) => void;
  onFocus: (id: string) => void;
  onDelete: (id: string) => void;
  onSave: (id: string, title: string, summary: string) => void | Promise<void>;
}) {
  const p = detail.props;
  const id = String(p.id ?? "");
  const type = detail.labels.filter((l) => l !== "Node").join(" · ") || String(p.type ?? "Node");
  const [editing, setEditing] = useState(false);
  const [preview, setPreview] = useState(false);
  const [draftTitle, setDraftTitle] = useState(String(p.title ?? ""));
  const [draftSummary, setDraftSummary] = useState(String(p.summary ?? ""));
  const [saving, setSaving] = useState(false);

  const meta = ((): Record<string, unknown> => {
    try {
      return typeof p.metadata === "string"
        ? JSON.parse(p.metadata)
        : ((p.metadata as Record<string, unknown>) ?? {});
    } catch {
      return {};
    }
  })();
  const conf = typeof p.confidence === "number" ? p.confidence : undefined;
  const touched = String(p.lastReadAt ?? p.updatedAt ?? p.createdAt ?? "");
  const url = typeof meta.url === "string" ? meta.url : typeof p.url === "string" ? p.url : "";
  const citations = (Array.isArray(meta.citations) ? meta.citations : []) as Array<{
    title?: string;
    url?: string;
  }>;
  const seen = new Set<string>();
  const edges = detail.edges.filter((ed) => {
    const k = `${ed.type}:${ed.to}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const startEdit = () => {
    setDraftTitle(String(p.title ?? ""));
    setDraftSummary(String(p.summary ?? ""));
    setPreview(false);
    setEditing(true);
  };
  const save = async () => {
    setSaving(true);
    await onSave(id, draftTitle, draftSummary);
    setSaving(false);
    setEditing(false);
  };

  return (
    <div
      style={{
        position: "absolute",
        top: "50%",
        left: "50%",
        transform: "translate(-50%,-50%)",
        zIndex: 22,
        width: 640,
        maxWidth: "92vw",
        maxHeight: "80vh",
        display: "flex",
        flexDirection: "column",
        background: surface(0.95),
        backdropFilter: "blur(28px) saturate(1.1)",
        WebkitBackdropFilter: "blur(28px) saturate(1.1)",
        border: `1px solid ${ink(0.1)}`,
        borderRadius: 16,
        padding: "26px 30px",
        boxShadow: "0 30px 80px rgba(0,0,0,.16)",
        animation: "float-in-center .4s ease-out",
      }}
    >
      <div
        style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexShrink: 0 }}
      >
        <div
          style={{
            fontFamily: MONO,
            fontSize: 7,
            letterSpacing: 4,
            color: ink(0.5),
            textTransform: "uppercase",
          }}
        >
          {type}
          {p.edited ? " · edited" : ""}
        </div>
        <div style={{ flex: 1, height: 1, background: ink(0.1) }} />
        <button
          type="button"
          onClick={onClose}
          style={{
            fontFamily: MONO,
            fontSize: 12,
            lineHeight: 1,
            padding: "2px 9px",
            border: `1px solid ${ink(0.16)}`,
            borderRadius: 6,
            background: "transparent",
            color: ink(0.6),
            cursor: "pointer",
          }}
        >
          ×
        </button>
      </div>

      {editing ? (
        <input
          value={draftTitle}
          onChange={(ev) => setDraftTitle(ev.target.value)}
          className="cm-edit"
          placeholder="Title"
          style={{
            width: "100%",
            marginBottom: 12,
            flexShrink: 0,
            fontFamily: SANS,
            fontSize: 20,
            fontWeight: 600,
            color: INK,
            background: surface(0.6),
            border: `1px solid ${ink(0.16)}`,
            borderRadius: 9,
            padding: "8px 12px",
            lineHeight: 1.25,
          }}
        />
      ) : (
        <div
          style={{
            fontFamily: SANS,
            fontSize: 20,
            fontWeight: 600,
            color: INK,
            marginBottom: 12,
            flexShrink: 0,
            lineHeight: 1.25,
          }}
        >
          {String(p.title ?? "")}
        </div>
      )}

      <div style={{ flex: 1, overflowY: "auto", paddingRight: 6 }}>
        {editing ? (
          preview ? (
            draftSummary.trim() ? (
              <Markdown style={{ fontSize: 14, color: ink(0.82) }}>{draftSummary}</Markdown>
            ) : (
              <div style={{ fontFamily: MONO, fontSize: 11, color: ink(0.4) }}>
                nothing to preview
              </div>
            )
          ) : (
            <textarea
              value={draftSummary}
              onChange={(ev) => setDraftSummary(ev.target.value)}
              className="cm-edit"
              placeholder="Write in markdown — **bold**, lists, `code`, [links](url)…"
              style={{
                width: "100%",
                minHeight: 240,
                resize: "vertical",
                fontFamily: MONO,
                fontSize: 13,
                lineHeight: 1.6,
                color: ink(0.86),
                background: surface(0.6),
                border: `1px solid ${ink(0.16)}`,
                borderRadius: 10,
                padding: "12px 14px",
              }}
            />
          )
        ) : (
          <>
            {p.summary ? (
              <Markdown style={{ fontSize: 14, color: ink(0.82) }}>{String(p.summary)}</Markdown>
            ) : null}

            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "6px 18px",
                marginTop: 16,
                fontFamily: MONO,
                fontSize: 9.5,
                color: ink(0.5),
              }}
            >
              {p.domain ? <span>domain: {String(p.domain)}</span> : null}
              {conf !== undefined ? <span>confidence: {conf.toFixed(2)}</span> : null}
              {p.touchCount !== undefined ? <span>reads: {String(p.touchCount)}</span> : null}
              {touched ? <span>last touched: {touched.slice(0, 10)}</span> : null}
              {meta.source ? <span>source: {String(meta.source)}</span> : null}
            </div>
            {url ? (
              <div style={{ marginTop: 10 }}>
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontFamily: MONO, fontSize: 10, color: LINK, wordBreak: "break-all" }}
                >
                  {url}
                </a>
              </div>
            ) : null}

            {edges.length > 0 && (
              <div style={{ marginTop: 22 }}>
                <div
                  style={{
                    fontFamily: MONO,
                    fontSize: 7.5,
                    letterSpacing: 3,
                    color: ink(0.4),
                    textTransform: "uppercase",
                    marginBottom: 8,
                  }}
                >
                  Connections · {edges.length}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  {edges.map((ed) => (
                    <div
                      key={`${ed.type}-${ed.to}`}
                      onClick={() => onOpen(ed.to)}
                      className="cm-chip"
                      style={{
                        display: "flex",
                        gap: 10,
                        alignItems: "baseline",
                        padding: "6px 10px",
                        borderRadius: 8,
                        cursor: "pointer",
                      }}
                    >
                      <span
                        style={{
                          fontFamily: MONO,
                          fontSize: 8,
                          letterSpacing: 1,
                          color: ink(0.4),
                          minWidth: 92,
                          flexShrink: 0,
                        }}
                      >
                        {ed.type}
                      </span>
                      <span style={{ fontSize: 13, color: ink(0.8) }}>
                        {ed.toTitle ?? ed.to.slice(0, 8)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {citations.length > 0 && (
              <div style={{ marginTop: 22 }}>
                <div
                  style={{
                    fontFamily: MONO,
                    fontSize: 7.5,
                    letterSpacing: 3,
                    color: ink(0.4),
                    textTransform: "uppercase",
                    marginBottom: 8,
                  }}
                >
                  Web sources · {citations.length}
                </div>
                {citations.slice(0, 15).map((cit) => (
                  <div key={cit.url ?? cit.title} style={{ marginBottom: 5 }}>
                    <a
                      href={String(cit.url ?? "")}
                      target="_blank"
                      rel="noreferrer"
                      style={{ fontSize: 11.5, color: LINK }}
                    >
                      {String(cit.title ?? cit.url ?? "")}
                    </a>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 18, flexShrink: 0, alignItems: "center" }}>
        {editing ? (
          <>
            <button
              type="button"
              onClick={() => setPreview((v) => !v)}
              className="cm-iconbtn"
              style={footBtn("transparent", ink(0.6), ink(0.18))}
            >
              {preview ? "✎ Edit" : "◉ Preview"}
            </button>
            <div style={{ flex: 1 }} />
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="cm-dismiss"
              style={footBtn("transparent", ink(0.5), ink(0.16))}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="cm-continue"
              style={{ ...footBtn(ACCENT, ACCENT_FG, ACCENT), opacity: saving ? 0.6 : 1 }}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={startEdit}
              className="cm-iconbtn"
              style={footBtn("transparent", ink(0.6), ink(0.18))}
            >
              ✎ Edit
            </button>
            <button
              type="button"
              onClick={() => onFocus(id)}
              className="cm-iconbtn"
              title="Isolate this node and its direct connections on the sphere"
              style={footBtn("transparent", ink(0.6), ink(0.18))}
            >
              ⦿ Connections
            </button>
            <div style={{ flex: 1 }} />
            <button
              type="button"
              onClick={() => onDelete(id)}
              className="cm-trash"
              style={footBtn("transparent", "#C2557A", "rgba(194,85,122,.4)")}
            >
              Delete
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function Vital({
  value,
  label,
  last,
  dot,
  onClick,
}: {
  value: string;
  label: string;
  last?: boolean;
  dot?: boolean;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      title={onClick ? "view all" : undefined}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        paddingRight: last ? 0 : 20,
        cursor: onClick ? "pointer" : "default",
      }}
    >
      {dot && <div style={{ width: 6, height: 6, borderRadius: "50%", background: INK }} />}
      <div>
        <div
          style={{
            fontFamily: MONO,
            fontSize: 15,
            fontWeight: 700,
            color: INK,
            lineHeight: 1,
            textDecoration: onClick ? "underline dotted rgba(var(--ink),.25)" : "none",
            textUnderlineOffset: 3,
          }}
        >
          {value}
        </div>
        <div
          style={{ fontSize: 6.5, letterSpacing: 2, color: ink(0.36), textTransform: "uppercase" }}
        >
          {label}
        </div>
      </div>
    </div>
  );
}
