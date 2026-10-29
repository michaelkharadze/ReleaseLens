import type { Analysis, Cluster, Release, Report } from './types.ts';

const DAY = 86_400_000;
const STOP = new Set(
  'a an the is are was were be been being i we our my us me it its this that these those to for from at in on of with and or but after before since when then have has had can cannot could would should will not no do does did just still now get getting using use please issue problem report user users new latest version release upgrade updated update app application'.split(
    ' ',
  ),
);
const ALIASES: Record<string, string> = {
  logging: 'login',
  signin: 'login',
  authentication: 'auth',
  authenticated: 'auth',
  exporting: 'export',
  exports: 'export',
  downloads: 'download',
  downloading: 'download',
  notifications: 'notification',
  webhooks: 'webhook',
  retries: 'retry',
  searching: 'search',
  searches: 'search',
  billing: 'payment',
  payments: 'payment',
  invoices: 'invoice',
  crashes: 'crash',
  crashing: 'crash',
  failed: 'fail',
  failing: 'fail',
  errors: 'error',
  tokens: 'token',
  sessions: 'session',
  invitations: 'invite',
  invites: 'invite',
};

export function tokens(text: string): Set<string> {
  return new Set(
    (
      text
        .toLowerCase()
        .replace(/sign[ -]in/g, 'signin')
        .match(/[a-z][a-z0-9_]{1,}/g) ?? []
    )
      .filter((t) => !STOP.has(t))
      .map((t) => ALIASES[t] ?? t),
  );
}

/** Binary cosine is deliberately inspectable; it is not a semantic embedding. */
export function similarity(a: string, b: string): number {
  const left = tokens(a),
    right = tokens(b);
  if (!left.size || !right.size) return 0;
  return [...left].filter((t) => right.has(t)).length / Math.sqrt(left.size * right.size);
}

export const GROUP_THRESHOLD = 0.36;
export function groupReports(reports: Report[], threshold = GROUP_THRESHOLD): Report[][] {
  const groups: Report[][] = [];
  // Stable IDs and membership for identical input regardless of ingestion order.
  for (const report of [...reports].sort((a, b) => a.id.localeCompare(b.id))) {
    let best = -1,
      score = threshold;
    const text = `${report.title} ${report.body}`;
    groups.forEach((group, index) => {
      // Complete-link similarity prevents a vague bridge report joining two distinct topics.
      const candidate = Math.min(...group.map((r) => similarity(text, `${r.title} ${r.body}`)));
      if (candidate >= score) {
        best = index;
        score = candidate;
      }
    });
    if (best < 0) groups.push([report]);
    else groups[best].push(report);
  }
  return groups;
}

export function clusterId(reports: Report[]): string {
  // Representative ID remains stable as newer reports join an existing group.
  return `signal-${reports.map((r) => r.id).sort()[0]}`;
}

export function analyze(reports: Report[], release: Release, windowDays = 7): Analysis {
  if (!Number.isInteger(windowDays) || windowDays < 1 || windowDays > 30)
    throw new Error('Window must be between 1 and 30 days');
  const boundary = Date.parse(release.releasedAt);
  if (!Number.isFinite(boundary)) throw new Error('Invalid release date');
  const start = boundary - windowDays * DAY,
    end = boundary + windowDays * DAY;
  const scoped = reports.filter(
    (r) => Date.parse(r.createdAt) >= start && Date.parse(r.createdAt) < end,
  );
  const before = scoped.filter((r) => Date.parse(r.createdAt) < boundary);
  const after = scoped.filter((r) => Date.parse(r.createdAt) >= boundary);
  const accountCount = (items: Report[]) => new Set(items.map((r) => r.account)).size;
  const beforeTotal = accountCount(before),
    afterTotal = accountCount(after);
  const clusters: Cluster[] = groupReports(scoped)
    .map((group) => {
      const pre = accountCount(group.filter((r) => Date.parse(r.createdAt) < boundary));
      const post = accountCount(group.filter((r) => Date.parse(r.createdAt) >= boundary));
      const beforeShare = beforeTotal ? pre / beforeTotal : 0;
      const afterShare = afterTotal ? post / afterTotal : 0;
      // Jeffreys-style pseudocount gives finite ratios for zero-count topics.
      const lift =
        beforeTotal && afterTotal
          ? (post + 0.5) / (afterTotal + 1) / ((pre + 0.5) / (beforeTotal + 1))
          : null;
      const signal: Cluster['signal'] =
        lift === null
          ? 'insufficient'
          : post === 0
            ? 'declining'
            : pre === 0
              ? 'new'
              : lift >= 1.5
                ? 'rising'
                : lift <= 0.67
                  ? 'declining'
                  : 'stable';
      let change: string | null = null,
        changeSimilarity = 0;
      for (const item of release.changes) {
        const score = Math.max(...group.map((r) => similarity(`${r.title} ${r.body}`, item)));
        if (score > changeSimilarity && score >= 0.18) {
          change = item;
          changeSimilarity = score;
        }
      }
      return {
        id: clusterId(group),
        title: group[0].title,
        reports: group,
        before: pre,
        after: post,
        beforeShare,
        afterShare,
        lift,
        priority: lift === null ? 0 : Math.round(post * Math.max(0, Math.log2(lift)) * 10) / 10,
        signal,
        change,
        changeSimilarity,
      };
    })
    .sort((a, b) => b.priority - a.priority || b.after - a.after || a.id.localeCompare(b.id));
  const timeline = Array.from({ length: windowDays * 2 }, (_, index) => {
    const time = start + index * DAY;
    return {
      date: new Date(time).toISOString(),
      reports: scoped.filter(
        (r) => Date.parse(r.createdAt) >= time && Date.parse(r.createdAt) < time + DAY,
      ).length,
      phase: time < boundary ? ('before' as const) : ('after' as const),
    };
  });
  return {
    release,
    windowDays,
    clusters,
    totals: {
      before: beforeTotal,
      after: afterTotal,
      reports: scoped.length,
      accounts: accountCount(scoped),
    },
    timeline,
  };
}

export function engineeringBrief(cluster: Cluster, analysis: Analysis): string {
  const lines = [
    `# Investigate: ${cluster.title}`,
    '',
    `Release: ${analysis.release.name} (${analysis.release.releasedAt})`,
    `Comparison: ${analysis.windowDays} days before and after the release.`,
    '',
    '## Observed signal',
    `${cluster.before} reporting accounts before; ${cluster.after} after.`,
    `Share of reporting accounts: ${(cluster.beforeShare * 100).toFixed(1)}% → ${(cluster.afterShare * 100).toFixed(1)}%.`,
    cluster.lift === null
      ? 'Insufficient data: both windows need reporting accounts before a frequency ratio can be calculated. This is not causal evidence.'
      : `Smoothed frequency ratio: ${cluster.lift.toFixed(2)}×. This is a triage signal, not causal evidence.`,
    '',
    '## Related release change',
    cluster.change ?? 'No lexical match in the supplied release notes.',
    '',
    '## Source evidence',
  ];
  for (const report of cluster.reports) {
    lines.push(
      '',
      `### [${report.id}] ${report.title}`,
      `Account: ${report.account} · ${report.createdAt} · ${report.source}`,
      `> ${report.body.replace(/\n/g, '\n> ')}`,
    );
    if (report.url) lines.push(`Source: ${report.url}`);
  }
  return [
    ...lines,
    '',
    '## Investigation checklist',
    '- [ ] Reproduce on the release and its predecessor.',
    '- [ ] Check affected configurations and exposure denominators.',
    '- [ ] Verify or reject the suspected release change.',
    '- [ ] Add a regression test before proposing a fix.',
    '',
    'Draft generated by ReleaseLens. Human review required.',
  ].join('\n');
}
