// @ts-check
import { describe, expect, it } from 'vitest';
import {
  capSource,
  confluencePageText,
  CUT_NOTICE,
  htmlToText,
  MAX_SOURCE_CHARS,
} from '../../src/mcp/sourceText.js';

/**
 * A Confluence result for a page.
 * @param {Record<string, unknown>} [data] - Fields of the page to set.
 * @returns {string} The result as the server returns it.
 */
function page(data = {}) {
  return JSON.stringify({
    data: {
      id: '262439',
      title: 'Design',
      body: { format: 'html', value: '<p>Hello</p>' },
      metadata: { version: { number: 4, createdAt: '2026-10-10T10:54:29.040Z' } },
      ...data,
    },
  });
}

describe('htmlToText', () => {
  it('keeps headings as # lines and drops attributes', () => {
    const text = htmlToText('<h1 data-local-id="x">Title</h1><h3 class="y">Part</h3><p>Body.</p>');

    expect(text).toBe('# Title\n\n### Part\n\nBody.');
  });

  it('writes list items, line breaks and rules', () => {
    const text = htmlToText('<ul><li>one</li><li>two<br>three</li></ul><hr><p>end</p>');

    expect(text).toBe('- one\n- two\nthree\n---\n\nend');
  });

  it('joins a list item with the paragraph inside it', () => {
    expect(htmlToText('<ul><li><p>text</p></li></ul>')).toBe('- text');
  });

  it('joins a list item with its text even when an empty paragraph comes first', () => {
    expect(htmlToText('<ul><li><p></p><p>text</p></li></ul>')).toBe('- text');
  });

  it('writes a table with one row to a line and cells divided by bars', () => {
    const text = htmlToText(
      '<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>',
    );

    expect(text).toBe('A | B |\n1 | 2 |');
  });

  it('puts code in a fenced block', () => {
    expect(htmlToText('<pre>a &lt; b</pre>')).toBe('```\na < b\n```');
  });

  it('turns entities back into characters, once', () => {
    expect(htmlToText('<p>&quot;a&quot; &amp; &amp;lt; it&#39;s</p>')).toBe('"a" & &lt; it\'s');
  });

  it('drops scripts and styles with their content, and unknown tags but not their text', () => {
    const text = htmlToText('<p>a<script>alert(1)</script><span>b</span><style>p{}</style></p>');

    expect(text).toBe('ab');
  });

  it('collapses runs of blank lines and has no blank line at the start', () => {
    expect(htmlToText('<p></p><p></p><p>a</p><p></p><p></p><p>b</p>')).toBe('a\n\nb');
  });
});

describe('confluencePageText', () => {
  it('gives the title, id and version above the body as text', () => {
    expect(confluencePageText(page())).toBe(
      'Title: Design\nPage id: 262439\nVersion: 4\nLast updated: 2026-10-10T10:54:29.040Z\n\nHello',
    );
  });

  it('leaves out header lines the page does not have', () => {
    const text = confluencePageText(page({ title: 1, id: 2, metadata: {} }));

    expect(text).toBe('\n\nHello');
  });

  it.each([
    ['not JSON', 'plain text'],
    ['JSON with no page', '[]'],
    ['a body that is not HTML', page({ body: { format: 'storage', value: 'x' } })],
    ['a body with no text', page({ body: { format: 'html' } })],
    ['no body', page({ body: undefined })],
  ])('says nothing for %s, so the result is used as it came', (_name, text) => {
    expect(confluencePageText(text)).toBeUndefined();
  });
});

describe('capSource', () => {
  it('leaves text up to the limit alone', () => {
    const text = 'x'.repeat(MAX_SOURCE_CHARS);

    expect(capSource(text)).toBe(text);
  });

  it('cuts at the limit with a notice when there is no line break near', () => {
    const cut = capSource('x'.repeat(MAX_SOURCE_CHARS + 10));

    expect(cut).toBe(`${'x'.repeat(MAX_SOURCE_CHARS)}${CUT_NOTICE}`);
  });

  it('cuts at a line break when one is near the limit', () => {
    const text = `${'x'.repeat(MAX_SOURCE_CHARS - 20)}\n${'y'.repeat(100)}`;

    expect(capSource(text)).toBe(`${'x'.repeat(MAX_SOURCE_CHARS - 20)}${CUT_NOTICE}`);
  });

  it('names the headings that were cut when asked, and not the ones that were kept', () => {
    const text = `## Kept\n${'x'.repeat(MAX_SOURCE_CHARS)}\n## Gone\ntext\n#### Also gone\n`;

    const cut = capSource(text, { names: true });

    expect(cut).toContain('Sections that were cut and not read: Gone; Also gone.');
    expect(cut).not.toContain('Kept;');
  });

  it('does not name headings unless asked', () => {
    const text = `${'x'.repeat(MAX_SOURCE_CHARS)}\n## Gone\n`;

    expect(capSource(text)).not.toContain('Gone');
  });

  it('adds no list when the part that was cut has no headings', () => {
    expect(capSource('x'.repeat(MAX_SOURCE_CHARS + 5), { names: true })).toBe(
      `${'x'.repeat(MAX_SOURCE_CHARS)}${CUT_NOTICE}`,
    );
  });

  it('names at most 40 headings, counts the rest, and shortens a long one', () => {
    const headings = Array.from({ length: 44 }, (_unused, index) => `## H${index}`).join('\n');
    const text = `${'x'.repeat(MAX_SOURCE_CHARS)}\n## ${'w'.repeat(200)}\n${headings}\n`;

    const cut = capSource(text, { names: true });

    expect(cut).toContain(`not read: ${'w'.repeat(80)}; H0; H1;`);
    expect(cut).toContain('H38 and 5 more.');
    expect(cut).not.toContain('H39;');
    expect(cut).not.toContain('w'.repeat(81));
  });
});
