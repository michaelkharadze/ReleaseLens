import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { Document } from '@langchain/core/documents';
import type { EmbeddingsInterface } from '@langchain/core/embeddings';
import { VectorStore } from '@langchain/core/vectorstores';

export const hash = (text: string) => createHash('sha256').update(text).digest('hex');
export function validateVector(vector: number[], dimensions?: number) {
  if (!Array.isArray(vector) || vector.length === 0 || vector.some(v => !Number.isFinite(v)) || (dimensions !== undefined && vector.length !== dimensions)) throw new Error('Embedding vector has invalid values or dimensions');
  if (!vector.some(v => v !== 0)) throw new Error('Embedding vector must not be zero');
}
export function cosine(a: number[], b: number[]): number {
  validateVector(a); validateVector(b, a.length);
  return a.reduce((sum, v, i) => sum + v * b[i], 0) / Math.sqrt(a.reduce((sum,v)=>sum+v*v,0) * b.reduce((sum,v)=>sum+v*v,0));
}

/** Exact cosine search over persistent SQLite vectors; no ANN scalability claim. */
export class SQLiteVectorStore extends VectorStore {
  declare FilterType: { scope: string };
  db: DatabaseSync;
  scope: string;
  embeddingIdentity: string;
  cacheHits = 0;
  embeddedChunks = 0;
  constructor(db: DatabaseSync, embeddings: EmbeddingsInterface, scope: string, embeddingIdentity: string) {
    super(embeddings, {}); this.db = db; this.scope = scope; this.embeddingIdentity = embeddingIdentity;
    db.exec(`CREATE TABLE IF NOT EXISTS rag_vectors(scope TEXT NOT NULL,id TEXT NOT NULL,content TEXT NOT NULL,metadata TEXT NOT NULL,vector TEXT NOT NULL,PRIMARY KEY(scope,id));
      CREATE TABLE IF NOT EXISTS rag_embedding_cache(key TEXT PRIMARY KEY,vector TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS rag_indexes(scope TEXT PRIMARY KEY,fingerprint TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS rag_runs(id TEXT PRIMARY KEY,created_at TEXT NOT NULL,payload TEXT NOT NULL);`);
  }
  _vectorstoreType() { return 'releaselens_sqlite'; }
  async addVectors(vectors: number[][], documents: Document[]): Promise<string[]> {
    if (vectors.length !== documents.length) throw new Error('Embedding count does not match chunks');
    let dimensions: number | undefined;
    for (const vector of vectors) { validateVector(vector, dimensions); dimensions ??= vector.length; }
    const ids = documents.map(d => String(d.metadata.chunkId));
    const insert = this.db.prepare('INSERT OR REPLACE INTO rag_vectors VALUES (?,?,?,?,?)');
    for (let i=0; i<documents.length; i++) insert.run(this.scope, ids[i], documents[i].pageContent, JSON.stringify(documents[i].metadata), JSON.stringify(vectors[i]));
    return ids;
  }
  async addDocuments(documents: Document[]): Promise<string[]> {
    return this.addVectors(await this.embeddings.embedDocuments(documents.map(d=>d.pageContent)), documents);
  }
  async synchronize(documents: Document[]): Promise<void> {
    if (documents.length > 5000) throw new Error('RAG index is limited to 5000 chunks per release window');
    const fingerprint = hash(JSON.stringify(documents.map(d=>[d.metadata.chunkId,d.pageContent,d.metadata])) + this.embeddingIdentity);
    const current = this.db.prepare('SELECT fingerprint FROM rag_indexes WHERE scope=?').get(this.scope);
    if (current?.fingerprint === fingerprint) { this.cacheHits = documents.length; return; }
    const cache = this.db.prepare('SELECT vector FROM rag_embedding_cache WHERE key=?');
    const pending = new Map<string, string>();
    const keys = documents.map(d=>hash(this.embeddingIdentity + '\0' + d.pageContent));
    const vectors = new Map<string, number[]>();
    documents.forEach((d,i) => { const row=cache.get(keys[i]); if (row) { vectors.set(keys[i],JSON.parse(row.vector as string)); this.cacheHits++; } else pending.set(keys[i],d.pageContent); });
    const missing = [...pending.entries()];
    // Keep embedding requests bounded, and do not hold a transaction across network calls.
    for (let offset=0;offset<missing.length;offset+=16) {
      const batch=missing.slice(offset,offset+16), output=await this.embeddings.embedDocuments(batch.map(([,text])=>text));
      if(output.length!==batch.length) throw new Error('Embedding provider returned the wrong number of vectors');
      output.forEach((v,i)=>{ validateVector(v); vectors.set(batch[i][0],v); }); this.embeddedChunks += output.length;
    }
    const ordered=keys.map(key=>vectors.get(key)!);
    if (ordered.length) ordered.forEach(v=>validateVector(v,ordered[0].length));
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('DELETE FROM rag_vectors WHERE scope=?').run(this.scope);
      await this.addVectors(ordered,documents);
      const save=this.db.prepare('INSERT OR IGNORE INTO rag_embedding_cache VALUES (?,?)');
      for(const [key] of missing) save.run(key,JSON.stringify(vectors.get(key)));
      this.db.prepare('INSERT OR REPLACE INTO rag_indexes VALUES (?,?)').run(this.scope,fingerprint);
      this.db.exec('COMMIT');
    } catch(error) { this.db.exec('ROLLBACK'); throw error; }
  }
  async similaritySearchVectorWithScore(query: number[], k: number, filter?: {scope:string}): Promise<[Document,number][]> {
    validateVector(query);
    const scope=filter?.scope ?? this.scope;
    if(scope!==this.scope) throw new Error('Retriever scope cannot be changed');
    const rows=this.db.prepare('SELECT id,content,metadata,vector FROM rag_vectors WHERE scope=? ORDER BY id').all(scope);
    const ranked=rows.map(row=> {
      const score=cosine(query,JSON.parse(row.vector as string));
      return [new Document({id:row.id as string,pageContent:row.content as string,metadata:{...JSON.parse(row.metadata as string),score}}),score] as [Document,number];
    }).sort((a,b)=>b[1]-a[1]||String(a[0].id).localeCompare(String(b[0].id)));
    // Repeated support text must not consume the complete context budget.
    const seen=new Set<string>(), result:[Document,number][]=[];
    for(const candidate of ranked) {
      const key=hash(candidate[0].pageContent); if(seen.has(key))continue;
      seen.add(key); result.push(candidate); if(result.length>=k)break;
    }
    return result;
  }
}
