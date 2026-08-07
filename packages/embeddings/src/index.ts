import { loadConfig, childLogger } from "@cm/shared";

const log = childLogger("embeddings");

/**
 * Shared embedding pipeline (design §11), used by the daemon (write side) and the
 * MCP server (query side). Two roles — content-chunk and summary embeddings —
 * both from the same Ollama model so the FalkorDB vector index dimension is
 * consistent.
 */
export async function embed(text: string): Promise<number[]> {
  const cfg = loadConfig();
  const res = await fetch(`${cfg.OLLAMA_URL}/api/embeddings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: cfg.EMBED_MODEL, prompt: text }),
  });
  if (!res.ok) {
    throw new Error(`ollama embeddings -> ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as { embedding?: number[] };
  if (!json.embedding || json.embedding.length === 0) {
    throw new Error("ollama returned empty embedding");
  }
  return json.embedding;
}

/** Approximate token-based chunking via characters (~4 chars/token). */
export function chunkText(text: string): string[] {
  const cfg = loadConfig();
  const size = Math.max(1, cfg.CHUNK_TOKENS) * 4;
  // Clamped to size - 1: both values are unvalidated env numbers, and an
  // overlap >= size makes the loop step below zero and never terminate,
  // appending chunks until the process runs out of memory.
  const overlap = Math.min(Math.max(0, cfg.CHUNK_OVERLAP) * 4, size - 1);
  const clean = text.trim();
  if (clean.length <= size) return clean.length ? [clean] : [];

  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
    chunks.push(clean.slice(start, start + size));
    start += size - overlap;
  }
  return chunks;
}

/** Best-effort check that the embedding model is available in Ollama. */
export async function ensureEmbedModel(): Promise<void> {
  const cfg = loadConfig();
  try {
    const res = await fetch(`${cfg.OLLAMA_URL}/api/tags`);
    if (!res.ok) return;
    const json = (await res.json()) as { models?: Array<{ name: string }> };
    const have = (json.models ?? []).some((m) => m.name.startsWith(cfg.EMBED_MODEL));
    if (!have) {
      log.warn(
        { model: cfg.EMBED_MODEL },
        `embedding model not found in Ollama — run: docker exec cm-ollama ollama pull ${cfg.EMBED_MODEL}`,
      );
    }
  } catch {
    log.warn("could not reach Ollama to verify embedding model");
  }
}
