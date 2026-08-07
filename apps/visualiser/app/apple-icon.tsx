import { ImageResponse } from "next/og";
import { CANVAS_DARK, GOLD_DARK, markDataUri } from "./icon-mark";

/**
 * iOS/Safari ignore SVG favicons, so the home-screen icon is generated as a PNG
 * at build time. Unlike the favicon it sits on an opaque tile (iOS composites
 * transparency onto white), so it uses the app's own dark canvas colour.
 */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: CANVAS_DARK,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={markDataUri({ ring: "#E4E7EE", gold: GOLD_DARK })} width={132} height={132} alt="" />
      </div>
    ),
    size,
  );
}
