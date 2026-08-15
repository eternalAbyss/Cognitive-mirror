import { randomUUID } from "node:crypto";
import type { GraphClient } from "@cm/graph-client";
import {
  type EnrichPayload,
  EnrichPayloadSchema,
  type GraphOp,
  type NewNode,
  childLogger,
} from "@cm/shared";
import { enrichArtifact } from "./anthropic.js";
import { chunkText, embed } from "./embeddings.js";

const log = childLogger("daemon:enrich");

/**
 * Stable external identity for a re-ingestible artifact, or null for one-off
 * captures. When set, the Source node is upserted on it so re-pulling the same
 * artifact (e.g. a GitHub repo whose README changed) updates the existing node
 * instead of spawning a duplicate.
 */
function externalIdFor(p: EnrichPayload): string | null {
  // One Source per repo — `source` is already "github:owner/repo".
  if (p.kind === "github_repo") return p.source;
  // One Source per commit, keyed by immutable sha (source is the shared repo).
  if (p.kind === "github_commit") {
    const sha = typeof p.meta?.sha === "string" ? p.meta.sha : null;
    return sha ? `github:commit:${sha}` : null;
  }
  return null;
}

export interface EnrichOutcome {
  sourceId: string;
  conceptIds: string[];
  conceptTitles: string[];
  opLogId: string;
  opCount: number;
}

/**
 * The first autonomous job (design §15 Phase 1): an ingested artifact →
 * Anthropic enrichment → Source + Concept nodes + edges + embeddings, all
 * written through the single-writer Core Graph Service in one batch.
 */
export async function enrichJob(graph: GraphClient, rawPayload: unknown): Promise<EnrichOutcome> {
  const payload = EnrichPayloadSchema.parse(rawPayload);
  const result = await enrichArtifact(payload);

  const ops: GraphOp[] = [];

  // Upsert the Source node on its stable external identity so re-ingesting the
  // same artifact updates the existing node rather than creating a duplicate.
  const externalId = externalIdFor(payload);
  const existing = externalId ? (await graph.findByExternalId(externalId)).node : null;
  const existingId = existing?.props?.id;
  const sourceId = typeof existingId === "string" ? existingId : randomUUID();

  const sourceFields = {
    title: result.source.title,
    summary: result.source.summary,
    content: payload.text,
    confidence: result.source.confidence ?? payload.confidence,
    asOf: payload.occurredAt?.slice(0, 10),
    metadata: { source: payload.source, url: payload.url, kind: payload.kind },
  };

  if (existing) {
    // `externalId` is deliberately not in the patch: it's the key we just looked
    // the node up by, so re-writing it is a no-op — and it's a protected property
    // precisely because a patch that *changed* it would silently re-point every
    // future upsert of this artifact at the wrong node.
    ops.push({ kind: "updateNode", id: sourceId, patch: sourceFields });
  } else {
    const sourceNode: NewNode = {
      type: "Source",
      ...sourceFields,
      ...(externalId ? { externalId } : {}),
    };
    ops.push({ kind: "createNode", id: sourceId, node: sourceNode });
  }

  const conceptIds = result.concepts.map(() => randomUUID());
  result.concepts.forEach((c, i) => {
    const id = conceptIds[i];
    if (!id) return;
    ops.push({
      kind: "createNode",
      id,
      node: { type: "Concept", title: c.title, summary: c.summary, domain: c.domain },
    });
    ops.push({ kind: "createEdge", from: sourceId, to: id, type: "MENTIONS" });
  });

  for (const rel of result.relations) {
    const a = conceptIds[rel.from];
    const b = conceptIds[rel.to];
    if (a && b && a !== b) {
      ops.push({ kind: "createEdge", from: a, to: b, type: "RELATES_TO" });
    }
  }

  // Summary embedding for the Source node (design §11, summary role).
  ops.push({
    kind: "setSummaryEmbedding",
    id: sourceId,
    embedding: await embed(result.source.summary || result.source.title),
  });

  // Content-chunk embeddings for retrieval (design §11, content-chunk role).
  const chunks = chunkText(payload.text);
  for (let i = 0; i < chunks.length; i++) {
    const text = chunks[i];
    if (!text) continue;
    ops.push({
      kind: "upsertChunk",
      chunk: {
        id: `${sourceId}:${i}`,
        sourceNodeId: sourceId,
        text,
        ordinal: i,
        embedding: await embed(text),
      },
    });
  }

  // Summary embeddings for each Concept.
  for (let i = 0; i < conceptIds.length; i++) {
    const id = conceptIds[i];
    const c = result.concepts[i];
    if (!id || !c) continue;
    ops.push({
      kind: "setSummaryEmbedding",
      id,
      embedding: await embed(c.summary || c.title),
    });
  }

  const res = await graph.execute(ops, `enrich ${payload.source}: ${payload.title}`);
  log.info(
    { sourceId, concepts: conceptIds.length, chunks: chunks.length, opLogId: res.opLogId },
    "enriched artifact",
  );
  return {
    sourceId,
    conceptIds,
    conceptTitles: result.concepts.map((c) => c.title),
    opLogId: res.opLogId,
    opCount: ops.length,
  };
}
