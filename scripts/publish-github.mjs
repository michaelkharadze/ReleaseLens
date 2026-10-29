import { spawnSync } from 'node:child_process';

const repository = 'michaelkharadze/releaselens';
const origin = `https://github.com/${repository}.git`;
const publish = process.argv.includes('--publish');
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.error || result.status !== 0)
    throw new Error(result.error?.message || result.stderr || `${command} failed`);
  return result.stdout.trim();
}
const milestones = [
  {
    branch: 'feat/release-analysis',
    merge: 'Merge release-window analysis and source evidence',
    title: 'Add release-window analysis and source-backed signals',
    body: 'Compare unique reporting accounts in equal UTC windows around a release, group related reports, and assemble evidence-backed engineering briefs. Includes clearly labeled synthetic fixtures.\n\nValidation: seven analysis tests passed at this milestone, covering date boundaries, account deduplication, grouping determinism, and input validation.',
  },
  {
    branch: 'feat/ingestion-api',
    merge: 'Merge persistent ingestion API and review workflow',
    title: 'Persist triage data and add validated ingestion APIs',
    body: 'Add SQLite transactions, idempotent report imports, release-scoped reviews, audit events, and bounded background imports from public GitHub repositories. Add an optional Together hypothesis adapter with source-ID validation.\n\nValidation: 12 unit and HTTP integration tests passed. GitHub import behavior was tested against a controlled response; the live model path requires provider credentials.',
  },
  {
    branch: 'feat/investigation-workspace',
    merge: 'Merge interactive release investigation workspace',
    title: 'Build the investigation workspace and engineering-brief workflow',
    body: 'Add the responsive release overview, report timeline, evidence library, release switching, review notes, JSON import/export, and downloadable engineering briefs. Share the analysis core between the browser demo and local API.\n\nValidation: built the browser app and checked signal selection, generated briefs, and persisted investigation notes in the local browser. The hosted demo uses browser storage; the full local app uses SQLite.',
  },
  {
    branch: 'feat/evaluation-and-ci',
    merge: 'Merge reproducible evaluation, CI, and portfolio documentation',
    title: 'Add reproducible evaluation, TypeScript checks, and project documentation',
    body: 'Add 24 labeled synthetic report pairs, visible per-case evaluation failures, an F1 regression gate, strict TypeScript checking, and GitHub Actions. Document the architecture, limits, local setup, and measured portfolio claims.\n\nBaseline: 66.7% precision, 83.3% recall, and 74.1% F1 on the authored development set. This is not a held-out or real-customer benchmark. The documentation distinguishes working local features from the static demo and untested live-model integration.',
  },
];
const history = run('git', ['log', 'main', '--first-parent', '--reverse', '--format=%H%x09%s'])
  .split('\n')
  .map((line) => {
    const [sha, ...subject] = line.split('\t');
    return { sha, subject: subject.join('\t') };
  });
for (const stage of milestones) {
  stage.sha = history.find((commit) => commit.subject === stage.merge)?.sha;
  if (!stage.sha) throw new Error(`Missing completed milestone: ${stage.merge}`);
}
console.log(`Repository: ${repository}\nScope commit: ${history[0].sha}`);
milestones.forEach((stage, i) =>
  console.log(`PR ${i + 1}: ${stage.branch} → main (${stage.sha.slice(0, 8)})`),
);
if (!publish) {
  console.log(
    '\nDry run only. With GitHub CLI installed and authenticated, pass --publish to create the repository and publish these real stages.',
  );
  process.exit(0);
}
if (run('git', ['status', '--porcelain']))
  throw new Error('Commit or set aside local changes before publishing.');
if (run('gh', ['api', 'user', '--jq', '.login']) !== 'michaelkharadze')
  throw new Error('Authenticate GitHub CLI as michaelkharadze first.');
const repoCheck = spawnSync('gh', ['repo', 'view', repository, '--json', 'name'], {
  encoding: 'utf8',
});
if (repoCheck.status !== 0)
  run('gh', [
    'repo',
    'create',
    repository,
    '--public',
    '--description',
    'Release-aware customer regression triage with source-backed engineering briefs',
  ]);
const remotes = run('git', ['remote']).split('\n');
if (!remotes.includes('origin')) run('git', ['remote', 'add', 'origin', origin]);
else if (run('git', ['remote', 'get-url', 'origin']) !== origin)
  throw new Error(`Existing origin differs from ${origin}. Resolve it before publishing.`);
const gitAuth = ['-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential'];
const remoteLine = run('git', [...gitAuth, 'ls-remote', '--heads', 'origin', 'main']);
let remoteSha = remoteLine ? remoteLine.split(/\s/)[0] : '';
const recognized = [history[0].sha, ...milestones.map((stage) => stage.sha)];
if (remoteSha && !recognized.includes(remoteSha))
  throw new Error('Remote main is not a recognized local milestone. No history was changed.');
if (!remoteSha) {
  run('git', [...gitAuth, 'push', 'origin', `${history[0].sha}:refs/heads/main`]);
  remoteSha = history[0].sha;
}
const resumeAt = recognized.indexOf(remoteSha);
for (const stage of milestones.slice(resumeAt)) {
  run('git', [...gitAuth, 'push', 'origin', `${stage.branch}:refs/heads/${stage.branch}`]);
  const existing = JSON.parse(
    run('gh', [
      'pr',
      'list',
      '--repo',
      repository,
      '--head',
      stage.branch,
      '--state',
      'all',
      '--json',
      'number,url,state',
    ]),
  );
  let url;
  if (existing.length) url = existing[0].url;
  else
    url = run('gh', [
      'pr',
      'create',
      '--repo',
      repository,
      '--base',
      'main',
      '--head',
      stage.branch,
      '--title',
      stage.title,
      '--body',
      stage.body,
    ]);
  console.log(`Opened ${url}`);
  // Advance main with the real two-parent merge, without rewriting any timestamps or commits.
  run('git', [...gitAuth, 'push', 'origin', `${stage.sha}:refs/heads/main`]);
  const state = run('gh', ['pr', 'view', url, '--json', 'state', '--jq', '.state']);
  if (state !== 'MERGED')
    throw new Error(`Main was advanced, but ${url} has state ${state}. Inspect before continuing.`);
  console.log(`Merged ${url}`);
}
console.log(`Published https://github.com/${repository}`);
