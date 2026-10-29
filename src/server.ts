import { createServer } from 'node:http';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Store } from './store.ts';
import { demoWorkspace } from './core/demo.ts';
import { analyze, engineeringBrief } from './core/analysis.ts';
import { importGithub } from './github.ts';
import { generateHypothesis } from './model.ts';

const MAX_BODY = 2_000_000;
export function createApp(store: Store, options = { allowModel: false }) {
  return createServer(async (req, res) => {
    const send = (code: number, body: unknown) => {
      res.writeHead(code, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(JSON.stringify(body));
    };
    const host = req.headers.host || '127.0.0.1';
    // The local app is loopback-only. Reject DNS rebinding and cross-origin writes.
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host))
      return send(403, { error: 'Local access only' });
    const url = new URL(req.url || '/', `http://${host}`);
    if (req.headers.origin && req.headers.origin !== url.origin)
      return send(403, { error: 'Cross-origin access rejected' });
    const body = async () => {
      if (!req.headers['content-type']?.startsWith('application/json'))
        throw new Error('Use application/json');
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BODY) throw new Error('Request exceeds 2 MB');
        chunks.push(chunk);
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    };
    const investigation = () => {
      const workspace = store.workspace();
      const release = workspace.releases.find((r) => r.id === url.searchParams.get('release'));
      if (!release) throw new Error('Release not found');
      return analyze(workspace.reports, release, Number(url.searchParams.get('days') || 7));
    };
    try {
      if (req.method === 'GET' && url.pathname === '/api/workspace')
        return send(200, {
          ...store.workspace(),
          mode: 'sqlite',
          modelEnabled: options.allowModel,
        });
      if (req.method === 'GET' && url.pathname === '/api/analysis')
        return send(200, investigation());
      if (req.method === 'GET' && url.pathname === '/api/audit')
        return send(200, store.db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 100').all());
      if (req.method === 'POST' && url.pathname === '/api/reports') {
        const input = await body();
        if (!Array.isArray(input)) throw new Error('Expected an array of reports');
        return send(201, store.ingest(input));
      }
      if (req.method === 'POST' && url.pathname === '/api/releases')
        return send(201, store.release(await body()));
      if (req.method === 'POST' && url.pathname.startsWith('/api/reviews/')) {
        const key = decodeURIComponent(url.pathname.slice('/api/reviews/'.length));
        if (!key || key.length > 400) throw new Error('Invalid review key');
        return send(200, store.review(key, await body()));
      }
      if (req.method === 'POST' && url.pathname === '/api/import/github') {
        const { repository, since } = await body();
        if (
          typeof repository !== 'string' ||
          !/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repository) ||
          typeof since !== 'string' ||
          !Number.isFinite(Date.parse(since))
        )
          throw new Error('Provide owner/repository and an ISO start date');
        const running = store.db
          .prepare('SELECT payload FROM jobs')
          .all()
          .some((r) => JSON.parse(r.payload as string).status === 'running');
        if (running) return send(409, { error: 'An import is already running' });
        const id = randomUUID(),
          job = {
            id,
            repository,
            since,
            status: 'running',
            imported: 0,
            error: null as string | null,
          };
        store.job(id, job);
        send(202, job);
        void importGithub(
          repository,
          since,
          (r) => store.ingest(r),
          (n) => {
            job.imported = n;
            store.job(id, job);
          },
        )
          .then((result) => store.job(id, { ...job, ...result, status: 'completed' }))
          .catch((error) => store.job(id, { ...job, status: 'failed', error: error.message }));
        return;
      }
      if (req.method === 'GET' && url.pathname.startsWith('/api/jobs/')) {
        const job = store.job(url.pathname.split('/').pop()!);
        return send(job ? 200 : 404, job || { error: 'Job not found' });
      }
      if (url.pathname === '/api/brief' || url.pathname === '/api/hypothesis') {
        const analysis = investigation(),
          cluster = analysis.clusters.find((c) => c.id === url.searchParams.get('cluster'));
        if (!cluster) throw new Error('Signal not found');
        if (req.method === 'GET' && url.pathname === '/api/brief')
          return send(200, { markdown: engineeringBrief(cluster, analysis) });
        if (req.method === 'POST' && url.pathname === '/api/hypothesis') {
          if (!options.allowModel)
            return send(409, { error: 'Model integration is not configured' });
          await body();
          return send(200, await generateHypothesis(cluster));
        }
      }
      if (url.pathname.startsWith('/api/')) return send(404, { error: 'Endpoint not found' });
      if (req.method !== 'GET' && req.method !== 'HEAD')
        return send(405, { error: 'Method not allowed' });
      const root = resolve('dist'),
        path = resolve(
          root,
          `.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`,
        );
      if (!path.startsWith(root + sep)) return send(403, { error: 'Invalid path' });
      const mime: Record<string, string> = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.json': 'application/json',
        '.svg': 'image/svg+xml',
      };
      const data = readFileSync(path);
      res.writeHead(200, {
        'Content-Type': `${mime[extname(path)] || 'application/octet-stream'}; charset=utf-8`,
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy':
          "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
      });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch (error) {
      if (!res.headersSent)
        send((error as NodeJS.ErrnoException).code === 'ENOENT' ? 404 : 400, {
          error: (error as Error).message,
        });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  mkdirSync('.data', { recursive: true });
  const store = new Store(process.env.DATABASE_PATH || '.data/releaselens.sqlite');
  if (!store.workspace().releases.length && process.env.SEED_DEMO !== 'false') {
    const demo = demoWorkspace();
    store.ingest(demo.reports);
    demo.releases.forEach((r) => store.release(r));
  }
  for (const row of store.db.prepare('SELECT id,payload FROM jobs').all()) {
    const job = JSON.parse(row.payload as string);
    if (job.status === 'running')
      store.job(row.id as string, {
        ...job,
        status: 'failed',
        error: 'Server restarted during import. Run the import again; duplicate IDs are safe.',
      });
  }
  const app = createApp(store, {
    allowModel: Boolean(process.env.TOGETHER_API_KEY && process.env.TOGETHER_MODEL),
  });
  const port = Number(process.env.PORT || 4317);
  app.listen(port, '127.0.0.1', () => console.log(`ReleaseLens ready at http://127.0.0.1:${port}`));
  process.on('SIGINT', () =>
    app.close(() => {
      store.close();
      process.exit(0);
    }),
  );
}
