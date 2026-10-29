import type { Release, Report } from './types.ts';

function string(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${name} must be nonempty text of at most ${max} characters`);
  return value.trim();
}
export function date(value: unknown): string {
  const input = string(value, 'Date', 40);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}.*(?:Z|[+-]\d{2}:\d{2})$/.test(input) || !Number.isFinite(Date.parse(input))) throw new Error('Dates must be ISO timestamps with a timezone');
  return new Date(input).toISOString();
}
export function validateReport(input: unknown): Report {
  if (!input || typeof input !== 'object') throw new Error('Each report must be an object');
  const r = input as Record<string, unknown>;
  if (!['github', 'support', 'community'].includes(String(r.source))) throw new Error('Source must be github, support, or community');
  const output: Report = { id: string(r.id, 'ID', 160), title: string(r.title, 'Title', 250), body: string(r.body, 'Body', 20_000),
    account: string(r.account, 'Account', 160), createdAt: date(r.createdAt), source: r.source as Report['source'] };
  if (r.url) {
    const url = new URL(string(r.url, 'URL', 2000));
    if (url.protocol !== 'https:') throw new Error('Source URL must use HTTPS');
    output.url = url.href;
  }
  return output;
}
export function validateRelease(input: unknown): Release {
  if (!input || typeof input !== 'object') throw new Error('Release must be an object');
  const r = input as Record<string, unknown>;
  if (!Array.isArray(r.changes) || r.changes.length > 100) throw new Error('Changes must be an array of at most 100 entries');
  return { id: string(r.id, 'ID', 160), name: string(r.name, 'Name', 120), releasedAt: date(r.releasedAt), changes: r.changes.map(c => string(c, 'Change', 2000)) };
}
