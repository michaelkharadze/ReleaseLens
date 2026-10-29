import { ChatOllama, OllamaEmbeddings } from '@langchain/ollama';
import { isAIMessage } from '@langchain/core/messages';
import type { Store } from '../store.ts';
import { constrainedAnswerSchema, RagService } from './pipeline.ts';

export function localRag(store:Store,config:{baseUrl?:string;chatModel?:string;embeddingModel?:string;timeoutMs?:number}={}) {
  const baseUrl=config.baseUrl??process.env.OLLAMA_BASE_URL??'http://127.0.0.1:11434';
  const chatModel=config.chatModel??process.env.OLLAMA_CHAT_MODEL??'qwen3:1.7b';
  const embeddingModel=config.embeddingModel??process.env.OLLAMA_EMBED_MODEL??'nomic-embed-text:v1.5';
  const url=new URL(baseUrl);
  if(url.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw new Error('Local inference must use an HTTP loopback URL');
  const timedFetch:typeof fetch=(input,init)=>fetch(input,{...init,signal:AbortSignal.any([AbortSignal.timeout(config.timeoutMs??60_000),...(init?.signal?[init.signal]:[])])});
  const rawEmbeddings=new OllamaEmbeddings({model:embeddingModel,baseUrl,fetch:timedFetch,maxRetries:1,truncate:false});
  const embeddings={embedDocuments:(texts:string[])=>rawEmbeddings.embedDocuments(texts.map(t=>embeddingModel.startsWith('nomic-embed-text')?`search_document: ${t}`:t)),embedQuery:(text:string)=>rawEmbeddings.embedQuery(embeddingModel.startsWith('nomic-embed-text')?`search_query: ${text}`:text)};
  const model=new ChatOllama({model:chatModel,baseUrl,temperature:0,think:false,numCtx:4096,numPredict:650,maxRetries:1,fetch:timedFetch});
  return new RagService({store,embeddings,embeddingIdentity:`ollama:${embeddingModel}`,resolveEmbeddingIdentity:async()=>{
    const response=await timedFetch(`${url.origin}/api/tags`);
    if(!response.ok)throw new Error(`Ollama model discovery returned ${response.status}`);
    const data=await response.json() as {models:{name:string;digest:string}[]};
    const installed=data.models.find(m=>m.name===embeddingModel);
    if(!installed?.digest)throw new Error(`Pull embedding model ${embeddingModel} before asking a question`);
    return `ollama:${embeddingModel}@${installed.digest}:prefix-v1`;
  },generate:async(messages,signal,sources)=>{
    const structured=model.withStructuredOutput(constrainedAnswerSchema(sources),{name:'release_answer',includeRaw:true});
    const response=await structured.invoke(messages,{signal});
    return {parsed:response.parsed,model:chatModel,usage:isAIMessage(response.raw)?response.raw.usage_metadata:undefined};
  },timeoutMs:config.timeoutMs});
}
