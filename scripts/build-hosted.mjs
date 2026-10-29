import { build } from 'esbuild';
import { readdir, readFile, writeFile, mkdir, cp, rm } from 'node:fs/promises';
import { extname } from 'node:path';
import './build.mjs';

const assets = {};
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};
async function collect(directory, prefix = '') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = `${prefix}/${entry.name}`,
      path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await collect(path, relative);
    else {
      const type = types[extname(entry.name)];
      if (!type) throw new Error(`Unrecognized public asset type: ${entry.name}`);
      assets[relative] = { content: await readFile(path, 'utf8'), type };
    }
  }
}
await collect('dist');
await rm('dist', { recursive: true, force: true });
await mkdir('dist/server', { recursive: true });
await mkdir('dist/.openai', { recursive: true });
const manifest = JSON.parse(await readFile('.openai/hosting.json', 'utf8'));
if (manifest.static) throw new Error('Hosted Worker manifest must omit static');
await cp('.openai/hosting.json', 'dist/.openai/hosting.json');
await cp('drizzle', 'dist/drizzle', { recursive: true });
await build({
  entryPoints: ['src/hosted/worker.ts'],
  outfile: 'dist/server/index.js',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  conditions: ['workerd', 'worker', 'browser'],
  external: ['node:*'],
  minify: true,
  plugins: [
    {
      name: 'embedded-public-assets',
      setup(build) {
        build.onResolve({ filter: /^releaselens:assets$/ }, () => ({
          path: 'assets',
          namespace: 'embedded',
        }));
        build.onLoad({ filter: /.*/, namespace: 'embedded' }, () => ({
          contents: `export default ${JSON.stringify(assets)};`,
          loader: 'js',
        }));
      },
    },
  ],
});
const worker = await import(new URL('../dist/server/index.js', import.meta.url));
if (typeof worker.default?.fetch !== 'function')
  throw new Error('Worker must export default.fetch');
const response = await worker.default.fetch(new Request('https://example.com/'), {});
if (response.status !== 200 || !(await response.text()).includes('ReleaseLens'))
  throw new Error('Worker did not preserve the app');
console.log(
  `Built and validated Worker with ${Object.keys(assets).length} embedded assets and D1 migrations.`,
);
