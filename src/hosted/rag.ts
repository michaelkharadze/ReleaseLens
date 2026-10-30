import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai';
import { isAIMessage } from '@langchain/core/messages';
import { RunnableLambda, RunnableSequence } from '@langchain/core/runnables';
import type { EmbeddingsInterface } from '@langchain/core/embeddings';
import { demoWorkspace } from '../core/demo.ts';
import { releaseDocuments } from '../rag/documents.ts';
import {
  constrainedAnswerSchema,
  missingRequestedFact,
  prompt,
  validateAnswer,
  type Generated,
  type RagResult,
  type Source,
} from '../rag/grounding.ts';
import { z } from 'zod';
import { HostedVectorStore } from './vector-store.ts';
import { PublicError, type Database } from './db.ts';

export type HostedConfig = { OPENAI_API_KEY?: string; OPENAI_CHAT_MODEL?: string; DB?: Database };
export type Question = { question: string; releaseId: string; windowDays: number; k: number };
export function parseQuestion(value: unknown): Question {
  const parsed = z
    .object({
      question: z.string().trim().min(1).max(1000),
      releaseId: z.enum(['v2.8.0', 'v2.7.0']),
      windowDays: z.union([z.literal(3), z.literal(7), z.literal(14), z.literal(30)]).default(7),
      k: z.number().int().min(1).max(4).default(4),
    })
    .strict()
    .safeParse(value);
  if (!parsed.success)
    throw new PublicError('Enter a question of 1–1,000 characters about an included release.');
  return parsed.data;
}

// Responses requires an object at the schema root. Each citation is still constrained to
// an actual retrieved chunk and its verbatim excerpts; independent validation follows.
export function hostedAnswerSchema(sources: Source[]) {
  const schema = z.toJSONSchema(constrainedAnswerSchema(sources)) as any;
  const citation = schema.anyOf[1].properties.citations.items;
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      answer: { type: 'string' },
      abstained: { type: 'boolean' },
      citations: { type: 'array', items: citation, maxItems: 2 },
    },
    required: ['answer', 'abstained', 'citations'],
  };
}
export type HostedDependencies = {
  embeddings: EmbeddingsInterface;
  generate: (sources: Source[], question: Question, signal: AbortSignal) => Promise<Generated>;
  embeddingIdentity: string;
};
export function openAIModels(
  config: HostedConfig,
  fetchImpl: typeof fetch = fetch,
): HostedDependencies {
  const modelName = config.OPENAI_CHAT_MODEL || 'gpt-4.1-mini-2025-04-14';
  const model = new ChatOpenAI({
    apiKey: config.OPENAI_API_KEY,
    model: modelName,
    useResponsesApi: true,
    temperature: 0,
    maxTokens: 600,
    maxRetries: 0,
    timeout: 25_000,
    configuration: { fetch: fetchImpl },
    modelKwargs: { store: false },
  });
  return {
    embeddingIdentity: 'openai:text-embedding-3-small:768:v1',
    embeddings: new OpenAIEmbeddings({
      apiKey: config.OPENAI_API_KEY,
      model: 'text-embedding-3-small',
      dimensions: 768,
      batchSize: 64,
      maxRetries: 0,
      timeout: 20_000,
      configuration: { fetch: fetchImpl },
    }),
    generate: async (sources, question, signal) => {
      const structured = model.withStructuredOutput(hostedAnswerSchema(sources), {
        name: 'release_evidence_answer',
        method: 'jsonSchema',
        strict: true,
        includeRaw: true,
      });
      const messages = await prompt.formatMessages({
        release: question.releaseId,
        question: question.question,
        context: JSON.stringify(sources.map(({ score, createdAt, url, ...s }) => s)),
      });
      const response = await structured.invoke(messages, { signal });
      if (!response.parsed) throw new Error('Invalid hosted structured output');
      return {
        parsed: response.parsed,
        model: modelName,
        usage: isAIMessage(response.raw) ? response.raw.usage_metadata : undefined,
      };
    },
  };
}

export async function askHosted(
  db: Database,
  input: Question,
  models: HostedDependencies,
): Promise<RagResult> {
  const start = performance.now();
  const vectorStore = new HostedVectorStore(
    models.embeddings,
    db,
    models.embeddingIdentity,
    input.releaseId,
  );
  await vectorStore.synchronize(
    await releaseDocuments(demoWorkspace(), input.releaseId, input.windowDays),
  );
  const retriever = vectorStore.asRetriever({ k: input.k, filter: { releaseId: input.releaseId } });
  let sources: Source[] = [],
    retrievalMs = 0,
    generationMs = 0,
    generated: Generated | undefined;
  const retrieve = RunnableLambda.from(async (question: string) => {
    const documents = await retriever.invoke(question);
    sources = documents
      .filter((d) => Number(d.metadata.score) >= 0.25)
      .map((d) => ({
        chunkId: String(d.metadata.chunkId),
        sourceId: String(d.metadata.sourceId),
        kind: d.metadata.kind,
        title: d.metadata.title,
        text: d.pageContent,
        score: Number(d.metadata.score),
        createdAt: d.metadata.createdAt,
      }));
    retrievalMs = performance.now() - start;
    return sources;
  });
  const generate = RunnableLambda.from(async (evidence: Source[]) => {
    if (!evidence.length || missingRequestedFact(input.question, evidence))
      return {
        answer: 'The retrieved evidence is insufficient to answer this question.',
        abstained: true,
        citations: [],
      };
    const then = performance.now();
    generated = await models.generate(evidence, input, AbortSignal.timeout(30_000));
    generationMs = performance.now() - then;
    return validateAnswer(generated.parsed, evidence);
  });
  const answer = await RunnableSequence.from([retrieve, generate]).invoke(input.question);
  return {
    ...answer,
    citations: answer.citations.map((c) => ({
      ...c,
      sourceId: sources.find((s) => s.chunkId === c.chunkId)!.sourceId,
    })),
    sources,
    trace: {
      runId: crypto.randomUUID(),
      embeddingModel: models.embeddingIdentity,
      chatModel: generated?.model ?? null,
      embeddedChunks: vectorStore.embeddedChunks,
      cacheHits: vectorStore.cacheHits,
      retrievalMs,
      generationMs,
      totalMs: performance.now() - start,
      usage: generated?.usage ?? null,
    },
    note: 'Live answer about the included synthetic sample corpus. Source IDs and exact quotes validated; semantic faithfulness still requires review.',
  };
}
