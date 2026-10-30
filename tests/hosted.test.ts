import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TestD1 } from './helpers/d1.ts';
import { claimRequest, PublicError } from '../src/hosted/db.ts';
import {
  askHosted,
  openAIModels,
  parseQuestion,
  type HostedDependencies,
} from '../src/hosted/rag.ts';
import { handleAPI } from '../src/hosted/handler.ts';
import { HostedVectorStore } from '../src/hosted/vector-store.ts';
import { Document } from '@langchain/core/documents';
import { ragView } from '../src/web/rag-view.ts';

function fixtureModels() {
  const counters = { embeddings: 0, generation: 0 };
  const models: HostedDependencies = {
    embeddingIdentity: 'contract-fixture',
    embeddings: {
      async embedDocuments(texts) {
        counters.embeddings += texts.length;
        return texts.map((t) => (/csv/i.test(t) ? [1, 0] : [0, 1]));
      },
      async embedQuery(question) {
        return /csv|spreadsheet/i.test(question) ? [1, 0] : [-1, 0];
      },
    },
    async generate(sources) {
      counters.generation++;
      return {
        model: 'contract-fixture',
        parsed: {
          answer: 'Customers report CSV export truncation.',
          abstained: false,
          citations: [{ chunkId: sources[0].chunkId, quote: sources[0].text.split('\n')[0] }],
        },
      };
    },
  };
  return { models, counters };
}
const question = {
  question: 'What happens to CSV exports?',
  releaseId: 'v2.8.0',
  windowDays: 7,
  k: 4,
};
const request = (body: unknown, headers: Record<string, string> = {}) =>
  new Request('https://demo.test/api/rag/ask', {
    method: 'POST',
    headers: { origin: 'https://demo.test', 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

test('D1 request quotas enforce visitor/hour and shared/day caps across limiter instances', async () => {
  const db = new TestD1();
  try {
    for (let n = 0; n < 10; n++) await claimRequest(db, 'visitor', 0);
    await assert.rejects(
      claimRequest(db, 'visitor', 0),
      (error) => error instanceof PublicError && error.status === 429,
    );
    await claimRequest(db, 'visitor', 3_600_000);
    for (let n = 0; n < 88; n++) await claimRequest(db, `other${n}`, 0);
    await assert.rejects(
      claimRequest(db, 'new', 0),
      (error) => error instanceof PublicError && error.status === 429,
    );
    await claimRequest(db, 'new', 86_400_000);
    assert.equal(
      db.db.prepare('SELECT count FROM hosted_request_limits WHERE key=?').get('global:0')?.count,
      100,
    );
  } finally {
    db.close();
  }
});

test('hosted LangChain retrieval caches D1 embeddings, isolates releases, and abstains on missing facts', async () => {
  const db = new TestD1(),
    { models, counters } = fixtureModels();
  try {
    const result = await askHosted(db, parseQuestion(question), models);
    assert.equal(result.abstained, false);
    assert.ok(
      result.citations.every((c) =>
        result.sources.some((s) => s.chunkId === c.chunkId && s.text.includes(c.quote)),
      ),
    );
    const embedded = counters.embeddings;
    const warm = await askHosted(db, parseQuestion(question), models);
    assert.equal(counters.embeddings, embedded);
    assert.ok(warm.trace.cacheHits > 0);
    const unsupported = await askHosted(
      db,
      parseQuestion({ ...question, question: 'Which commit SHA fixed CSV truncation?' }),
      models,
    );
    assert.equal(unsupported.abstained, true);
    assert.equal(counters.generation, 2);
    const irrelevant = await askHosted(
      db,
      parseQuestion({ ...question, question: 'What is the revenue forecast?' }),
      models,
    );
    assert.equal(irrelevant.abstained, true);
    assert.equal(counters.generation, 2);
    const vector = new HostedVectorStore(models.embeddings, db, 'scope-test', 'v1');
    await vector.synchronize([new Document({ pageContent: 'CSV', metadata: { chunkId: 'r1' } })]);
    await assert.rejects(
      vector.similaritySearchVectorWithScore([1, 0], 4, { releaseId: 'v2' }),
      /scope/,
    );
    await assert.rejects(vector.similaritySearchVectorWithScore([1, 0, 0], 4), /Invalid/);
  } finally {
    db.close();
  }
});

test('public API validates origin, size, scope, methods, and model availability before spending quota', async () => {
  const db = new TestD1(),
    { models, counters } = fixtureModels(),
    env = { OPENAI_API_KEY: 'test-only-key', DB: db };
  try {
    assert.equal(
      (await handleAPI(request(question, { origin: 'https://other.test' }), env, models)).status,
      403,
    );
    assert.equal(
      (await handleAPI(request({ ...question, question: 'x'.repeat(5000) }), env, models)).status,
      413,
    );
    assert.equal(
      (await handleAPI(request({ ...question, releaseId: 'private-tenant' }), env, models)).status,
      400,
    );
    assert.equal((await handleAPI(request({ ...question, reports: [] }), env, models)).status, 400);
    assert.equal(
      (await handleAPI(new Request('https://demo.test/api/rag/ask'), env, models)).status,
      405,
    );
    assert.equal((await handleAPI(request(question), {}, models)).status, 503);
    assert.equal(counters.embeddings, 0);
    assert.equal(db.db.prepare('SELECT count(*) AS n FROM hosted_request_limits').get()?.n, 0);
    const workspace = await (
      await handleAPI(new Request('https://demo.test/api/workspace'), env)
    ).json();
    assert.equal(workspace.ragMode, 'hosted');
    assert.equal(workspace.ragEnabled, true);
    assert.equal(workspace.reports.length, 41);
    assert.ok(!JSON.stringify(workspace).includes(env.OPENAI_API_KEY));
  } finally {
    db.close();
  }
});

test('public API returns cited results, rejects fabricated citations, and sanitizes provider errors', async () => {
  const db = new TestD1(),
    { models } = fixtureModels(),
    env = { OPENAI_API_KEY: 'test-only-key', DB: db };
  try {
    const success = await handleAPI(request(question), env, models);
    assert.equal(success.status, 200);
    assert.equal(success.headers.get('cache-control'), 'no-store');
    const bad = {
      ...models,
      generate: async () => ({
        model: 'fixture',
        parsed: {
          answer: 'Invented',
          abstained: false,
          citations: [{ chunkId: 'unknown', quote: 'fabricated quote' }],
        },
      }),
    };
    const rejected = await handleAPI(request(question), env, bad);
    assert.equal(rejected.status, 502);
    const broken = {
      ...models,
      generate: async () => {
        throw new Error('secret-provider-payload');
      },
    };
    const failed = await handleAPI(request(question), env, broken);
    assert.equal(failed.status, 502);
    assert.ok(!(await failed.text()).includes('secret-provider-payload'));
    assert.deepEqual(
      db.db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all()
        .map((r) => r.name),
      ['hosted_embedding_cache', 'hosted_request_limits'],
    );
  } finally {
    db.close();
  }
});

test('LangChain OpenAI transport sends embeddings and strict Responses JSON schema with storage disabled', async () => {
  const captured: { path: string; body: any }[] = [];
  const source = {
    chunkId: 'r1:0',
    sourceId: 'r1',
    kind: 'report' as const,
    title: 'CSV truncation',
    text: 'CSV export stops at 10000 rows.',
    score: 0.9,
    createdAt: '2026-10-16T00:00:00Z',
  };
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    const body = JSON.parse(String(init?.body));
    captured.push({ path: url.pathname, body });
    if (url.pathname === '/v1/embeddings')
      return Response.json({
        object: 'list',
        data: (Array.isArray(body.input) ? body.input : [body.input]).map(
          (_: unknown, index: number) => ({
            index,
            object: 'embedding',
            embedding: [1, 0],
          }),
        ),
        model: 'text-embedding-3-small',
        usage: { prompt_tokens: 5, total_tokens: 5 },
      });
    const answer = {
      answer: 'CSV exports stop at 10000 rows.',
      abstained: false,
      citations: [{ chunkId: source.chunkId, quote: source.text }],
    };
    return Response.json({
      id: 'resp_test',
      object: 'response',
      created_at: 0,
      status: 'completed',
      model: 'gpt-4.1-mini-2025-04-14',
      output: [
        {
          type: 'message',
          id: 'msg_test',
          status: 'completed',
          role: 'assistant',
          content: [{ type: 'output_text', text: JSON.stringify(answer), annotations: [] }],
        },
      ],
      usage: { input_tokens: 100, output_tokens: 30, total_tokens: 130 },
    });
  };
  const models = openAIModels({ OPENAI_API_KEY: 'test-only-key' }, fetchImpl);
  assert.deepEqual(await models.embeddings.embedQuery('CSV question'), [1, 0]);
  const result = await models.generate(
    [source],
    parseQuestion(question),
    AbortSignal.timeout(1000),
  );
  assert.equal((result.parsed as any).abstained, false);
  assert.equal(result.usage?.total_tokens, 130);
  assert.equal(captured[0].body.dimensions, 768);
  const response = captured.find((c) => c.path === '/v1/responses')!;
  assert.equal(response.body.store, false);
  assert.equal(response.body.text.format.strict, true);
  assert.equal(response.body.text.format.schema.type, 'object');
  assert.ok(JSON.stringify(response.body.text.format.schema).includes(source.chunkId));
});

test('hosted interface offers custom questions and identifies sample scope, provider, and recorded baseline', () => {
  const html = ragView({
    benchmark: null,
    result: null,
    question: '',
    live: true,
    hosted: true,
    busy: false,
    error: '',
    releaseId: 'v2.8.0',
  });
  assert.match(html, /Live hosted inference/);
  assert.match(html, /41 included synthetic reports/);
  assert.match(html, /sent to OpenAI/);
  assert.match(html, /id="rag-form"/);
  assert.doesNotMatch(html, /Models run locally/);
});
