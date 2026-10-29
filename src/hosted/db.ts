export interface Statement {
  bind(...values: (string | number)[]): Statement;
  all<T>(): Promise<{ results: T[] }>;
}
export interface Database {
  prepare(query: string): Statement;
  batch<T>(statements: Statement[]): Promise<{ results: T[] }[]>;
}
export class PublicError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/** Atomic, shared caps survive Worker restarts and apply before any paid model request. */
export async function claimRequest(db: Database, visitor: string, now = Date.now()) {
  const hour = Math.floor(now / 3_600_000),
    day = Math.floor(now / 86_400_000);
  const buckets = [
    { key: `global:${day}`, limit: 100, expires: (day + 2) * 86_400_000 },
    { key: `visitor:${visitor}:${hour}`, limit: 10, expires: (hour + 2) * 3_600_000 },
  ];
  const results = await db.batch<{ count: number }>(
    buckets.map((b) =>
      db
        .prepare(
          'INSERT INTO hosted_request_limits (key,count,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 WHERE count<? RETURNING count',
        )
        .bind(b.key, b.expires, b.limit),
    ),
  );
  if (results.some((r) => r.results.length === 0))
    throw new PublicError('The demo has reached its request limit. Please try again later.', 429);
}
