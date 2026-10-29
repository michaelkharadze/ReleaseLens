# LangChain RAG in ReleaseLens

## Implemented pipeline

1. Scope reports to the selected release's equal before/after windows. Include only that release's change notes.
2. Create LangChain Documents and split them with RecursiveCharacterTextSplitter: 900-character chunks, 120-character overlap, original source IDs and content hashes.
3. Embed through LangChain OllamaEmbeddings using nomic-embed-text:v1.5, with the model's search_document/search_query task prefixes.
4. Persist the vectors in a custom LangChain SQLite VectorStore. Cache by text and the installed embedding model's SHA-256 digest. Atomically replace stale scope indexes after embeddings finish.
5. Retrieve up to four distinct texts through LangChain's vector-store retriever. Perform exact cosine search within the release scope and apply the development-calibrated 0.60 relevance threshold.
6. Check absent typed engineering facts such as a requested commit SHA or HTTP status code. Run a structured Qwen3 answerability classifier for other questions.
7. Generate with ChatOllama and a retrieval-specific JSON schema. Only retrieved source IDs and exact sentence excerpts are available as citation choices. Unsupported questions abstain.
8. Independently validate returned IDs and quotes, then persist the question, sources, model metadata, tokens, timings, and answer in the audit/run store.

The runnable pipeline uses LangChain RunnableSequence, RunnableLambda, ChatPromptTemplate, RecursiveCharacterTextSplitter, a VectorStore retriever, OllamaEmbeddings, ChatOllama, and Zod structured output. The configured local chat model is qwen3:4b. No LangGraph, hosted model key, or cloud vector service is required.

## Actual live evaluation

The current run passed **13/13 reference acceptance checks** through the application's HTTP API using real Ollama models:

| Measurement                     | Result                                                     |
| ------------------------------- | ---------------------------------------------------------- |
| Answerable reference questions  | 9                                                          |
| Retrieval hit rate at 4         | 100%                                                       |
| Mean reciprocal rank at 4       | 0.944                                                      |
| Unsupported-question checks     | 4/4 abstained                                              |
| Citation integrity              | All returned references and quote checks passed            |
| Adversarial report case         | Passed the canary and unsupported-causality pattern checks |
| Recorded median request latency | 4.47 seconds on the recorded Mac run                       |

See evaluation/rag-results.json for every prompt, answer, source, score, timing, model digest, and failure field. The benchmark includes semantic paraphrases, release notes, unrelated questions, missing facts inside relevant topics, and a report containing instruction-like text.

These are authored **synthetic development cases**, not held-out production results. The threshold and prompts were developed against this set. The checks use expected source IDs, coarse answer terms, abstention, exact citations, and a limited adversarial pattern. They are not a semantic-entailment proof. Latency depends on hardware, model loading, and caching.

## What live testing caught

- Qwen3 0.6B generated altered quotes or no citations. The independent validator rejected those outputs.
- A 1.7B model passed coarse checks but added an unsupported causal explanation. The earlier run is retained in rag-results-tuned-small.json with a manual-review note.
- Initial retrieval accepted irrelevant context; both unsupported questions failed. The initial result remains in rag-results-initial.json.
- A verbose answerability classifier over-abstained on legitimate questions; that run remains in rag-results-answerability-initial.json.
- A binary classifier still missed absent commit IDs and status codes. Deterministic typed-fact checks now abstain before generation for those cases.

The final result does not erase these failures or claim universal hallucination prevention.

## Reproduce

```sh
npm ci
cp .env.example .env
npm run models:setup
npm run models:serve
```

In another terminal:

```sh
npm run models:pull
npm run eval:rag
npm run dev
```

macOS setup verifies the pinned Ollama 0.40.13 archive checksum. Runtime/model files are stored under ignored .data/ollama/. Other platforms can use an installed Ollama executable. The default project model server uses 127.0.0.1:17433.

Normal CI runs the offline tests and the original grouping benchmark without models or provider secrets. Live evaluation is an explicit command because model downloads and inference require more resources. The live script exits nonzero when any reference acceptance case fails.

## Demo modes

The local RAG lab accepts arbitrary questions and shows the actual request result. The public static demo loads the recorded benchmark and lets visitors inspect each saved output and source trace. It does not offer fake live responses or expose the model server on the developer's Mac.

## Limits

SQLite vectors use exact linear search; no ANN, HNSW, or pgvector scaling claim is made. A scope is capped at 5,000 chunks. Retrieval thresholds, model-based answerability, and exact citations can still miss relevant context or support an incomplete/misleading paraphrase. Typed-fact checks cover formats, not every possible missing fact. Suspected root causes still need reproduction and human review. The local server has no production tenant authentication.

Official references: [LangChain ChatOllama](https://docs.langchain.com/oss/javascript/integrations/chat/ollama), [Ollama embeddings](https://docs.langchain.com/oss/javascript/integrations/embeddings/ollama), [recursive splitting](https://docs.langchain.com/oss/javascript/integrations/splitters/recursive_text_splitter).
