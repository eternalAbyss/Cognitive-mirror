import {
  loadConfig,
  type ExecuteRequest,
  type ExecuteResult,
  type GraphOp,
  type NodeType,
} from "@cm/shared";

/**
 * Typed client to the Core Graph Service localhost API. This is the "internal
 * graph library" of design §13 Q1: the reasoning daemon writes through this
 * directly, bypassing MCP. The MCP server and ingestion also use it for reads.
 */
export interface NodeView {
  props: Record<string, unknown>;
  labels: string[];
  edges?: Array<{ type: string; to: string; toTitle: string | null }>;
}

export interface SemanticHit extends NodeView {
  score: number;
}

export interface ChunkHit {
  id: string;
  text: string;
  sourceNodeId: string;
  score: number;
}

export class GraphClient {
  constructor(private readonly baseUrl = loadConfig().graphCoreUrl) {}

  private async req<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`graph-core ${path} -> ${res.status}: ${text}`);
    }
    return (await res.json()) as T;
  }

  health(): Promise<{ ok: boolean }> {
    return this.req("/health");
  }

  getNode(id: string): Promise<NodeView> {
    return this.req(`/node/${encodeURIComponent(id)}`);
  }

  searchSemantic(args: {
    embedding: number[];
    k?: number;
    type?: NodeType;
  }): Promise<{ results: SemanticHit[] }> {
    return this.req("/search/semantic", {
      method: "POST",
      body: JSON.stringify(args),
    });
  }

  searchChunks(embedding: number[], k?: number): Promise<{ results: ChunkHit[] }> {
    return this.req("/search/chunks", {
      method: "POST",
      body: JSON.stringify({ embedding, k }),
    });
  }

  traverse(args: {
    id: string;
    depth?: number;
    limit?: number;
  }): Promise<{ results: Array<NodeView & { distance: number }> }> {
    return this.req("/traverse", {
      method: "POST",
      body: JSON.stringify(args),
    });
  }

  /** The transactional mutation primitive — the sole write path. */
  execute(ops: GraphOp[], reason?: string): Promise<ExecuteResult> {
    const body: ExecuteRequest = { ops, reason };
    return this.req("/execute", { method: "POST", body: JSON.stringify(body) });
  }

  oplog(limit?: number): Promise<{ entries: unknown[] }> {
    return this.req(`/oplog${limit ? `?limit=${limit}` : ""}`);
  }

  // ── Maintenance engine (design §9) ──────────────────────────────────────────
  mergeCandidates(maxDistance: number): Promise<{ candidates: MergeCandidate[] }> {
    return this.req(`/maintenance/merge-candidates?max=${maxDistance}`);
  }

  crossDomainEdges(): Promise<{ pairs: CrossDomainPair[] }> {
    return this.req("/maintenance/cross-domain");
  }

  resurface(limit?: number): Promise<{ items: ResurfaceItem[] }> {
    return this.req(`/maintenance/resurface${limit ? `?limit=${limit}` : ""}`);
  }

  counts(): Promise<{ counts: Record<string, number> }> {
    return this.req("/stats/counts");
  }

  listNodes(type: string, limit?: number): Promise<{ nodes: ListedNode[] }> {
    return this.req(`/nodes?type=${encodeURIComponent(type)}${limit ? `&limit=${limit}` : ""}`);
  }

  undo(opLogId: string): Promise<{ ok: boolean; reason?: string; reversed?: number }> {
    return this.req("/maintenance/undo", { method: "POST", body: JSON.stringify({ opLogId }) });
  }
}

export interface MergeCandidate {
  aId: string;
  aTitle: string;
  aSummary: string;
  bId: string;
  bTitle: string;
  bSummary: string;
  distance: number;
}
export interface CrossDomainPair {
  aId: string;
  aTitle: string;
  aDomain: string;
  bId: string;
  bTitle: string;
  bDomain: string;
}
export interface ResurfaceItem {
  id: string;
  title: string;
  summary: string;
  updatedAt: string;
  degree: number;
}
export interface ListedNode {
  props: Record<string, unknown>;
  degree: number;
}

export function createGraphClient(baseUrl?: string): GraphClient {
  return new GraphClient(baseUrl);
}
