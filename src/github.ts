import type { Report } from './core/types.ts';

export async function importGithub(
  repository: string,
  since: string,
  ingest: (reports: Report[]) => unknown,
  progress: (count: number) => void,
  fetcher: typeof fetch = fetch,
) {
  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repository))
    throw new Error('Use owner/repository');
  if (!Number.isFinite(Date.parse(since))) throw new Error('Invalid import start date');
  let imported = 0;
  for (let page = 1; page <= 3; page++) {
    const url = new URL(`https://api.github.com/repos/${repository}/issues`);
    url.search = new URLSearchParams({
      state: 'all',
      since,
      sort: 'created',
      direction: 'desc',
      per_page: '100',
      page: String(page),
    }).toString();
    const response = await fetcher(url, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'ReleaseLens/0.1' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok)
      throw new Error(
        response.status === 403 || response.status === 429
          ? 'GitHub rate limit reached. Retry later.'
          : `GitHub returned ${response.status}`,
      );
    const rows = await response.json();
    if (!Array.isArray(rows)) throw new Error('Unexpected GitHub response');
    const reports = rows
      .filter((r) => !r.pull_request && Date.parse(r.created_at) >= Date.parse(since))
      .map((r) => ({
        id: `github:${repository}#${r.number}`,
        title: r.title,
        body: r.body?.trim() || r.title,
        account: r.user?.login || 'unknown',
        createdAt: r.created_at,
        source: 'github' as const,
        url: r.html_url,
      }));
    ingest(reports);
    imported += reports.length;
    progress(imported);
    if (rows.length < 100) return { imported, capped: false };
  }
  return { imported, capped: true };
}
