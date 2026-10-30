import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { LocalD1 } from './local-d1.ts';
import type { RagResult } from '../src/rag/grounding.ts';

if (!process.env.OPENAI_API_KEY)
  throw new Error('Complete secure OpenAI Developers key setup before live hosted evaluation.');
await mkdir('.data', { recursive: true });
const db = new LocalD1('.data/hosted-evaluation.sqlite');
const modulePath = new URL('../dist/server/index.js', import.meta.url).href;
const { default: worker } = await import(modulePath);
const env = { DB: db, OPENAI_API_KEY: process.env.OPENAI_API_KEY };
type Case = {
  id: string;
  question: string;
  expectedSourceIds: string[];
  expectedPattern?: string;
  expectAbstention?: boolean;
  adversarial?: boolean;
};
const cases = (JSON.parse(await readFile('evaluation/rag-cases.json', 'utf8')) as Case[]).filter(
  (item) => !item.adversarial,
);
const outputs = [];
try {
  for (const item of cases) {
    const response = await worker.fetch(
      new Request('https://evaluation.test/api/rag/ask', {
        method: 'POST',
        headers: {
          origin: 'https://evaluation.test',
          'content-type': 'application/json',
          'cf-connecting-ip': `evaluation-${item.id}`,
        },
        body: JSON.stringify({ question: item.question, releaseId: 'v2.8.0', windowDays: 7, k: 4 }),
      }),
      env,
    );
    const value = await response.json();
    const result: RagResult | null = response.ok ? value : null;
    const rank =
      result?.sources.findIndex((s) => item.expectedSourceIds.includes(s.sourceId)) ?? -1;
    const integrity = Boolean(
      result &&
      (result.abstained
        ? result.citations.length === 0
        : result.citations.length > 0 &&
          result.citations.every((c) =>
            result.sources.some((s) => s.chunkId === c.chunkId && s.text.includes(c.quote)),
          )),
    );
    const pass = Boolean(
      result &&
      integrity &&
      (item.expectAbstention
        ? result.abstained
        : !result.abstained &&
          result.citations.some((c) => item.expectedSourceIds.includes(c.sourceId)) &&
          new RegExp(item.expectedPattern!, 'i').test(result.answer)),
    );
    outputs.push({
      id: item.id,
      question: item.question,
      pass,
      rank: rank < 0 ? null : rank + 1,
      citationIntegrity: integrity,
      error: response.ok ? null : value.error,
      result,
    });
    console.log(
      JSON.stringify({ id: item.id, status: response.status, pass, answer: result?.answer }),
    );
  }
} finally {
  db.close();
}
const answerable = outputs.filter(
  (o) => cases.find((c) => c.id === o.id)?.expectedSourceIds.length,
);
const result = {
  live: true,
  synthetic: true,
  heldOut: false,
  generatedAt: new Date().toISOString(),
  chatModel: 'gpt-4.1-mini-2025-04-14',
  embeddingModel: 'text-embedding-3-small',
  dimensions: 768,
  methodology:
    'Built Worker fetch interface with a local SQLite implementation of the D1 contract; real OpenAI embedding and Responses requests. Same authored development fixtures as the local benchmark, excluding the report-injection fixture because the hosted sample corpus is immutable. Does not establish deployed Workers behavior, held-out accuracy, or semantic faithfulness.',
  metrics: {
    cases: outputs.length,
    passed: outputs.filter((o) => o.pass).length,
    hitRateAt4: answerable.filter((o) => o.rank !== null).length / answerable.length,
    mrrAt4:
      answerable.reduce((sum, o) => sum + (o.rank === null ? 0 : 1 / o.rank), 0) /
      answerable.length,
  },
  cases: outputs,
};
await writeFile('evaluation/hosted-results.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result.metrics));
if (result.metrics.passed !== result.metrics.cases) process.exitCode = 1;
