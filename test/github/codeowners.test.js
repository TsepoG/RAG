// @ts-check
import { describe, expect, it, vi } from 'vitest';
import {
  CODEOWNERS_LOCATIONS,
  createCodeownersLookup,
  matchOwners,
  parseCodeowners,
} from '../../src/github/codeowners.js';
import { createLogger } from '../../src/logger/index.js';
import { createMemoryStream } from '../helpers/memory-stream.js';

const FILE = [
  '# Owners of the shop',
  '* @acme/everyone',
  '*.js @acme/frontend',
  '/docs/ @acme/docs',
  'docs/*  docs@acme.example',
  '/src/refunds/ @acme/payments @alice # the payments team',
  'apps/ @acme/apps',
  '/build/logs/',
  '**/secrets/ @acme/security',
  '/src/**/legacy @acme/legacy',
].join('\n');

describe('parseCodeowners', () => {
  it('reads each rule with its owners', () => {
    expect(parseCodeowners(FILE)).toEqual([
      { pattern: '*', owners: ['@acme/everyone'] },
      { pattern: '*.js', owners: ['@acme/frontend'] },
      { pattern: '/docs/', owners: ['@acme/docs'] },
      { pattern: 'docs/*', owners: ['docs@acme.example'] },
      { pattern: '/src/refunds/', owners: ['@acme/payments', '@alice'] },
      { pattern: 'apps/', owners: ['@acme/apps'] },
      { pattern: '/build/logs/', owners: [] },
      { pattern: '**/secrets/', owners: ['@acme/security'] },
      { pattern: '/src/**/legacy', owners: ['@acme/legacy'] },
    ]);
  });

  it.each([
    ['comments', '# a comment\n   # another\n* @a'],
    ['blank lines', '\n\n* @a\n\n'],
    ['section headers', '[Docs]\n* @a'],
    ['negated patterns', '!*.md @b\n* @a'],
    ['Windows line endings', '* @a\r\n'],
  ])('skips %s', (_name, text) => {
    expect(parseCodeowners(text)).toEqual([{ pattern: '*', owners: ['@a'] }]);
  });

  it('keeps only words that name an owner', () => {
    expect(parseCodeowners('*.md @a notanowner b@c.example')).toEqual([
      { pattern: '*.md', owners: ['@a', 'b@c.example'] },
    ]);
  });

  it('reads an empty file as no rules', () => {
    expect(parseCodeowners('')).toEqual([]);
  });

  it('stops at a very large number of rules, and ignores a very long file', () => {
    const many = Array.from({ length: 6000 }, (_, index) => `/f${index} @a`).join('\n');

    expect(parseCodeowners(many)).toHaveLength(5000);
    expect(parseCodeowners(`${'#'.repeat(100_000)}\n* @a`)).toEqual([]);
  });
});

describe('matchOwners', () => {
  const rules = parseCodeowners(FILE);

  it.each([
    ['README.md', ['@acme/everyone']],
    ['web/app.js', ['@acme/frontend']],
    ['docs/app.js', ['docs@acme.example']],
    ['docs/guide.md', ['docs@acme.example']],
    ['docs/guide/setup.md', ['@acme/docs']],
    ['src/refunds/policy.ts', ['@acme/payments', '@alice']],
    ['src/refunds/deep/er/rule.ts', ['@acme/payments', '@alice']],
    ['packages/apps/web/index.ts', ['@acme/apps']],
    ['apps/web/index.ts', ['@acme/apps']],
    ['myapps/index.ts', ['@acme/everyone']],
    ['build/logs/out.txt', []],
    ['a/b/secrets/key.txt', ['@acme/security']],
    ['secrets/key.txt', ['@acme/security']],
    ['src/legacy/x.ts', ['@acme/legacy']],
    ['src/a/b/legacy', ['@acme/legacy']],
    ['other/src/legacy/x.ts', ['@acme/everyone']],
    ['/docs/guide.md', ['docs@acme.example']],
  ])('gives %s the owners %j', (path, owners) => {
    expect(matchOwners(path, rules)).toEqual(owners);
  });

  it('lets the last matching rule win', () => {
    const ordered = parseCodeowners('* @first\n* @second');

    expect(matchOwners('a.md', ordered)).toEqual(['@second']);
  });

  it('gives nothing when there are no rules or no rule matches', () => {
    expect(matchOwners('a.md', [])).toEqual([]);
    expect(matchOwners('a.md', parseCodeowners('/other/ @a'))).toEqual([]);
  });

  it('matches names exactly as written, including case', () => {
    expect(matchOwners('Docs/a.md', parseCodeowners('/docs/ @a'))).toEqual([]);
  });

  it('reads ? as one character and * as any run of them within a name', () => {
    const wild = parseCodeowners('/f?le.t*t @a');

    expect(matchOwners('file.txt', wild)).toEqual(['@a']);
    expect(matchOwners('fle.txt', wild)).toEqual([]);
    expect(matchOwners('file.text', wild)).toEqual(['@a']);
  });

  it('lets a trailing * match nothing', () => {
    const wild = parseCodeowners('/te* @a');

    expect(matchOwners('te', wild)).toEqual(['@a']);
    expect(matchOwners('tea', wild)).toEqual(['@a']);
    expect(matchOwners('t', wild)).toEqual([]);
  });

  it('keeps a directory pattern from matching a file of the same name', () => {
    expect(matchOwners('apps', parseCodeowners('apps/ @a'))).toEqual([]);
    expect(matchOwners('apps', parseCodeowners('apps @a'))).toEqual(['@a']);
  });

  it('ignores a pattern that is only slashes', () => {
    expect(matchOwners('a.md', parseCodeowners('/ @a'))).toEqual([]);
  });

  it('does not change the rules it is given or share their owner lists', () => {
    const [first] = rules;
    const owners = matchOwners('README.md', rules);
    owners.push('@x');

    expect(first.owners).toEqual(['@acme/everyone']);
  });
});

/**
 * Builds a lookup around a fake client.
 * @param {Record<string, string | Error>} files - The file text, or an error to throw, by location.
 * @param {string[]} [repos] - The allowed repositories.
 * @returns {{ lookup: ReturnType<typeof createCodeownersLookup>, getRaw: ReturnType<typeof vi.fn>, lines: () => Array<Record<string, unknown>> }}
 *   The lookup, the fake, and the log lines.
 */
function setup(files, repos = ['acme/app']) {
  const { stream, lines } = createMemoryStream();
  const getRaw = vi.fn(async (/** @type {string} */ path) => {
    const location = path.split('/contents/')[1];
    const file = files[location];
    if (file instanceof Error) {
      throw file;
    }
    return file;
  });
  const lookup = createCodeownersLookup({
    api: { getRaw },
    repos,
    logger: createLogger({ level: 'debug', destination: stream }),
  });
  return { lookup, getRaw, lines };
}

describe('createCodeownersLookup reading the file', () => {
  it('uses the first of the three places that has a file, and stops there', async () => {
    const { lookup, getRaw } = setup({
      '.github/CODEOWNERS': '* @github-dir',
      CODEOWNERS: '* @root',
    });

    expect(await lookup.ownersOf('acme/app', 'a.md')).toEqual(['@github-dir']);
    expect(getRaw).toHaveBeenCalledTimes(1);
    expect(getRaw).toHaveBeenCalledWith('/repos/acme/app/contents/.github/CODEOWNERS');
  });

  it.each(CODEOWNERS_LOCATIONS)(
    'finds the file at %s after trying the earlier places',
    async (location) => {
      const { lookup, getRaw } = setup({ [location]: '* @found' });

      expect(await lookup.ownersOf('acme/app', 'a.md')).toEqual(['@found']);
      expect(getRaw).toHaveBeenCalledTimes(CODEOWNERS_LOCATIONS.indexOf(location) + 1);
    },
  );

  it('gives nothing, after three requests, when there is no file anywhere', async () => {
    const { lookup, getRaw } = setup({});

    expect(await lookup.ownersOf('acme/app', 'a.md')).toEqual([]);
    expect(getRaw).toHaveBeenCalledTimes(3);
  });

  it('reads each repository once however often and however fast it is asked', async () => {
    const { lookup, getRaw } = setup({ CODEOWNERS: '*.md @docs\n*.js @code' });

    const answers = await Promise.all([
      lookup.ownersOf('acme/app', 'a.md'),
      lookup.ownersOf('ACME/App', 'b.js'),
      lookup.ownersOf('acme/app', 'c.txt'),
    ]);
    await lookup.ownersOf('acme/app', 'd.md');

    expect(answers).toEqual([['@docs'], ['@code'], []]);
    expect(getRaw).toHaveBeenCalledTimes(2);
  });

  it('keeps repositories apart', async () => {
    const { lookup } = setup({ CODEOWNERS: '* @a' }, ['acme/app', 'acme/docs']);

    expect(await lookup.ownersOf('acme/docs', 'x')).toEqual(['@a']);
  });

  it("keeps one lookup's files out of another's", async () => {
    const first = setup({ CODEOWNERS: '* @first' });
    const second = setup({ CODEOWNERS: '* @second' });

    expect(await first.lookup.ownersOf('acme/app', 'x')).toEqual(['@first']);
    expect(await second.lookup.ownersOf('acme/app', 'x')).toEqual(['@second']);
  });
});

describe('createCodeownersLookup scope and failures', () => {
  it('refuses a repository that is not allowed, without any request', async () => {
    const { lookup, getRaw, lines } = setup({ CODEOWNERS: '* @a' });

    expect(await lookup.ownersOf('evil/secrets', 'x')).toEqual([]);
    expect(getRaw).not.toHaveBeenCalled();
    expect(lines().at(-1)).toMatchObject({ level: 'warn', repo: 'evil/secrets' });
  });

  it('gives nothing, says why, and stops trying when GitHub fails', async () => {
    const { lookup, getRaw, lines } = setup({
      '.github/CODEOWNERS': new Error('GitHub answered 500'),
    });

    expect(await lookup.ownersOf('acme/app', 'x')).toEqual([]);
    expect(getRaw).toHaveBeenCalledTimes(1);
    expect(lines().at(-1)).toMatchObject({
      repo: 'acme/app',
      reason: 'GitHub answered 500',
      msg: 'could not read CODEOWNERS',
    });
  });

  it('remembers a failure, so a broken repository is not asked about again', async () => {
    const { lookup, getRaw } = setup({ '.github/CODEOWNERS': new TypeError('network') });

    await lookup.ownersOf('acme/app', 'x');
    await lookup.ownersOf('acme/app', 'y');

    expect(getRaw).toHaveBeenCalledTimes(1);
  });

  it('names only the kind of error when the network fails', async () => {
    const { lookup, lines } = setup({ '.github/CODEOWNERS': new TypeError('secret detail') });

    await lookup.ownersOf('acme/app', 'x');

    expect(lines().at(-1)).toMatchObject({ reason: 'TypeError' });
    expect(JSON.stringify(lines())).not.toContain('secret detail');
  });

  it('never logs the file or who owns what', async () => {
    const { lookup, lines } = setup({ CODEOWNERS: '* @very-private-owner' });

    await lookup.ownersOf('acme/app', 'x');
    await lookup.ownersOf('evil/secrets', 'x');

    expect(JSON.stringify(lines())).not.toContain('very-private-owner');
  });

  it('works without a logger', async () => {
    const lookup = createCodeownersLookup({
      api: { getRaw: async () => undefined },
      repos: ['acme/app'],
    });

    expect(await lookup.ownersOf('acme/app', 'x')).toEqual([]);
    expect(await lookup.ownersOf('other/repo', 'x')).toEqual([]);
  });

  it('works without a logger when the request fails', async () => {
    const lookup = createCodeownersLookup({
      api: {
        getRaw: async () => {
          throw new Error('x');
        },
      },
      repos: ['acme/app'],
    });

    expect(await lookup.ownersOf('acme/app', 'x')).toEqual([]);
  });
});
