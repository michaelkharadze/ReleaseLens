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

The live Together model path requires credentials and has not been exercised. Public GitHub ingestion has a controlled-response test; no live repository import was used to validate retrieval completeness. There is no real customer dataset or production user study. The desktop browser flow was checked; no claim is made that every mobile device, assistive technology, or browser has been tested.
