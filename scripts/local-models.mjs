import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const action = process.argv[2] ?? 'help';
const baseUrl = process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:17433';
const runtime = resolve('.data/ollama/runtime'),
  binary = existsSync(`${runtime}/ollama`) ? `${runtime}/ollama` : 'ollama';
const models = [
  process.env.OLLAMA_CHAT_MODEL ?? 'qwen3:4b',
  process.env.OLLAMA_EMBED_MODEL ?? 'nomic-embed-text:v1.5',
];
if (action === 'setup') {
  if (existsSync(`${runtime}/ollama`)) {
    console.log(`Ollama runtime already exists: ${runtime}`);
    process.exit(0);
  }
  if (process.platform !== 'darwin')
    throw new Error(
      'Automatic runtime setup supports macOS. On Linux/Windows, install Ollama from https://ollama.com/download, then run the serve/pull commands.',
    );
  const response = await fetch(
    'https://github.com/ollama/ollama/releases/download/v0.40.13/ollama-darwin.tgz',
    { signal: AbortSignal.timeout(180000) },
  );
  if (!response.ok) throw new Error(`Official Ollama download returned ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (
    createHash('sha256').update(bytes).digest('hex') !==
    'bae29252232b9e1358cf5801a7d65a07442af18fb5467cb68c7fc3711f59c511'
  )
    throw new Error('Ollama release checksum mismatch');
  mkdirSync(runtime, { recursive: true });
  const archive = resolve('.data/ollama/runtime.tgz');
  writeFileSync(archive, bytes);
  const result = spawnSync('tar', ['-xzf', archive, '-C', runtime], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error('Ollama extraction failed');
  console.log('Installed checksum-verified Ollama 0.40.13 in ignored .data/ollama/runtime.');
} else if (action === 'serve') {
  const url = new URL(baseUrl);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
    throw new Error('Ollama must bind to a loopback address');
  const child = spawn(binary, ['serve'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      OLLAMA_HOST: url.host,
      OLLAMA_MODELS: resolve('.data/ollama/models'),
      OLLAMA_NO_CLOUD: '1',
    },
  });
  child.on('error', () => {
    console.error('Ollama is unavailable. Run npm run models:setup or install Ollama first.');
    process.exitCode = 1;
  });
  process.on('SIGINT', () => child.kill('SIGINT'));
  process.on('SIGTERM', () => child.kill('SIGTERM'));
  child.on('exit', (code) => {
    process.exitCode = code ?? 0;
  });
} else if (action === 'pull') {
  for (const model of models) {
    console.log(`Pulling ${model} from Ollama's registry…`);
    const response = await fetch(`${baseUrl}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model }),
      signal: AbortSignal.timeout(900000),
    });
    if (!response.ok) throw new Error(`Ollama pull returned ${response.status}`);
    let pending = '',
      lastStatus = '',
      lastBucket = -1;
    for await (const chunk of response.body) {
      pending += Buffer.from(chunk).toString();
      let end;
      while ((end = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, end);
        pending = pending.slice(end + 1);
        if (!line) continue;
        const item = JSON.parse(line);
        if (item.error) throw new Error(item.error);
        const bucket =
          item.total && item.completed !== undefined
            ? Math.floor((item.completed / item.total) * 4)
            : 0;
        if (item.status !== lastStatus || bucket !== lastBucket) {
          console.log(
            `${model}: ${item.status}${item.completed !== undefined ? ` ${bucket * 25}%` : ''}`,
          );
          lastStatus = item.status;
          lastBucket = bucket;
        }
      }
    }
    if (lastStatus !== 'success') throw new Error(`Ollama did not confirm ${model} download`);
  }
} else console.log('Usage: node scripts/local-models.mjs setup|serve|pull');
