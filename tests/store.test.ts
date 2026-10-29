import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.ts';
import { demoWorkspace } from '../src/core/demo.ts';
import { validateHypothesis } from '../src/model.ts';
import { analyze } from '../src/core/analysis.ts';
import { importGithub } from '../src/github.ts';

test('batch import is idempotent and an invalid batch writes nothing', () => {
  const store = new Store(':memory:');
  const reports = demoWorkspace().reports.slice(0, 3);
  assert.equal(store.ingest(reports).inserted, 3);
  assert.deepEqual(store.ingest(reports), { inserted: 0, duplicates: 3 });
  assert.throws(() => store.ingest([{ ...reports[0], id: 'different' }, { bad: true }]));
  assert.equal(store.workspace().reports.length, 3);
  store.close();
});
test('reviews persist with release-scoped keys', () => {
  const store = new Store(':memory:');
  store.review('v2:signal-a', { status: 'confirmed', note: 'Reproduced' });
  assert.equal(store.workspace().reviews['v2:signal-a'].status, 'confirmed');
  assert.equal(store.workspace().reviews['v1:signal-a'], undefined);
  store.close();
});
test('model validation rejects invented citations and accepts only supplied IDs', () => {
  const demo = demoWorkspace(),
    cluster = analyze(demo.reports, demo.releases[0]).clusters[0];
  assert.throws(() =>
    validateHypothesis(
      { hypothesis: 'Maybe token rotation', citations: ['invented'], nextStep: 'Reproduce' },
      cluster,
    ),
  );
  assert.equal(
    validateHypothesis(
      {
        hypothesis: 'Maybe token rotation',
        citations: [cluster.reports[0].id],
        nextStep: 'Reproduce',
      },
      cluster,
    ).citations.length,
    1,
  );
});
test('GitHub adapter excludes PRs and keeps source URLs', async () => {
  const rows = [
    {
      number: 1,
      title: 'Export broken',
      body: 'CSV truncates',
      user: { login: 'alice' },
      created_at: '2026-10-16T00:00:00Z',
      html_url: 'https://github.com/test/repo/issues/1',
    },
    { number: 2, pull_request: {}, created_at: '2026-10-16T00:00:00Z' },
  ];
  const collected: unknown[] = [];
  await importGithub(
    'test/repo',
    '2026-10-01T00:00:00Z',
    (r) => collected.push(...r),
    () => {},
    (async () => Response.json(rows)) as typeof fetch,
  );
  assert.equal(collected.length, 1);
  assert.match((collected[0] as any).url, /issues\/1$/);
});
