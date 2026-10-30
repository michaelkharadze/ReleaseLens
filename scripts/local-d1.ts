import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import type { Database, Statement } from '../src/hosted/db.ts';

type LocalStatement = Statement & { runAll(): unknown[] };
/** SQLite adapter for local preview/contract tests. Production uses the Sites D1 binding. */
export class LocalD1 implements Database {
  db: DatabaseSync;
  constructor(path = ':memory:') {
    this.db = new DatabaseSync(path);
    if (this.db.prepare('PRAGMA user_version').get()?.user_version === 0) {
      this.db.exec(
        readFileSync(new URL('../drizzle/0000_first_charles_xavier.sql', import.meta.url), 'utf8'),
      );
      this.db.exec('PRAGMA user_version=1');
    }
  }
  prepare(query: string): Statement {
    const statement = this.db.prepare(query);
    let values: (string | number)[] = [];
    const wrapper: LocalStatement = {
      bind(...input) {
        values = input;
        return wrapper;
      },
      runAll() {
        return statement.all(...values);
      },
      async all<T>() {
        return { results: wrapper.runAll() as T[] };
      },
    };
    return wrapper;
  }
  async batch<T>(statements: Statement[]) {
    this.db.exec('BEGIN');
    try {
      const results = statements.map((statement) => ({
        results: (statement as LocalStatement).runAll() as T[],
      }));
      this.db.exec('COMMIT');
      return results;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  close() {
    this.db.close();
  }
}
