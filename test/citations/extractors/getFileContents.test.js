// @ts-check
import { describe, expect, it, vi } from 'vitest';
import { extractFileContents } from '../../../src/citations/extractors/getFileContents.js';
import { BLOB_SHA, fixtureInput, HEAD_SHA, makeContext } from '../../helpers/extraction.js';

const COMMIT_SHA = 'ebf99bea1fdf70b3a206c622a5134068c73eb607';
const ARGS = { owner: 'acme', repo: 'app', path: 'docs/Guide.md' };
const FILE_TEXT = `successfully downloaded text file (SHA: ${BLOB_SHA})# Guide`;

/**
 * Builds the log of a file result, which names its resource.
 * @param {string} uri - The resource URI.
 * @returns {string} A log containing the URI.
 */
const logFor = (uri) => `${uri}\n# Guide`;

describe('extractFileContents from a real fixture', () => {
  it('pins the file to the commit named in its resource, not to anything else', async () => {
    const result = await extractFileContents(
      fixtureInput('get_file_contents'),
      makeContext({ resolveHead: vi.fn(async () => HEAD_SHA) }),
    );

    expect(result.sources).toEqual([
      {
        type: 'github',
        repo: 'acme/app',
        path: 'part-48.md',
        title: 'part-48.md',
        commitSha: COMMIT_SHA,
        url: `https://github.com/acme/app/blob/${COMMIT_SHA}/part-48.md`,
        latestUrl: 'https://github.com/acme/app/blob/HEAD/part-48.md',
        kind: 'file',
        pinned: true,
      },
    ]);
    expect(result).toMatchObject({ blocked: false, candidates: [] });
  });

  it('does not call the resolver when the result names the commit', async () => {
    const resolveHead = vi.fn(async () => HEAD_SHA);

    await extractFileContents(fixtureInput('get_file_contents'), makeContext({ resolveHead }));

    expect(resolveHead).not.toHaveBeenCalled();
  });
});

describe('extractFileContents folder listings', () => {
  const ROOT_ARGS = { owner: 'acme', repo: 'app', path: '/' };

  it('registers a listing as a folder source pinned to the commit its entries name', async () => {
    const resolveHead = vi.fn(async () => HEAD_SHA);

    const result = await extractFileContents(
      fixtureInput('get_file_contents_dir', ROOT_ARGS),
      makeContext({ resolveHead }),
    );

    expect(result.sources).toEqual([
      {
        type: 'github',
        repo: 'acme/app',
        path: '',
        title: '/',
        commitSha: COMMIT_SHA,
        url: `https://github.com/acme/app/tree/${COMMIT_SHA}`,
        latestUrl: 'https://github.com/acme/app/tree/HEAD',
        kind: 'directory',
        pinned: true,
      },
    ]);
    expect(result).toMatchObject({ blocked: false, candidates: [] });
    expect(resolveHead).not.toHaveBeenCalled();
  });

  it('links a sub-folder with its path, ignoring slashes at either end', async () => {
    const { sources } = await extractFileContents(
      { ...fixtureInput('get_file_contents_dir'), args: { ...ROOT_ARGS, path: '/src/my dir/' } },
      makeContext(),
    );

    expect(sources[0]).toMatchObject({
      path: 'src/my dir',
      title: 'src/my dir/',
      url: `https://github.com/acme/app/tree/${COMMIT_SHA}/src/my%20dir`,
      latestUrl: 'https://github.com/acme/app/tree/HEAD/src/my%20dir',
    });
  });

  it('looks up the head commit when no entry names one', async () => {
    const { sources } = await extractFileContents({ args: ROOT_ARGS, text: '[]' }, makeContext());

    expect(sources[0]).toMatchObject({
      commitSha: HEAD_SHA,
      pinned: true,
      url: `https://github.com/acme/app/tree/${HEAD_SHA}`,
    });
  });

  it('does not take a commit from the link of an entry in another repository', async () => {
    const entry = { html_url: `https://github.com/other/repo/blob/${COMMIT_SHA}/a.js` };

    const { sources } = await extractFileContents(
      { args: ROOT_ARGS, text: JSON.stringify([entry]) },
      makeContext({ resolveHead: async () => undefined }),
    );

    expect(sources[0]).toMatchObject({ commitSha: '', pinned: false });
    expect(sources[0].url).toBe('https://github.com/acme/app/tree/HEAD');
  });

  it('does not take a branch name or a blob SHA for a commit', async () => {
    const text = JSON.stringify([
      { html_url: 'https://github.com/acme/app/blob/main/a.js', sha: BLOB_SHA },
      { html_url: 'not a link' },
      'not an object',
    ]);

    const { sources } = await extractFileContents(
      { args: ROOT_ARGS, text },
      makeContext({ resolveHead: async () => undefined }),
    );

    expect(sources[0]).toMatchObject({ commitSha: '' });
    expect(JSON.stringify(sources)).not.toContain(BLOB_SHA);
  });

  it('makes no source for a repository that is not allowed', async () => {
    const result = await extractFileContents(
      { args: { owner: 'other', repo: 'repo', path: '/' }, text: '[]' },
      makeContext(),
    );

    expect(result).toMatchObject({ sources: [], reason: 'repo-not-allowed' });
  });

  it('makes no source for text that starts like a listing but is not one', async () => {
    const result = await extractFileContents({ args: ROOT_ARGS, text: '[oops' }, makeContext());

    expect(result).toMatchObject({ sources: [], reason: 'unparseable' });
  });
});

describe('extractFileContents blob SHAs', () => {
  it('never uses the blob SHA in the result text as the pinned commit', async () => {
    const resolveHead = vi.fn(async () => HEAD_SHA);

    const { sources } = await extractFileContents(
      { args: ARGS, text: FILE_TEXT },
      makeContext({ resolveHead }),
    );

    expect(sources[0]).toMatchObject({ commitSha: HEAD_SHA, pinned: true });
    expect(JSON.stringify(sources)).not.toContain(BLOB_SHA);
    expect(resolveHead).toHaveBeenCalledWith('acme/app');
  });

  it('does not pin to a blob SHA when the resolver finds nothing', async () => {
    const { sources } = await extractFileContents(
      { args: ARGS, text: FILE_TEXT },
      makeContext({ resolveHead: async () => undefined }),
    );

    expect(sources[0]).toMatchObject({ commitSha: '', pinned: false });
    expect(JSON.stringify(sources)).not.toContain(BLOB_SHA);
  });

  it('does not use a blob SHA from the arguments either', async () => {
    const { sources } = await extractFileContents(
      { args: { ...ARGS, sha: BLOB_SHA }, text: FILE_TEXT },
      makeContext({ resolveHead: async () => HEAD_SHA }),
    );

    expect(sources[0]).toMatchObject({ commitSha: HEAD_SHA });
    expect(JSON.stringify(sources)).not.toContain(BLOB_SHA);
  });

  it('never uses a blob SHA from a listing as a commit: the link has none in it', async () => {
    const { sources } = await extractFileContents(
      { args: ARGS, text: FILE_TEXT, log: `${FILE_TEXT} blob ${BLOB_SHA}` },
      makeContext({ resolveHead: async () => undefined }),
    );

    expect(sources[0].url).toBe('https://github.com/acme/app/blob/HEAD/docs/Guide.md');
  });
});

describe('extractFileContents fallback', () => {
  it('looks up the head commit when the result names none, and pins to it', async () => {
    const { sources } = await extractFileContents({ args: ARGS, text: FILE_TEXT }, makeContext());

    expect(sources[0]).toMatchObject({
      commitSha: HEAD_SHA,
      url: `https://github.com/acme/app/blob/${HEAD_SHA}/docs/Guide.md`,
      latestUrl: 'https://github.com/acme/app/blob/HEAD/docs/Guide.md',
      pinned: true,
    });
  });

  it.each([
    ['finds nothing', async () => undefined],
    ['returns something that is not a commit SHA', async () => 'main'],
    ['returns a short SHA', async () => 'ebf99be'],
    [
      'fails',
      async () => {
        throw new Error('network down');
      },
    ],
  ])(
    'links to the default branch and says it is not pinned when the resolver %s',
    async (_what, resolveHead) => {
      const { sources } = await extractFileContents(
        { args: ARGS, text: FILE_TEXT },
        makeContext({ resolveHead }),
      );

      expect(sources[0]).toMatchObject({
        commitSha: '',
        pinned: false,
        url: 'https://github.com/acme/app/blob/HEAD/docs/Guide.md',
      });
    },
  );
});

describe('extractFileContents paths and repositories', () => {
  it('reads the repository and path from the resource, which wins over the arguments', async () => {
    const log = logFor(`repo://acme/app/sha/${COMMIT_SHA}/contents/src/real.js`);

    const { sources } = await extractFileContents(
      { args: { owner: 'x', repo: 'y', path: 'wrong.js' }, text: FILE_TEXT, log },
      makeContext(),
    );

    expect(sources[0]).toMatchObject({ repo: 'acme/app', path: 'src/real.js' });
  });

  it('decodes a percent-encoded path and encodes it again in the link', async () => {
    const log = logFor(`repo://acme/app/sha/${COMMIT_SHA}/contents/My%20Docs/a%23b.md`);

    const { sources } = await extractFileContents(
      { args: ARGS, text: FILE_TEXT, log },
      makeContext(),
    );

    expect(sources[0]).toMatchObject({
      path: 'My Docs/a#b.md',
      url: `https://github.com/acme/app/blob/${COMMIT_SHA}/My%20Docs/a%23b.md`,
    });
  });

  it('keeps a path with a broken percent sequence as it is', async () => {
    const log = logFor(`repo://acme/app/sha/${COMMIT_SHA}/contents/100%.md`);

    const { sources } = await extractFileContents(
      { args: ARGS, text: FILE_TEXT, log },
      makeContext(),
    );

    expect(sources[0]).toMatchObject({ path: '100%.md' });
  });

  it('accepts the repository in any case', async () => {
    const { sources } = await extractFileContents(
      { args: { owner: 'ACME', repo: 'App', path: 'a.md' }, text: FILE_TEXT },
      makeContext(),
    );

    expect(sources[0]).toMatchObject({ repo: 'ACME/App' });
  });

  it('makes no source for a repository that is not allowed', async () => {
    const log = logFor(`repo://other/repo/sha/${COMMIT_SHA}/contents/a.md`);

    const result = await extractFileContents({ args: ARGS, text: FILE_TEXT, log }, makeContext());

    expect(result).toMatchObject({ sources: [], reason: 'repo-not-allowed' });
  });

  it('makes no source when the repository is unknown', async () => {
    const result = await extractFileContents(
      { args: { path: 'a.md' }, text: FILE_TEXT },
      makeContext(),
    );

    expect(result).toMatchObject({ sources: [], reason: 'repo-not-allowed' });
  });

  it.each([{}, { path: '' }, { path: 'docs/' }, { path: '/' }, undefined])(
    'makes no source without a file path: %j',
    async (args) => {
      const result = await extractFileContents({ args, text: FILE_TEXT }, makeContext());

      expect(result).toMatchObject({ sources: [], reason: 'no-file-path' });
    },
  );

  it('reads a listing with leading whitespace as a folder', async () => {
    const result = await extractFileContents(
      { args: ARGS, text: '\n  [{"type":"file"}]' },
      makeContext(),
    );

    expect(result.sources[0]).toMatchObject({ kind: 'directory', path: 'docs/Guide.md' });
  });
});
