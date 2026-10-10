// @ts-check
import { describe, expect, it } from 'vitest';
import { extractCommit } from '../../../src/citations/extractors/getCommit.js';
import { extractRelease } from '../../../src/citations/extractors/getLatestRelease.js';
import { extractCommitList } from '../../../src/citations/extractors/listCommits.js';
import { extractReleaseList } from '../../../src/citations/extractors/listReleases.js';
import { extractCodeSearch } from '../../../src/citations/extractors/searchCode.js';
import { fixtureInput, makeContext } from '../../helpers/extraction.js';

const SHA = 'ebf99bea1fdf70b3a206c622a5134068c73eb607';
const OTHER = 'ccad636a5d7ead1560bf3516cd95f72ca47bc16d';

/**
 * A GitHub tool result as text.
 * @param {unknown} value - The JSON value.
 * @returns {string} The text.
 */
const json = (value) => JSON.stringify(value);

describe('extractCommit', () => {
  it('registers a real commit, pinned by its own SHA', async () => {
    const result = await extractCommit(fixtureInput('get_commit'), makeContext());

    expect(result.sources).toEqual([
      {
        type: 'github',
        repo: 'acme/app',
        path: '',
        title: 'Commit message 1',
        commitSha: SHA,
        url: `https://github.com/acme/app/commit/${SHA}`,
        latestUrl: `https://github.com/acme/app/commit/${SHA}`,
        kind: 'commit',
        pinned: true,
      },
    ]);
  });

  it('uses only the first line of a long message, cut to a sensible length', async () => {
    const message = `${'x'.repeat(200)}\nsecond line`;

    const { sources } = await extractCommit(
      {
        args: {},
        text: json({
          sha: SHA,
          html_url: `https://github.com/acme/app/commit/${SHA}`,
          commit: { message },
        }),
      },
      makeContext(),
    );

    expect(sources[0].title).toBe(`${'x'.repeat(79)}…`);
  });

  it('titles a commit with no message by its short SHA', async () => {
    const { sources } = await extractCommit(
      { args: {}, text: json({ sha: SHA, html_url: `https://github.com/acme/app/commit/${SHA}` }) },
      makeContext(),
    );

    expect(sources[0].title).toBe('Commit ebf99be');
  });

  it('reads the repository from the arguments when the result has no link', async () => {
    const { sources } = await extractCommit(
      { args: { owner: 'acme', repo: 'app' }, text: json({ sha: SHA }) },
      makeContext(),
    );

    expect(sources[0]).toMatchObject({ repo: 'acme/app' });
  });

  it('makes no source for a repository that is not allowed', async () => {
    const result = await extractCommit(
      {
        args: {},
        text: json({ sha: SHA, html_url: `https://github.com/other/repo/commit/${SHA}` }),
      },
      makeContext(),
    );

    expect(result).toMatchObject({ sources: [], reason: 'repo-not-allowed' });
  });

  it.each(['not json', '{}', json({ sha: 'abc123' }), json({ sha: 42 }), json([1])])(
    'makes no source from a result it cannot read: %s',
    async (text) => {
      expect(await extractCommit({ args: {}, text }, makeContext())).toMatchObject({
        sources: [],
        blocked: false,
        reason: 'unparseable',
      });
    },
  );
});

describe('extractCommitList', () => {
  it('makes a candidate of each real commit, never a source', async () => {
    const result = await extractCommitList(fixtureInput('list_commits'), makeContext());

    expect(result.sources).toEqual([]);
    expect(result.candidates).toHaveLength(3);
    expect(result.candidates[0]).toEqual({
      type: 'github',
      title: 'Commit message 1',
      url: `https://github.com/acme/app/commit/${SHA}`,
    });
  });

  it('leaves out commits of a repository that is not allowed, and items without a link', async () => {
    const text = json([
      {
        sha: SHA,
        html_url: `https://github.com/acme/app/commit/${SHA}`,
        commit: { message: 'ok' },
      },
      {
        sha: OTHER,
        html_url: `https://github.com/other/repo/commit/${OTHER}`,
        commit: { message: 'no' },
      },
      { commit: { message: 'no link' } },
    ]);

    const result = await extractCommitList({ args: {}, text }, makeContext());

    expect(result.candidates.map(({ title }) => title)).toEqual(['ok']);
  });

  it('titles a commit without a message by its link', async () => {
    const url = `https://github.com/acme/app/commit/${SHA}`;

    const result = await extractCommitList(
      { args: {}, text: json([{ html_url: url }]) },
      makeContext(),
    );

    expect(result.candidates[0].title).toBe(url);
  });

  it('keeps at most ten', async () => {
    const items = Array.from({ length: 14 }, (_, index) => ({
      html_url: `https://github.com/acme/app/commit/${index}`,
      commit: { message: `m${index}` },
    }));

    expect(
      (await extractCommitList({ args: {}, text: json(items) }, makeContext())).candidates,
    ).toHaveLength(10);
  });

  it.each(['not json', '{}', '"text"'])('finds nothing in %s', async (text) => {
    expect(await extractCommitList({ args: {}, text }, makeContext())).toMatchObject({
      candidates: [],
      reason: 'unparseable',
    });
  });
});

describe('extractRelease', () => {
  it('registers a real release, pinned by its tag link, with the commit it names', async () => {
    const result = await extractRelease(fixtureInput('get_latest_release'), makeContext());

    expect(result.sources).toEqual([
      {
        type: 'github',
        repo: 'acme/app',
        path: '',
        title: 'Placeholder text 5',
        commitSha: SHA,
        url: 'https://github.com/acme/app/releases/tag/part-54',
        latestUrl: 'https://github.com/acme/app/releases/tag/part-54',
        kind: 'release',
        pinned: true,
      },
    ]);
  });

  it('does not take a branch name for a commit', async () => {
    const text = json({
      tag_name: 'v1',
      target_commitish: 'main',
      html_url: 'https://github.com/acme/app/releases/tag/v1',
    });

    const { sources } = await extractRelease({ args: {}, text }, makeContext());

    expect(sources[0]).toMatchObject({ commitSha: '', pinned: true });
  });

  it('falls back to the release name when there is no tag', async () => {
    const text = json({ name: 'Spring', html_url: 'https://github.com/acme/app/releases/tag/s' });

    expect((await extractRelease({ args: {}, text }, makeContext())).sources[0].title).toBe(
      'Spring',
    );
  });

  it('makes no source for a repository that is not allowed', async () => {
    const text = json({
      tag_name: 'v1',
      html_url: 'https://github.com/other/repo/releases/tag/v1',
    });

    expect(await extractRelease({ args: {}, text }, makeContext())).toMatchObject({
      sources: [],
      reason: 'repo-not-allowed',
    });
  });

  it.each([
    'not json',
    '{}',
    json({ tag_name: 'v1' }),
    json({ html_url: 'https://github.com/acme/app/releases' }),
  ])('makes no source from a result it cannot read: %s', async (text) => {
    expect(await extractRelease({ args: {}, text }, makeContext())).toMatchObject({
      sources: [],
      reason: 'unparseable',
    });
  });
});

describe('extractReleaseList', () => {
  it('makes a candidate of each real release, never a source', async () => {
    const result = await extractReleaseList(fixtureInput('list_releases'), makeContext());

    expect(result.sources).toEqual([]);
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates[0]).toMatchObject({
      type: 'github',
      url: 'https://github.com/acme/app/releases/tag/part-54',
    });
  });

  it('leaves out releases of other repositories and items missing a link or a name', async () => {
    const text = json([
      { tag_name: 'v1', html_url: 'https://github.com/acme/app/releases/tag/v1' },
      { tag_name: 'v2', html_url: 'https://github.com/other/repo/releases/tag/v2' },
      { tag_name: 'v3' },
      { html_url: 'https://github.com/acme/app/releases/tag/v4' },
    ]);

    const result = await extractReleaseList({ args: {}, text }, makeContext());

    expect(result.candidates.map(({ title }) => title)).toEqual(['v1']);
  });

  it('uses the name when there is no tag, and keeps at most ten', async () => {
    const items = Array.from({ length: 13 }, (_, index) => ({
      name: `n${index}`,
      html_url: `https://github.com/acme/app/releases/tag/${index}`,
    }));

    const result = await extractReleaseList({ args: {}, text: json(items) }, makeContext());

    expect(result.candidates).toHaveLength(10);
    expect(result.candidates[0].title).toBe('n0');
  });

  it.each(['not json', '{}'])('finds nothing in %s', async (text) => {
    expect(await extractReleaseList({ args: {}, text }, makeContext())).toMatchObject({
      candidates: [],
      reason: 'unparseable',
    });
  });
});

describe('extractCodeSearch', () => {
  it('finds nothing in the real result, which had no hits', async () => {
    const result = await extractCodeSearch(fixtureInput('search_code'), makeContext());

    expect(result).toMatchObject({ sources: [], candidates: [], blocked: false });
  });

  it('makes candidates of the hits in the synthetic fixture, leaving out a repository not allowed', async () => {
    const result = await extractCodeSearch(fixtureInput('search_code.synthetic'), makeContext());

    expect(result.sources).toEqual([]);
    expect(result.candidates).toEqual([
      {
        type: 'github',
        title: 'src/refunds/refund_policy.ts',
        url: `https://github.com/acme/app/blob/${SHA}/src/refunds/refund_policy.ts`,
      },
      {
        type: 'github',
        title: 'src/refunds/approval.ts',
        url: `https://github.com/acme/app/blob/${SHA}/src/refunds/approval.ts`,
      },
    ]);
  });

  it('reads the repository from the link when the hit does not name it, and the title from the name', async () => {
    const text = json({
      items: [{ name: 'a.js', html_url: `https://github.com/acme/app/blob/${SHA}/a.js` }],
    });

    const result = await extractCodeSearch({ args: {}, text }, makeContext());

    expect(result.candidates).toEqual([
      { type: 'github', title: 'a.js', url: `https://github.com/acme/app/blob/${SHA}/a.js` },
    ]);
  });

  it('leaves out hits with no link or no name, and keeps at most ten', async () => {
    const items = [
      { path: 'a.js', repository: { full_name: 'acme/app' } },
      {
        html_url: 'https://github.com/acme/app/blob/x/b.js',
        repository: { full_name: 'acme/app' },
      },
      ...Array.from({ length: 12 }, (_, index) => ({
        path: `f${index}.js`,
        html_url: `https://github.com/acme/app/blob/x/f${index}.js`,
        repository: { full_name: 'acme/app' },
      })),
    ];

    const result = await extractCodeSearch({ args: {}, text: json({ items }) }, makeContext());

    expect(result.candidates).toHaveLength(10);
    expect(result.candidates[0].title).toBe('f0.js');
  });

  it.each(['not json', '{}', '{"items":"x"}'])('finds nothing in %s', async (text) => {
    expect(await extractCodeSearch({ args: {}, text }, makeContext())).toMatchObject({
      candidates: [],
      reason: 'unparseable',
    });
  });
});
