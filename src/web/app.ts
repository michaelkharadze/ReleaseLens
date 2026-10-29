import { analyze, engineeringBrief } from '../core/analysis.ts';
import { demoWorkspace } from '../core/demo.ts';
import { validateReport, validateRelease } from '../core/validation.ts';
import type { Analysis, Cluster, Workspace } from '../core/types.ts';

const root = document.querySelector('#app')!;
const modal = document.querySelector<HTMLDialogElement>('#modal')!;
let workspace: Workspace = demoWorkspace();
let mode = 'browser',
  modelEnabled = false,
  page = 'signals',
  releaseId = 'v2.8.0',
  days = 7,
  selected = '',
  query = '';
let evaluation: any = null;
let evidenceFilter: Set<string> | null = null;
const KEY = 'releaselens.workspace.v1';
const escape = (value: unknown) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
const formatLift = (value: number | null) => (value === null ? '—' : `${value.toFixed(1)}×`);
const date = (value: string) =>
  new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const icon = (name: string) => {
  const paths: Record<string, string> = {
    signal: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
    reports: '<path d="M5 3h14v18H5zM9 8h6M9 12h6M9 16h3"/>',
    release: '<path d="m12 3 8 5v8l-8 5-8-5V8zM4 8l8 5 8-5M12 13v8"/>',
    eval: '<path d="M5 20V10M12 20V4M19 20v-7M2 20h20"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    arrow: '<path d="M7 17 17 7M7 7h10v10"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
    search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    people:
      '<circle cx="9" cy="7" r="3"/><path d="M3 20v-3a6 6 0 0 1 12 0v3M17 4a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 5"/>',
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.signal}</svg>`;
};
let toastTimer: ReturnType<typeof setTimeout>;
function toast(message: string) {
  const el = document.querySelector('#toast')!;
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 4500);
}
function persist() {
  if (mode === 'browser') {
    try {
      localStorage.setItem(KEY, JSON.stringify(workspace));
    } catch {
      toast('Browser storage is full. Export your workspace to keep changes.');
    }
  }
}
function download(name: string, content: string, type = 'text/markdown') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
async function api(path: string, data?: unknown) {
  const response = await fetch(
    path,
    data === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        },
  );
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Request failed');
  return result;
}
function current(): Analysis {
  return analyze(
    workspace.reports,
    workspace.releases.find((r) => r.id === releaseId) || workspace.releases[0],
    days,
  );
}
function reviewKey(cluster: Cluster) {
  return `${releaseId}:${cluster.id}`;
}
const names: Record<string, string> = {
  signals: 'Release overview',
  evidence: 'Evidence library',
  releases: 'Releases',
  evaluation: 'Evaluation lab',
};

function chart(analysis: Analysis) {
  const points = analysis.timeline,
    max = Math.max(4, ...points.map((p) => p.reports));
  const left = 28,
    top = 12,
    height = 105,
    width = 880,
    step = width / points.length,
    boundary = left + step * days;
  return `<svg class="chart" viewBox="0 0 940 160" role="img" aria-label="Daily report counts before and after the selected release">
    <rect x="${boundary}" y="${top}" width="${width / 2}" height="${height}" fill="#f5f8f0"/>
    ${[0, 0.5, 1].map((v) => `<line x1="${left}" y1="${top + height * v}" x2="${left + width}" y2="${top + height * v}" stroke="#e9ede3" stroke-dasharray="3 4"/><text x="15" y="${top + height * v + 3}" font-size="8" fill="#a0aa95" text-anchor="end">${Math.round(max * (1 - v))}</text>`).join('')}
    ${points.map((p, i) => `<rect x="${left + step * i + step * 0.28}" y="${top + height - (p.reports / max) * height}" width="${step * 0.44}" height="${(p.reports / max) * height}" rx="3" fill="${p.phase === 'before' ? '#c9d4bb' : '#54785b'}"><title>${date(p.date)}: ${p.reports} reports</title></rect>${points.length <= 14 || i % 3 === 0 ? `<text x="${left + step * (i + 0.5)}" y="140" fill="#95a088" font-size="8" text-anchor="middle">${date(p.date)}</text>` : ''}`).join('')}
    <line x1="${boundary}" y1="4" x2="${boundary}" y2="125" stroke="#a4b58c" stroke-dasharray="3 3"/>
    <rect x="${boundary - 30}" y="0" width="60" height="17" rx="4" fill="#e4ecd8"/><text x="${boundary}" y="11" fill="#6d8456" font-size="8" text-anchor="middle">${escape(analysis.release.name)} shipped</text>
  </svg>`;
}
function metric(label: string, value: unknown, bottom: string, symbol: string) {
  return `<div class="metric"><div class="metric-top"><span>${label}</span>${icon(symbol)}</div><div class="metric-value">${escape(value)}</div><div class="metric-bottom">${bottom}</div></div>`;
}
function detail(cluster: Cluster, analysis: Analysis) {
  const review = workspace.reviews[reviewKey(cluster)];
  return `<section class="detail" aria-label="Selected signal details"><div class="detail-top"><div class="detail-label">SIGNAL / ${escape(cluster.reports[0].id)}</div><h3>${escape(cluster.title)}</h3><div class="detail-chips"><span class="chip warm">${cluster.lift === null ? 'Insufficient data' : formatLift(cluster.lift) + ' frequency'}</span><span class="chip">${cluster.after} reporting accounts after</span></div></div><div class="detail-body"><div class="section-label">Related release change</div><div class="change">${escape(cluster.change || 'No matching change in these release notes. Investigate independently.')}<br><span class="method">${cluster.change ? 'Lexical match · a hypothesis to verify' : 'No inferred cause'}</span></div><div class="section-label">What customers reported</div>${cluster.reports
    .slice(-2)
    .map(
      (r) =>
        `<div class="quote"><p>“${escape(r.body)}”</p><small>${escape(r.account)} · ${date(r.createdAt)} · [${escape(r.id)}]</small>${r.url ? `<br><a href="${escape(r.url)}" target="_blank" rel="noopener noreferrer">Open original report ↗</a>` : ''}</div>`,
    )
    .join(
      '',
    )}<button class="mini-link" data-action="all-evidence">View all ${cluster.reports.length} source reports →</button><p class="detail-note">${(cluster.beforeShare * 100).toFixed(1)}% → ${(cluster.afterShare * 100).toFixed(1)}% of reporting accounts. ${cluster.lift === null ? 'Both windows need reporting accounts before comparing frequencies.' : 'Timing is a signal; it does not establish a cause.'}</p><div class="section-label">Investigation note</div><textarea class="review-note" id="review-note" aria-label="Investigation note" placeholder="Reproduction steps, affected setup, next check…">${escape(review?.note || '')}</textarea><div class="detail-actions"><button class="button" data-action="review">${icon('check')}${review ? 'Update review' : 'Review signal'}</button><button class="button primary" data-action="brief">${icon('reports')}Draft brief</button></div>${modelEnabled ? '<button class="mini-link all-evidence" data-action="hypothesis">Generate an AI hypothesis →</button>' : ''}</div></section>`;
}
function signals(analysis: Analysis) {
  const active = analysis.clusters.filter((c) => c.signal === 'new' || c.signal === 'rising');
  const visible = analysis.clusters.filter((c) =>
    `${c.title} ${c.reports.map((r) => r.body).join(' ')}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  if (!visible.some((c) => c.id === selected)) selected = visible[0]?.id || '';
  const cluster = visible.find((c) => c.id === selected);
  return `<div class="release-strip"><div class="release-left"><div class="release-icon">${icon('release')}</div><div><strong>A closer look at ${escape(analysis.release.name)}</strong><small>Shipped ${date(analysis.release.releasedAt)} · equal windows before and after release</small></div></div><div class="release-controls"><label for="release-select">Investigating</label><select id="release-select" aria-label="Select release">${workspace.releases.map((r) => `<option ${r.id === releaseId ? 'selected' : ''} value="${escape(r.id)}">${escape(r.name)}</option>`).join('')}</select><select id="days-select" aria-label="Comparison window">${[3, 7, 14, 30].map((d) => `<option value="${d}" ${d === days ? 'selected' : ''}>${d} day window</option>`).join('')}</select></div></div>
    <div class="metrics">${metric('Reports analyzed', analysis.totals.reports, `${analysis.totals.before} before · ${analysis.totals.after} after reporting accounts`, 'reports')}${metric('Regression signals', active.length, '<b>New or rising</b> topics to investigate', 'signal')}${metric('Reporting accounts', analysis.totals.accounts, 'Unique accounts across both windows', 'people')}${metric('Reviewed signals', analysis.clusters.filter((c) => workspace.reviews[reviewKey(c)]).length, `${analysis.clusters.length} grouped topics in this release`, 'check')}</div>
    <section class="chart-card"><div class="card-heading"><div><h2>The release, in context</h2><p>Report volume across the comparison window</p></div><div class="legend"><span><i></i>Before release</span><span><i></i>After release</span></div></div>${chart(analysis)}</section>
    <div class="investigation-heading"><h2>Your investigation queue <small>${analysis.clusters.length} signals · sorted by priority</small></h2><label class="search">${icon('search')}<input id="search" value="${escape(query)}" aria-label="Search signals" placeholder="Search signals…  /"></label></div>
    <div class="investigation"><div class="signal-list"><div class="table-head"><span>Signal</span><span>Before</span><span>After</span><span>Change</span></div>${visible.length ? visible.map((c) => `<button class="signal-row ${c.id === selected ? 'selected' : ''}" data-signal="${escape(c.id)}" aria-pressed="${c.id === selected}"><span><span class="signal-title">${escape(c.title)}</span><span class="signal-meta"><i class="signal-status ${escape(workspace.reviews[reviewKey(c)]?.status || '')}"></i>${escape(workspace.reviews[reviewKey(c)]?.status || (c.signal === 'rising' || c.signal === 'new' ? 'Needs investigation' : c.signal === 'insufficient' ? 'Insufficient data' : 'Monitoring'))}<span>·</span>${c.reports.length} source reports</span></span><span class="num">${c.before}</span><span class="num">${c.after}</span><span><span class="lift ${c.lift === null || c.lift < 1.5 ? 'cool' : ''}">${formatLift(c.lift)} ${c.lift === null ? '' : c.lift >= 1 ? '↗' : '↘'}</span></span></button>`).join('') : '<div class="empty">No signals match your search.</div>'}<div class="table-bottom"><span>${visible.length} of ${analysis.clusters.length} signals</span><span>Unique accounts · smoothed ratio</span></div></div>${cluster ? detail(cluster, analysis) : '<section class="detail empty">Select a signal to inspect its evidence.</section>'}</div>`;
}
function evidencePage() {
  const reports = [...workspace.reports]
    .filter(
      (r) =>
        (!evidenceFilter || evidenceFilter.has(r.id)) &&
        `${r.title} ${r.body} ${r.account}`.toLowerCase().includes(query.toLowerCase()),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return `<div class="investigation-heading"><h2>${reports.length} original reports</h2><label class="search">${icon('search')}<input id="search" value="${escape(query)}" aria-label="Search reports" placeholder="Search reports…"></label></div><div class="evidence-grid">${reports.map((r) => `<article class="evidence-card"><span class="source-pill">${escape(r.source)}</span><small> &nbsp; ${escape(r.id)} · ${date(r.createdAt)}</small><h3>${escape(r.title)}</h3><p>${escape(r.body)}</p><small>${escape(r.account)}${r.url ? ` · <a href="${escape(r.url)}" target="_blank" rel="noopener noreferrer">Original source ↗</a>` : ''}</small></article>`).join('') || '<div class="empty">No reports found. Import a JSON file to get started.</div>'}</div>`;
}
function releasePage() {
  return workspace.releases
    .map(
      (r) =>
        `<section class="full-card"><div class="card-heading"><div><div class="eyebrow">${date(r.releasedAt)} · ${escape(r.releasedAt.slice(11, 16))} UTC</div><h2>${escape(r.name)}</h2></div><button class="button" data-release="${escape(r.id)}">Investigate release ${icon('arrow')}</button></div><ul class="release-notes">${r.changes.map((c) => `<li>${escape(c)}</li>`).join('')}</ul></section>`,
    )
    .join('');
}
function evalPage() {
  if (!evaluation)
    return '<section class="full-card"><h2>Run the reproducible benchmark</h2><p>From the repository, run <code>npm run eval && npm run build</code>. The results will appear here after a reload.</p></section>';
  return `<div class="eval-grid">${metric('Pairwise precision', `${(evaluation.precision * 100).toFixed(1)}%`, 'Predicted pairs that share a topic', 'check')}${metric('Pairwise recall', `${(evaluation.recall * 100).toFixed(1)}%`, 'Same-topic pairs recovered', 'signal')}${metric('Pairwise F1', `${(evaluation.f1 * 100).toFixed(1)}%`, `${evaluation.pairs} labeled pairs · threshold ${evaluation.threshold}`, 'eval')}</div><section class="full-card"><h2>A baseline you can inspect</h2><p>This evaluation uses authored, synthetic report pairs, including paraphrases and hard negatives. It measures lexical grouping, not real-world triage accuracy. The set is a development benchmark, not a held-out test. No model was called.</p><p>${evaluation.falsePositives} false positives · ${evaluation.falseNegatives} false negatives · ${evaluation.latencyMs.toFixed(2)} ms for ${evaluation.pairs} pair comparisons on the recorded machine.</p><p>Reproduce with <code>npm run eval</code>. Dataset SHA-256: <code>${escape(evaluation.datasetSha256.slice(0, 16))}…</code></p></section><section class="full-card"><h2>Case-level results</h2>${evaluation.cases.map((c: any) => `<div class="eval-case"><span>${escape(c.label)}<br><small>${escape(c.left)} / ${escape(c.right)}</small></span><span class="${c.correct ? 'pass' : 'fail'}">${c.correct ? 'PASS' : 'MISS'} · ${c.score.toFixed(2)}</span></div>`).join('')}</section>`;
}
function render() {
  if (!workspace.releases.length) {
    root.innerHTML =
      '<main class="empty"><h1>Welcome to ReleaseLens</h1><p>Add your first release, then import reports to start an investigation.</p><button class="button primary" data-action="add-release">Add a release</button> <button class="button" data-action="import">Import reports</button></main>';
    bind();
    return;
  }
  const analysis = current();
  const subtitles: Record<string, string> = {
    signals: 'You shipped. Let’s see what your customers are telling you.',
    evidence: 'Every signal starts with something a customer actually said.',
    releases: 'The changes that give customer feedback its context.',
    evaluation: 'Measure the baseline. Inspect the failures. Improve with evidence.',
  };
  root.innerHTML = `<div class="shell"><aside class="sidebar"><div class="brand"><img src="/favicon.svg" alt="">ReleaseLens</div><div class="workspace-switch"><span class="workspace-avatar">M</span><div>Michael’s workspace<small>Engineering / release health</small></div></div><div class="nav-label">Workspace</div><nav class="nav" aria-label="Main navigation">${Object.entries(
    names,
  )
    .map(
      ([key, name]) =>
        `<button data-page="${key}" class="${page === key ? 'active' : ''}" ${page === key ? 'aria-current="page"' : ''}>${icon({ signals: 'signal', evidence: 'reports', releases: 'release', evaluation: 'eval' }[key]!)}${name.replace('Release overview', 'Overview').replace('Evidence library', 'Evidence').replace('Evaluation lab', 'Evaluation')} ${key === 'signals' ? `<span class="count">${analysis.clusters.filter((c) => c.signal === 'new' || c.signal === 'rising').length}</span>` : ''}</button>`,
    )
    .join(
      '',
    )}</nav><div class="side-bottom"><div class="side-note"><strong>A little context goes a long way.</strong>Connect what shipped to what customers are reporting. Follow the evidence.</div><div class="profile"><span class="avatar">MK</span><div>Michael Kharadze<small>Personal project workspace</small></div></div></div></aside><main class="main"><header class="topbar"><div class="crumb">Workspace <span>/</span> <strong>${names[page]}</strong></div><div class="top-status"><span><i class="status-dot"></i>${mode === 'sqlite' ? 'SQLite connected' : 'Browser demo'}</span><span class="badge">${workspace.reports.every((r) => r.id.startsWith('R-')) ? 'Synthetic demo data' : 'Custom workspace'}</span></div></header><div class="content"><div class="page-head"><div><div class="eyebrow">${page === 'signals' ? 'FROM RELEASE TO RESOLUTION' : 'AN EVIDENCE-FIRST WORKSPACE'}</div><h1>${names[page]}</h1><p>${subtitles[page]}</p></div><div class="head-actions">${page === 'releases' ? '<button class="button primary" data-action="add-release">' + icon('plus') + 'Add release</button>' : `<button class="button" data-action="export">${icon('download')}Export workspace</button><button class="button primary" data-action="import">${icon('plus')}Import reports</button>`}</div></div>${page === 'signals' ? signals(analysis) : page === 'evidence' ? evidencePage() : page === 'releases' ? releasePage() : evalPage()}<footer class="footer"><span>ReleaseLens <span aria-hidden="true">✳</span> Built for the investigation after the deploy.</span><span>${mode === 'sqlite' ? 'Local application · persisted in SQLite' : 'Interactive demo · saved in this browser'} · ${workspace.reports.length} reports</span></footer></div></main></div>`;
  bind();
}

function showModal(html: string) {
  modal.innerHTML = `<button class="modal-close" aria-label="Close dialog">×</button>${html}`;
  modal.querySelector('.modal-close')!.addEventListener('click', () => modal.close());
  modal.showModal();
}
function bind() {
  root.querySelectorAll<HTMLElement>('[data-page]').forEach(
    (el) =>
      (el.onclick = () => {
        page = el.dataset.page!;
        query = '';
        evidenceFilter = null;
        render();
      }),
  );
  root.querySelectorAll<HTMLElement>('[data-signal]').forEach(
    (el) =>
      (el.onclick = () => {
        selected = el.dataset.signal!;
        render();
      }),
  );
  root.querySelectorAll<HTMLElement>('[data-release]').forEach(
    (el) =>
      (el.onclick = () => {
        releaseId = el.dataset.release!;
        page = 'signals';
        selected = '';
        render();
      }),
  );
  root.querySelector('#release-select')?.addEventListener('change', (e) => {
    releaseId = (e.target as HTMLSelectElement).value;
    selected = '';
    render();
  });
  root.querySelector('#days-select')?.addEventListener('change', (e) => {
    days = Number((e.target as HTMLSelectElement).value);
    render();
  });
  root.querySelector('#search')?.addEventListener('input', (e) => {
    const value = e.target as HTMLInputElement,
      pos = value.selectionStart;
    query = value.value;
    render();
    const input = root.querySelector<HTMLInputElement>('#search')!;
    input.focus();
    input.setSelectionRange(pos, pos);
  });
  root
    .querySelectorAll<HTMLElement>('[data-action]')
    .forEach((el) => (el.onclick = () => action(el.dataset.action!)));
}
async function action(name: string) {
  if (name === 'export')
    return download(
      'releaselens-workspace.json',
      JSON.stringify(workspace, null, 2),
      'application/json',
    );
  if (name === 'import') return importModal();
  if (name === 'add-release') return releaseModal();
  const analysis = current(),
    cluster = analysis.clusters.find((c) => c.id === selected);
  if (!cluster) return;
  if (name === 'all-evidence') {
    evidenceFilter = new Set(cluster.reports.map((r) => r.id));
    query = '';
    page = 'evidence';
    render();
    return;
  }
  if (name === 'brief') {
    const markdown = engineeringBrief(cluster, analysis);
    showModal(
      `<h2>Engineering brief</h2><p>Original evidence and measured counts, ready for your review.</p><pre>${escape(markdown)}</pre><div class="modal-actions"><button class="button" id="copy-brief">Copy Markdown</button><button class="button primary" id="download-brief">Download brief ${icon('download')}</button></div>`,
    );
    modal
      .querySelector('#download-brief')!
      .addEventListener('click', () => download(`${cluster.id}.md`, markdown));
    modal.querySelector('#copy-brief')!.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(markdown);
        toast('Brief copied to clipboard');
      } catch {
        toast('Clipboard unavailable. Download the brief instead.');
      }
    });
    return;
  }
  if (name === 'review') {
    const note = root.querySelector<HTMLTextAreaElement>('#review-note')!.value;
    const previous = workspace.reviews[reviewKey(cluster)];
    showModal(
      `<h2>Review this signal</h2><p>${escape(cluster.title)}</p><form id="review-form"><label class="field">Investigation status<select name="status">${['investigating', 'confirmed', 'dismissed'].map((s) => `<option ${previous?.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label><label class="field">Evidence and next step<textarea name="note">${escape(note)}</textarea></label><p class="method">“Confirmed” means you have reproduced the problem. Document that evidence in the note.</p><div class="form-error" role="alert"></div><div class="modal-actions"><button class="button primary" type="submit">Save review</button></div></form>`,
    );
    modal.querySelector('form')!.addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = new FormData(e.target as HTMLFormElement);
      const review = { status: form.get('status'), note: form.get('note') };
      try {
        if (mode === 'sqlite')
          await api(`/api/reviews/${encodeURIComponent(reviewKey(cluster))}`, review);
        workspace.reviews[reviewKey(cluster)] = review as any;
        persist();
        modal.close();
        render();
        toast('Review saved');
      } catch (error) {
        modal.querySelector('.form-error')!.textContent = (error as Error).message;
      }
    });
    return;
  }
  if (name === 'hypothesis') {
    toast('Analyzing the supplied source reports…');
    try {
      const result = await api(
        `/api/hypothesis?release=${encodeURIComponent(releaseId)}&cluster=${encodeURIComponent(cluster.id)}&days=${days}`,
        {},
      );
      showModal(
        `<h2>A hypothesis to test</h2><p>${escape(result.hypothesis)}</p><div class="change">Next step: ${escape(result.nextStep)}</div><p>Sources: ${escape(result.citations.join(', '))}</p><p class="method">${escape(result.note)} · ${escape(result.model)}</p>`,
      );
    } catch (error) {
      toast((error as Error).message);
    }
  }
}
function importModal() {
  showModal(
    `<h2>Bring the evidence in</h2><p>Import support conversations or a workspace export as JSON. Original IDs are preserved; duplicate IDs are skipped.</p><label class="field">JSON file<input id="import-file" type="file" accept=".json,application/json"></label><p class="method">Expected report fields: id, title, body, account, createdAt (ISO timestamp), source (support, github, or community), and optional HTTPS url. Up to 1,000 reports, 2 MB per import.</p><button class="button" id="sample">Download example JSON</button><div class="form-error" id="import-error" role="alert"></div><hr class="divider"><h2>Import GitHub issues</h2><p>${mode === 'sqlite' ? 'Read public issues from a repository. Imports run in the background, up to 300 issue records per job.' : 'Public GitHub imports are available in the local full-stack application. Run npm run dev from the repository; this hosted demo keeps your data in your browser.'}</p>${mode === 'sqlite' ? '<form id="github-form"><label class="field">Repository<input name="repository" required pattern="[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+" placeholder="owner/repository"></label><label class="field">Created since (UTC)<input name="since" type="date" required value="2026-10-01"></label><button class="button primary" type="submit">Start import</button><p id="job-status" role="status"></p></form>' : ''}`,
  );
  modal
    .querySelector('#sample')!
    .addEventListener('click', () =>
      download(
        'example-reports.json',
        JSON.stringify(demoWorkspace().reports.slice(0, 2), null, 2),
        'application/json',
      ),
    );
  modal.querySelector('#import-file')!.addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      if (file.size > 2_000_000) throw new Error('File exceeds 2 MB');
      const input = JSON.parse(await file.text());
      const rows = Array.isArray(input) ? input : input.reports;
      if (!Array.isArray(rows) || rows.length > 1000)
        throw new Error('Provide an array of up to 1000 reports, or a workspace export');
      const reports = rows.map(validateReport);
      const releases =
        !Array.isArray(input) && Array.isArray(input.releases)
          ? input.releases.map(validateRelease)
          : [];
      let inserted = 0;
      if (mode === 'sqlite') {
        const result = await api('/api/reports', reports);
        inserted = result.inserted;
        for (const release of releases) await api('/api/releases', release);
        workspace = await api('/api/workspace');
      } else {
        const known = new Set(workspace.reports.map((r) => r.id));
        for (const report of reports)
          if (!known.has(report.id)) {
            workspace.reports.push(report);
            known.add(report.id);
            inserted++;
          }
        for (const release of releases) {
          const i = workspace.releases.findIndex((r) => r.id === release.id);
          if (i >= 0) workspace.releases[i] = release;
          else workspace.releases.push(release);
        }
        persist();
      }
      modal.close();
      render();
      toast(`Imported ${inserted} reports. ${reports.length - inserted} duplicate IDs skipped.`);
    } catch (error) {
      modal.querySelector('#import-error')!.textContent = (error as Error).message;
    }
  });
  modal.querySelector('#github-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target as HTMLFormElement);
    const button = modal.querySelector<HTMLButtonElement>('#github-form button')!;
    button.disabled = true;
    const status = modal.querySelector('#job-status')!;
    try {
      const job = await api('/api/import/github', {
        repository: form.get('repository'),
        since: `${form.get('since')}T00:00:00Z`,
      });
      const poll = async () => {
        const result = await api(`/api/jobs/${job.id}`);
        status.textContent = `${result.status}: ${result.imported} report records processed${result.error ? ` · ${result.error}` : ''}${result.capped ? ' · 300 record limit reached' : ''}`;
        if (result.status === 'running' && modal.open)
          setTimeout(
            () =>
              poll().catch((error) => {
                status.textContent = error.message;
                button.disabled = false;
              }),
            1200,
          );
        else {
          workspace = await api('/api/workspace');
          render();
          button.disabled = false;
        }
      };
      await poll();
    } catch (error) {
      status.textContent = (error as Error).message;
      button.disabled = false;
    }
  });
}
function releaseModal() {
  showModal(
    `<h2>Add a release</h2><p>Use the actual deployment time and one change per line. Comparisons use UTC.</p><form id="release-form"><label class="field">Release name<input name="name" required maxlength="120" placeholder="v2.9.0"></label><label class="field">Released at (UTC)<input name="at" type="datetime-local" required></label><label class="field">Release changes<textarea name="changes" required placeholder="Rotate refresh tokens on session renewal&#10;Stream large CSV exports"></textarea></label><div class="form-error" role="alert"></div><div class="modal-actions"><button type="submit" class="button primary">Add release</button></div></form>`,
  );
  modal.querySelector('form')!.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target as HTMLFormElement);
    try {
      const release = validateRelease({
        id: String(form.get('name')),
        name: form.get('name'),
        releasedAt: `${form.get('at')}:00Z`,
        changes: String(form.get('changes')).split('\n').filter(Boolean),
      });
      if (workspace.releases.some((r) => r.id === release.id))
        throw new Error('A release with this name already exists');
      if (mode === 'sqlite') await api('/api/releases', release);
      workspace.releases.unshift(release);
      releaseId = release.id;
      persist();
      modal.close();
      page = 'signals';
      render();
      toast('Release added');
    } catch (error) {
      modal.querySelector('.form-error')!.textContent = (error as Error).message;
    }
  });
}
document.addEventListener('keydown', (e) => {
  if (
    e.key === '/' &&
    !modal.open &&
    !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)
  ) {
    e.preventDefault();
    root.querySelector<HTMLInputElement>('#search')?.focus();
  }
});
try {
  const response = await fetch('/api/workspace', { signal: AbortSignal.timeout(2500) });
  if (response.ok && response.headers.get('content-type')?.includes('application/json')) {
    const data = await response.json();
    workspace = data;
    mode = data.mode;
    modelEnabled = data.modelEnabled;
  } else throw new Error('Static demo');
} catch {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) {
      const input = JSON.parse(saved);
      workspace = {
        reports: input.reports.map(validateReport),
        releases: input.releases.map(validateRelease),
        reviews: input.reviews || {},
      };
    }
  } catch {
    /* Invalid saved data falls back to demo. */
  }
}
if (!workspace.releases.some((r) => r.id === releaseId)) releaseId = workspace.releases[0]?.id;
try {
  const response = await fetch('/evaluation.json');
  if (response.ok) evaluation = await response.json();
} catch {
  /* The app can run before benchmarks are built. */
}
render();
