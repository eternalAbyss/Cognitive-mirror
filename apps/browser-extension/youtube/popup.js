const statusEl = document.getElementById("status");

document.getElementById("opts").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

document.getElementById("capture").addEventListener("click", async () => {
  statusEl.textContent = "Capturing…";
  const { ingestUrl = "http://127.0.0.1:4002/ingest", ingestToken = "" } =
    await chrome.storage.sync.get(["ingestUrl", "ingestToken"]);

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url?.includes("youtube.com/watch")) {
    statusEl.textContent = "Open a YouTube video first.";
    return;
  }

  const [{ result } = {}] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["scrape.js"],
  }).then(() =>
    chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => cmScrapeYouTube() }),
  );

  if (!result?.title) {
    statusEl.textContent = "Could not read the video.";
    return;
  }

  try {
    const res = await fetch(ingestUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(ingestToken ? { authorization: `Bearer ${ingestToken}` } : {}),
      },
      body: JSON.stringify({
        kind: "youtube",
        title: result.title,
        text: `${result.channel ? result.channel + "\n\n" : ""}${result.text}`,
        url: result.url,
        source: `youtube:${result.channel || "unknown"}`,
      }),
    });
    statusEl.textContent = res.ok ? "✓ Sent to your second brain." : `Failed (${res.status}).`;
  } catch (err) {
    statusEl.textContent = `Error: ${String(err)}`;
  }
});
