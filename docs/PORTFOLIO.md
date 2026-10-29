# Explaining ReleaseLens

## Suggested résumé bullets

- Built a release-aware RAG application with **TypeScript, Node.js, LangChain, and SQLite**, connecting customer reports and release notes to source-backed engineering investigations.
- Implemented **semantic retrieval** with Nomic embeddings, recursive chunking, release-window metadata filtering, and a persistent vector cache keyed by content and model revision; measured **100% hit rate at 4 and 0.94 MRR on nine synthetic reference queries**.
- Integrated local **Qwen3 4B through Ollama** with structured JSON generation, constrained citations, answerability checks, and deterministic missing-fact guards; passed **13/13 live acceptance cases**, including four abstentions and an adversarial report.
- Validated the ingestion and AI workflows with **30 automated tests**, covering vector persistence, cache invalidation, scope isolation, malformed output, timeouts, HTTP integration, and UI escaping; automated checks through **GitHub Actions CI**.

The retrieval and live acceptance metrics are from an authored synthetic development benchmark, not production or held-out accuracy. Citation integrity is not a proof of semantic faithfulness. Do not claim customer adoption, time savings, or incident reduction without measuring them. LangChain is implemented; LangGraph is not.

## Five-minute interview walkthrough

1. Open the release overview for v2.8.0 and explain why report share and unique accounts are more useful than raw complaint counts.
2. Select a suspected regression and inspect the original source text and the release-note association.
3. Open RAG lab. In the local app, ask an evidence question and show retrieved chunks, source scores, quotes, cache hits, tokens, and timings. The public demo clearly replays recorded live results.
4. Ask for an unsupported commit SHA or HTTP status code and show abstention instead of an invented identifier.
5. Explain the difference between source-ID/quote validity and semantic faithfulness, using the retained failed development runs.
6. Show GitHub Actions and the committed evaluation output. Explain why a small synthetic benchmark is useful for regression checks but insufficient to establish real-world accuracy.

## Decisions to discuss

**RAG instead of large prompt stuffing:** retrieve question-relevant chunks from a release scope, cache dense embeddings, and expose the retrieved evidence. Metadata filtering prevents searching unrelated release windows.

**Local model validation:** actual Ollama embedding/chat requests exercise the deployed local API without a hosted provider key. Model digests and runtime versions make the result inspectable.

**Grounding:** constrain citations to real retrieved excerpts, validate independently, and add answerability checks. Exact quotes do not guarantee every answer claim is entailed.

**Persistence:** validate a complete import before writing, use source IDs for retry safety, and replace a vector index atomically after successful embedding. Model/content fingerprints invalidate stale embeddings.

**Deployment:** the public demo is static and replays real benchmark outputs. The live backend runs locally; production multi-user inference would require authenticated tenancy and a hosted inference service.

## Next evidence to collect

Use permissioned real reports labeled independently by two people. Create a held-out set. Compare embeddings and retrieval settings using hit rate, MRR, recall, answerability precision/recall, and human-rated faithfulness. Time actual triage sessions before claiming efficiency gains. Add release exposure counts before interpreting complaint share as incidence.
