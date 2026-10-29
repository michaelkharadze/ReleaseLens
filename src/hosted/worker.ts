import assets from 'releaselens:assets';
import { handleAPI } from './handler.ts';
import type { HostedConfig } from './rag.ts';

export default {
  async fetch(request: Request, env: HostedConfig): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path.startsWith('/api/')) return handleAPI(request, env);
    if (!['GET', 'HEAD'].includes(request.method))
      return new Response('Method not allowed', { status: 405 });
    const asset = assets[path === '/' ? '/index.html' : path];
    if (!asset) return new Response('Not found', { status: 404 });
    return new Response(request.method === 'HEAD' ? null : asset.content, {
      headers: {
        'Content-Type': asset.type,
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Content-Security-Policy':
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'",
      },
    });
  },
};
