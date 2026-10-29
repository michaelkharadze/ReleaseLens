# Validation record

Checked during initial implementation on 2026-10-29.

## Automated checks

- Strict TypeScript checking passes for server, browser, analysis, tests, and evaluation code.
- The Node test suite covers UTC boundary inclusion/exclusion, per-account deduplication, deterministic grouping, topic separation, finite zero-topic ratios, empty-window abstention, source validation, exact source-body preservation, transactional/idempotent imports, release-scoped reviews, model citation validation, GitHub issue/PR filtering, and a real HTTP import/analyze/review workflow.
- The 24-pair authored development benchmark produces 66.7% precision, 83.3% recall, and 74.1% F1. Failures are retained in the output.
- The browser build completes successfully from shared TypeScript source.

## Browser checks performed

- The local workspace loads from the SQLite API with 41 synthetic reports and six groups.
- Selecting the CSV export signal updates its source evidence and related release change.
- Draft brief shows seven original reports and their actual source IDs, before/after counts, and a reproduction checklist.
- An investigation note can be saved and survives a reload.
- Release switching recomputes counts and review state.
- The evaluation view displays metrics and all 24 individual cases, including misses.
- No error or warning entries were returned by the browser log check.
- A full-page dashboard screenshot is saved as `docs/dashboard.jpg`.

Browser QA identified an empty-before-window bug; the analysis now abstains with `insufficient` and a null ratio when either comparison window has no reporting accounts. A regression test covers this case.

## Verification limits

The original Together adapter was replaced by the local LangChain/Ollama RAG pipeline. The live RAG integration has now been exercised with real models. Public GitHub ingestion has a controlled-response test; no live repository import was used to validate retrieval completeness. There is no real customer dataset or production user study. The desktop browser flow was checked; no claim is made that every mobile device, assistive technology, or browser has been tested.

## LangChain RAG upgrade validation

- 30 offline automated tests cover the original workflow and RAG index persistence across restart, cache invalidation, vector validation, metadata scope isolation, atomic failed-index updates, retrieval abstention, constrained source/quote rejection, typed-fact guards, provider errors/timeouts, real LangChain HTTP transport, and UI escaping.
- The final live benchmark passed 13/13 reference checks with Qwen3 4B and Nomic embeddings, invoked through the application HTTP API. Nine answerable queries produced 100% retrieval hit rate at 4 and 0.944 MRR. Four unsupported questions abstained.
- The live result records installed model digests, local runtime versions, tokens, latency, retrieved sources, and the actual generated outputs.
- Earlier failed runs and a manual-review note remain committed to show the limits of coarse reference checks and the changes prompted by live testing.
- The desktop browser submitted a live CSV question and displayed a generated answer with two validated report citations and the actual inference trace. A missing commit-SHA question displayed an abstention with zero generation tokens. The positive flow is captured in `docs/rag.jpg`.

These are synthetic development results. Citation integrity does not establish semantic entailment or causal correctness. No hosted Together/OpenAI provider is used in the current RAG workflow.
