import { VectorStore } from '@langchain/core/vectorstores';
import type { EmbeddingsInterface } from '@langchain/core/embeddings';
import { Document } from '@langchain/core/documents';
import { digest } from '../rag/documents.ts';
import type { Database } from './db.ts';

export function validVector(vector: number[], dimensions?: number) {
  if (
    !Array.isArray(vector) ||
    !vector.length ||
    vector.some((x) => !Number.isFinite(x)) ||
    (dimensions !== undefined && vector.length !== dimensions) ||
    !vector.some((x) => x !== 0)
  )
    throw new Error('Invalid hosted embedding vector');
}
export function cosine(a: number[], b: number[]) {
  validVector(a);
  validVector(b, a.length);
  let dot = 0,
    aa = 0,
    bb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  return dot / Math.sqrt(aa * bb);
}

/** Small fixed demo corpus: persistent D1 embedding cache and exact cosine retrieval. */
export class HostedVectorStore extends VectorStore {
  declare FilterType: { releaseId: string };
  rows: { document: Document; vector: number[] }[] = [];
  embeddedChunks = 0;
  cacheHits = 0;
  private db: Database;
  private identity: string;
  private releaseId: string;
  constructor(embeddings: EmbeddingsInterface, db: Database, identity: string, releaseId: string) {
    super(embeddings, {});
    this.db = db;
    this.identity = identity;
    this.releaseId = releaseId;
  }
  _vectorstoreType() {
    return 'releaselens_d1';
  }
  async addVectors(vectors: number[][], documents: Document[]) {
    if (vectors.length !== documents.length) throw new Error('Embedding count mismatch');
    vectors.forEach((v) => validVector(v, vectors[0]?.length));
    this.rows = documents.map((document, i) => ({ document, vector: vectors[i] }));
    return documents.map((d) => String(d.metadata.chunkId));
  }
  async addDocuments(documents: Document[]) {
    return this.addVectors(
      await this.embeddings.embedDocuments(documents.map((d) => d.pageContent)),
      documents,
    );
  }
  async synchronize(documents: Document[]) {
    if (documents.length > 100) throw new Error('Public corpus chunk limit exceeded');
    const keys = await Promise.all(
      documents.map((d) => digest(`${this.identity}\0${d.pageContent}`)),
    );
    const unique = [...new Set(keys)];
    if (!unique.length) return;
    const cached = await this.db
      .prepare(
        `SELECT id,vector FROM hosted_embedding_cache WHERE id IN (${unique.map(() => '?').join(',')})`,
      )
      .bind(...unique)
      .all<{ id: string; vector: string }>();
    const vectors = new Map(cached.results.map((r) => [r.id, JSON.parse(r.vector) as number[]]));
    this.cacheHits = keys.filter((key) => vectors.has(key)).length;
    const missing = unique.filter((key) => !vectors.has(key));
    if (missing.length) {
      const embedded = await this.embeddings.embedDocuments(
        missing.map((key) => documents[keys.indexOf(key)].pageContent),
      );
      if (embedded.length !== missing.length)
        throw new Error('Embedding provider returned an incomplete batch');
      embedded.forEach((v) => validVector(v, embedded[0]?.length));
      await this.db.batch(
        missing.map((key, i) =>
          this.db
            .prepare('INSERT OR IGNORE INTO hosted_embedding_cache (id,vector) VALUES (?,?)')
            .bind(key, JSON.stringify(embedded[i])),
        ),
      );
      missing.forEach((key, i) => vectors.set(key, embedded[i]));
      this.embeddedChunks = missing.length;
    }
    await this.addVectors(
      keys.map((key) => vectors.get(key)!),
      documents,
    );
  }
  async similaritySearchVectorWithScore(
    query: number[],
    k: number,
    filter?: { releaseId: string },
  ): Promise<[Document, number][]> {
    if (filter && filter.releaseId !== this.releaseId)
      throw new Error('Release scope cannot be changed');
    const ranked = this.rows
      .map(({ document, vector }) => {
        const score = cosine(query, vector);
        return [
          new Document({
            pageContent: document.pageContent,
            metadata: { ...document.metadata, score },
          }),
          score,
        ] as [Document, number];
      })
      .sort(
        (a, b) =>
          b[1] - a[1] || String(a[0].metadata.chunkId).localeCompare(String(b[0].metadata.chunkId)),
      );
    const seen = new Set<string>();
    return ranked
      .filter(([d]) => {
        if (seen.has(d.pageContent)) return false;
        seen.add(d.pageContent);
        return true;
      })
      .slice(0, k);
  }
}
