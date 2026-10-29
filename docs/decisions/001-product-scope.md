# 001 — Investigate release regressions before adding a general chat interface

Status: accepted

The primary question is: which customer problems became more common after a release? The system compares equally sized windows, counts unique reporting accounts per topic, normalizes by all reporting accounts in each window, and links every finding back to source records. It does not claim a causal link from release timing alone.

Start with a deterministic lexical baseline that works offline. A model can add a hypothesis to a brief, but cannot change measured counts or invent citations. Keep model output behind validation and human review.

The initial v0.1 implementation used TypeScript and Node's built-in SQLite with no runtime package dependencies. The browser demo shares the analysis engine with the server; the full local application persists data in SQLite. A hosted static demo uses browser storage and explicitly identifies that mode. Decision 002 adds LangChain runtime dependencies for the v0.2 RAG pipeline.

Initial non-goals: production multi-tenant authentication, automatic issue publication, semantic embeddings, causal inference, and fabricated business-impact metrics.
