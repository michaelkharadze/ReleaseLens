import type { Workspace } from './types.ts';

/** Synthetic, authored fixtures. These are not real customer reports. */
export function demoWorkspace(): Workspace {
  const release = {
    id: 'v2.8.0',
    name: 'v2.8.0',
    releasedAt: '2026-10-15T00:00:00.000Z',
    changes: [
      'Rotate auth refresh tokens when a login session is renewed.',
      'Stream large CSV export downloads through the export worker.',
      'Retry webhook delivery with exponential backoff.',
      'Improve search indexing for archived documents.',
    ],
  };
  const topics = [
    {
      title: 'Login loop after session expires',
      body: 'The auth refresh token expires and the login session loops. Refresh token renewal sends us back to login.',
      before: 1,
      after: 9,
    },
    {
      title: 'CSV export stops at 10,000 rows',
      body: 'The CSV export download is truncated at 10000 rows. Large CSV export files stop before all rows download.',
      before: 1,
      after: 6,
    },
    {
      title: 'Webhook events delivered twice',
      body: 'Webhook retry delivery sends duplicate events. The same webhook event arrives twice after a delivery retry.',
      before: 2,
      after: 5,
    },
    {
      title: 'Search misses archived documents',
      body: 'Search indexing misses archived documents. Archived document results are missing from search.',
      before: 4,
      after: 2,
    },
    {
      title: 'Invoice payment declined',
      body: 'Credit card invoice payment is declined. The payment page shows an invoice payment error.',
      before: 3,
      after: 3,
    },
    {
      title: 'Workspace invite link expired',
      body: 'Workspace invite link expired before a teammate could accept. Resending the invite link resolves the expiry.',
      before: 3,
      after: 2,
    },
  ];
  const accounts = [
    'Northstar',
    'Linear Labs',
    'Acme Studio',
    'Orbit',
    'Meridian',
    'Fieldwork',
    'Atlas',
    'Forma',
    'Daybreak',
    'Arc',
  ];
  let sequence = 101;
  const reports = topics.flatMap((topic, index) =>
    (['before', 'after'] as const).flatMap((phase) =>
      Array.from({ length: topic[phase] }, (_, n) => ({
        id: `R-${sequence++}`,
        title: topic.title,
        body: `${topic.body} ${['This blocks our daily workflow.', 'Reproduced in our workspace.', 'Our team can reproduce this consistently.'][n % 3]}`,
        account: `${accounts[n % accounts.length]} ${index + 1}`,
        createdAt: new Date(
          Date.parse(release.releasedAt) +
            (phase === 'before' ? -((n % 7) + 1) : n % 7) * 86_400_000 +
            3_600_000,
        ).toISOString(),
        source: (['support', 'github', 'community'] as const)[n % 3],
      })),
    ),
  );
  return {
    reports,
    releases: [
      release,
      {
        id: 'v2.7.0',
        name: 'v2.7.0',
        releasedAt: '2026-10-08T00:00:00.000Z',
        changes: ['Improve archived document search indexing', 'Update invoice payment page'],
      },
    ],
    reviews: {},
  };
}
