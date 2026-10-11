// @ts-check
import { describe, expect, it } from 'vitest';
import { describeInvalidKeys, formatReport } from '../../src/answer/report.js';
import { friendlyLabel } from '../../src/citations/index.js';
import { COMMIT_SHA, confluenceSource, githubSource } from '../helpers/sources.js';

const DEVELOPER = { displayName: 'Developer', depth: 3 };
const OWNER = { displayName: 'Product Owner', depth: 1 };
const SHORT_SHA = COMMIT_SHA.slice(0, 7);

/**
 * Builds a result, filling in whatever the test does not set.
 * @param {Partial<import('../../src/answer/askQuestion.js').AskResult>} [overrides] - Changes.
 * @returns {import('../../src/answer/askQuestion.js').AskResult} The result.
 */
function result(overrides = {}) {
  return {
    status: /** @type {const} */ ('answered'),
    confidence: /** @type {const} */ ('high'),
    confidenceReason: 'Stated in the page.',
    capsApplied: [],
    gaps: [],
    conflicts: [],
    uncitedSentences: [],
    styleViolations: [],
    rewritten: false,
    rewriteRejected: false,
    whoToAsk: [],
    answer: 'Refunds take 30 days [C1].\n',
    role: 'developer',
    sources: [],
    alsoConsulted: [],
    invalidKeys: [],
    uncitedSourceKeys: [],
    inferredKeys: [],
    toolCalls: [],
    model: 'gpt-x',
    durationMs: 18_240,
    ...overrides,
  };
}

/**
 * Builds a cited source.
 * @param {import('../../src/citations/index.js').Source} source - The source.
 * @param {string} key - Its key.
 * @returns {import('../../src/answer/result.js').CitedSource} The cited source.
 */
function cited(source, key) {
  return { ...source, key, friendlyLabel: friendlyLabel(source), inferred: false };
}

/**
 * Formats a report for a role.
 * @param {import('../../src/answer/askQuestion.js').AskResult} value - The result.
 * @param {{ displayName: string, depth: number }} role - The role.
 * @returns {string} The report.
 */
function report(value, role = DEVELOPER) {
  return formatReport({ result: value, role });
}

describe('formatReport sections', () => {
  it('prints the answer, the sources, the tools used and a footer, in that order', () => {
    const text = report(
      result({
        sources: [cited(confluenceSource(), 'C1')],
        toolCalls: [
          {
            server: 'atlassian',
            tool: 'searchConfluence',
            summary: 'cql=x',
            durationMs: 120,
            success: true,
          },
        ],
      }),
    );

    expect(text).toBe(
      [
        'Refunds take 30 days [C1].',
        '',
        'Sources',
        '  [C1] Refund Policy — https://acme.atlassian.net/wiki/spaces/PAY/pages/262439 (v3)',
        '',
        'Tools used:',
        '  - atlassian / searchConfluence (cql=x) [120 ms]',
        '',
        'Role: Developer | Model: gpt-x | 18.2s',
        '',
      ].join('\n'),
    );
  });

  it('says there are no sources and no tools when there are none', () => {
    const text = report(result({ model: undefined }));

    expect(text).toContain('Sources\n  (none)');
    expect(text).toContain('Tools used:\n  (none)');
    expect(text).toContain('Model: unknown');
  });

  it('lists what was only consulted, with keys where the model had the source', () => {
    const text = report(
      result({
        alsoConsulted: [
          { key: 'G1', type: 'github', title: 'a.js', url: 'https://x/g1' },
          { type: 'confluence', title: 'A page', url: 'https://x/page' },
        ],
      }),
    );

    expect(text).toContain(
      '\nAlso consulted\n  - [G1] a.js — https://x/g1\n  - A page — https://x/page\n',
    );
  });

  it('leaves out the "also consulted" heading when nothing was only consulted', () => {
    expect(report(result())).not.toContain('Also consulted');
  });

  it('shows how a tool call went: how long it took, that it failed, or that it never finished', () => {
    const text = report(
      result({
        toolCalls: [
          { server: 's', tool: 'ok', summary: '', durationMs: 5, success: true },
          { server: 's', tool: 'bad', summary: 'a=b', durationMs: 7, success: false },
          { server: 's', tool: 'open', summary: '', durationMs: undefined, success: undefined },
        ],
      }),
    );

    expect(text).toContain(
      '  - s / ok [5 ms]\n  - s / bad (a=b) [7 ms, failed]\n  - s / open [no result]\n',
    );
  });
});

describe('formatReport sources for technical roles', () => {
  it('shows the title and where a file is pinned', () => {
    const text = report(result({ sources: [cited(githubSource(), 'G1')] }));

    expect(text).toContain(
      `  [G1] src/refunds/refund_policy.ts — https://github.com/acme/payments-service/blob/${COMMIT_SHA}/src/refunds/refund_policy.ts (commit ${SHORT_SHA})`,
    );
  });

  it('says plainly when a file is not pinned to a commit', () => {
    const unpinned = githubSource({ pinned: false, commitSha: '', url: 'https://x/HEAD' });

    const text = report(result({ sources: [cited(unpinned, 'G1')] }));

    expect(text).toContain('(latest on the default branch, not pinned to a commit)');
  });

  it('shows a commit by its short SHA and a release by its tag', () => {
    const commit = githubSource({
      kind: 'commit',
      path: '',
      title: 'Fix refunds',
      url: 'https://x/c',
    });
    const release = githubSource({
      kind: 'release',
      path: '',
      title: 'v1.2.0',
      url: 'https://x/r',
      commitSha: '',
    });

    const text = report(result({ sources: [cited(commit, 'G1'), cited(release, 'G2')] }));

    expect(text).toContain(`[G1] Fix refunds — https://x/c (commit ${SHORT_SHA})`);
    expect(text).toContain('[G2] v1.2.0 — https://x/r (release v1.2.0)');
  });

  it('marks a Confluence page that may be out of date', () => {
    const text = report(result({ sources: [cited(confluenceSource({ stale: true }), 'C1')] }));

    expect(text).toContain('(v3, may be out of date)');
  });
});

describe('formatReport sources for business-facing roles', () => {
  it('shows a business label instead of a title or a file path', () => {
    const text = report(
      result({ sources: [cited(confluenceSource(), 'C1'), cited(githubSource(), 'G1')] }),
      OWNER,
    );

    expect(text).toContain(
      '[C1] Refund Policy v3 — Confluence (PAY) — https://acme.atlassian.net/wiki/spaces/PAY/pages/262439\n',
    );
    expect(text).toContain('[G1] Refund policy — code (payments-service) — https://github.com/');
    expect(text).not.toContain('src/refunds/refund_policy.ts —');
  });

  it('does not repeat the version after a label that names it, but still marks a stale page', () => {
    const text = report(
      result({ sources: [cited(confluenceSource({ stale: true }), 'C1')] }),
      OWNER,
    );

    expect(text).toContain('(may be out of date)');
    expect(text).not.toContain('(v3');
  });

  it('shows a release by its tag', () => {
    const release = githubSource({ kind: 'release', path: '', title: 'v2', url: 'https://x/r' });

    const text = report(result({ sources: [cited(release, 'G1')] }), OWNER);

    expect(text).toContain('Release v2 — code (payments-service) — https://x/r (release v2)');
  });

  it.each([2, 3])('shows titles, not labels, at depth %i', (depth) => {
    const text = report(result({ sources: [cited(githubSource(), 'G1')] }), {
      displayName: 'Someone',
      depth,
    });

    expect(text).toContain('[G1] src/refunds/refund_policy.ts —');
  });
});

describe('describeInvalidKeys', () => {
  it('lists the keys that were removed', () => {
    expect(describeInvalidKeys(['C9', 'G8'])).toBe(
      'Removed citation keys that matched no fetched source: C9, G8',
    );
  });

  it('says nothing when none were removed', () => {
    expect(describeInvalidKeys([])).toBeUndefined();
  });
});
