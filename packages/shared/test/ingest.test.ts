import { describe, it, expect } from "vitest";
import { EnrichPayloadSchema, ENRICH_KINDS, JOB_TYPE_ENRICH, JOB_TYPE_WORLD_BRIEF } from "../src/ingest.js";

describe("EnrichPayload", () => {
  it("accepts all Phase-2 source kinds", () => {
    for (const kind of ["note", "journal", "youtube", "kindle_highlight", "arxiv", "rss", "github_trending"]) {
      const p = EnrichPayloadSchema.parse({ kind, title: "t", text: "x", source: "s" });
      expect(p.kind).toBe(kind);
    }
  });

  it("defaults kind to generic", () => {
    expect(EnrichPayloadSchema.parse({ title: "t", text: "x", source: "s" }).kind).toBe("generic");
  });

  it("rejects an unknown kind", () => {
    expect(() => EnrichPayloadSchema.parse({ kind: "tiktok", title: "t", text: "x", source: "s" })).toThrow();
  });

  it("exposes stable job-type + kind constants", () => {
    expect(JOB_TYPE_ENRICH).toBe("enrich");
    expect(JOB_TYPE_WORLD_BRIEF).toBe("world_brief");
    expect(ENRICH_KINDS).toContain("kindle_highlight");
  });
});
