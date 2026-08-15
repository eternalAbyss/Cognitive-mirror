const urlEl = document.getElementById("url");
const tokenEl = document.getElementById("token");

chrome.storage.sync.get(["ingestUrl", "ingestToken"]).then(({ ingestUrl, ingestToken }) => {
  urlEl.value = ingestUrl ?? "http://127.0.0.1:4002/ingest";
  tokenEl.value = ingestToken ?? "";
});

document.getElementById("save").addEventListener("click", async () => {
  await chrome.storage.sync.set({
    ingestUrl: urlEl.value.trim(),
    ingestToken: tokenEl.value.trim(),
  });
  document.getElementById("saved").textContent = "Saved";
  setTimeout(() => {
    document.getElementById("saved").textContent = "";
  }, 1500);
});
