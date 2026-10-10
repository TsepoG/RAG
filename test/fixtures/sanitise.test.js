// @ts-check
import { describe, expect, it } from 'vitest';
import { findForbiddenContent } from '../../src/fixtures/check.js';
import { createSanitiser } from '../../src/fixtures/sanitise.js';

const SHA = 'ebf99bea1fdf70b3a206c622a5134068c73eb607';
const OTHER_SHA = '0123456789abcdef0123456789abcdef01234567';
const LIMITS = {
  siteHost: 'realcorp.atlassian.net',
  repos: ['RealOrg/Real-App', 'RealOrg/Real-Docs'],
  spaceKeys: ['RC', 'HR'],
};

/**
 * Builds a sanitiser and runs it over one value.
 * @param {unknown} value - The raw value.
 * @returns {any} The sanitised copy.
 */
function sanitise(value) {
  return createSanitiser(LIMITS).sanitise(value);
}

describe('sanitise: what stays', () => {
  it('keeps numbers, booleans, dates, SHAs and numeric ids', () => {
    const raw = {
      id: '262439',
      version: { number: 14, createdAt: '2026-03-02T09:30:00.000Z' },
      draft: false,
      sha: SHA,
      day: '2026-03-02',
    };

    expect(sanitise(raw)).toEqual(raw);
  });

  it('keeps the values that describe the shape of a result', () => {
    const raw = { type: 'page', status: 'current', detail: 'full', format: 'storage', ref: 'main' };

    expect(sanitise(raw)).toEqual(raw);
  });

  it('keeps null, empty strings and empty arrays', () => {
    const raw = { a: null, b: '', c: [] };

    expect(sanitise(raw)).toEqual(raw);
  });
});

describe('sanitise: what is replaced', () => {
  it('replaces titles, bodies and other text with neutral placeholders', () => {
    const result = sanitise({
      title: 'Refund policy',
      body: { value: '<p>Secret internal rules</p>' },
      message: 'fix: patch the ledger',
      excerpt: 'some real excerpt text',
    });

    expect(result).toEqual({
      title: 'Page title 1',
      body: { value: 'Placeholder text 1' },
      message: 'Commit message 1',
      excerpt: 'Placeholder text 2',
    });
  });

  it('gives the same original the same placeholder, and different originals different ones', () => {
    const result = sanitise({
      a: { title: 'Design' },
      b: { title: 'Design' },
      c: { title: 'Plan' },
    });

    expect(result.a.title).toBe(result.b.title);
    expect(result.c.title).not.toBe(result.a.title);
  });

  it('is deterministic across runs and does not change its input', () => {
    const raw = { title: 'Design', path: 'src/billing/refund.js' };
    const copy = structuredClone(raw);

    expect(createSanitiser(LIMITS).sanitise(raw)).toEqual(createSanitiser(LIMITS).sanitise(raw));
    expect(raw).toEqual(copy);
  });

  it('replaces paths part by part, keeping extensions and sharing parts across values', () => {
    const result = sanitise({ path: 'docs/Guide.md', filename: 'docs/Other.md', name: 'Guide.md' });

    expect(result).toEqual({
      path: 'part-1/part-2.md',
      filename: 'part-1/part-3.md',
      name: 'part-2.md',
    });
  });

  it('does not let a dotfile name survive as its extension', () => {
    const output = JSON.stringify(sanitise({ path: '.secretdir', name: 'config.production' }));

    expect(output).toBe('{"path":"part-1","name":"part-2"}');
  });

  it('keeps only well-known extensions', () => {
    expect(sanitise([{ path: 'x.md' }, { path: 'x.PY' }, { path: 'x.internalword' }])).toEqual([
      { path: 'part-1.md' },
      { path: 'part-2.py' },
      { path: 'part-3' },
    ]);
  });

  it('maps every UUID to a stable placeholder UUID', () => {
    const cloud = '82b58a78-f056-49aa-a740-c3c946f68f8b';
    const result = sanitise({ cloudId: cloud, again: cloud });

    expect(result.cloudId).toBe('00000000-0000-4000-8000-000000000001');
    expect(result.again).toBe(result.cloudId);
  });

  it('keeps the original out of the output and records it as replaced', () => {
    const sanitiser = createSanitiser(LIMITS);

    const output = JSON.stringify(sanitiser.sanitise({ title: 'Refund policy v3' }));

    expect(output).not.toContain('Refund policy');
    expect(sanitiser.replacedStrings()).toContain('Refund policy v3');
  });
});

describe('sanitise: people', () => {
  it('replaces names, logins, emails and their numeric ids', () => {
    const result = sanitise({
      commit: {
        author: {
          name: 'Ada Lovelace',
          email: 'ada@realcorp.example',
          date: '2026-01-01T00:00:00Z',
        },
      },
      author: { login: 'adal', id: 4711, html_url: 'https://github.com/adal' },
    });

    expect(result.commit.author).toEqual({
      name: 'Person 1',
      email: 'user1@example.com',
      date: '2026-01-01T00:00:00Z',
    });
    expect(result.author).toEqual({
      login: 'user1',
      id: 900_001,
      html_url: 'https://github.com/part-1',
    });
  });

  it.each(['authorId', 'accountId', 'ownerId'])(
    'replaces an Atlassian account id under %s',
    (key) => {
      const result = sanitise({ [key]: '712020:5b1f1c4a-91b2-4c3d-8e7f-0123456789ab' });

      expect(result[key]).toBe('account-1');
    },
  );

  it('replaces an email wherever it appears as a whole value', () => {
    expect(sanitise({ contact: 'someone@realcorp.example' }).contact).toBe('user1@example.com');
  });
});

describe('sanitise: URLs', () => {
  it('maps the site host, space key and slug, keeping the page id', () => {
    const result = sanitise({
      url: 'https://realcorp.atlassian.net/wiki/spaces/RC/pages/262439/Design',
    });

    expect(result.url).toBe('https://acme.atlassian.net/wiki/spaces/ENG/pages/262439/part-1');
  });

  it('maps site-relative paths too', () => {
    expect(sanitise({ webui: '/spaces/HR/pages/98379/Payroll' }).webui).toBe(
      '/spaces/SPACE2/pages/98379/part-1',
    );
  });

  it('maps owners, repositories and numbers repositories after the first', () => {
    const result = sanitise({
      a: 'https://github.com/RealOrg/Real-App/blob/main/README.md',
      b: 'https://github.com/RealOrg/Real-Docs/releases/tag/v1.0.0',
    });

    expect(result).toEqual({
      a: 'https://github.com/acme/app/blob/main/part-1.md',
      b: 'https://github.com/acme/app-2/releases/tag/part-2',
    });
  });

  it('maps a repo:// URI, keeping the commit SHA', () => {
    const result = sanitise({
      uri: `repo://RealOrg/Real-App/sha/${SHA}/contents/docs/Guide.md`,
    });

    expect(result.uri).toBe(`repo://acme/app/sha/${SHA}/contents/part-1/part-2.md`);
  });

  it('keeps SHAs in paths and leaves other hex strings to be replaced', () => {
    const result = sanitise({
      u: `https://api.github.com/repos/RealOrg/Real-App/commits/${OTHER_SHA}`,
    });

    expect(result.u).toBe(`https://api.github.com/repos/acme/app/commits/${OTHER_SHA}`);
  });

  it.each([
    'https://avatars.githubusercontent.com/u/4711?v=4',
    'https://other-corp.example/page',
    'https://evil.atlassian.net/wiki/spaces/RC/pages/1',
  ])('replaces a URL on a host that is not mapped: %s', (url) => {
    expect(sanitise({ url }).url).toBe('https://example.com/placeholder');
  });

  it('handles a very short site-relative path', () => {
    expect(sanitise({ link: '/a/b' }).link).toBe('/part-1/part-2');
  });

  it('replaces a query string and a fragment, which may carry real values', () => {
    const result = sanitise({
      next: '/rest/api/search?cql=space%3DRC&cursor=abc',
      page: 'https://realcorp.atlassian.net/wiki/spaces/RC/pages/1/Design#Real-Heading',
    });

    expect(result).toEqual({
      next: '/rest/api/search?placeholder=1',
      page: 'https://acme.atlassian.net/wiki/spaces/ENG/pages/1/part-1#section',
    });
  });
});

describe('sanitise: JSON inside strings', () => {
  it('sanitises the JSON a tool returns as text, and writes it back as text', () => {
    const inner = { data: { id: '1', title: 'Real title', metadata: { version: { number: 3 } } } };

    const result = sanitise({ content: [{ type: 'text', text: JSON.stringify(inner) }] });

    expect(JSON.parse(result.content[0].text)).toEqual({
      data: { id: '1', title: 'Page title 1', metadata: { version: { number: 3 } } },
    });
  });

  it('treats text that only looks like JSON as ordinary text', () => {
    expect(sanitise({ text: '{not json at all' }).text).toBe('Placeholder text 1');
  });
});

describe('sanitise: a realistic result leaves nothing to find', () => {
  it('passes the leak check', () => {
    const sanitiser = createSanitiser(LIMITS);
    const raw = {
      server: 'atlassian',
      arguments: {
        cloudId: '82b58a78-f056-49aa-a740-c3c946f68f8b',
        content_url: 'https://realcorp.atlassian.net/wiki/spaces/RC/pages/262439',
        cql: 'space = RC AND text ~ "realcorp"',
      },
      result: {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              data: {
                id: '262439',
                title: 'RealCorp refund policy',
                body: { value: '<p>Contact boss@realcorp.example</p>' },
                metadata: { authorId: '712020:5b1f1c4a-91b2-4c3d-8e7f-0123456789ab' },
              },
            }),
          },
        ],
      },
    };

    const output = JSON.stringify(sanitiser.sanitise(raw));

    expect(
      findForbiddenContent(output, {
        names: ['realcorp', 'RealOrg', 'Real-App', 'RC'],
        replaced: sanitiser.replacedStrings(),
      }),
    ).toEqual([]);
  });
});
