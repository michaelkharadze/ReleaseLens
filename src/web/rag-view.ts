import type { RagResult } from '../rag/pipeline.ts';

export type RagBenchmark = {
  metrics: {
    cases: number;
    passed: number;
    retrievalHitRateAt4: number;
    mrrAt4: number;
    citationIntegrity: number;
    abstentionPasses: number;
    abstentionCases: number;
    medianLatencyMs: number;
  };
  cases: {
    id: string;
    question: string;
    pass: boolean;
    result: RagResult | null;
    error: string | null;
  }[];
  methodology: string;
};
const e = (v: unknown) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
export function ragView(input: {
  benchmark: RagBenchmark | null;
  result: RagResult | null;
  question: string;
  live: boolean;
  busy: boolean;
  error: string;
  releaseId: string;
}) {
  const { benchmark, result, question, live, busy, error, releaseId } = input,
    m = benchmark?.metrics;
  return `<section class="full-card"><div class="eyebrow">LANGCHAIN · SEMANTIC RETRIEVAL · GROUNDED GENERATION</div><h2>Ask the release evidence</h2><p>${live ? 'Ask a question about reports and release notes in the selected window. Local Ollama models retrieve evidence and generate a cited answer.' : 'Explore recorded outputs from real local-model requests. This public static demo replays the saved benchmark; run the local application to ask your own questions.'}</p><div class="badge rag-badge">${live ? 'Live local inference' : 'Recorded live-model benchmark'}</div><p class="method">Pipeline: 900-character chunks → Nomic embeddings → SQLite vector search → LangChain retriever and prompt → Qwen3 → validated source IDs and exact quotes.</p>
 ${benchmark ? `<label class="field">${live ? 'Try a benchmark question' : 'Choose a recorded question'}<select id="rag-case"><option value="">Select a question…</option>${benchmark.cases.map((c) => `<option value="${e(c.id)}">${e(c.question)}</option>`).join('')}</select></label>` : ''}
 ${live ? `<form id="rag-form"><label class="field" for="rag-question">Question about ${e(releaseId)}<textarea name="question" id="rag-question" required maxlength="1000" aria-label="Question about ${e(releaseId)}" placeholder="Which reports describe an incomplete spreadsheet download?">${e(question)}</textarea></label><button class="button primary" type="submit" ${busy ? 'disabled' : ''}>${busy ? 'Retrieving and generating…' : 'Retrieve evidence and answer'}</button><span class="method"> &nbsp; Models run locally · no API key</span></form>` : ''}
 ${error ? `<p class="form-error" role="alert">${e(error)}</p>` : ''}</section>
 ${m ? `<div class="eval-grid rag-metrics"><div class="metric"><div class="metric-top">Retrieval hit rate @ 4</div><div class="metric-value">${(m.retrievalHitRateAt4 * 100).toFixed(1)}%</div><div class="metric-bottom">At least one reference source retrieved</div></div><div class="metric"><div class="metric-top">Mean reciprocal rank @ 4</div><div class="metric-value">${m.mrrAt4.toFixed(2)}</div><div class="metric-bottom">Rank of the first reference source</div></div><div class="metric"><div class="metric-top">Recorded acceptance checks</div><div class="metric-value">${m.passed}/${m.cases}</div><div class="metric-bottom">Synthetic development cases · inspect failures</div></div></div>` : ''}
 ${result ? `<section class="full-card"><div class="card-heading"><h2>${result.abstained ? 'Evidence is insufficient' : 'Answer grounded in retrieved sources'}</h2><span class="badge">${result.trace.chatModel ? e(result.trace.chatModel) : 'Retrieval abstention'}</span></div><p class="rag-answer">${e(result.answer)}</p><div class="section-label">Validated citations</div>${result.citations.length ? result.citations.map((c) => `<blockquote class="quote"><p>“${e(c.quote)}”</p><small>${e(c.sourceId)} · ${e(c.chunkId)}</small></blockquote>`).join('') : '<p>No supporting citation was returned. The system abstained.</p>'}<p class="method">${e(result.note)}</p></section><section class="full-card"><h2>Retrieval trace</h2><p class="method">${result.trace.embeddedChunks} chunks embedded · ${result.trace.cacheHits} cache hits · ${(result.trace.retrievalMs / 1000).toFixed(2)}s retrieval · ${(result.trace.generationMs / 1000).toFixed(2)}s generation · ${result.trace.usage?.total_tokens ?? 0} model tokens</p><p class="method">Embedding identity: <code>${e(result.trace.embeddingModel)}</code></p>${result.sources.map((s) => `<details class="rag-source"><summary>${e(s.sourceId)} · ${e(s.kind.replace('_', ' '))} · cosine ${s.score.toFixed(3)}</summary><p>${e(s.text)}</p><small>${e(s.chunkId)}${s.url ? ` · <a href="${e(s.url)}" target="_blank" rel="noopener noreferrer">Original source ↗</a>` : ''}</small></details>`).join('')}</section>` : '<section class="full-card empty">Choose a recorded question or submit a live question to inspect its answer, evidence, and retrieval trace.</section>'}
 ${benchmark ? `<section class="full-card"><h2>What these results measure</h2><p>${e(benchmark.methodology)}</p><p class="method">${(m!.citationIntegrity * 100).toFixed(1)}% citation-integrity checks passed · ${m!.abstentionPasses}/${m!.abstentionCases} unsupported-question checks passed · ${(m!.medianLatencyMs / 1000).toFixed(2)}s recorded median latency.</p></section>` : ''}`;
}
