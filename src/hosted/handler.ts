import { demoWorkspace } from '../core/demo.ts';
import { digest } from '../rag/documents.ts';
import { claimRequest, PublicError, type Database } from './db.ts';
import {
  askHosted,
  openAIModels,
  parseQuestion,
  type HostedConfig,
  type HostedDependencies,
} from './rag.ts';

function json(value: unknown, status = 200, extra: Record<string, string> = {}) {
  return Response.json(value, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra },
  });
}
async function readBody(request: Request) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))
    throw new PublicError('Use application/json.', 415);
  if (Number(request.headers.get('content-length')) > 4096)
    throw new PublicError('Request is too large.', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new PublicError('A question is required.');
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 4096) {
        await reader.cancel();
        throw new PublicError('Request is too large.', 413);
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    try {
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new PublicError('Invalid JSON.');
    }
  } finally {
    reader.releaseLock();
  }
}

export async function handleAPI(
  request: Request,
  env: HostedConfig,
  dependencies?: HostedDependencies,
): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (path === '/api/workspace' && request.method === 'GET')
    return json({
      ...demoWorkspace(),
      mode: 'browser',
      ragEnabled: Boolean(env.OPENAI_API_KEY && env.DB),
      modelEnabled: false,
      ragMode: 'hosted',
      ragUnavailable: !env.OPENAI_API_KEY
        ? 'Hosted inference is awaiting model access.'
        : undefined,
    });
  if (path !== '/api/rag/ask') return json({ error: 'Endpoint not found.' }, 404);
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405, { Allow: 'POST' });
  const origin = request.headers.get('origin');
  if (
    origin !== new URL(request.url).origin ||
    request.headers.get('sec-fetch-site') === 'cross-site'
  )
    return json({ error: 'Cross-origin requests are not allowed.' }, 403);
  try {
    const input = parseQuestion(await readBody(request));
    if (!env.OPENAI_API_KEY || !env.DB)
      throw new PublicError(
        'Live inference is temporarily unavailable. Please try again later.',
        503,
      );
    // Do not retain raw IP addresses or questions in the public demo database.
    const visitor = await digest(
      `${env.OPENAI_API_KEY}:${request.headers.get('cf-connecting-ip') || 'shared-anonymous'}`,
    );
    await claimRequest(env.DB, visitor);
    const result = await askHosted(env.DB, input, dependencies ?? openAIModels(env));
    return json(result);
  } catch (error) {
    if (error instanceof PublicError)
      return json(
        { error: error.message },
        error.status,
        error.status === 429 ? { 'Retry-After': '3600' } : {},
      );
    const id = crypto.randomUUID();
    // Only safe failure metadata. Do not log provider payloads, credentials, source text, or questions.
    console.error(
      JSON.stringify({
        event: 'hosted_rag_failed',
        id,
        errorType: error instanceof Error ? error.name : 'UnknownError',
      }),
    );
    return json(
      { error: `The model request could not be completed. Please retry shortly. Reference: ${id}` },
      502,
    );
  }
}
