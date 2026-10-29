# Local HTTP API

The application listens on `127.0.0.1:4317`. Requests are same-origin. Mutation bodies use `application/json`, at most 2 MB. This is a single-user development API.

| Method | Path                                             | Behavior                                                                         |
| ------ | ------------------------------------------------ | -------------------------------------------------------------------------------- |
| GET    | `/api/workspace`                                 | Reports, releases, reviews, storage mode, model availability                     |
| POST   | `/api/reports`                                   | Validate and transactionally insert a JSON array; duplicate IDs skipped          |
| POST   | `/api/releases`                                  | Validate and insert/update a release                                             |
| GET    | `/api/analysis?release=v2.8.0&days=7`            | Release-window counts, groups, ranking, timeline                                 |
| POST   | `/api/reviews/<encoded-release:signal-key>`      | Save `{status,note}` and an audit entry                                          |
| POST   | `/api/import/github`                             | Start a job with `{repository:"owner/name",since:"ISO timestamp"}`               |
| GET    | `/api/jobs/<id>`                                 | Persisted import progress, completion, or error                                  |
| GET    | `/api/brief?release=...&cluster=...&days=7`      | Source-backed Markdown draft                                                     |
| POST   | `/api/hypothesis?release=...&cluster=...&days=7` | Optional provider analysis; requires configured server credentials and `{}` body |
| GET    | `/api/audit`                                     | Most recent 100 audit events                                                     |

Report schema:

```json
{
  "id": "support-123",
  "title": "CSV export truncates at 10000 rows",
  "body": "An original support report, preserved verbatim.",
  "account": "example-account",
  "createdAt": "2026-10-16T14:05:00Z",
  "source": "support",
  "url": "https://example.com/tickets/123"
}
```

The URL is optional and must use HTTPS. IDs are bounded to 160 characters, titles to 250, and bodies to 20,000. Sources are `support`, `github`, or `community`. Dates require explicit timezones. Import up to 1,000 reports at a time.
