// @ts-check
import { describe, expect, it } from 'vitest';
import { checkCql } from '../../src/mcp/cql.js';
import { buildScope } from '../../src/mcp/scope.js';

const SCOPE = buildScope({
  repos: ['acme/app'],
  spaceKeys: ['ENG', 'Prod'],
  siteUrl: 'https://acme.atlassian.net',
});

/**
 * Runs the CQL check on a query.
 * @param {unknown} cql - The cql argument.
 * @param {Record<string, unknown>} [extra] - Other arguments, such as cqlcontext.
 * @returns {string} "ok", or the denial code.
 */
function verdict(cql, extra = {}) {
  const result = checkCql({ cloudId: 'cloud-1', cql, ...extra }, SCOPE);
  return result.ok ? 'ok' : result.code;
}

describe('checkCql allows searches confined to allowed spaces', () => {
  it.each([
    'space = ENG',
    'space=ENG',
    'SPACE = eng',
    'space = "ENG"',
    "space = 'ENG'",
    'space in (ENG, PROD)',
    'space in ("ENG","Prod")',
    'type = page AND space = ENG',
    'space = ENG and text ~ "retry logic"',
    'text ~ foo AND space = ENG AND type in (page, blogpost)',
    'space = ENG AND space = PROD',
    '  space = ENG  ',
    'space = ENG\n AND\n text ~ "x"',
    'label = space AND space = ENG',
    'title !~ draft AND space = ENG',
  ])('allows %j', (cql) => {
    expect(verdict(cql)).toBe('ok');
  });

  it.each([
    'space = ENG AND text ~ "this OR that"',
    'space = ENG AND text ~ "NOT space = HR"',
    String.raw`space = ENG AND text ~ "say \"or\" twice"`,
    "space = ENG AND text ~ 'it is OR not'",
  ])('ignores keywords inside a quoted string: %j', (cql) => {
    expect(verdict(cql)).toBe('ok');
  });

  it.each([
    'space = ENG order by lastmodified desc',
    'space = ENG ORDER BY title asc, created desc',
    'space = ENG AND title ~ "x" order by title',
  ])('allows a trailing order by: %j', (cql) => {
    expect(verdict(cql)).toBe('ok');
  });
});

describe('checkCql refuses searches that are not confined', () => {
  it.each([
    ['text ~ "foo"', 'cql-space'],
    ['type = page', 'cql-space'],
    ['label = space', 'cql-space'],
    ['space != ENG', 'cql-space'],
    ['space ~ ENG', 'cql-space'],
    ['space =', 'cql-space'],
    ['space in ()', 'cql-space'],
    ['space in ENG', 'cql-space'],
    ['space = HR', 'cql-space-not-allowed'],
    ['space in (ENG, HR)', 'cql-space-not-allowed'],
    ['space = ENG AND space = HR', 'cql-space-not-allowed'],
    ['space in ("ENG", "HR")', 'cql-space-not-allowed'],
    ['space = ENG*', 'cql-space-not-allowed'],
  ])('refuses %j with %s', (cql, code) => {
    expect(verdict(cql)).toBe(code);
  });

  it.each([
    'space = ENG OR type = page',
    'space = ENG or type = page',
    'Space = ENG Or type = page',
    'type = page OR space = ENG',
    'NOT space = HR',
    'space not in (ENG)',
    'space = ENG AND NOT type = page',
    'space = ENG AND (type = page OR type = blogpost)',
  ])('refuses the boolean operator in %j', (cql) => {
    expect(verdict(cql)).toBe('cql-boolean');
  });

  it.each([
    'space = ENG AND (type = page)',
    'space = ENG AND title ~ currentSpace()',
    'space = currentSpace()',
    'space in (ENG',
    'space = ENG)',
    'space in ((ENG))',
    'type in (page, blogpost) AND (space = ENG)',
    'space = ENG, type = page',
  ])('refuses parentheses or commas outside an in-list: %j', (cql) => {
    expect(verdict(cql)).toBe('cql-parens');
  });

  it.each([
    'space = ENG order by',
    'space = ENG order by title AND type = page',
    'space = ENG order by title OR x',
    'space = ENG order by title = x',
    'space = ENG order by (title)',
    'space = ENG order by "title"',
  ])('refuses anything but sort fields after order by: %j', (cql) => {
    expect(verdict(cql)).toBe('cql-order-by');
  });
});

describe('checkCql refuses input it cannot read', () => {
  it.each([
    '',
    '   ',
    undefined,
    null,
    42,
    { space: 'ENG' },
    ['space = ENG'],
    'space = ENG AND text ~ "unterminated',
    'space = ENG AND !',
    "space = ENG AND text ~ 'also unterminated",
  ])('refuses %j', (cql) => {
    expect(verdict(cql)).toBe('cql-unparseable');
  });

  it('refuses a missing cql argument', () => {
    expect(checkCql({}, SCOPE)).toMatchObject({ ok: false, code: 'cql-unparseable' });
    expect(checkCql(undefined, SCOPE)).toMatchObject({ ok: false, code: 'cql-unparseable' });
  });
});

describe('checkCql and the cqlcontext argument', () => {
  it.each(['{"spaceKey":"HR"}', 'x', 0, false, {}])('refuses cqlcontext %j', (context) => {
    expect(verdict('space = ENG', { cqlcontext: context })).toBe('cql-context');
  });

  it.each([undefined, null, ''])('ignores an empty cqlcontext %j', (context) => {
    expect(verdict('space = ENG', { cqlcontext: context })).toBe('ok');
  });
});

describe('checkCql denials explain themselves to the model', () => {
  it('tells the model how to restrict the search when there is no space clause', () => {
    expect(checkCql({ cql: 'text ~ "x"' }, SCOPE)).toEqual({
      ok: false,
      code: 'cql-space',
      reason: 'Restrict the search with space = KEY or space in (KEY, ...).',
    });
  });

  it('names the space that is not allowed', () => {
    expect(checkCql({ cql: 'space = HR' }, SCOPE)).toEqual({
      ok: false,
      code: 'cql-space-not-allowed',
      reason: 'Space HR is not in the allowed list.',
    });
  });
});
