import { ImageResponse } from "next/og";
import { CANVAS_DARK, GOLD_DARK, markDataUri } from "./icon-mark";

/** Link-preview card for the repo and any shared deployment. */
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "The Cognitive Mirror — watch your second brain think.";

export default function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        gap: 72,
        padding: "0 96px",
        background: CANVAS_DARK,
        color: "#E4E7EE",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={markDataUri({ ring: "#E4E7EE", gold: GOLD_DARK })}
        width={300}
        height={300}
        alt=""
      />
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div style={{ fontSize: 68, fontWeight: 600, letterSpacing: -1.5 }}>
          The Cognitive Mirror
        </div>
        <div style={{ fontSize: 34, color: "#9AA1AE", lineHeight: 1.35 }}>
          A local-first second brain that manages its own knowledge graph.
        </div>
        <div style={{ fontSize: 28, color: GOLD_DARK, marginTop: 12 }}>npx cognitive-mirror up</div>
      </div>
    </div>,
    size,
  );
}
