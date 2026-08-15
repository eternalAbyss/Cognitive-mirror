import { describe, expect, it } from "vitest";
import { parseClippings } from "../src/kindle-parse.js";

const SAMPLE = `Meditations (Marcus Aurelius)
- Your Highlight on page 12 | Location 100-102 | Added on Monday

You have power over your mind - not outside events.
==========
Thinking in Systems (Donella Meadows)
- Your Highlight on page 4 | Location 50-52 | Added on Tuesday

A system is an interconnected set of elements.
==========
Some Book (Author)
- Your Bookmark on page 9 | Location 80

==========
`;

describe("parseClippings", () => {
  it("extracts book + highlight text and skips bodyless bookmarks", () => {
    const clips = parseClippings(SAMPLE);
    expect(clips).toHaveLength(2);
    expect(clips[0]).toEqual({
      book: "Meditations (Marcus Aurelius)",
      text: "You have power over your mind - not outside events.",
    });
    expect(clips[1]?.book).toBe("Thinking in Systems (Donella Meadows)");
  });

  it("handles CRLF line endings", () => {
    const crlf = SAMPLE.replace(/\n/g, "\r\n");
    expect(parseClippings(crlf)).toHaveLength(2);
  });

  it("returns empty for blank input", () => {
    expect(parseClippings("")).toEqual([]);
  });
});
