// @ts-check
import { describe, expect, it } from 'vitest';
import { friendlyLabel } from '../../src/citations/labels.js';
import { COMMIT_SHA, confluenceSource, githubSource } from '../helpers/sources.js';

describe('friendlyLabel for Confluence', () => {
  it('gives the title, version and space', () => {
    expect(friendlyLabel(confluenceSource())).toBe('Refund Policy v3 — Confluence (PAY)');
  });
});

describe('friendlyLabel for GitHub files', () => {
  it.each([
    ['src/refunds/refund_policy.ts', 'Refund policy'],
    ['src/RefundPolicy.java', 'Refund policy'],
    ['docs/refund-rules.md', 'Refund rules'],
    ['README.md', 'README'],
    ['Makefile', 'Makefile'],
    ['.env.example', 'Env'],
    ['config/payment.settings.yaml', 'Payment settings'],
  ])('turns %s into "%s"', (path, name) => {
    expect(friendlyLabel(githubSource({ path }))).toBe(`${name} — code (payments-service)`);
  });

  it('never shows a path or an extension', () => {
    const label = friendlyLabel(githubSource());

    expect(label).not.toContain('/');
    expect(label).not.toContain('.ts');
  });

  it('copes with a path that has no words in it', () => {
    expect(friendlyLabel(githubSource({ path: '___' }))).toBe('___ — code (payments-service)');
  });
});

describe('friendlyLabel for folders', () => {
  it.each([
    ['src/refunds', 'Refunds folder'],
    ['src/data_layer', 'Data layer folder'],
    ['', 'Top-level folder'],
  ])('names the folder %j as "%s"', (path, name) => {
    expect(friendlyLabel(githubSource({ path, kind: 'directory' }))).toBe(
      `${name} — code (payments-service)`,
    );
  });
});

describe('friendlyLabel for commits and releases', () => {
  it('names a commit by its short SHA', () => {
    const label = friendlyLabel(githubSource({ kind: 'commit', path: '' }));

    expect(label).toBe(`Commit ${COMMIT_SHA.slice(0, 7)} — code (payments-service)`);
  });

  it('names a release by its tag', () => {
    const label = friendlyLabel(githubSource({ kind: 'release', path: '', title: 'v1.2.0' }));

    expect(label).toBe('Release v1.2.0 — code (payments-service)');
  });
});
