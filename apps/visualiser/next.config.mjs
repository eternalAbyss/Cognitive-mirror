/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false, // the WebGL engine manages its own lifecycle; avoid double-mount in dev
  devIndicators: false, // hide the dev overlay badge (it sits over the status bar)
};

export default nextConfig;
