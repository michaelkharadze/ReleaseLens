import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Document} from '@langchain/core/documents';
import {Embeddings} from '@langchain/core/embeddings';
import {Store} from '../src/store.ts';
import {SQLiteVectorStore,cosine} from '../src/rag/vector-store.ts';
import {RagService,releaseDocuments,validateAnswer,type Source,type Generator} from '../src/rag/pipeline.ts';
import type {Report} from '../src/core/types.ts';

// Contract-test vectors, never used for reported model quality metrics.
class ContractEmbeddings extends Embeddings {
  batches=0;
  constructor(){super({});}
  async embedDocuments(texts:string[]){this.batches++;return texts.map(t=>this.vector(t));}
  async embedQuery(text:string){return this.vector(text);}
  vector(text:string){return [/export|spreadsheet|rows/i.test(text)?1:0,/login|token/i.test(text)?1:0,/invoice|payment/i.test(text)?1:0,0.01];}
}
const release={id:'v2',name:'v2',releasedAt:'2026-10-15T00:00:00Z',changes:['Stream large export downloads']};
const report=(id:string,body:string,createdAt='2026-10-16T00:00:00Z'):Report=>({id,title:body.slice(0,200),body,account:id,source:'support',createdAt});
function setup(){const store=new Store(':memory:');store.release(release);store.ingest([report('csv','CSV export stops at 10000 rows.'),report('auth','Login token expires in a loop.')]);return store;}
const grounded:Generator=async messages=>{
  const text=String(messages.at(-1)!.content),sources=JSON.parse(text.split('EVIDENCE (JSON):\n')[1]) as Source[];
  return {parsed:{answer:'The export stops at 10000 rows.',abstained:false,citations:[{chunkId:sources[0].chunkId,quote:sources[0].text}]},model:'contract-test',usage:{input_tokens:40,output_tokens:20,total_tokens:60}};
};

test('LangChain splitter preserves source metadata and excludes reports outside the release window',async()=>{
 const store=setup();store.ingest([report('old','Old export bug','2026-09-01T00:00:00Z'),report('long','export '.repeat(400))]);
 const docs=await releaseDocuments(store.workspace(),'v2',7);
 assert.ok(docs.length>4);assert.ok(docs.every(d=>d.pageContent.length<=900));
 assert.ok(docs.every(d=>d.metadata.sourceId!=='old'));assert.ok(docs.some(d=>d.metadata.kind==='release_note'));
 assert.equal(new Set(docs.map(d=>d.metadata.chunkId)).size,docs.length);store.close();
});
test('SQLite vectors persist, cache unchanged content, and invalidate when content or model changes',async()=>{
 const store=setup(),embeddings=new ContractEmbeddings(),docs=[new Document({pageContent:'CSV export',metadata:{chunkId:'a'}})];
 const first=new SQLiteVectorStore(store.db,embeddings,'s','model-v1');await first.synchronize(docs);assert.equal(embeddings.batches,1);
 const cached=new SQLiteVectorStore(store.db,embeddings,'s','model-v1');await cached.synchronize(docs);assert.equal(embeddings.batches,1);assert.equal(cached.cacheHits,1);
 const changed=[new Document({pageContent:'CSV export rows',metadata:{chunkId:'b'}})];await cached.synchronize(changed);assert.equal(embeddings.batches,2);
 assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM rag_vectors WHERE scope=?').get('s')!.n,1);
 await new SQLiteVectorStore(store.db,embeddings,'s','model-v2').synchronize(changed);assert.equal(embeddings.batches,3);store.close();
});
test('retriever isolates scopes and rejects vector dimension mismatch',async()=>{
 const store=setup(),embeddings=new ContractEmbeddings();const vectors=new SQLiteVectorStore(store.db,embeddings,'a','m');
 await vectors.synchronize([new Document({pageContent:'export',metadata:{chunkId:'a'}})]);
 await assert.rejects(()=>vectors.similaritySearchVectorWithScore([1,0,0,.01],2,{scope:'b'}),/scope/);
 assert.throws(()=>cosine([1,0],[1]),/dimensions/);assert.throws(()=>cosine([0,0],[1,0]),/zero/);store.close();
});
test('failed embedding batches leave the previous committed index intact',async()=>{
 const store=setup(),embeddings=new ContractEmbeddings(),vectors=new SQLiteVectorStore(store.db,embeddings,'s','m');
 await vectors.synchronize([new Document({pageContent:'export',metadata:{chunkId:'a'}})]);
 embeddings.embedDocuments=async()=>[[Number.NaN]];
 await assert.rejects(()=>vectors.synchronize([new Document({pageContent:'login',metadata:{chunkId:'b'}})]),/invalid/);
 assert.equal(store.db.prepare('SELECT id FROM rag_vectors WHERE scope=?').get('s')!.id,'a');store.close();
});
test('real LangChain retrieval/prompt/generation chain produces validated sources and an auditable run',async()=>{
 const store=setup(),rag=new RagService({store,embeddings:new ContractEmbeddings(),embeddingIdentity:'contract-v1',generate:grounded});
 const result=await rag.ask({question:'Which export is incomplete?',releaseId:'v2'});
 assert.equal(result.abstained,false);assert.equal(result.citations[0].sourceId,'csv');assert.equal(result.trace.usage?.total_tokens,60);
 assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM rag_runs').get()!.n,1);
 const next=await rag.ask({question:'Which export is incomplete?',releaseId:'v2'});assert.equal(next.trace.embeddedChunks,0);assert.ok(next.trace.cacheHits>0);store.close();
});
test('low-relevance retrieval abstains without calling the LLM',async()=>{
 const store=setup();let calls=0;
 const rag=new RagService({store,embeddings:new ContractEmbeddings(),embeddingIdentity:'c',minimumScore:.9,generate:async()=>{calls++;throw new Error('Must not generate');}});
 const result=await rag.ask({question:'Revenue forecast for next quarter?',releaseId:'v2'});
 assert.equal(result.abstained,true);assert.equal(calls,0);assert.equal(result.trace.chatModel,null);store.close();
});
test('citation validation rejects invented chunks, fabricated quotes, and unsupported answers',()=>{
 const source:Source={chunkId:'c1',sourceId:'r1',kind:'report',title:'Export',text:'CSV export stops at 10000 rows.',score:.8,createdAt:release.releasedAt};
 const valid={answer:'Export truncates.',abstained:false,citations:[{chunkId:'c1',quote:'stops at 10000 rows'}]};
 assert.equal(validateAnswer(valid,[source]).abstained,false);
 assert.throws(()=>validateAnswer({...valid,citations:[{chunkId:'invented',quote:'stops at 10000 rows'}]},[source]),/not retrieved/);
 assert.throws(()=>validateAnswer({...valid,citations:[{chunkId:'c1',quote:'all records are deleted'}]},[source]),/verbatim/);
 assert.throws(()=>validateAnswer({...valid,citations:[]},[source]),/must cite/);
 assert.throws(()=>validateAnswer({...valid,abstained:true},[source]),/must not/);
 assert.equal(validateAnswer({answer:'Invented explanation',abstained:true,citations:[]},[source]).answer,'The retrieved evidence is insufficient to answer this question.');
});
test('provider errors and generation timeouts fail visibly and do not persist a successful run',async()=>{
 const store=setup();
 const rag=new RagService({store,embeddings:new ContractEmbeddings(),embeddingIdentity:'c',generate:async()=>{throw new Error('provider unavailable');}});
 await assert.rejects(()=>rag.ask({question:'Export rows?',releaseId:'v2'}),/provider unavailable/);
 const timed=new RagService({store,embeddings:new ContractEmbeddings(),embeddingIdentity:'c',timeoutMs:20,generate:async(_,signal)=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new Error('generation aborted')),{once:true}))});
 await assert.rejects(()=>timed.ask({question:'Export rows?',releaseId:'v2'}),/aborted/);
 assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM rag_runs').get()!.n,0);store.close();
});
test('RAG rejects malformed requests and handles concurrent questions without nested transactions',async()=>{
 const store=setup(),rag=new RagService({store,embeddings:new ContractEmbeddings(),embeddingIdentity:'c',generate:grounded});
 await assert.rejects(()=>rag.ask({question:'',releaseId:'v2'}));await assert.rejects(()=>rag.ask({question:'export',releaseId:'missing'}));
 const results=await Promise.all([rag.ask({question:'export',releaseId:'v2'}),rag.ask({question:'export',releaseId:'v2'})]);
 assert.equal(results.length,2);assert.equal(results[1].trace.embeddedChunks,0);store.close();
});
