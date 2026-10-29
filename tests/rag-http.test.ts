import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { Store } from '../src/store.ts';
import { createApp } from '../src/server.ts';
import { localRag } from '../src/rag/local-models.ts';

test('LangChain Ollama transport and RAG HTTP endpoint embed, generate, validate, trace, and surface malformed citations', async () => {
  const requests: { path: string; body: any }[] = [];
  let bad = false;
  const provider = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    requests.push({ path: req.url!, body });
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/tags') {
      res.end(
        JSON.stringify({
          models: [{ name: 'nomic-embed-text:v1.5', digest: 'test-embedding-revision' }],
        }),
      );
      return;
    }
    if (req.url === '/api/embed') {
      res.end(
        JSON.stringify({ model: body.model, embeddings: body.input.map(() => [1, 0, 0.01]) }),
      );
      return;
    }
    if (req.url === '/api/chat') {
      const human = body.messages.find((m: any) => m.role === 'user').content as string;
      const sources = JSON.parse(human.split('EVIDENCE (JSON):\n')[1]);
      const source = sources[0];
      const output = {
        answer: 'The CSV export truncates.',
        abstained: false,
        citations: [
          { chunkId: bad ? 'invented' : source.chunkId, quote: source.text.split('\n')[0] },
        ],
      };
      res.setHeader('Content-Type', 'application/x-ndjson');
      res.end(
        JSON.stringify({
          model: body.model,
          created_at: new Date().toISOString(),
          message: { role: 'assistant', content: JSON.stringify(output) },
          done: true,
          done_reason: 'stop',
          prompt_eval_count: 100,
          eval_count: 35,
        }) + '\n',
      );
      return;
    }
    res.writeHead(404);
    res.end('{}');
  });
  provider.listen(0, '127.0.0.1');
  await once(provider, 'listening');
  const store = new Store(':memory:');
  store.release({ id: 'v2', name: 'v2', releasedAt: '2026-10-15T00:00:00Z', changes: [] });
  store.ingest([
    {
      id: 'r1',
      title: 'CSV export truncated',
      body: 'CSV export stops at 10000 rows.',
      source: 'support',
      account: 'a',
      createdAt: '2026-10-16T00:00:00Z',
    },
  ]);
  const baseUrl = `http://127.0.0.1:${(provider.address() as { port: number }).port}`;
  const app = createApp(store, { rag: localRag(store, { baseUrl, timeoutMs: 3000 }) });
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  const root = `http://127.0.0.1:${(app.address() as { port: number }).port}`;
  const ask = () =>
    fetch(root + '/api/rag/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'What is wrong with the CSV export?', releaseId: 'v2' }),
    });
  try {
    const response = await ask();
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.citations[0].sourceId, 'r1');
    assert.equal(result.trace.usage.total_tokens, 135);
    assert.ok(
      requests.some(
        (r) =>
          r.path === '/api/embed' &&
          r.body.input.some((t: string) => t.startsWith('search_document:')),
      ),
    );
    assert.ok(
      requests.some(
        (r) =>
          r.path === '/api/embed' &&
          r.body.input.some((t: string) => t.startsWith('search_query:')),
      ),
    );
    const chat = requests.find((r) => r.path === '/api/chat')!;
    assert.ok(chat.body.format.anyOf);
    assert.equal(chat.body.think, false);
    assert.equal((await (await fetch(root + '/api/rag/runs')).json()).length, 1);
    bad = true;
    const rejected = await ask();
    assert.equal(rejected.status, 400);
    assert.match((await rejected.json()).error, /invalid structured output/);
    assert.equal((await (await fetch(root + '/api/rag/runs')).json()).length, 1);
  } finally {
    await new Promise<void>((resolve) => app.close(() => resolve()));
    await new Promise<void>((resolve) => provider.close(() => resolve()));
    store.close();
  }
});

test('RAG HTTP endpoint reports disabled inference without calling a provider', async () => {
  const store = new Store(':memory:'),
    app = createApp(store);
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  try {
    const response = await fetch(
      `http://127.0.0.1:${(app.address() as { port: number }).port}/api/rag/ask`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: 'Export?', releaseId: 'v2' }),
      },
    );
    assert.equal(response.status, 409);
  } finally {
    await new Promise<void>((resolve) => app.close(() => resolve()));
    store.close();
  }
});
