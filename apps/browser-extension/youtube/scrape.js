// Injected into the YouTube tab to extract a capturable record of the video.
// Returns { title, channel, url, text }. The transcript is only available if the
// user has opened the transcript panel (YouTube lazy-loads it into the DOM).
function cmScrapeYouTube() {
  const q = (sel) => document.querySelector(sel);
  const title =
    q("h1.ytd-watch-metadata yt-formatted-string")?.textContent?.trim() ||
    document.title.replace(/ - YouTube$/, "").trim();
  const channel = q("ytd-channel-name #text a")?.textContent?.trim() || "";
  const description =
    q("#description-inline-expander")?.textContent?.trim() ||
    q("#description")?.textContent?.trim() ||
    "";
  const segments = Array.from(
    document.querySelectorAll("ytd-transcript-segment-renderer .segment-text"),
  )
    .map((n) => n.textContent.trim())
    .join(" ");
  const text = [description, segments].filter(Boolean).join("\n\n");
  return { title, channel, url: location.href, text };
}
