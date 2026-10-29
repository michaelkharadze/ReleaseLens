import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ragView } from '../src/web/rag-view.ts';
import type { RagResult } from '../src/rag/pipeline.ts';

test('public RAG interface identifies recorded runs and does not pretend to offer live inference', () => {
  const html = ragView({
    benchmark: null,
    result: null,
    question: '',
    live: false,
    busy: false,
    error: '',
    releaseId: 'v2',
  });
  assert.match(html, /Recorded live-model benchmark/);
  assert.match(html, /replays the saved benchmark/);
  assert.doesNotMatch(html, /id="rag-form"/);
});
test('local RAG interface offers an actual question form and escapes untrusted model/source content', () => {
  const result: RagResult = {
    answer: '<script>alert(1)</script>',
    abstained: false,
    citations: [{ chunkId: 'x', sourceId: 'r1', quote: '<img onerror=evil>' }],
    sources: [],
    trace: {
      runId: 'x',
      embeddingModel: 'test',
      chatModel: 'test',
      embeddedChunks: 0,
      cacheHits: 1,
      retrievalMs: 2,
      generationMs: 3,
      totalMs: 5,
      usage: null,
    },
    note: 'source check',
  };
  const html = ragView({
    benchmark: null,
    result,
    question: 'A question',
    live: true,
    busy: false,
    error: '',
    releaseId: 'v2',
  });
  assert.match(html, /id="rag-form"/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /<img onerror/);
});
