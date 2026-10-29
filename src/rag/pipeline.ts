import { randomUUID } from 'node:crypto';
import type { EmbeddingsInterface } from '@langchain/core/embeddings';
import { RunnableLambda, RunnableSequence } from '@langchain/core/runnables';
import type { Store } from '../store.ts';
import { SQLiteVectorStore, hash } from './vector-store.ts';
import { releaseDocuments } from './documents.ts';
import {
  prompt,
  validateAnswer,
  missingRequestedFact,
  type ModelAnswer,
  type Source,
  type Generated,
  type Generator,
  type RagResult,
} from './grounding.ts';
export { releaseDocuments } from './documents.ts';
export {
  AnswerSchema,
  constrainedAnswerSchema,
  validateAnswer,
  missingRequestedFact,
  type ModelAnswer,
  type Source,
  type Generated,
  type Generator,
  type RagResult,
} from './grounding.ts';

export class RagService {
  store: Store;
  embeddings: EmbeddingsInterface;
  embeddingIdentity: string;
  generate: Generator;
  minimumScore: number;
  timeoutMs: number;
  resolveEmbeddingIdentity?: () => Promise<string>;
  private pending = Promise.resolve();
  constructor(input: {
    store: Store;
    embeddings: EmbeddingsInterface;
    embeddingIdentity: string;
    generate: Generator;
    minimumScore?: number;
    timeoutMs?: number;
    resolveEmbeddingIdentity?: () => Promise<string>;
  }) {
    this.store = input.store;
    this.embeddings = input.embeddings;
    this.embeddingIdentity = input.embeddingIdentity;
    this.generate = input.generate;
    this.minimumScore = input.minimumScore ?? 0.6;
    this.timeoutMs = input.timeoutMs ?? 60_000;
    this.resolveEmbeddingIdentity = input.resolveEmbeddingIdentity;
  }
  async ask(input: {
    question: string;
    releaseId: string;
    windowDays?: number;
    k?: number;
  }): Promise<RagResult> {
    if (
      typeof input.question !== 'string' ||
      !input.question.trim() ||
      input.question.length > 1000
    )
      throw new Error('Question must contain 1–1000 characters');
    if (input.k !== undefined && (!Number.isInteger(input.k) || input.k < 1 || input.k > 8))
      throw new Error('Retrieve between 1 and 8 chunks');
    // Serialize index updates and local inference; avoid overlapping SQLite transactions.
    const before = this.pending;
    let release!: () => void;
    this.pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    await before;
    try {
      return await this.execute(input);
    } finally {
      release();
    }
  }
  private async execute(input: {
    question: string;
    releaseId: string;
    windowDays?: number;
    k?: number;
  }): Promise<RagResult> {
    const start = performance.now(),
      runId = randomUUID(),
      windowDays = input.windowDays ?? 7;
    const workspace = this.store.workspace(),
      release = workspace.releases.find((r) => r.id === input.releaseId);
    if (!release) throw new Error('Release not found');
    const embeddingIdentity = (await this.resolveEmbeddingIdentity?.()) ?? this.embeddingIdentity;
    const scope = hash(`${input.releaseId}\0${windowDays}\0${embeddingIdentity}`);
    const vectorStore = new SQLiteVectorStore(
      this.store.db,
      this.embeddings,
      scope,
      embeddingIdentity,
    );
    await vectorStore.synchronize(await releaseDocuments(workspace, input.releaseId, windowDays));
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let sources: Source[] = [],
      retrievalMs = 0,
      generationMs = 0,
      generated: Generated | undefined;
    let groundingDecision: Generated['answerability'];
    try {
      const retriever = vectorStore.asRetriever({ k: input.k ?? 4, filter: { scope } });
      const retrieve = RunnableLambda.from(async (question: string) => {
        const documents = await retriever.invoke(question, { signal: controller.signal });
        let characters = 0;
        sources = documents
          .filter((d) => Number(d.metadata.score) >= this.minimumScore)
          .filter((d) => {
            characters += d.pageContent.length;
            return characters <= 6000;
          })
          .map((d) => ({
            chunkId: String(d.metadata.chunkId),
            sourceId: String(d.metadata.sourceId),
            kind: d.metadata.kind,
            title: d.metadata.title,
            text: d.pageContent,
            score: d.metadata.score,
            createdAt: d.metadata.createdAt,
            ...(d.metadata.url ? { url: d.metadata.url } : {}),
          }));
        retrievalMs = performance.now() - start;
        return sources;
      });
      const generate = RunnableLambda.from(async (evidence: Source[]) => {
        if (!evidence.length)
          return {
            answer: 'The retrieved evidence is insufficient to answer this question.',
            abstained: true,
            citations: [],
          } as ModelAnswer;
        const missing = missingRequestedFact(input.question, evidence);
        if (missing) {
          groundingDecision = { answerable: false, reason: missing };
          return {
            answer: 'The retrieved evidence is insufficient to answer this question.',
            abstained: true,
            citations: [],
          } as ModelAnswer;
        }
        const generationStart = performance.now();
        const messages = await prompt.formatMessages({
          question: input.question,
          release: release.name,
          context: JSON.stringify(evidence.map(({ score, createdAt, url, ...s }) => s)),
        });
        generated = await this.generate(messages, controller.signal, evidence);
        generationMs = performance.now() - generationStart;
        if (generated.parsed === null) throw new Error('Model returned invalid structured output');
        return validateAnswer(generated.parsed, evidence);
      });
      const chain = RunnableSequence.from([retrieve, generate]);
      const answer = await chain.invoke(input.question.trim(), {
        signal: controller.signal,
        tags: ['releaselens', 'rag'],
        metadata: { releaseId: input.releaseId, runId },
      });
      const result: RagResult = {
        ...answer,
        citations: answer.citations.map((c) => ({
          ...c,
          sourceId: sources.find((s) => s.chunkId === c.chunkId)!.sourceId,
        })),
        sources,
        trace: {
          runId,
          embeddingModel: embeddingIdentity,
          chatModel: generated?.model ?? null,
          embeddedChunks: vectorStore.embeddedChunks,
          cacheHits: vectorStore.cacheHits,
          retrievalMs,
          generationMs,
          totalMs: performance.now() - start,
          usage: generated?.usage ?? null,
          ...((generated?.answerability ?? groundingDecision)
            ? { answerability: generated?.answerability ?? groundingDecision }
            : {}),
        },
        note: 'Retrieved IDs and verbatim quotations validated. Semantic faithfulness and suspected causes still require human review.',
      };
      this.store.db
        .prepare('INSERT INTO rag_runs VALUES (?,?,?)')
        .run(
          runId,
          new Date().toISOString(),
          JSON.stringify({ releaseId: input.releaseId, question: input.question, ...result }),
        );
      this.store.audit('rag:answer', runId);
      return result;
    } finally {
      clearTimeout(timer);
    }
  }
}
