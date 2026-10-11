// @ts-check
import { Marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
import { parseCitationKeys } from '../citations/index.js';

/**
 * What the renderer needs to know about links.
 * @typedef {object} AnswerHtmlOptions
 * @property {ReadonlyArray<string>} allowedHosts - Host names a link in the answer may point to
 *   (for example the Atlassian site and `github.com`). Any other link is shown as plain text.
 */

const CITATION_AT_START = /^\[([^[\]\n]{1,40})\]/;
const CITE_KEY = /^[CG][1-9]\d*$/;
const CITE_CLASS = 'cite';
const FIRST_HEADING_LEVEL = 3;
const LAST_HEADING_LEVEL = 5;
const HTTPS = 'https:';
const HTML_ESCAPES = new Map([
  ['&', '&amp;'],
  ['<', '&lt;'],
  ['>', '&gt;'],
  ['"', '&quot;'],
  ["'", '&#39;'],
]);

/**
 * Escapes text for use in HTML, both as content and inside a quoted attribute.
 * @param {string} text - The text.
 * @returns {string} The text with &, <, >, " and ' replaced.
 */
function escapeHtml(text) {
  return [...text].map((character) => HTML_ESCAPES.get(character) ?? character).join('');
}

/**
 * Checks a link target. Only an https link to one of the allowed hosts, by exact name and the
 * default port, with no user name or password, is kept; anything else gets no link.
 * @param {string} href - The target as the model wrote it.
 * @param {ReadonlySet<string>} hosts - The allowed host names, lower case.
 * @returns {string | undefined} The normalised target, or undefined when it is not allowed.
 */
function safeTarget(href, hosts) {
  try {
    const url = new URL(href.trim());
    const allowed =
      url.protocol === HTTPS &&
      hosts.has(url.hostname) &&
      url.port === '' &&
      url.username === '' &&
      url.password === '';
    return allowed ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Writes one citation chip. The key has already been checked against the key pattern.
 * @param {{ key: string, inferred: boolean }} written - The key and whether it carried an asterisk.
 * @returns {string} The button.
 */
function chip({ key, inferred }) {
  const label = inferred ? `${key}*` : key;
  return `<button type="button" class="${CITE_CLASS}" data-key="${key}" data-inferred="${inferred}">${label}</button>`;
}

/** Turns `[C1]`, `[G2*]` and `[C1, G2]` in the text into chips; never inside code. */
const citationExtension = {
  name: 'citation',
  level: /** @type {const} */ ('inline'),
  start(/** @type {string} */ source) {
    const at = source.indexOf('[');
    return at === -1 ? undefined : at;
  },
  tokenizer(/** @type {string} */ source) {
    const found = CITATION_AT_START.exec(source);
    const keys = found === null ? undefined : parseCitationKeys(found[1]);
    return found === null || keys === undefined
      ? undefined
      : { type: 'citation', raw: found[0], keys };
  },
  renderer(/** @type {{ keys: Array<{ key: string, inferred: boolean }> }} */ token) {
    return token.keys.map(chip).join('');
  },
};

/**
 * Builds the markdown converter. What the model writes is data: raw HTML is shown as text, images
 * as their description, and a link only when it points to an allowed host.
 * @param {ReadonlySet<string>} hosts - The allowed host names, lower case.
 * @returns {Marked} The converter.
 */
function createMarked(hosts) {
  return new Marked({
    gfm: true,
    async: false,
    extensions: [citationExtension],
    renderer: {
      html: ({ text }) => escapeHtml(text),
      image: ({ text }) => escapeHtml(text),
      heading({ tokens, depth }) {
        const level = Math.min(Math.max(depth, FIRST_HEADING_LEVEL), LAST_HEADING_LEVEL);
        return `<h${level}>${this.parser.parseInline(tokens)}</h${level}>\n`;
      },
      link({ href, tokens }) {
        const text = this.parser.parseInline(tokens);
        const target = safeTarget(href, hosts);
        return target === undefined ? text : `<a href="${escapeHtml(target)}">${text}</a>`;
      },
    },
  });
}

const ALLOWED_TAGS = [
  'p',
  'h3',
  'h4',
  'h5',
  'ul',
  'ol',
  'li',
  'em',
  'strong',
  'del',
  'br',
  'hr',
  'code',
  'pre',
  'blockquote',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'a',
  'button',
];

/**
 * Whether a button is one of our citation chips and nothing else.
 * @param {{ tag: string, attribs: Record<string, string> }} frame - The element.
 * @returns {boolean} True for a button that must be removed.
 */
function isForgedButton({ tag, attribs }) {
  return (
    tag === 'button' && !(attribs.class === CITE_CLASS && CITE_KEY.test(attribs['data-key'] ?? ''))
  );
}

/**
 * Removes everything from HTML except the tags and attributes the page needs. Links keep an
 * https target and open in a new tab without access to the page; a button survives only as a
 * well-formed citation chip. A second line of defence: the converter already shows raw HTML as text.
 * @param {string} html - HTML that may be hostile.
 * @returns {string} Safe HTML.
 */
export function sanitizeAnswerHtml(html) {
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      a: ['href', 'target', 'rel'],
      button: ['type', 'class', 'data-key', 'data-inferred'],
    },
    allowedClasses: { button: [CITE_CLASS] },
    allowedSchemes: ['https'],
    allowProtocolRelative: false,
    transformTags: {
      a: (_tag, attribs) => ({
        tagName: 'a',
        attribs: { href: attribs.href ?? '', target: '_blank', rel: 'noopener noreferrer' },
      }),
      button: (_tag, attribs) => ({
        tagName: 'button',
        attribs: {
          ...attribs,
          type: 'button',
          'data-inferred': attribs['data-inferred'] === 'true' ? 'true' : 'false',
        },
      }),
    },
    exclusiveFilter: (frame) => isForgedButton(frame) || (frame.tag === 'a' && !frame.attribs.href),
  });
}

/**
 * Creates the function that turns the model's markdown into HTML that is safe to put in the page:
 * citation keys become chips, raw HTML is shown as text, and links are kept only to allowed hosts.
 * @param {AnswerHtmlOptions} options - Which hosts a link may point to.
 * @returns {(markdown: string) => string} The converter.
 */
export function createAnswerHtmlRenderer({ allowedHosts }) {
  const marked = createMarked(new Set(allowedHosts.map((host) => host.toLowerCase())));
  return (markdown) => sanitizeAnswerHtml(/** @type {string} */ (marked.parse(markdown))).trim();
}
