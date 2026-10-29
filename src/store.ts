import { DatabaseSync } from 'node:sqlite';
import type { Report, Release, Review, Workspace } from './core/types.ts';
import { validateReport, validateRelease } from './core/validation.ts';

export class Store {
  db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS reports(id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS releases(id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS reviews(id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, created_at TEXT NOT NULL, action TEXT NOT NULL, subject TEXT NOT NULL);`);
  }
  workspace(): Workspace {
    const read = (table: string) =>
      this.db
        .prepare(`SELECT payload FROM ${table} ORDER BY id`)
        .all()
        .map((r) => JSON.parse(r.payload as string));
    return {
      reports: read('reports'),
      releases: read('releases'),
      reviews: Object.fromEntries(
        this.db
          .prepare('SELECT id, payload FROM reviews')
          .all()
          .map((r) => [r.id, JSON.parse(r.payload as string)]),
      ),
    };
  }
  ingest(input: unknown[]): { inserted: number; duplicates: number } {
    if (input.length > 1000) throw new Error('Import up to 1000 reports per request');
    const reports = input.map(validateReport); // validate the whole batch before writing
    let inserted = 0;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const stmt = this.db.prepare('INSERT OR IGNORE INTO reports(id,payload) VALUES (?,?)');
      for (const r of reports) inserted += Number(stmt.run(r.id, JSON.stringify(r)).changes);
      this.audit('import', `${inserted} reports`);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return { inserted, duplicates: reports.length - inserted };
  }
  release(input: unknown): Release {
    const r = validateRelease(input);
    this.db
      .prepare(
        'INSERT INTO releases VALUES (?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload',
      )
      .run(r.id, JSON.stringify(r));
    return r;
  }
  review(key: string, input: unknown): Review {
    const r = input as Review;
    if (
      !r ||
      !['investigating', 'confirmed', 'dismissed'].includes(r.status) ||
      typeof r.note !== 'string' ||
      r.note.length > 4000
    )
      throw new Error('Invalid review');
    const review = { status: r.status, note: r.note };
    this.db
      .prepare(
        'INSERT INTO reviews VALUES (?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload',
      )
      .run(key, JSON.stringify(review));
    this.audit(`review:${r.status}`, key);
    return review;
  }
  audit(action: string, subject: string) {
    this.db
      .prepare('INSERT INTO audit(created_at,action,subject) VALUES (?,?,?)')
      .run(new Date().toISOString(), action, subject);
  }
  job(id: string, payload?: unknown): any {
    if (payload !== undefined)
      this.db
        .prepare(
          'INSERT INTO jobs VALUES (?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload',
        )
        .run(id, JSON.stringify(payload));
    const row = this.db.prepare('SELECT payload FROM jobs WHERE id=?').get(id);
    return row ? JSON.parse(row.payload as string) : null;
  }
  close() {
    this.db.close();
  }
}
