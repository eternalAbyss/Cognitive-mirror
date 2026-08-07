# @cm/embeddings

Ollama embeddings and text chunking.

Embeddings are computed **locally**, which is the point: your notes are never
sent anywhere to be indexed. `nomic-embed-text` at 768 dimensions by default;
`EMBED_MODEL` and `EMBED_DIM` must agree with each other and with the vector
index FalkorDB was built with.

Two embedding roles, per the architecture:

- **Summary embeddings** on a node, for concept-level similarity — this is what
  the maintenance engine compares when deciding whether two concepts are the
  same thing.
- **Chunk embeddings** on the text, for passage retrieval.

`chunkText` splits on an approximate token count (~4 characters per token) with
overlap. The overlap is clamped below the chunk size: both come from unvalidated
environment variables, and an overlap greater than or equal to the size makes the
loop step backwards and never terminate.
