/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false, // the WebGL engine manages its own lifecycle; avoid double-mount in dev
  devIndicators: false, // hide the dev overlay badge (it sits over the status bar)
  // Emit a self-contained server the CLI can ship, so `npx cognitive-mirror up`
  // serves the UI without a checkout or an npm install at the user's end.
  output: "standalone",
  // The tracing root is the monorepo, not this package — otherwise Next only
  // traces apps/visualiser and the standalone bundle misses hoisted deps.
  outputFileTracingRoot: new URL("../..", import.meta.url).pathname,
};

export default nextConfig;
