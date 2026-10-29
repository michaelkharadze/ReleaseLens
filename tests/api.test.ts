import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../src/server.ts';
import { Store } from '../src/store.ts';
import { demoWorkspace } from '../src/core/demo.ts';

test('HTTP workflow imports, analyzes, reviews, and rejects cross-origin writes', async () => {
  const store = new Store(':memory:'),
    demo = demoWorkspace();
  demo.releases.forEach((r) => store.release(r));
  const app = createApp(store);
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  const address = app.address() as { port: number },
    base = `http://127.0.0.1:${address.port}`;
  const post = (path: string, data: unknown, headers = {}) =>
    fetch(base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(data),
    });
  try {
    assert.equal((await post('/api/reports', demo.reports)).status, 201);
    const result = await (await fetch(base + '/api/analysis?release=v2.8.0')).json();
    assert.equal(result.clusters.length, 6);
    assert.equal(result.clusters[0].after, 9);
    assert.equal(
      (
        await post('/api/reviews/v2.8.0%3Asignal-R-101', {
          status: 'confirmed',
          note: 'Reproduced',
        })
      ).status,
      200,
    );
    assert.equal((await post('/api/reports', [], { Origin: 'https://evil.example' })).status, 403);
    assert.equal((await post('/api/reports', [{ bad: true }])).status, 400);
    assert.equal((await fetch(base + '/api/analysis?release=missing')).status, 400);
  } finally {
    await new Promise<void>((r) => app.close(() => r()));
    store.close();
  }
});
