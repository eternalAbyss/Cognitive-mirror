import { describe, expect, it } from "vitest";
import { ExecuteRequestSchema, GraphOpSchema, PROTECTED_NODE_PROPS } from "../src/ops.js";

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
        {
          kind: "createNode",
          node: { type: "Source", title: "s" },
          id: "11111111-1111-1111-1111-111111111111",
        },
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

describe("updateNode patch key validation", () => {
  const ID = "11111111-1111-1111-1111-111111111111";
  const patch = (p: Record<string, unknown>) =>
    GraphOpSchema.parse({ kind: "updateNode", id: ID, patch: p });

  it("accepts ordinary content keys", () => {
    expect(patch({ title: "t", summary: "s", edited: true }).kind).toBe("updateNode");
  });

  it("rejects a key that would break out of the Cypher REMOVE clause", () => {
    // graph-core's rollback path interpolates patch keys into
    // `REMOVE n.\`key\``. Without this check, a backtick in the key escapes the
    // identifier and the rest of the string is executed as Cypher.
    expect(() => patch({ "x` = 1 WITH n MATCH (m) DETACH DELETE m //": 1 })).toThrow();
  });

  it("rejects keys with spaces, dots, or dollar signs", () => {
    expect(() => patch({ "has space": 1 })).toThrow();
    expect(() => patch({ "a.b": 1 })).toThrow();
    expect(() => patch({ $param: 1 })).toThrow();
  });

  it.each(PROTECTED_NODE_PROPS)("rejects the protected property %s", (key) => {
    expect(() => patch({ [key]: "anything" })).toThrow();
  });

  it("rejects protected keys on createEdge props too", () => {
    expect(() =>
      GraphOpSchema.parse({
        kind: "createEdge",
        from: ID,
        to: "22222222-2222-2222-2222-222222222222",
        type: "MENTIONS",
        props: { "bad`key": 1 },
      }),
    ).toThrow();
  });
});
