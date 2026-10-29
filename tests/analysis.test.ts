import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze, engineeringBrief, groupReports, similarity } from '../src/core/analysis.ts';
import { validateReport } from '../src/core/validation.ts';
import type { Report } from '../src/core/types.ts';

const release = {
  id: 'v2',
  name: 'v2',
  releasedAt: '2026-10-15T00:00:00Z',
  changes: ['Refresh token rotation for auth login sessions'],
};
const report = (
  id: string,
  account: string,
  createdAt: string,
  title = 'Refresh token login loop',
): Report => ({
  id,
  account,
  createdAt,
  title,
  body: 'Auth refresh token login loop on session expiry',
  source: 'support',
});
test('half-open release windows exclude the end and put release time after', () => {
  const result = analyze(
    [
      report('a', 'a', '2026-10-08T00:00:00Z'),
      report('b', 'b', release.releasedAt),
      report('c', 'c', '2026-10-22T00:00:00Z'),
    ],
    release,
  );
  assert.deepEqual(result.totals, { before: 1, after: 1, reports: 2, accounts: 2 });
});
test('repeated complaints from one account do not inflate impact', () => {
  const result = analyze(
    [report('a', 'same', release.releasedAt), report('b', 'same', release.releasedAt)],
    release,
  );
  assert.equal(result.clusters[0].after, 1);
  assert.equal(result.totals.reports, 2);
});
test('zero topic baselines produce finite ratios when both windows have accounts', () => {
  const unrelated = {
    ...report('b', 'b', '2026-10-14T00:00:00Z'),
    title: 'Credit card invoice',
    body: 'Payment declined',
  };
  const result = analyze([report('a', 'a', release.releasedAt), unrelated], release);
  const group = result.clusters.find((c) => c.reports.some((r) => r.id === 'a'))!;
  assert.equal(group.signal, 'new');
  assert.ok(Number.isFinite(group.lift));
  assert.match(engineeringBrief(group, result), /not causal evidence/);
  assert.match(engineeringBrief(group, result), /\[a\]/);
});
test('an empty comparison window produces insufficient data, not a misleading ratio', () => {
  const result = analyze([report('a', 'a', release.releasedAt)], release);
  assert.equal(result.clusters[0].lift, null);
  assert.equal(result.clusters[0].signal, 'insufficient');
  assert.equal(result.clusters[0].priority, 0);
  assert.match(engineeringBrief(result.clusters[0], result), /Insufficient data/);
});
test('grouping is independent of ingestion order', () => {
  const reports = [report('z', 'a', release.releasedAt), report('a', 'b', release.releasedAt)];
  assert.deepEqual(groupReports(reports), groupReports(reports.toReversed()));
});
test('different topics remain separate', () => {
  assert.ok(similarity('refresh token auth login', 'invoice payment credit card') < 0.1);
  const unrelated = {
    ...report('b', 'b', release.releasedAt),
    title: 'Invoice payment declined',
    body: 'Credit card invoice payment fails',
  };
  assert.equal(groupReports([report('a', 'a', release.releasedAt), unrelated]).length, 2);
});
test('empty input and invalid windows', () => {
  assert.equal(analyze([], release).clusters.length, 0);
  assert.throws(() => analyze([], release, 0));
  assert.throws(() => analyze([], release, 31));
});
test('validation rejects unsafe URLs and ambiguous timestamps', () => {
  assert.throws(() =>
    validateReport({ ...report('a', 'a', release.releasedAt), url: 'javascript:alert(1)' }),
  );
  assert.throws(() => validateReport(report('a', 'a', '2026-10-15')));
});
test('ingestion preserves original body whitespace and brief quotation text', () => {
  const input = {
    ...report('a', 'a', release.releasedAt),
    body: '  Original report.\nSecond line.  ',
  };
  const validated = validateReport(input);
  assert.equal(validated.body, input.body);
  const result = analyze([validated], release);
  assert.ok(
    engineeringBrief(result.clusters[0], result).includes('>   Original report.\n> Second line.  '),
  );
});
