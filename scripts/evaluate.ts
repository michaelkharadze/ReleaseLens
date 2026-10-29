import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { GROUP_THRESHOLD, groupReports, similarity } from '../src/core/analysis.ts';

const raw = await readFile(new URL('../evaluation/pairs.json', import.meta.url), 'utf8');
const pairs = JSON.parse(raw) as { label: string; left: string; right: string; same: boolean }[];
const started = performance.now();
const cases = pairs.map((p) => {
  const reports = [p.left, p.right].map((text, i) => ({
    id: String(i),
    title: text,
    body: text,
    account: String(i),
    source: 'support' as const,
    createdAt: '2026-10-15T00:00:00Z',
  }));
  const predicted = groupReports(reports).length === 1;
  return { ...p, score: similarity(p.left, p.right), predicted, correct: predicted === p.same };
});
const latencyMs = performance.now() - started;
const tp = cases.filter((c) => c.same && c.predicted).length;
const fp = cases.filter((c) => !c.same && c.predicted).length;
const fn = cases.filter((c) => c.same && !c.predicted).length;
const precision = tp / (tp + fp || 1),
  recall = tp / (tp + fn || 1),
  f1 = (2 * precision * recall) / (precision + recall || 1);
const results = {
  dataset: 'authored-development-pairs-v1',
  datasetSha256: createHash('sha256').update(raw).digest('hex'),
  pairs: pairs.length,
  threshold: GROUP_THRESHOLD,
  precision,
  recall,
  f1,
  falsePositives: fp,
  falseNegatives: fn,
  latencyMs,
  node: process.version,
  platform: process.platform,
  synthetic: true,
  heldOut: false,
  modelCalls: 0,
  cases,
};
await writeFile(
  new URL('../evaluation/results.json', import.meta.url),
  JSON.stringify(results, null, 2) + '\n',
);
console.log(
  JSON.stringify(
    {
      pairs: pairs.length,
      precision,
      recall,
      f1,
      falsePositives: fp,
      falseNegatives: fn,
      latencyMs,
    },
    null,
    2,
  ),
);
// A modest development regression gate, not a production-quality assertion.
if (f1 < 0.65) {
  console.error('Pairwise F1 fell below the documented 0.65 baseline gate.');
  process.exitCode = 1;
}
