// @ts-check
import { describe, expect, it } from 'vitest';
import { getExtractor } from '../../../src/citations/extractors/index.js';
import {
  asObject,
  asString,
  firstLine,
  isAllowedRepo,
  isFullSha,
  isOlderThanAYear,
  parseJson,
  repoFromArguments,
  repoFromUrl,
} from '../../../src/citations/extractors/shared.js';
import { ALLOWLIST } from '../../../src/mcp/index.js';

describe('getExtractor', () => {
  it('has an extractor for every allow-listed tool that returns content', () => {
    const withoutExtractor = Object.entries(ALLOWLIST).flatMap(([server, tools]) =>
      tools
        .filter((tool) => getExtractor({ server, tool }) === undefined)
        .map((tool) => `${server}/${tool}`),
    );

    expect(withoutExtractor).toEqual(['atlassian/getAccessibleAtlassianResources']);
  });

  it.each([
    { server: 'atlassian', tool: 'getAccessibleAtlassianResources' },
    { server: 'atlassian', tool: 'executeWrite' },
    { server: 'github_repos', tool: 'create_pull_request' },
    { server: 'other', tool: 'search_code' },
    { server: 'constructor', tool: 'x' },
    { server: 'atlassian', tool: 'constructor' },
    { server: '__proto__', tool: 'toString' },
  ])('has none for $server / $tool', (target) => {
    expect(getExtractor(target)).toBeUndefined();
  });
});

describe('shared helpers', () => {
  it('parseJson gives undefined for text that is not JSON', () => {
    expect(parseJson('{"a":1}')).toEqual({ a: 1 });
    expect(parseJson('nope')).toBeUndefined();
  });

  it.each([null, undefined, 'text', 4, [1], true])(
    'asObject gives an empty object for %j',
    (value) => {
      expect(asObject(value)).toEqual({});
    },
  );

  it('asObject returns an object as it is', () => {
    expect(asObject({ a: 1 })).toEqual({ a: 1 });
  });

  it.each([null, undefined, 4, {}, ['a']])('asString gives an empty string for %j', (value) => {
    expect(asString(value)).toBe('');
  });

  it.each([
    ['ebf99bea1fdf70b3a206c622a5134068c73eb607', true],
    ['EBF99BEA1FDF70B3A206C622A5134068C73EB607', false],
    ['ebf99bea', false],
    ['x'.repeat(40), false],
    [42, false],
    [undefined, false],
  ])('isFullSha(%j) is %s', (value, expected) => {
    expect(isFullSha(value)).toBe(expected);
  });

  it.each([
    ['https://github.com/acme/app/blob/main/a.js', 'acme/app'],
    ['https://github.com/acme/app/commit/abc', 'acme/app'],
    ['https://gitlab.com/acme/app/blob/main/a.js', undefined],
    ['https://github.com/acme', undefined],
    ['not a url', undefined],
  ])('repoFromUrl(%s) is %s', (url, expected) => {
    expect(repoFromUrl(url)).toBe(expected);
  });

  it('repoFromArguments needs both owner and repo as text', () => {
    expect(repoFromArguments({ owner: 'acme', repo: 'app' })).toBe('acme/app');
    expect(repoFromArguments({ owner: 'acme' })).toBeUndefined();
    expect(repoFromArguments({ owner: 1, repo: 'app' })).toBeUndefined();
    expect(repoFromArguments(undefined)).toBeUndefined();
  });

  it('isAllowedRepo ignores case and is false for an unknown or missing repository', () => {
    expect(isAllowedRepo(['Acme/App'], 'acme/app')).toBe(true);
    expect(isAllowedRepo(['acme/app'], 'acme/other')).toBe(false);
    expect(isAllowedRepo(['acme/app'], undefined)).toBe(false);
  });

  it('firstLine keeps a short first line and cuts a long one', () => {
    expect(firstLine('Fix refunds\n\nLong body')).toBe('Fix refunds');
    expect(firstLine('x'.repeat(80))).toBe('x'.repeat(80));
    expect(firstLine('x'.repeat(81))).toBe(`${'x'.repeat(79)}…`);
    expect(firstLine('')).toBe('');
  });

  describe('isOlderThanAYear', () => {
    const now = Date.parse('2026-10-11T12:00:00Z');

    it.each([
      ['2025-10-11T11:59:59Z', true],
      ['2025-10-11T12:00:00Z', false],
      ['2026-10-01T00:00:00Z', false],
      ['2020-01-01T00:00:00Z', true],
    ])('is %s older than a year before 2026-10-11 noon? %s', (date, expected) => {
      expect(isOlderThanAYear(date, now)).toBe(expected);
    });

    it.each([undefined, 'not a date', ''])(
      'is false for the date %j, which says nothing',
      (date) => {
        expect(isOlderThanAYear(date, now)).toBe(false);
      },
    );
  });
});
