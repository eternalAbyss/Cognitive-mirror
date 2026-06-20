import { describe, it, expect } from "vitest";
import { ExecuteRequestSchema, GraphOpSchema } from "../src/ops.js";

describe("GraphOp schema", () => {
  it("accepts a createNode op", () => {
    const op = GraphOpSchema.parse({
      kind: "createNode",
      node: { type: "Concept", title: "Vector indexes" },
    });
    expect(op.kind).toBe("createNode");
  });

  it("rejects an unknown op kind", () => {
    expect(() => GraphOpSchema.parse({ kind: "nope" })).toThrow();
  });

  it("rejects an invalid node type", () => {
    expect(() =>
      GraphOpSchema.parse({
        kind: "createNode",
        node: { type: "NotAType", title: "x" },
      }),
    ).toThrow();
  });

  it("validates an execute request with mixed ops", () => {
    const req = ExecuteRequestSchema.parse({
      ops: [
        { kind: "createNode", node: { type: "Source", title: "s" }, id: "11111111-1111-1111-1111-111111111111" },
        {
          kind: "createEdge",
          from: "11111111-1111-1111-1111-111111111111",
          to: "22222222-2222-2222-2222-222222222222",
          type: "MENTIONS",
        },
      ],
      reason: "test",
    });
    expect(req.ops).toHaveLength(2);
  });
});
