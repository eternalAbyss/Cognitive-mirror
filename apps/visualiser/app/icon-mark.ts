/**
 * The Cognitive Mirror mark, as an inline SVG string.
 *
 * `app/icon.svg` is the real favicon and is served verbatim; this module exists
 * because `apple-icon` and `opengraph-image` are generated as PNGs through
 * `next/og`, whose renderer (Satori) only accepts SVG via a data URI on an
 * `<img>`. Keeping one source here stops the three assets from drifting apart.
 */

export interface MarkOptions {
  /** Sphere wireframe + node dots. */
  ring: string;
  /** The cross-domain connection arc. */
  gold: string;
}

/** Matches the dark canvas the WebGL scene clears to (`engine.ts` setTheme). */
export const CANVAS_DARK = "#0B0D12";
export const GOLD_DARK = "#D8A63E";

export function markSvg({ ring, gold }: MarkOptions): string {
  return `<svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
  <circle cx="32" cy="32" r="22" stroke="${ring}" stroke-width="3.25"/>
  <circle cx="32" cy="10" r="2.75" fill="${ring}"/>
  <circle cx="13.3" cy="43.6" r="2.75" fill="${ring}"/>
  <circle cx="50.7" cy="43.6" r="2.75" fill="${ring}"/>
  <path d="M11.33 24.48 Q18.6 3.1 39.52 11.33" stroke="${gold}" stroke-width="5" stroke-linecap="round"/>
  <circle cx="11.33" cy="24.48" r="4.25" fill="${gold}"/>
  <circle cx="39.52" cy="11.33" r="4.25" fill="${gold}"/>
</svg>`;
}

/** The mark as a `data:` URI, ready for an `<img src>` inside an ImageResponse. */
export function markDataUri(opts: MarkOptions): string {
  return `data:image/svg+xml;base64,${Buffer.from(markSvg(opts)).toString("base64")}`;
}
