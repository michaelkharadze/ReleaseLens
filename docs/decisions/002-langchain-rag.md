# 002 — Local LangChain RAG with explicit evidence contracts

Status: accepted

Add a question-driven retrieval pipeline rather than passing an entire selected topic to a model. LangChain owns document splitting, the vector-store retriever, prompt construction, runnable composition, and the Ollama chat/embedding integrations.

Use local open-weight models because no hosted provider credentials were configured and the user selected local validation. Qwen3 4B generates answers; Nomic v1.5 creates embeddings. A custom LangChain VectorStore persists vectors in SQLite and performs exact cosine search. This is an inspectable small-workspace implementation, not an ANN system.

Generate citations with a schema whose allowed source IDs and quote excerpts come from the retrieved evidence, then validate source IDs and verbatim quotes independently. Citation integrity is a structural property, not proof that every answer claim follows from its sources.

Abstain for low-relevance retrieval and missing typed engineering facts. An LLM answerability check provides another estimate; it is not a substitute for deterministic checks or human review. Early live runs showed that small models could produce invalid citations and that a classifier could miss unavailable identifiers or over-abstain.

Keep the public website static and replay labeled real benchmark outputs. Live inference runs in the local full-stack application; do not expose the user's local model server or introduce a public inference bill.
