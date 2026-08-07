/**
 * The consent screen shown during the OAuth authorize step.
 *
 * Deliberately a single self-contained HTML string: this page must render on a
 * phone, mid-OAuth-redirect, with no build step and nothing loaded from a CDN
 * (a strict page like this should not depend on a third party being up).
 */
export function loginPage(opts: {
  clientName: string;
  /** Opaque blob echoed back on POST so the server can resume the flow. */
  request: string;
  error?: string;
}): string {
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Authorise · Cognitive-mirror</title>
<style>
  :root { color-scheme: light dark; --gold:#B07B16; --bg:#fff; --ink:#0c0c0c; --muted:#666; --line:#ddd; --err:#c2557a; }
  @media (prefers-color-scheme: dark) {
    :root { --gold:#D8A63E; --bg:#0b0d12; --ink:#e4e7ee; --muted:#9aa1ae; --line:#2a2f39; }
  }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100dvh; display:grid; place-items:center; padding:24px;
         background:var(--bg); color:var(--ink);
         font:16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  main { width:100%; max-width:26rem; }
  .mark { display:block; margin:0 auto 1.5rem; }
  h1 { font-size:1.25rem; margin:0 0 .5rem; text-align:center; font-weight:600; }
  p { margin:0 0 1.5rem; text-align:center; color:var(--muted); font-size:.9rem; }
  strong { color:var(--ink); font-weight:600; }
  label { display:block; font-size:.8rem; color:var(--muted); margin-bottom:.4rem; }
  input { width:100%; padding:.7rem .8rem; font-size:1rem; border-radius:8px;
          border:1px solid var(--line); background:transparent; color:var(--ink); }
  input:focus { outline:2px solid var(--gold); outline-offset:1px; border-color:transparent; }
  button { width:100%; margin-top:1rem; padding:.7rem; font-size:1rem; font-weight:600;
           border:0; border-radius:8px; background:var(--gold); color:#fff; cursor:pointer; }
  button:hover { filter:brightness(1.08); }
  .err { margin:0 0 1rem; padding:.6rem .8rem; border-radius:8px; text-align:left;
         border:1px solid var(--err); color:var(--err); font-size:.85rem; }
  .foot { margin:1.5rem 0 0; font-size:.75rem; }
</style>
</head><body><main>
  <svg class="mark" width="52" height="52" viewBox="0 0 64 64" fill="none" aria-hidden="true">
    <circle cx="32" cy="32" r="22" stroke="currentColor" stroke-opacity=".35" stroke-width="3.25"/>
    <path d="M11.33 24.48 Q18.6 3.1 39.52 11.33" stroke="var(--gold)" stroke-width="5" stroke-linecap="round"/>
    <circle cx="11.33" cy="24.48" r="4.25" fill="var(--gold)"/>
    <circle cx="39.52" cy="11.33" r="4.25" fill="var(--gold)"/>
  </svg>
  <h1>Authorise access</h1>
  <p><strong>${esc(opts.clientName)}</strong> is asking to read and write your knowledge graph.</p>
  ${opts.error ? `<p class="err">${esc(opts.error)}</p>` : ""}
  <form method="POST" autocomplete="off">
    <input type="hidden" name="request" value="${esc(opts.request)}">
    <label for="pp">Passphrase</label>
    <input id="pp" name="passphrase" type="password" autofocus required
           autocomplete="current-password" enterkeyhint="go">
    <button type="submit">Authorise</button>
  </form>
  <p class="foot">Only approve this if you started it. Anyone with your passphrase
     can read everything in your graph.</p>
</main></body></html>`;
}
