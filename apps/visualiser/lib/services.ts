// Server-side service URLs (the visualiser's Next API routes run on the same
// machine and proxy these localhost-only services so the browser stays
// same-origin and graph-core/daemon/mcp never need to be exposed).
export const GRAPH_CORE = process.env.GRAPH_CORE_URL ?? "http://127.0.0.1:4001";
export const MCP = process.env.MCP_URL ?? "http://127.0.0.1:4003";
export const DAEMON = process.env.DAEMON_URL ?? "http://127.0.0.1:4005";
export const OLLAMA = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434";
export const EMBED_MODEL = process.env.EMBED_MODEL ?? "nomic-embed-text";

/** GET a JSON endpoint, returning a fallback (and never throwing) so panels degrade gracefully. */
export async function getJson<T>(url: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return fallback;
    return (await res.json()) as T;
  } catch {
    return fallback;
  }
}

/** Embed a query string via Ollama (server-side) for live semantic search. */
export async function embed(text: string): Promise<number[]> {
  const res = await fetch(`${OLLAMA}/api/embeddings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, prompt: text }),
  });
  const json = (await res.json()) as { embedding?: number[] };
  return json.embedding ?? [];
}
