import { stripTypeScriptTypes } from 'node:module';
import { mkdir, readFile, writeFile, cp, rm } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist/core', { recursive: true });
await cp('public', 'dist', { recursive: true });
for (const file of ['core/types', 'core/analysis', 'core/validation', 'core/demo', 'web/app']) {
  const source = await readFile(`src/${file}.ts`, 'utf8');
  const output = stripTypeScriptTypes(source, { mode: 'strip' }).replace(/(from\s+['"][^'"]+)\.ts(['"])/g, '$1.js$2');
  await writeFile(file === 'web/app' ? 'dist/app.js' : `dist/${file}.js`, output);
}
try { await cp('evaluation/results.json', 'dist/evaluation.json'); } catch { /* Evaluation panel offers instructions until the first run. */ }
console.log('Built browser demo in dist/ (shared analysis engine, no dependencies).');
