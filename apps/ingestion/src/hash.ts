import { createHash } from "node:crypto";

/** Stable content hash for idempotent ingestion (design §12). */
export function contentHash(...parts: string[]): string {
  const h = createHash("sha256");
  for (const p of parts) h.update(p).update("\0");
  return h.digest("hex");
}
