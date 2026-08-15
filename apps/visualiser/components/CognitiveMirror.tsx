"use client";

import { type CSSProperties, useEffect, useRef, useState } from "react";
import { CognitiveMirrorEngine, type ViewState } from "../lib/engine";
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
};

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
    // Clicking a node on the sphere opens its full detail card.
    engine.setOnSelect(async (id) => {
      const d = await getJson<NodeDetail | null>(`/api/node/${encodeURIComponent(id)}`, null);
      if (d?.props?.id) setDetail(d);
    });
    engine.mount();
    // Apply the current theme to the freshly-built scene.
    engine.setTheme(document.documentElement.dataset.theme === "dark");

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
      es?.close();
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  const e = () => engineRef.current;
  const c = vitals.counts;

  // Rebuild the sphere from the live graph — reflects deletions/edits immediately
  // (the periodic poll only *adds* nodes; this also drops archived ones).
  const reloadGraph = async () => {
    const g = await getJson<{ nodes: any[]; edges: any[] }>("/api/graph", { nodes: [], edges: [] });
    e()?.loadData(g);
    e()?.setReadout(`${g.nodes.length} nodes · ${g.edges.length} edges · live`);
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
      ? "↵ ask your real graph  ·  or tap “Enter the graph”"
      : view.queryState === "querying"
        ? "traversing your knowledge graph…"
        : view.queryState === "answered"
          ? "retrieved from your graph"
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
      <div
        id="cm-canvas-mount"
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 1,
          pointerEvents: "none",
          transition: "filter .9s ease",
        }}
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

        {/* Clock */}
        <div
          style={{
            position: "absolute",
            top: 28,
            left: 28,
            width: 268,
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
            position: "absolute",
            top: 192,
            left: 28,
            width: 268,
            maxHeight: 230,
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
            }}
          >
            Operation Log
          </div>
          {oplog.length === 0 && (
            <div style={{ fontFamily: MONO, fontSize: 10, color: ink(0.3) }}>idle</div>
          )}
          {oplog.slice(0, 7).map((o) => (
            <div
              key={o.id}
              style={{
                display: "flex",
                gap: 8,
                padding: "4px 0",
                borderBottom: `1px solid ${ink(0.05)}`,
              }}
            >
              <span style={{ fontFamily: MONO, fontSize: 8.5, color: ink(0.3), flexShrink: 0 }}>
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

        {/* Weather (ambient) */}
        <div
          style={{
            position: "absolute",
            top: 28,
            right: 28,
            width: 204,
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
              style={{ fontFamily: MONO, fontSize: 42, fontWeight: 700, color: INK, lineHeight: 1 }}
            >
              27°
            </div>
            <div style={{ paddingBottom: 3 }}>
              <div style={{ fontSize: 12, color: ink(0.58), marginBottom: 2 }}>Light rain</div>
              <div style={{ fontFamily: MONO, fontSize: 10, color: ink(0.36) }}>≋ ↓ 0.4mm/h</div>
            </div>
          </div>
          <div
            style={{ display: "flex", gap: 14, paddingTop: 9, borderTop: `1px solid ${ink(0.08)}` }}
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
            top: 150,
            bottom: 182,
            left: "50%",
            width: 548,
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
              gap: 10,
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
                        Cleanup needs approval · {ap.action}
                      </span>
                    </div>
                    <div
                      style={{ fontSize: 13, color: ink(0.84), lineHeight: 1.45, fontWeight: 600 }}
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
            left: "50%",
            transform: "translateX(-50%)",
            width: 600,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
          }}
        >
          <button
            type="button"
            onClick={() => {
              const next = !explore;
              setExplore(next);
              if (next) e()?.enterGraph();
              else e()?.exitGraph();
            }}
            className="cm-enter"
            style={{
              fontFamily: MONO,
              fontSize: 8,
              letterSpacing: 3,
              textTransform: "uppercase",
              color: explore ? ACCENT_FG : ink(0.62),
              background: explore ? ACCENT : surface(0.7),
              border: `1px solid ${ink(0.16)}`,
              borderRadius: 20,
              padding: "7px 18px",
              marginBottom: explore ? 7 : 13,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 8,
              backdropFilter: "blur(10px)",
              animation: explore ? "none" : "breathe 3.6s ease-in-out infinite",
            }}
          >
            <span style={{ fontSize: 10, lineHeight: 1 }}>◈</span>{" "}
            {explore ? "Exit the graph" : "Enter the graph"}
          </button>
          {explore && (
            <div
              style={{
                marginBottom: 12,
                fontFamily: MONO,
                fontSize: 7.5,
                letterSpacing: 2.5,
                color: ink(0.4),
                textTransform: "uppercase",
              }}
            >
              drag to orbit · scroll to zoom · click a node
            </div>
          )}
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

      {/* Type list (Concepts / Insights / Syntheses / World Events) — click a row to
          open its card, trash to delete */}
      {listPanel && (
        <div
          style={{
            position: "absolute",
            left: 28,
            bottom: 70,
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
            top: 200,
            right: 28,
            width: 326,
            bottom: 150,
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
  onDelete,
  onSave,
}: {
  detail: NodeDetail;
  onClose: () => void;
  onOpen: (id: string) => void;
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
