import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { mkdirSync } from 'node:fs';
import { LocalD1 } from './local-d1.ts';

mkdirSync('.data', { recursive: true });
const db = new LocalD1('.data/hosted-preview.sqlite');
const path = new URL('../dist/server/index.js', import.meta.url).href;
const { default: worker } = await import(path);
const env = {
  DB: db,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_CHAT_MODEL: process.env.OPENAI_CHAT_MODEL,
};
const server = createServer(async (req, res) => {
  try {
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers))
      if (value) headers.set(key, Array.isArray(value) ? value.join(',') : value);
    headers.set('cf-connecting-ip', req.socket.remoteAddress || '127.0.0.1');
    const request = new Request(`http://127.0.0.1:${process.env.HOSTED_PORT || 4318}${req.url}`, {
      method: req.method,
      headers,
      ...(!['GET', 'HEAD'].includes(req.method || 'GET')
        ? { body: Readable.toWeb(req) as ReadableStream, duplex: 'half' }
        : {}),
    });
    const response = await worker.fetch(request, env);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    res.writeHead(500);
    res.end('Local hosted preview failed.');
  }
});
server.listen(Number(process.env.HOSTED_PORT || 4318), '127.0.0.1', () =>
  console.log(`Hosted Worker preview: http://127.0.0.1:${process.env.HOSTED_PORT || 4318}`),
);
function stop() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
