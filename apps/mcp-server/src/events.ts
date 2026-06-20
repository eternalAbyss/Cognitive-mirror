import { EventEmitter } from "node:events";
import type { Response } from "express";

/**
 * Live event bus (design §3: "emits a live event when a tool reads/traverses a
 * node"). The future visualiser subscribes over SSE at GET /events to animate
 * traversals in real time. In-memory and best-effort for Phase 1.
 */
export interface GraphEvent {
  type: "node_read" | "search" | "traverse" | "write";
  at: string;
  detail: Record<string, unknown>;
}

const bus = new EventEmitter();
bus.setMaxListeners(100);

export function emit(type: GraphEvent["type"], detail: Record<string, unknown>): void {
  const event: GraphEvent = { type, at: new Date().toISOString(), detail };
  bus.emit("event", event);
}

/** Attach an SSE response to the bus; returns an unsubscribe function. */
export function subscribe(res: Response): () => void {
  const onEvent = (e: GraphEvent) => {
    res.write(`data: ${JSON.stringify(e)}\n\n`);
  };
  bus.on("event", onEvent);
  return () => bus.off("event", onEvent);
}
