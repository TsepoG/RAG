// @ts-check
import { describe, expect, it } from 'vitest';
import { createAnswerHtmlRenderer, sanitizeAnswerHtml } from '../../src/render/index.js';

const SITE_HOST = 'acme.atlassian.net';
const FENCE = '```';
// Built from a variable because the tests need an insecure scheme on purpose, to prove it is refused.
const INSECURE = 'http';
const render = createAnswerHtmlRenderer({ allowedHosts: [SITE_HOST, 'github.com'] });

describe('createAnswerHtmlRenderer markdown', () => {
  it('renders paragraphs, emphasis and lists', () => {
    const html = render('A **bold** and *soft* claim.\n\n- one\n- two\n\n1. first\n2. second');

    expect(html).toContain('<p>A <strong>bold</strong> and <em>soft</em> claim.</p>');
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>one</li>');
    expect(html).toContain('<ol>');
  });

  it.each([
    ['# Title', 'h3'],
    ['## Title', 'h3'],
    ['### Title', 'h3'],
    ['#### Title', 'h4'],
    ['##### Title', 'h5'],
    ['###### Title', 'h5'],
  ])('renders %j as a %s', (markdown, tag) => {
    expect(render(markdown)).toBe(`<${tag}>Title</${tag}>`);
  });

  it('renders inline code, code blocks and quotes', () => {
    const html = render(`Use \`refund()\`.\n\n${FENCE}js\nrefund(order);\n${FENCE}\n\n> quoted`);

    expect(html).toContain('<code>refund()</code>');
    expect(html).toContain('<pre><code>refund(order);\n</code></pre>');
    expect(html).toContain('<blockquote>');
  });

  it('renders a table', () => {
    const html = render('| Day | Rule |\n| --- | --- |\n| 30 | Refund |');

    expect(html).toContain('<table>');
    expect(html).toContain('<th>Day</th>');
    expect(html).toContain('<td>Refund</td>');
  });

  it('renders an empty answer as nothing', () => {
    expect(render('')).toBe('');
  });
});

describe('createAnswerHtmlRenderer citation chips', () => {
  it('turns a key into a button with its key', () => {
    expect(render('Refunds take 30 days [C1].')).toBe(
      '<p>Refunds take 30 days <button type="button" class="cite" data-key="C1" data-inferred="false">C1</button>.</p>',
    );
  });

  it('marks an interpretation with its asterisk', () => {
    expect(render('Looks like [G2*].')).toContain(
      '<button type="button" class="cite" data-key="G2" data-inferred="true">G2*</button>',
    );
  });

  it.each(['[C1][G2]', '[C1, G2]', '[C1,G2]'])('makes a chip for each key in %s', (text) => {
    const html = render(`Both ${text}.`);

    expect(html.match(/<button /g)).toHaveLength(2);
    expect(html).toContain('data-key="C1"');
    expect(html).toContain('data-key="G2"');
  });

  it('keeps the asterisk on only the key that carries it', () => {
    const html = render('Mixed [C1, G2*].');

    expect(html).toContain('data-key="C1" data-inferred="false">C1</button>');
    expect(html).toContain('data-key="G2" data-inferred="true">G2*</button>');
  });

  it.each([
    ['a list item', '- Item [C1]'],
    ['a heading', '## Rules [C1]'],
    ['bold text', 'The **rule [C1]** holds'],
    ['a table cell', '| a |\n| - |\n| [C1] |'],
    ['a quote', '> said [C1]'],
  ])('finds a key in %s', (_name, markdown) => {
    expect(render(markdown)).toContain('data-key="C1"');
  });

  it.each(['[note]', '[1]', '[c1]', '[C1', '[C0]', '[]', '[C1 and more]', '[C1, note]'])(
    'leaves %s as text',
    (text) => {
      expect(render(`See ${text} here.`)).not.toContain('<button');
    },
  );

  it('does not turn a key in code into a chip', () => {
    const html = render(`Write \`[C1]\` like that.\n\n${FENCE}\n[G1] and [C2*]\n${FENCE}`);

    expect(html).not.toContain('<button');
    expect(html).toContain('<code>[C1]</code>');
    expect(html).toContain('[G1] and [C2*]');
  });
});

describe('createAnswerHtmlRenderer raw HTML from the model', () => {
  it.each([
    ['a script', '<script>alert(1)</script>'],
    ['an image with a handler', '<img src=x onerror=alert(1)>'],
    ['an element with a handler', '<b onclick="alert(1)">hi</b>'],
    ['an iframe', '<iframe src="https://github.com/x"></iframe>'],
    ['a style', '<style>body{display:none}</style>'],
    ['a form', '<form action="https://evil.example"><input name=a></form>'],
    ['a comment', '<!-- hidden -->'],
  ])('shows %s as text, not as an element', (_name, raw) => {
    const html = render(`Before ${raw} after`);

    expect(html).not.toMatch(/<(script|img|b|iframe|style|form|input)[\s>]/);
    // Apart from the paragraph, no tag is left, so there is nowhere for a handler to be.
    expect(html.replace('<p>', '').replace('</p>', '')).not.toContain('<');
    expect(html).toContain('&lt;');
  });

  it('shows a block of HTML as text', () => {
    const html = render('<div onclick="alert(1)">\nhello\n</div>');

    expect(html).not.toContain('<div');
    expect(html).toContain('&lt;div');
  });

  it('cannot forge a citation chip', () => {
    const html = render(
      '<button type="button" class="cite" data-key="C1" data-inferred="false">C1</button>',
    );

    expect(html).not.toContain('<button');
    expect(html).toContain('&lt;button');
  });

  it('escapes HTML inside a code block', () => {
    const html = render(`${FENCE}html\n<script>alert(1)</script>\n${FENCE}`);

    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script');
  });

  it('escapes HTML inside inline code', () => {
    expect(render('Use `<img src=x>` here')).toContain('<code>&lt;img src=x&gt;</code>');
  });
});

describe('createAnswerHtmlRenderer links', () => {
  const rel = 'target="_blank" rel="noopener noreferrer"';

  it.each([
    ['the Atlassian site', `https://${SITE_HOST}/wiki/spaces/ENG/pages/1`],
    ['github.com', 'https://github.com/acme/app/blob/abc/README.md'],
    ['github.com in capitals', 'https://GITHUB.COM/acme/app'],
  ])('keeps a link to %s and opens it safely in a new tab', (_name, href) => {
    const html = render(`See [the page](${href}).`);

    expect(html).toMatch(
      /<a href="https:\/\/[^"]+" target="_blank" rel="noopener noreferrer">the page<\/a>/,
    );
    expect(html).toContain(rel);
  });

  it('keeps an automatic link to an allowed host', () => {
    expect(render('See <https://github.com/acme/app> now')).toContain(
      '<a href="https://github.com/acme/app"',
    );
  });

  it('keeps a bare link to an allowed host', () => {
    expect(render('See https://github.com/acme/app now')).toContain(
      '<a href="https://github.com/acme/app"',
    );
  });

  it.each([
    ['an unlisted host', 'https://evil.example/x'],
    ['a look-alike with a suffix', 'https://github.com.evil.example/x'],
    ['a look-alike with a prefix', 'https://evilgithub.com/x'],
    ['a look-alike with the host as a name', 'https://github.com@evil.example/x'],
    ['a user name on an allowed host', 'https://user@github.com/x'],
    ['a user name and password', 'https://user:pass@github.com/x'],
    ['an unusual port', 'https://github.com:8443/x'],
    ['a sub-domain', 'https://gist.github.com/x'],
    ['a host with a trailing dot', 'https://github.com./x'],
    ['an insecure link', `${INSECURE}://github.com/x`],
    ['a javascript link', 'javascript:alert(1)'],
    ['a data link', 'data:text/html;base64,PHNjcmlwdD4='],
    ['a protocol-relative link', '//github.com/x'],
    ['a relative link', '/wiki/spaces/ENG'],
    ['a mail link', 'mailto:a@b.example'],
  ])('shows %s as plain text, with no link', (_name, href) => {
    const html = render(`See [the page](${href}) now.`);

    expect(html).not.toContain('<a');
    expect(html).not.toContain('href');
    expect(html).toContain('the page');
  });

  it('drops the title of a link', () => {
    expect(render('[x](https://github.com/a "Click here")')).not.toContain('Click here');
  });

  it('shows an image as its description, never as an image', () => {
    const html = render('![chart of refunds](https://github.com/acme/app/chart.png)');

    expect(html).not.toContain('<img');
    expect(html).toContain('chart of refunds');
  });

  it('matches host names without regard to the case they are configured in', () => {
    const upper = createAnswerHtmlRenderer({ allowedHosts: ['GitHub.com'] });

    expect(upper('[x](https://github.com/a)')).toContain('<a href=');
  });

  it('shows every link as text when no host is allowed', () => {
    const none = createAnswerHtmlRenderer({ allowedHosts: [] });

    expect(none('[x](https://github.com/a)')).not.toContain('<a');
  });
});

describe('sanitizeAnswerHtml', () => {
  it.each([
    ['a script', '<p>a</p><script>alert(1)</script>', '<p>a</p>'],
    ['an event handler', '<p onclick="x()">a</p>', '<p>a</p>'],
    ['an image', '<img src="https://github.com/x.png" onerror="x()">', ''],
    ['an iframe', '<iframe src="https://github.com/x"></iframe>', ''],
    ['a style attribute', '<p style="color:red">a</p>', '<p>a</p>'],
    ['a class on a paragraph', '<p class="big">a</p>', '<p>a</p>'],
    ['an h1', '<h1>a</h1>', 'a'],
  ])('removes %s', (_name, html, expected) => {
    expect(sanitizeAnswerHtml(html)).toBe(expected);
  });

  it('keeps an https link and forces a safe target and rel', () => {
    expect(
      sanitizeAnswerHtml('<a href="https://github.com/x" target="_self" rel="opener">x</a>'),
    ).toBe('<a href="https://github.com/x" target="_blank" rel="noopener noreferrer">x</a>');
  });

  it.each([
    'javascript:alert(1)',
    `${INSECURE}://github.com/x`,
    'data:text/html,x',
    '//github.com/x',
    'mailto:a@b.example',
  ])('removes the link target %s', (href) => {
    expect(sanitizeAnswerHtml(`<a href="${href}">x</a>`)).not.toContain('href');
  });

  it('removes a link with no target', () => {
    expect(sanitizeAnswerHtml('<a>x</a>')).toBe('');
  });

  it('keeps a well-formed citation chip', () => {
    const chip =
      '<button type="button" class="cite" data-key="G12" data-inferred="true">G12*</button>';

    expect(sanitizeAnswerHtml(chip)).toBe(chip);
  });

  it('makes the type of a chip a plain button, and its marker true or false', () => {
    expect(
      sanitizeAnswerHtml(
        '<button type="submit" class="cite" data-key="C1" data-inferred="yes">C1</button>',
      ),
    ).toBe('<button type="button" class="cite" data-key="C1" data-inferred="false">C1</button>');
  });

  it.each([
    ['no key', '<button class="cite">x</button>'],
    ['an invented key shape', '<button class="cite" data-key="X1">x</button>'],
    ['a key with markup', '<button class="cite" data-key="C1&quot; onclick=&quot;x()">x</button>'],
    ['another class', '<button class="danger" data-key="C1">x</button>'],
    ['no class', '<button data-key="C1">x</button>'],
  ])('removes a button with %s', (_name, html) => {
    expect(sanitizeAnswerHtml(html)).toBe('');
  });

  it('keeps a chip but strips a handler from it', () => {
    const clean = sanitizeAnswerHtml('<button class="cite" data-key="C1" onclick="x()">x</button>');

    expect(clean).not.toContain('onclick');
    expect(clean).toContain('data-key="C1"');
    expect(clean).toContain('type="button"');
  });
});
