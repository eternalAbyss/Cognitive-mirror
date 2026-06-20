# Apple Shortcuts → ingestion (Notes / journal)

Capture iPad/iPhone notes and journal entries into the second brain by POSTing to the ingestion
webhook (design §2). On-device works against `http://127.0.0.1:4002`; from other devices, point at
the Cloudflare tunnel hostname (Phase 0) instead.

## Endpoint

```
POST {INGEST_URL}/ingest
Authorization: Bearer {INGEST_TOKEN}      # only required if INGEST_TOKEN is set
Content-Type: application/json

{ "kind": "note", "title": "<short title>", "text": "<body>", "source": "ios:notes" }
```

`kind` is one of `note` | `journal` | `generic`. Ingestion is idempotent (it hashes
`kind+source+text`), so re-sending the same note is a no-op.

## Build the Shortcut

1. **Shortcuts app → +** → name it e.g. "Send to Second Brain".
2. Add **Text** (or **Get Contents of Note** / **Ask for Input**) → this is the body.
3. Add **Dictionary**:
   - `kind` → `note` (or `journal`)
   - `title` → first line / a Shortcut variable
   - `text` → the Text from step 2
   - `source` → `ios:notes`
4. Add **Get Contents of URL**:
   - URL: `https://<your-tunnel-host>/ingest` (or `http://127.0.0.1:4002/ingest` on-device)
   - Method: **POST**
   - Headers: `Authorization` = `Bearer <INGEST_TOKEN>`, `Content-Type` = `application/json`
   - Request Body: **JSON** → the Dictionary from step 3
5. (Optional) Add to the Share Sheet so you can send selected text from any app, and/or add a
   **Journal** automation that runs it each evening.

## Test

```bash
curl -s -X POST http://127.0.0.1:4002/ingest \
  -H "authorization: Bearer $INGEST_TOKEN" -H "content-type: application/json" \
  -d '{"kind":"journal","title":"Evening note","text":"Reflected on probabilistic system design today.","source":"ios:journal"}'
```

The reasoning daemon then enriches it into Source + Concept nodes like any other source.
