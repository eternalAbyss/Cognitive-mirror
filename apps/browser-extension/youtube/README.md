# YouTube capture — browser extension (MV3)

Sends the current YouTube video (title, channel, description, and the transcript if the transcript
panel is open) to the ingestion webhook as a `youtube` source (design §2).

## Install (unpacked, Chrome/Edge/Arc)
1. `chrome://extensions` → enable **Developer mode**.
2. **Load unpacked** → select this folder (`apps/browser-extension/youtube`).
3. Open the extension's **Settings** and set the Ingestion URL (default
   `http://127.0.0.1:4002/ingest`) and `INGEST_TOKEN` if you configured one. Off-device, use the
   Cloudflare tunnel hostname (Phase 0).

## Use
On a `youtube.com/watch` page, click the extension → **Capture this video**. For the transcript,
open YouTube's "Show transcript" panel first (it's lazy-loaded into the DOM). The reasoning daemon
then enriches it into graph nodes like any other source.

> No build step — plain MV3 files. It is intentionally *not* a pnpm workspace member.
