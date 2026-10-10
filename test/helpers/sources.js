// @ts-check

export const COMMIT_SHA = 'ebf99bea1fdf70b3a206c622a5134068c73eb607';
export const OTHER_COMMIT_SHA = '0123456789abcdef0123456789abcdef01234567';

/**
 * Builds a Confluence source, optionally changed.
 * @param {Partial<import('../../src/citations/registry.js').ConfluenceSource>} [overrides] - Fields to change.
 * @returns {import('../../src/citations/registry.js').ConfluenceSource} The source.
 */
export function confluenceSource(overrides = {}) {
  return {
    type: 'confluence',
    id: '262439',
    title: 'Refund Policy',
    spaceKey: 'PAY',
    version: 3,
    lastUpdated: '2026-08-12T09:30:00.000Z',
    url: 'https://acme.atlassian.net/wiki/spaces/PAY/pages/262439',
    ...overrides,
  };
}

/**
 * Builds a GitHub file source, optionally changed.
 * @param {Partial<import('../../src/citations/registry.js').GithubSource>} [overrides] - Fields to change.
 * @returns {import('../../src/citations/registry.js').GithubSource} The source.
 */
export function githubSource(overrides = {}) {
  return {
    type: 'github',
    repo: 'acme/payments-service',
    path: 'src/refunds/refund_policy.ts',
    title: 'src/refunds/refund_policy.ts',
    commitSha: COMMIT_SHA,
    url: `https://github.com/acme/payments-service/blob/${COMMIT_SHA}/src/refunds/refund_policy.ts`,
    latestUrl: 'https://github.com/acme/payments-service/blob/main/src/refunds/refund_policy.ts',
    kind: 'file',
    pinned: true,
    ...overrides,
  };
}
