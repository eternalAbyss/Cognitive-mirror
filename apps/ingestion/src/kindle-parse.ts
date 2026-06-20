export interface Clip {
  book: string;
  text: string;
}

/**
 * Parse a Kindle "My Clippings.txt" into highlights. Entries are separated by a
 * line of '=' characters; within an entry, line 0 is the book, the "- Your
 * Highlight …" line is metadata, and the body follows it. Bookmarks (no body)
 * are skipped.
 */
export function parseClippings(raw: string): Clip[] {
  const out: Clip[] = [];
  for (const block of raw.split(/^={5,}\s*$/m)) {
    const lines = block.split(/\r?\n/).map((l) => l.trim());
    const nonEmpty = lines.filter(Boolean);
    if (nonEmpty.length < 2) continue;
    const book = nonEmpty[0]!.replace(/﻿/g, "");
    const metaIdx = lines.findIndex((l) => /^- /.test(l));
    const text = lines.slice(metaIdx + 1).join(" ").trim();
    if (text) out.push({ book, text });
  }
  return out;
}
