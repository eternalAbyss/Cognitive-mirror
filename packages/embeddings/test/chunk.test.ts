import { resetConfigCache } from "@cm/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { chunkText } from "../src/index.js";

describe("chunkText", () => {
  beforeEach(() => {
    resetConfigCache();
    process.env.CHUNK_TOKENS = "10"; // 40 chars
    process.env.CHUNK_OVERLAP = "2"; // 8 chars
  });

  it("returns a single chunk for short text", () => {
    expect(chunkText("hello world")).toEqual(["hello world"]);
  });

  it("returns empty for blank text", () => {
    expect(chunkText("   ")).toEqual([]);
  });

  it("splits long text into overlapping chunks", () => {
    const text = "a".repeat(100);
    const chunks = chunkText(text);
    expect(chunks.length).toBeGreaterThan(1);
    // every chunk is at most the configured size (40 chars)
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(40);
    // chunks advance by (size - overlap) = 32 chars
    expect(chunks[0]?.length).toBe(40);
  });
});
