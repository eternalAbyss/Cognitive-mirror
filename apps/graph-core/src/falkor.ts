import { FalkorDB, type Graph } from "falkordb";
import { loadConfig } from "@cm/shared";

/**
 * Sole point of FalkorDB access (design §3: one Core Graph Service process owns
 * the data store). Every other service is a localhost client of graph-core, and
 * within graph-core every query goes through this module. Keeping all DB access
 * here is what makes a future backend swap (e.g. away from FalkorDB) contained.
 */
let db: FalkorDB | undefined;
let graph: Graph | undefined;

export async function getGraph(): Promise<Graph> {
  if (graph) return graph;
  const cfg = loadConfig();
  db = await FalkorDB.connect({
    socket: { host: cfg.FALKORDB_HOST, port: cfg.FALKORDB_PORT },
  });
  graph = db.selectGraph(cfg.FALKORDB_GRAPH);
  return graph;
}

export async function closeGraph(): Promise<void> {
  await db?.close();
  db = undefined;
  graph = undefined;
}

/** Run a Cypher query and return the row array (each row keyed by RETURN alias). */
export async function query<T = Record<string, unknown>>(
  cypher: string,
  params?: Record<string, unknown>,
): Promise<T[]> {
  const g = await getGraph();
  // The driver's QueryParams type is narrow; our values are plain JSON scalars/arrays.
  const opts = params ? ({ params } as Parameters<Graph["query"]>[1]) : undefined;
  const res = await g.query(cypher, opts);
  return (res?.data ?? []) as T[];
}

/**
 * Build a `vecf32([...])` literal. We inline the vector rather than passing it as
 * a parameter into `vecf32()` to avoid ambiguity in how the driver marshals a
 * list param into the function. Values are plain finite numbers, so this is safe.
 */
export function vecLiteral(vec: number[]): string {
  const body = vec
    .map((n) => (Number.isFinite(n) ? n : 0))
    .join(",");
  return `vecf32([${body}])`;
}
