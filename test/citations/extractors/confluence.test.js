// @ts-check
import { describe, expect, it } from 'vitest';
import { extractConfluenceContent } from '../../../src/citations/extractors/getConfluenceContent.js';
import { extractConfluenceSearch } from '../../../src/citations/extractors/searchConfluence.js';
import { fixtureInput, makeContext } from '../../helpers/extraction.js';

const PAGE_URL = 'https://acme.atlassian.net/wiki/spaces/ENG/pages/262439';

/**
 * Builds the text of a page result.
 * @param {Record<string, unknown>} [data] - Fields to put in `data`.
 * @returns {string} The result text.
 */
function pageText(data = {}) {
  return JSON.stringify({
    data: {
      id: '262439',
      title: 'Refund Policy',
      metadata: { version: { number: 3, createdAt: '2026-08-12T09:30:00.000Z' } },
      ...data,
    },
  });
}

/**
 * Builds the text of a search result.
 * @param {Array<Record<string, unknown>>} results - The hits.
 * @returns {string} The result text.
 */
function searchText(results) {
  return JSON.stringify({ data: { results } });
}

describe('extractConfluenceContent from a real fixture', () => {
  it('registers the page with its version, space, date and a link built from the site', async () => {
    const result = await extractConfluenceContent(
      fixtureInput('getConfluenceContent'),
      makeContext(),
    );

    expect(result).toEqual({
      sources: [
        {
          type: 'confluence',
          id: '262439',
          title: 'Page title 1',
          spaceKey: 'ENG',
          version: 1,
          lastUpdated: '2026-10-10T10:54:29.040Z',
          url: PAGE_URL,
          stale: false,
        },
      ],
      candidates: [],
      blocked: false,
    });
  });
});

describe('extractConfluenceContent', () => {
  const args = { content_url: `${PAGE_URL}/Refund+Policy`, cloudId: 'id' };

  it('marks a page last updated over twelve months ago as stale', async () => {
    const context = makeContext({ now: () => Date.parse('2027-09-13T00:00:00Z') });

    const { sources } = await extractConfluenceContent({ args, text: pageText() }, context);

    expect(sources[0]).toMatchObject({ stale: true });
  });

  it('does not mark a page updated within twelve months as stale', async () => {
    const context = makeContext({ now: () => Date.parse('2027-08-01T00:00:00Z') });

    const { sources } = await extractConfluenceContent({ args, text: pageText() }, context);

    expect(sources[0]).toMatchObject({ stale: false });
  });

  it('leaves the date out, and the page not stale, when the result has none', async () => {
    const text = pageText({ metadata: { version: { number: 3 } } });

    const { sources } = await extractConfluenceContent({ args, text }, makeContext());

    expect(sources[0]).not.toHaveProperty('lastUpdated');
    expect(sources[0]).toMatchObject({ stale: false });
  });

  it('keeps the display name of whoever saved the version, when the result has one', async () => {
    const text = pageText({
      metadata: { version: { number: 3, by: { displayName: 'Dana Reyes', accountId: 'a-1' } } },
    });

    const { sources } = await extractConfluenceContent({ args, text }, makeContext());

    expect(sources[0]).toMatchObject({ lastEditor: 'Dana Reyes' });
    expect(JSON.stringify(sources)).not.toContain('a-1');
  });

  it('leaves the editor out when the result has only an account id, as the real one does', async () => {
    const { sources } = await extractConfluenceContent(
      fixtureInput('getConfluenceContent'),
      makeContext(),
    );

    expect(sources[0]).not.toHaveProperty('lastEditor');
  });

  it.each([{ by: {} }, { by: { displayName: '' } }, { by: { displayName: 5 } }, { by: 'Dana' }])(
    'leaves the editor out for %j',
    async (by) => {
      const text = pageText({ metadata: { version: { number: 3, ...by } } });

      const { sources } = await extractConfluenceContent({ args, text }, makeContext());

      expect(sources[0]).not.toHaveProperty('lastEditor');
    },
  );

  it('takes the space from the validated URL, ignoring the case of the key', async () => {
    const lower = { content_url: 'https://acme.atlassian.net/wiki/spaces/eng/pages/262439' };

    const { sources, blocked } = await extractConfluenceContent(
      { args: lower, text: pageText() },
      makeContext(),
    );

    expect(blocked).toBe(false);
    expect(sources[0]).toMatchObject({ spaceKey: 'eng' });
  });

  it('builds the link from the configured site and the page id, not from the argument', async () => {
    const { sources } = await extractConfluenceContent({ args, text: pageText() }, makeContext());

    expect(sources[0]).toMatchObject({ url: PAGE_URL });
  });

  it('gives an untitled page a title from its id', async () => {
    const { sources } = await extractConfluenceContent(
      { args, text: pageText({ title: undefined }) },
      makeContext(),
    );

    expect(sources[0]).toMatchObject({ title: 'Page 262439' });
  });

  it('blocks a page whose id is not the page the URL names', async () => {
    const result = await extractConfluenceContent(
      { args, text: pageText({ id: '999' }) },
      makeContext(),
    );

    expect(result).toMatchObject({ blocked: true, reason: 'id-mismatch', sources: [] });
  });

  it('blocks a page in a space that is not allowed', async () => {
    const hr = { content_url: 'https://acme.atlassian.net/wiki/spaces/HR/pages/262439' };

    const result = await extractConfluenceContent({ args: hr, text: pageText() }, makeContext());

    expect(result).toMatchObject({ blocked: true, reason: 'space-not-allowed', sources: [] });
  });

  it.each([
    'https://acme.atlassian.net/wiki/spaces/ENG/overview',
    'https://acme.atlassian.net/wiki/spaces/ENG',
    'not a url',
    'https://acme.atlassian.net/wiki/display/ENG/Page',
  ])('blocks a content_url that names no page and space: %s', async (contentUrl) => {
    const result = await extractConfluenceContent(
      { args: { content_url: contentUrl }, text: pageText() },
      makeContext(),
    );

    expect(result).toMatchObject({ blocked: true, reason: 'space-unknown' });
  });

  it('blocks a page fetched by content_id when the result does not name the space', async () => {
    const result = await extractConfluenceContent(
      { args: { content_id: '262439' }, text: pageText() },
      makeContext(),
    );

    expect(result).toMatchObject({ blocked: true, reason: 'space-unknown' });
  });

  it.each([
    ['an object', { space: { key: 'ENG' } }],
    ['a field', { spaceKey: 'ENG' }],
  ])('reads the space from the result when fetched by content_id, from %s', async (_how, extra) => {
    const result = await extractConfluenceContent(
      { args: { content_id: '262439' }, text: pageText(extra) },
      makeContext(),
    );

    expect(result.blocked).toBe(false);
    expect(result.sources[0]).toMatchObject({ spaceKey: 'ENG' });
  });

  it('blocks a page fetched by content_id when the result names another space', async () => {
    const result = await extractConfluenceContent(
      { args: { content_id: '262439' }, text: pageText({ space: { key: 'HR' } }) },
      makeContext(),
    );

    expect(result).toMatchObject({ blocked: true, reason: 'space-not-allowed' });
  });

  it.each([
    ['text that is not JSON', 'Something went wrong'],
    ['JSON without data', '{"error":"nope"}'],
    ['an empty object', '{}'],
    ['a page without an id', pageText({ id: undefined })],
    ['a page without a version', pageText({ metadata: {} })],
    ['a version that is not a number', pageText({ metadata: { version: { number: '3' } } })],
  ])('blocks %s, because content that cannot be checked is not shown', async (_what, text) => {
    const result = await extractConfluenceContent({ args, text }, makeContext());

    expect(result).toMatchObject({ blocked: true, reason: 'unparseable', sources: [] });
  });

  it('treats missing arguments as no URL', async () => {
    const result = await extractConfluenceContent(
      { args: undefined, text: pageText() },
      makeContext(),
    );

    expect(result).toMatchObject({ blocked: true, reason: 'space-unknown' });
  });
});

describe('extractConfluenceSearch from a real fixture', () => {
  it('makes a candidate of each hit, with a link built from the site', async () => {
    const result = await extractConfluenceSearch(fixtureInput('searchConfluence'), makeContext());

    expect(result.blocked).toBe(false);
    expect(result.sources).toEqual([]);
    expect(result.candidates).toHaveLength(5);
    expect(result.candidates[0]).toEqual({
      type: 'confluence',
      title: 'Page title 2',
      url: 'https://acme.atlassian.net/wiki/spaces/ENG/pages/98379',
    });
  });
});

describe('extractConfluenceSearch', () => {
  const hit = (/** @type {string} */ path, extra = {}) => ({
    title: 'A page',
    url: path,
    ...extra,
  });

  it('accepts a hit in an allowed space whatever the case of its key', async () => {
    const text = searchText([hit('/spaces/eng/pages/1/slug')]);

    const result = await extractConfluenceSearch({ args: {}, text }, makeContext());

    expect(result.candidates).toHaveLength(1);
  });

  it('reads the location from the content links when the hit has no url', async () => {
    const text = searchText([
      { title: 'A page', content: { _links: { webui: '/spaces/ENG/pages/2/slug' } } },
    ]);

    const result = await extractConfluenceSearch({ args: {}, text }, makeContext());

    expect(result.candidates[0].url).toBe('https://acme.atlassian.net/wiki/spaces/ENG/pages/2');
  });

  it('accepts a path that starts with /wiki', async () => {
    const text = searchText([hit('/wiki/spaces/PROD/pages/3/slug')]);

    const result = await extractConfluenceSearch({ args: {}, text }, makeContext());

    expect(result.candidates[0].url).toBe('https://acme.atlassian.net/wiki/spaces/PROD/pages/3');
  });

  it('takes the title from the content when the hit has none', async () => {
    const text = searchText([{ url: '/spaces/ENG/pages/4/s', content: { title: 'From content' } }]);

    const result = await extractConfluenceSearch({ args: {}, text }, makeContext());

    expect(result.candidates[0].title).toBe('From content');
  });

  it('blocks the whole result when any hit is outside the allowed spaces', async () => {
    const text = searchText([hit('/spaces/ENG/pages/1/a'), hit('/spaces/HR/pages/2/b')]);

    const result = await extractConfluenceSearch({ args: {}, text }, makeContext());

    expect(result).toMatchObject({ blocked: true, reason: 'space-not-allowed', candidates: [] });
  });

  it.each([
    ['has no location', { title: 'A page' }],
    ['has a location that names no space', hit('/people/someone')],
  ])('blocks the whole result when a hit %s', async (_what, bad) => {
    const result = await extractConfluenceSearch(
      { args: {}, text: searchText([bad]) },
      makeContext(),
    );

    expect(result).toMatchObject({ blocked: true, reason: 'space-unknown' });
  });

  it('checks the space of a hit that is not a page, but makes no candidate of it', async () => {
    const ok = await extractConfluenceSearch(
      { args: {}, text: searchText([hit('/spaces/ENG/overview')]) },
      makeContext(),
    );
    const bad = await extractConfluenceSearch(
      { args: {}, text: searchText([hit('/spaces/HR/overview')]) },
      makeContext(),
    );

    expect(ok).toMatchObject({ blocked: false, candidates: [] });
    expect(bad.blocked).toBe(true);
  });

  it('makes no candidate of a hit without a title', async () => {
    const text = searchText([{ url: '/spaces/ENG/pages/5/s' }]);

    expect((await extractConfluenceSearch({ args: {}, text }, makeContext())).candidates).toEqual(
      [],
    );
  });

  it('keeps at most ten candidates', async () => {
    const text = searchText(
      Array.from({ length: 15 }, (_, index) => hit(`/spaces/ENG/pages/${index + 1}/s`)),
    );

    const result = await extractConfluenceSearch({ args: {}, text }, makeContext());

    expect(result.candidates).toHaveLength(10);
  });

  it('accepts a search with no hits', async () => {
    expect(
      await extractConfluenceSearch({ args: {}, text: searchText([]) }, makeContext()),
    ).toMatchObject({ blocked: false, candidates: [], sources: [] });
  });

  it.each(['not json', '{}', '{"data":{}}', '{"data":{"results":"x"}}'])(
    'blocks a result it cannot read: %s',
    async (text) => {
      expect(await extractConfluenceSearch({ args: {}, text }, makeContext())).toMatchObject({
        blocked: true,
        reason: 'unparseable',
      });
    },
  );
});
