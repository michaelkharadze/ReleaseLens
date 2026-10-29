# Public live RAG

This upgrade replaces the static-only publication with a Cloudflare Worker serving the existing dashboard and a server-side LangChain RAG endpoint. Publication is pending secure model-key setup and actual provider validation; the current public deployment is preserved until that succeeds.

## Runtime

- Public visitors can submit their own questions about the 41 included synthetic reports and two releases. The backend accepts no client-supplied documents or arbitrary URLs. Browser imports remain local and are not sent to the shared model endpoint.
- The same recursive text splitter, source metadata, prompt, missing-fact guards, and independent source/quote validator are shared with the local application.
- LangChain OpenAIEmbeddings uses text-embedding-3-small with 768 dimensions. Content/model identity keys a persistent D1 cache; exact cosine retrieval is scoped to the selected release window.
- LCEL runnables retrieve evidence and call ChatOpenAI through the Responses API. The configured snapshot is gpt-4.1-mini-2025-04-14, with structured output constrained to retrieved IDs and quotes and at most 600 output tokens. Response storage is disabled.
- The Nomic/Qwen benchmark shown in the interface is labeled as an earlier local-model baseline, separate from a visitor's hosted answer. Nomic's calibrated threshold is not reused for OpenAI embeddings; the hosted 0.25 threshold is an initial heuristic pending live evaluation.

## Public endpoint bounds

The API validates same-origin requests, JSON bodies up to 4 KiB, questions up to 1,000 characters, fixed release IDs, supported window sizes, and at most four chunks. D1 atomically enforces 10 attempted model requests per visitor per UTC hour and 100 globally per UTC day before any model call. Invalid requests do not consume inference quota. Provider failures consume a slot and return a safe error with a reference ID. These request caps bound usage, not a currency-denominated billing cap.

The public database stores document embeddings and quota counters, not questions or generated answers. Visitor addresses are hashed with a server-side secret before storage; raw addresses are not stored by application code. Platform/provider operational logs remain outside this application-level guarantee. Questions and selected sample excerpts go to OpenAI. The key is configured as a Sites runtime secret and is never included in source, the hosting manifest, or browser responses.

The D1 schema is defined in `db/schema.ts`, with generated immutable migrations in `drizzle/`. Sites provisions the DB binding and applies migrations on publication. Do not create migration-owned tables while handling a production request.

## Reproduce

```sh
npm ci
npm run check
npm run build:hosted
npm run dev:hosted
```

The hosted preview uses the same built Worker's fetch entrypoint, a local SQLite adapter for D1, and the OpenAI key configured through the secure Developers setup. It listens on 127.0.0.1:4318. It does not replace an actual deployed Worker verification.

After secure key setup, `npm run eval:hosted` runs real embedding and generation requests through the built Worker interface and writes `evaluation/hosted-results.json`. Offline transport/handler tests use explicit fixtures, require no keys, and are not live-model accuracy measurements.

## Deployment

The tracked `.openai/hosting.json` retains the existing Site ID, omits `static`, declares `d1: "DB"`, and leaves R2 unused. `npm run build:hosted` embeds the existing public assets in the Worker ESM artifact and includes migrations. The standard Sites source helper packages and publishes the exact pushed commit. Preserve the existing public audience.

Future multi-tenant or real customer data use requires a different authorization and storage design. This shared sample demo has no privileged write or import endpoint.
