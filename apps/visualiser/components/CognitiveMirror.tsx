"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { CognitiveMirrorEngine, type ViewState } from "../lib/engine";

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

interface BriefItem { id: string; title: string; summary: string; asOf: string }
interface LoopItem { id: string; title: string; summary: string }
interface OpEntry { id: string; ts: string; reason: string; ops: number }
interface Vitals { counts: Record<string, number>; budget: { spendUsd: number; dailyCap: number } | null }
interface Status { services: { graphCore?: boolean; mcp?: boolean; daemon?: boolean }; budget: { spendUsd: number; dailyCap: number } | null }
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
  const [clock, setClock] = useState({ time: "--:--:--", date: "", greeting: "evening" });
  const [vitals, setVitals] = useState<Vitals>({ counts: {}, budget: null });
  const [brief, setBrief] = useState<BriefItem[]>([]);
  const [loops, setLoops] = useState<LoopItem[]>([]);
  const [oplog, setOplog] = useState<OpEntry[]>([]);
  const [status, setStatus] = useState<Status>({ services: {}, budget: null });
  const [conceptsOpen, setConceptsOpen] = useState(false);
  const [conceptList, setConceptList] = useState<{ id: string; title: string; summary: string }[]>([]);
  const [detail, setDetail] = useState<NodeDetail | null>(null);

  useEffect(() => {
    const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const MON = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const tick = () => {
      const d = new Date(), p = (n: number) => String(n).padStart(2, "0");
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
    engine.mount();

    // Load the real graph, then keep it growing as the daemon creates nodes.
    void getJson<{ nodes: any[]; edges: any[] }>("/api/graph", { nodes: [], edges: [] }).then((g) => {
      engine.loadData(g);
      engine.setReadout(`${g.nodes.length} nodes · ${g.edges.length} edges · live`);
    });
    // Poll the graph and merge in new nodes — they spawn live on the sphere
    // (research, ingestion, maintenance all surface here within a few seconds).
    const graphPoll = setInterval(async () => {
      const g = await getJson<{ nodes: any[]; edges: any[] }>("/api/graph", { nodes: [], edges: [] });
      const added = engine.mergeData(g);
      if (added > 0) engine.setReadout(`${g.nodes.length} nodes · ${g.edges.length} edges · live`);
    }, 3500);

    const refresh = async () => {
      const [v, b, l, o, s] = await Promise.all([
        getJson<Vitals>("/api/vitals", { counts: {}, budget: null }),
        getJson<{ items: BriefItem[] }>("/api/brief", { items: [] }),
        getJson<{ items: LoopItem[] }>("/api/loops", { items: [] }),
        getJson<{ entries: OpEntry[] }>("/api/oplog", { entries: [] }),
        getJson<Status>("/api/status", { services: {}, budget: null }),
      ]);
      setVitals(v);
      setBrief(b.items);
      setLoops(l.items);
      setOplog(o.entries);
      setStatus(s);
    };
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

  const toggleConcepts = async () => {
    const next = !conceptsOpen;
    setConceptsOpen(next);
    if (next) {
      const { concepts } = await getJson<{ concepts: typeof conceptList }>("/api/concepts", { concepts: [] });
      setConceptList(concepts);
    }
  };

  // Open a node's full detail (and ping it on the sphere).
  const openNode = async (id: string) => {
    if (!id) return;
    e()?.flash(id, 2.4);
    const d = await getJson<NodeDetail | null>(`/api/node/${encodeURIComponent(id)}`, null);
    if (d && d.props?.id) setDetail(d);
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
  const showTrace = view.traceLines.length > 0 || view.queryState === "querying" || view.queryState === "returning" || view.queryState === "answered";

  return (
    <div style={{ width: "100vw", height: "100vh", background: "#ffffff", overflow: "hidden", position: "relative", fontFamily: SANS }}>
      <div id="cm-canvas-mount" style={{ position: "absolute", inset: 0, zIndex: 1, pointerEvents: "none", transition: "filter .9s ease" }} />
      <div id="cm-tint" style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 2, mixBlendMode: "multiply" }} />
      <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse 90% 90% at 50% 46%,transparent 55%,rgba(0,0,0,.018) 100%)", pointerEvents: "none", zIndex: 2 }} />

      <div id="cm-hud" style={{ position: "absolute", inset: 0, zIndex: 10, perspective: "2000px", transition: "opacity .8s ease,filter .8s ease" }}>
        {/* Wordmark */}
        <div style={{ position: "absolute", top: 30, left: "50%", transform: "translateX(-50%)", textAlign: "center", pointerEvents: "none" }}>
          <div style={{ fontFamily: SANS, fontWeight: 500, fontSize: 13, letterSpacing: 7, color: "rgba(0,0,0,.72)", textTransform: "uppercase", textShadow: "0 0 12px #fff,0 0 12px #fff,0 0 6px #fff" }}>The Cognitive Mirror</div>
          <div style={{ fontFamily: MONO, fontSize: 8, letterSpacing: 4, color: "rgba(0,0,0,.34)", textTransform: "uppercase", marginTop: 6, textShadow: "0 0 8px #fff,0 0 8px #fff" }}>Second Brain · {view.nodeReadout}</div>
        </div>

        {/* Clock */}
        <div style={{ position: "absolute", top: 28, left: 28, width: 268, background: "rgba(255,255,255,.66)", backdropFilter: "blur(14px) saturate(1.05)", WebkitBackdropFilter: "blur(14px) saturate(1.05)", border: "1px solid rgba(0,0,0,.07)", borderRadius: 14, padding: "20px 22px", boxShadow: "0 10px 34px rgba(0,0,0,.05),inset 0 1px 0 rgba(255,255,255,.7)" }}>
          <div style={{ fontSize: 9, letterSpacing: 3.5, color: "rgba(0,0,0,.38)", textTransform: "uppercase", marginBottom: 5 }}>Good {clock.greeting}</div>
          <div style={{ fontFamily: MONO, fontSize: 48, fontWeight: 700, color: "#0c0c0c", lineHeight: 1, letterSpacing: -2 }}>{clock.time}</div>
          <div style={{ fontFamily: MONO, fontSize: 10.5, color: "rgba(0,0,0,.42)", marginTop: 9, letterSpacing: 0.3 }}>{clock.date}</div>
          <div style={{ marginTop: 11, paddingTop: 10, borderTop: "1px solid rgba(0,0,0,.08)", fontSize: 8, letterSpacing: 3.5, color: "rgba(0,0,0,.3)", textTransform: "uppercase" }}>LOCAL · BENGALURU</div>
        </div>

        {/* Operation log (live maintenance activity) */}
        <div style={{ position: "absolute", top: 192, left: 28, width: 268, maxHeight: 230, overflow: "hidden", background: "rgba(255,255,255,.6)", backdropFilter: "blur(13px) saturate(1.05)", WebkitBackdropFilter: "blur(13px) saturate(1.05)", border: "1px solid rgba(0,0,0,.07)", borderRadius: 14, padding: "14px 16px", boxShadow: "0 8px 30px rgba(0,0,0,.05)" }}>
          <div style={{ fontSize: 7.5, letterSpacing: 3, color: "rgba(0,0,0,.4)", textTransform: "uppercase", marginBottom: 10 }}>Operation Log</div>
          {oplog.length === 0 && <div style={{ fontFamily: MONO, fontSize: 10, color: "rgba(0,0,0,.3)" }}>idle</div>}
          {oplog.slice(0, 7).map((o) => (
            <div key={o.id} style={{ display: "flex", gap: 8, padding: "4px 0", borderBottom: "1px solid rgba(0,0,0,.05)" }}>
              <span style={{ fontFamily: MONO, fontSize: 8.5, color: "rgba(0,0,0,.3)", flexShrink: 0 }}>{o.ts.slice(11, 16)}</span>
              <span style={{ fontFamily: MONO, fontSize: 9.5, color: "rgba(0,0,0,.66)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.reason.replace(/"/g, "")}</span>
            </div>
          ))}
        </div>

        {/* Weather (ambient) */}
        <div style={{ position: "absolute", top: 28, right: 28, width: 204, background: "rgba(255,255,255,.66)", backdropFilter: "blur(14px) saturate(1.05)", WebkitBackdropFilter: "blur(14px) saturate(1.05)", border: "1px solid rgba(0,0,0,.07)", borderRadius: 14, padding: "18px 20px", boxShadow: "0 10px 34px rgba(0,0,0,.05),inset 0 1px 0 rgba(255,255,255,.7)" }}>
          <div style={{ fontSize: 7.5, letterSpacing: 3, color: "rgba(0,0,0,.34)", textTransform: "uppercase", marginBottom: 11 }}>Bengaluru</div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 10, marginBottom: 11 }}>
            <div style={{ fontFamily: MONO, fontSize: 42, fontWeight: 700, color: "#0c0c0c", lineHeight: 1 }}>27°</div>
            <div style={{ paddingBottom: 3 }}>
              <div style={{ fontSize: 12, color: "rgba(0,0,0,.58)", marginBottom: 2 }}>Light rain</div>
              <div style={{ fontFamily: MONO, fontSize: 10, color: "rgba(0,0,0,.36)" }}>≋ ↓ 0.4mm/h</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 14, paddingTop: 9, borderTop: "1px solid rgba(0,0,0,.08)" }}>
            {[["Humid", "78%"], ["Wind", "12km/h"], ["Feels", "25°"]].map(([k, v]) => (
              <div key={k}>
                <div style={{ fontSize: 6.5, letterSpacing: 2, color: "rgba(0,0,0,.3)", textTransform: "uppercase", marginBottom: 3 }}>{k}</div>
                <div style={{ fontFamily: MONO, fontSize: 13, color: "#1a1a1a" }}>{v}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Center: live Daily Brief + open loop */}
        <div id="cm-center" style={{ position: "absolute", top: 150, bottom: 182, left: "50%", width: 548, overflowY: "auto", overflowX: "hidden", transformStyle: "preserve-3d", transition: "transform .25s ease-out" }}>
          <div style={{ minHeight: "100%", display: "flex", flexDirection: "column", justifyContent: "center", gap: 10, padding: "2px 0" }}>
            <div style={{ fontSize: 7.5, letterSpacing: 5, color: "rgba(0,0,0,.34)", textTransform: "uppercase", textAlign: "center", marginBottom: 2, flexShrink: 0 }}>Daily Brief</div>

            {brief.length === 0 && (
              <div style={card}>
                <div style={{ fontSize: 13, color: "rgba(0,0,0,.55)", lineHeight: 1.62 }}>No brief yet — run <span style={{ fontFamily: MONO, fontSize: 11 }}>pnpm --filter @cm/reasoning-daemon brief</span> to synthesise today's world signal against your concepts.</div>
              </div>
            )}
            {brief.map((b, i) => (
              <div key={b.id} style={card}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: i === 0 ? "#0c0c0c" : "rgba(0,0,0,.4)", flexShrink: 0 }} />
                  <span style={{ fontSize: 7.5, letterSpacing: 2.5, color: "rgba(0,0,0,.46)", textTransform: "uppercase" }}>{b.title}</span>
                </div>
                <div style={{ fontSize: 13, color: "rgba(0,0,0,.8)", lineHeight: 1.62, textWrap: "pretty" as CSSProperties["textWrap"] }}>{b.summary}</div>
              </div>
            ))}

            {loops[0] && (
              <>
                <div style={{ flexShrink: 0, height: 8 }} />
                <div style={{ flexShrink: 0, background: "rgba(252,252,251,.78)", backdropFilter: "blur(13px) saturate(1.05)", WebkitBackdropFilter: "blur(13px) saturate(1.05)", border: "1px solid rgba(0,0,0,.16)", borderRadius: 12, padding: "16px 18px", boxShadow: "0 8px 30px rgba(0,0,0,.07)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <div style={{ width: 7, height: 7, background: "#0c0c0c", transform: "rotate(45deg)", flexShrink: 0, animation: "soft-pulse 2.4s ease-in-out infinite" }} />
                    <span style={{ fontSize: 7.5, letterSpacing: 2.5, color: "rgba(0,0,0,.6)", textTransform: "uppercase" }}>Open Loop · resurfacing</span>
                  </div>
                  <div style={{ fontSize: 13, color: "rgba(0,0,0,.82)", lineHeight: 1.62, marginBottom: 14 }}>{loops[0].summary}</div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => e()?.runDefault()} className="cm-continue" style={loopBtn("#0c0c0c", "#fff", "#0c0c0c")}>Continue</button>
                    <button className="cm-park" style={loopBtn("transparent", "rgba(0,0,0,.5)", "rgba(0,0,0,.18)")}>Park</button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Command line — live search */}
        <div style={{ position: "absolute", bottom: 76, left: "50%", transform: "translateX(-50%)", width: 600, display: "flex", flexDirection: "column", alignItems: "center" }}>
          <button onClick={() => e()?.runDefault()} className="cm-enter" style={{ fontFamily: MONO, fontSize: 8, letterSpacing: 3, textTransform: "uppercase", color: "rgba(0,0,0,.62)", background: "rgba(255,255,255,.7)", border: "1px solid rgba(0,0,0,.16)", borderRadius: 20, padding: "7px 18px", marginBottom: 13, cursor: "pointer", display: "flex", alignItems: "center", gap: 8, backdropFilter: "blur(10px)", animation: "breathe 3.6s ease-in-out infinite" }}>
            <span style={{ fontSize: 10, lineHeight: 1 }}>◈</span> Enter the graph
          </button>
          <form onSubmit={(ev) => { ev.preventDefault(); e()?.submit(); }} style={{ position: "relative", width: "100%" }}>
            <input
              type="text"
              value={view.queryInput}
              onChange={(ev) => e()?.setQuery(ev.target.value)}
              placeholder="Ask your second brain…"
              className="cm-input"
              style={{ width: "100%", background: "rgba(255,255,255,.82)", border: "1px solid rgba(0,0,0,.14)", borderRadius: 28, padding: "15px 54px 15px 24px", fontFamily: SANS, fontSize: 14, color: "#111", boxShadow: "0 10px 30px rgba(0,0,0,.06),inset 0 1px 0 rgba(255,255,255,.8)", backdropFilter: "blur(12px)" }}
            />
            <button type="submit" className="cm-submit" style={{ position: "absolute", right: 13, top: "50%", transform: "translateY(-50%)", background: "#0c0c0c", border: "none", borderRadius: "50%", width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 7h10M8.5 4l3 3-3 3" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          </form>
          <div style={{ textAlign: "center", marginTop: 8, fontFamily: MONO, fontSize: 7.5, letterSpacing: 3, color: "rgba(0,0,0,.26)", textTransform: "uppercase" }}>{queryHint}</div>
        </div>

        {/* Status bar — live vitals */}
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 56, background: "rgba(255,255,255,.78)", borderTop: "1px solid rgba(0,0,0,.08)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", display: "flex", alignItems: "center", padding: "0 28px" }}>
          <Vital value={String(c.Concept ?? 0)} label="Concepts" dot onClick={toggleConcepts} />
          <Divider />
          <Vital value={String(c.Insight ?? 0)} label="Insights" />
          <Divider />
          <Vital value={String(c.Synthesis ?? 0)} label="Syntheses" />
          <Divider />
          <Vital value={String(c.WorldEvent ?? 0)} label="World Events" last />
          <div style={{ flex: 1 }} />
          <div style={{ paddingRight: 20, textAlign: "right" }}>
            <div style={{ fontFamily: MONO, fontSize: 14, color: "rgba(0,0,0,.5)", lineHeight: 1 }}>{spend != null ? `$${spend.toFixed(2)}` : "—"}</div>
            <div style={{ fontSize: 6.5, letterSpacing: 2, color: "rgba(0,0,0,.28)", textTransform: "uppercase" }}>API Today</div>
          </div>
          <Divider />
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: healthy ? "#0c0c0c" : "#C2557A", animation: "soft-pulse 2.4s ease-in-out infinite" }} />
            <span style={{ fontSize: 8, letterSpacing: 2.5, color: "rgba(0,0,0,.55)", textTransform: "uppercase" }}>{healthy ? "Healthy" : "Degraded"}</span>
          </div>
        </div>
      </div>

      {/* Concepts list — click a concept to ping it on the sphere */}
      {conceptsOpen && (
        <div style={{ position: "absolute", left: 28, bottom: 70, zIndex: 21, width: 320, maxHeight: "56vh", display: "flex", flexDirection: "column", background: "rgba(255,255,255,.93)", backdropFilter: "blur(18px) saturate(1.1)", WebkitBackdropFilter: "blur(18px) saturate(1.1)", border: "1px solid rgba(0,0,0,.1)", borderRadius: 14, boxShadow: "0 16px 50px rgba(0,0,0,.12)", overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px 12px", borderBottom: "1px solid rgba(0,0,0,.07)" }}>
            <span style={{ fontFamily: MONO, fontSize: 8, letterSpacing: 3, color: "rgba(0,0,0,.55)", textTransform: "uppercase" }}>Concepts · {conceptList.length}</span>
            <button onClick={() => setConceptsOpen(false)} style={{ fontFamily: MONO, fontSize: 12, lineHeight: 1, padding: "2px 9px", border: "1px solid rgba(0,0,0,.16)", borderRadius: 6, background: "transparent", color: "rgba(0,0,0,.6)", cursor: "pointer" }}>×</button>
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "4px 8px 10px" }}>
            {conceptList.length === 0 && <div style={{ fontFamily: MONO, fontSize: 10, color: "rgba(0,0,0,.3)", padding: "10px 8px" }}>no concepts yet</div>}
            {conceptList.map((cn) => (
              <div key={cn.id} onClick={() => openNode(cn.id)} title={cn.summary} className="cm-chip" style={{ fontSize: 12, color: "rgba(0,0,0,.78)", padding: "7px 10px", borderRadius: 8, cursor: "pointer", lineHeight: 1.3 }}>{cn.title}</div>
            ))}
          </div>
        </div>
      )}

      {/* Node detail card — everything about a concept/source you clicked */}
      {detail && <NodeDetailCard detail={detail} onClose={() => setDetail(null)} onOpen={openNode} />}

      {/* Answer overlay — wider, with a scrollable body (research briefings are long) */}
      {view.showAnswer && (
        <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", zIndex: 20, width: 760, maxWidth: "92vw", maxHeight: "78vh", display: "flex", flexDirection: "column", background: "rgba(255,255,255,.92)", backdropFilter: "blur(28px) saturate(1.1)", WebkitBackdropFilter: "blur(28px) saturate(1.1)", border: "1px solid rgba(0,0,0,.1)", borderRadius: 16, padding: "26px 30px", boxShadow: "0 30px 80px rgba(0,0,0,.14)", animation: "float-in .55s ease-out" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexShrink: 0 }}>
            <div style={{ width: 18, height: 2, background: "#0c0c0c" }} />
            <div style={{ fontSize: 7, letterSpacing: 5, color: "rgba(0,0,0,.5)", textTransform: "uppercase" }}>{view.noMatch ? "Not in your graph" : "Retrieved"}</div>
            <div style={{ flex: 1, height: 1, background: "rgba(0,0,0,.1)" }} />
          </div>
          <div style={{ flex: 1, overflowY: "auto", minHeight: 60, paddingRight: 6 }}>
            <div style={{ fontSize: 14, color: "rgba(0,0,0,.86)", lineHeight: 1.72, textWrap: "pretty" as CSSProperties["textWrap"], whiteSpace: "pre-wrap" }}>{view.answerText}</div>
            {view.sources.length > 0 && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 20 }}>
                {view.sources.map((src, i) => (
                  <div key={`${src.id}-${i}`} onClick={() => src.id && openNode(src.id)} className="cm-chip" style={{ fontFamily: MONO, fontSize: 9, padding: "5px 13px", background: "rgba(0,0,0,.03)", border: "1px solid rgba(0,0,0,.16)", borderRadius: 20, color: "rgba(0,0,0,.62)", cursor: src.id ? "pointer" : "default", userSelect: "none" }}>{src.label}</div>
                ))}
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 20, flexShrink: 0 }}>
            {view.noMatch && (
              <button onClick={() => e()?.researchCurrent()} className="cm-continue" style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: 2.5, padding: "9px 22px", background: "#0c0c0c", border: "1px solid #0c0c0c", borderRadius: 7, color: "#fff", cursor: "pointer", textTransform: "uppercase" }}>◈ Research the web</button>
            )}
            <button onClick={() => e()?.closeAnswer()} className="cm-dismiss" style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: 2.5, padding: "9px 22px", background: "transparent", border: "1px solid rgba(0,0,0,.16)", borderRadius: 7, color: "rgba(0,0,0,.5)", cursor: "pointer", textTransform: "uppercase" }}>Dismiss</button>
          </div>
        </div>
      )}

      {/* Reasoning trace console */}
      {showTrace && (
        <div style={{ position: "absolute", top: 200, right: 28, width: 326, bottom: 150, zIndex: 12, display: "flex", flexDirection: "column", background: "rgba(255,255,255,.82)", backdropFilter: "blur(18px) saturate(1.1)", WebkitBackdropFilter: "blur(18px) saturate(1.1)", border: "1px solid rgba(0,0,0,.1)", borderRadius: 14, boxShadow: "0 16px 50px rgba(0,0,0,.1)", overflow: "hidden" }}>
          <div style={{ padding: "14px 16px 12px", borderBottom: "1px solid rgba(0,0,0,.07)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <span style={{ fontFamily: MONO, fontSize: 8, letterSpacing: 3, color: "rgba(0,0,0,.55)", textTransform: "uppercase" }}>Reasoning Trace</span>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => e()?.cycleSpeed()} style={{ fontFamily: MONO, fontSize: 8, letterSpacing: 1, padding: "3px 8px", border: "1px solid rgba(0,0,0,.16)", borderRadius: 6, background: "transparent", color: "rgba(0,0,0,.6)", cursor: "pointer" }}>{view.speedLabel}</button>
                <button onClick={() => e()?.replay()} style={{ fontFamily: MONO, fontSize: 10, lineHeight: 1, padding: "3px 9px", border: "1px solid rgba(0,0,0,.16)", borderRadius: 6, background: "transparent", color: "rgba(0,0,0,.6)", cursor: "pointer" }}>↻</button>
              </div>
            </div>
            <div style={{ fontFamily: MONO, fontSize: 8, letterSpacing: 1.5, color: "rgba(0,0,0,.36)", textTransform: "uppercase", marginTop: 8, minHeight: 10 }}>{view.traverseStage}</div>
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "4px 16px 14px" }}>
            {view.traceLines.map((line, i) => (
              <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "8px 0", borderBottom: "1px solid rgba(0,0,0,.05)", animation: "float-in .34s ease-out" }}>
                <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 700, color: line.accent, flexShrink: 0, lineHeight: 1.5 }}>{line.n}</span>
                <div>
                  <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 0.4, color: "rgba(0,0,0,.82)", lineHeight: 1.5 }}>{line.label}</div>
                  {line.detail && <div style={{ fontFamily: SANS, fontSize: 11, color: "rgba(0,0,0,.5)", lineHeight: 1.5, marginTop: 3, textWrap: "pretty" as CSSProperties["textWrap"] }}>{line.detail}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Active node callout */}
      {view.callout && (
        <div id="cm-callout" style={{ position: "absolute", zIndex: 13, transform: "translate(-50%,-138%)", pointerEvents: "none", background: "rgba(12,12,12,.9)", border: "1px solid rgba(255,255,255,.14)", borderRadius: 9, padding: "9px 12px", minWidth: 150, maxWidth: 236, boxShadow: "0 12px 30px rgba(0,0,0,.3)", transition: "opacity .25s ease" }}>
          <div style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: 1.5, color: "#fff", textTransform: "uppercase", lineHeight: 1.4 }}>{view.callout.tag} · <span style={{ color: "rgba(255,255,255,.5)" }}>{view.callout.type}</span></div>
          <div style={{ fontFamily: SANS, fontSize: 11, color: "rgba(255,255,255,.74)", lineHeight: 1.45, marginTop: 5, textWrap: "pretty" as CSSProperties["textWrap"] }}>{view.callout.line}</div>
        </div>
      )}
    </div>
  );
}

const card: CSSProperties = {
  background: "rgba(255,255,255,.62)",
  backdropFilter: "blur(13px) saturate(1.05)",
  WebkitBackdropFilter: "blur(13px) saturate(1.05)",
  border: "1px solid rgba(0,0,0,.08)",
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

function Divider() {
  return <div style={{ width: 1, height: 24, background: "rgba(0,0,0,.1)", margin: "0 16px" }} />;
}

function NodeDetailCard({ detail, onClose, onOpen }: { detail: NodeDetail; onClose: () => void; onOpen: (id: string) => void }) {
  const p = detail.props;
  const type = detail.labels.filter((l) => l !== "Node").join(" · ") || String(p.type ?? "Node");
  const meta = ((): Record<string, unknown> => {
    try {
      return typeof p.metadata === "string" ? JSON.parse(p.metadata) : ((p.metadata as Record<string, unknown>) ?? {});
    } catch {
      return {};
    }
  })();
  const conf = typeof p.confidence === "number" ? p.confidence : undefined;
  const touched = String(p.lastReadAt ?? p.updatedAt ?? p.createdAt ?? "");
  const url = typeof meta.url === "string" ? meta.url : typeof p.url === "string" ? p.url : "";
  const citations = (Array.isArray(meta.citations) ? meta.citations : []) as Array<{ title?: string; url?: string }>;
  const seen = new Set<string>();
  const edges = detail.edges.filter((ed) => {
    const k = `${ed.type}:${ed.to}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return (
    <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", zIndex: 22, width: 640, maxWidth: "92vw", maxHeight: "80vh", display: "flex", flexDirection: "column", background: "rgba(255,255,255,.95)", backdropFilter: "blur(28px) saturate(1.1)", WebkitBackdropFilter: "blur(28px) saturate(1.1)", border: "1px solid rgba(0,0,0,.1)", borderRadius: 16, padding: "26px 30px", boxShadow: "0 30px 80px rgba(0,0,0,.16)", animation: "float-in .4s ease-out" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexShrink: 0 }}>
        <div style={{ fontFamily: MONO, fontSize: 7, letterSpacing: 4, color: "rgba(0,0,0,.5)", textTransform: "uppercase" }}>{type}</div>
        <div style={{ flex: 1, height: 1, background: "rgba(0,0,0,.1)" }} />
        <button onClick={onClose} style={{ fontFamily: MONO, fontSize: 12, lineHeight: 1, padding: "2px 9px", border: "1px solid rgba(0,0,0,.16)", borderRadius: 6, background: "transparent", color: "rgba(0,0,0,.6)", cursor: "pointer" }}>×</button>
      </div>
      <div style={{ fontFamily: SANS, fontSize: 20, fontWeight: 600, color: "#0c0c0c", marginBottom: 12, flexShrink: 0, lineHeight: 1.25 }}>{String(p.title ?? "")}</div>
      <div style={{ flex: 1, overflowY: "auto", paddingRight: 6 }}>
        {p.summary ? <div style={{ fontSize: 14, color: "rgba(0,0,0,.82)", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>{String(p.summary)}</div> : null}

        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 18px", marginTop: 16, fontFamily: MONO, fontSize: 9.5, color: "rgba(0,0,0,.5)" }}>
          {p.domain ? <span>domain: {String(p.domain)}</span> : null}
          {conf !== undefined ? <span>confidence: {conf.toFixed(2)}</span> : null}
          {p.touchCount !== undefined ? <span>reads: {String(p.touchCount)}</span> : null}
          {touched ? <span>last touched: {touched.slice(0, 10)}</span> : null}
          {meta.source ? <span>source: {String(meta.source)}</span> : null}
        </div>
        {url ? <div style={{ marginTop: 10 }}><a href={url} target="_blank" rel="noreferrer" style={{ fontFamily: MONO, fontSize: 10, color: "#0a66c2", wordBreak: "break-all" }}>{url}</a></div> : null}

        {edges.length > 0 && (
          <div style={{ marginTop: 22 }}>
            <div style={{ fontFamily: MONO, fontSize: 7.5, letterSpacing: 3, color: "rgba(0,0,0,.4)", textTransform: "uppercase", marginBottom: 8 }}>Connections · {edges.length}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {edges.map((ed, i) => (
                <div key={i} onClick={() => onOpen(ed.to)} className="cm-chip" style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "6px 10px", borderRadius: 8, cursor: "pointer" }}>
                  <span style={{ fontFamily: MONO, fontSize: 8, letterSpacing: 1, color: "rgba(0,0,0,.4)", minWidth: 92, flexShrink: 0 }}>{ed.type}</span>
                  <span style={{ fontSize: 13, color: "rgba(0,0,0,.8)" }}>{ed.toTitle ?? ed.to.slice(0, 8)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {citations.length > 0 && (
          <div style={{ marginTop: 22 }}>
            <div style={{ fontFamily: MONO, fontSize: 7.5, letterSpacing: 3, color: "rgba(0,0,0,.4)", textTransform: "uppercase", marginBottom: 8 }}>Web sources · {citations.length}</div>
            {citations.slice(0, 15).map((cit, i) => (
              <div key={i} style={{ marginBottom: 5 }}><a href={String(cit.url ?? "")} target="_blank" rel="noreferrer" style={{ fontSize: 11.5, color: "#0a66c2" }}>{String(cit.title ?? cit.url ?? "")}</a></div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Vital({ value, label, last, dot, onClick }: { value: string; label: string; last?: boolean; dot?: boolean; onClick?: () => void }) {
  return (
    <div onClick={onClick} title={onClick ? "view all" : undefined} style={{ display: "flex", alignItems: "center", gap: 8, paddingRight: last ? 0 : 20, cursor: onClick ? "pointer" : "default" }}>
      {dot && <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#0c0c0c" }} />}
      <div>
        <div style={{ fontFamily: MONO, fontSize: 15, fontWeight: 700, color: "#0c0c0c", lineHeight: 1, textDecoration: onClick ? "underline dotted rgba(0,0,0,.25)" : "none", textUnderlineOffset: 3 }}>{value}</div>
        <div style={{ fontSize: 6.5, letterSpacing: 2, color: "rgba(0,0,0,.36)", textTransform: "uppercase" }}>{label}</div>
      </div>
    </div>
  );
}
