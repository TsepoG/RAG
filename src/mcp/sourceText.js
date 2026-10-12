// @ts-check
import sanitizeHtml from 'sanitize-html';

/** The bare name of the tool whose result is a Confluence page. */
export const CONFLUENCE_PAGE_TOOL = 'getConfluenceContent';

/**
 * Most characters of one source given to the model: about 15,000 tokens, enough for the longest
 * design page in use whole, and still a limit, because every character is read on every later
 * turn of the question. Anything longer is cut, and the model is told what it did not see.
 */
export const MAX_SOURCE_CHARS = 60_000;

/** Added where a source is cut, so the model does not take the end of the text for the end. */
export const CUT_NOTICE = '\n[The rest of this content was cut because it is too long.]';

/** Most cut headings named in the notice; the rest are counted. */
const MAX_CUT_HEADINGS = 40;

/** Longest heading text kept in the notice. */
const MAX_HEADING_CHARS = 80;

/** A cut is moved back to a line break only if that loses less than this share of the limit. */
const LINE_BREAK_WINDOW = 0.1;

/** A heading line of the plain text made from a page. */
const HEADING_LINE = /^#{1,6} (.+)$/;

/** The tags kept while a page is turned into text; everything else is dropped, its text kept. */
const STRUCTURE_TAGS = [
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'li',
  'tr',
  'td',
  'th',
  'br',
  'pre',
  'hr',
];

// What sanitize-html writes for the tags kept above: no attributes, `<br />` and `<hr />` closed.
const STRUCTURE_TAG = /<(\/?)(h[1-6]|p|li|tr|td|th|br|pre|hr)(?: \/)?>/g;

const LINE_BREAK = '\n';
/** A list item with no text yet, after the line ends are trimmed. */
const BULLET = '-';

/** A heading tag name. */
const HEADING_TAG = /^h[1-6]$/;

/** What each kept tag becomes: the text for its opening tag and for its closing tag. */
const TAG_TEXT = Object.freeze({
  p: ['\n', '\n'],
  li: ['\n- ', ''],
  tr: ['', '\n'],
  td: ['', ' | '],
  th: ['', ' | '],
  br: ['\n', ''],
  hr: ['\n---\n', ''],
  pre: ['\n```\n', '\n```\n'],
});

/**
 * Writes what a kept tag becomes.
 * @param {string} _tag - The whole tag.
 * @param {string} closing - `/` for a closing tag, otherwise empty.
 * @param {string} name - The tag name.
 * @returns {string} The text that replaces it.
 */
function tagToText(_tag, closing, name) {
  if (HEADING_TAG.test(name)) {
    const level = Number(name.slice(1));
    return closing === '/' ? LINE_BREAK : `\n\n${'#'.repeat(level)} `;
  }
  const [open, close] = TAG_TEXT[/** @type {keyof typeof TAG_TEXT} */ (name)];
  return closing === '/' ? close : open;
}

/**
 * Puts back the characters sanitize-html wrote as entities. The `&` comes last so that
 * `&amp;lt;` stays the text `&lt;`.
 * @param {string} text - Text with the five entities it writes.
 * @returns {string} Plain text.
 */
function decodeEntities(text) {
  return text
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&');
}

/**
 * Turns a page's HTML into plain text, keeping headings (as `#` lines), lists, table rows and code
 * blocks. Attributes, macros and other markup are dropped: they are most of a long page's size and
 * say nothing to a reader.
 * @param {string} html - The page body.
 * @returns {string} The text, with no more than one blank line in a row.
 */
export function htmlToText(html) {
  const tagged = sanitizeHtml(html, { allowedTags: STRUCTURE_TAGS, allowedAttributes: {} });
  const lines = decodeEntities(tagged.replace(STRUCTURE_TAG, tagToText))
    .split(LINE_BREAK)
    .map((line) => line.trimEnd());
  /** @type {string[]} */
  const kept = [];
  for (const line of lines) {
    const last = kept.at(-1);
    if (last === BULLET) {
      // A list item whose text came in a paragraph of its own: join them.
      if (line !== '') {
        kept[kept.length - 1] = `${BULLET} ${line}`;
      }
    } else if (line !== '' || (last !== undefined && last !== '')) {
      kept.push(line);
    }
  }
  return kept.join(LINE_BREAK).trim();
}

/**
 * Narrows a parsed value to an object, or to an empty one.
 * @param {unknown} value - Anything parsed from JSON.
 * @returns {Record<string, unknown>} The object, or an empty one.
 */
function asRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? /** @type {Record<string, unknown>} */ (value)
    : {};
}

/**
 * Reads what the model should see of a Confluence page result: its title, id and version, then the
 * body as plain text. A result in any other shape is left to be used as it came.
 * @param {string} text - The tool's result, a JSON document.
 * @returns {string | undefined} The page as text, or undefined when it is not an HTML page.
 */
export function confluencePageText(text) {
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  const data = asRecord(asRecord(parsed).data);
  const body = asRecord(data.body);
  if (body.format !== 'html' || typeof body.value !== 'string') {
    return undefined;
  }
  const version = asRecord(asRecord(data.metadata).version);
  const header = [
    typeof data.title === 'string' ? `Title: ${data.title}` : undefined,
    typeof data.id === 'string' ? `Page id: ${data.id}` : undefined,
    typeof version.number === 'number' ? `Version: ${version.number}` : undefined,
    typeof version.createdAt === 'string' ? `Last updated: ${version.createdAt}` : undefined,
  ].filter((line) => line !== undefined);
  return `${header.join(LINE_BREAK)}\n\n${htmlToText(body.value)}`;
}

/**
 * Lists the headings in a piece of text, for naming what was cut off.
 * @param {string} text - Text made by `htmlToText`.
 * @returns {string[]} The heading texts, in order, each shortened.
 */
function headingsIn(text) {
  return text.split(LINE_BREAK).flatMap((line) => {
    const heading = HEADING_LINE.exec(line)?.[1];
    return heading === undefined ? [] : [heading.slice(0, MAX_HEADING_CHARS)];
  });
}

/**
 * Says which sections were cut off, so the model can report them as unchecked.
 * @param {string[]} headings - The headings in the part that was cut.
 * @returns {string} A line for the notice, or nothing when there were no headings.
 */
function cutSections(headings) {
  if (headings.length === 0) {
    return '';
  }
  const named = headings.slice(0, MAX_CUT_HEADINGS).join('; ');
  const more =
    headings.length > MAX_CUT_HEADINGS ? ` and ${headings.length - MAX_CUT_HEADINGS} more` : '';
  return `\n[Sections that were cut and not read: ${named}${more}. If the answer could depend on them, list them under gaps.]`;
}

/**
 * Cuts text that is too long for one source, at a line break when one is near. When the text is a
 * page made by `htmlToText`, the notice names the sections that were cut.
 * @param {string} text - What the model would be given.
 * @param {{ names?: boolean }} [options] - `names`: list the headings in the part that was cut.
 * @returns {string} The text, or its first part followed by a notice.
 */
export function capSource(text, { names = false } = {}) {
  if (text.length <= MAX_SOURCE_CHARS) {
    return text;
  }
  const lineBreak = text.lastIndexOf(LINE_BREAK, MAX_SOURCE_CHARS);
  const nearBreak = lineBreak >= MAX_SOURCE_CHARS * (1 - LINE_BREAK_WINDOW);
  const cutAt = nearBreak ? lineBreak : MAX_SOURCE_CHARS;
  const sections = names ? cutSections(headingsIn(text.slice(cutAt))) : '';
  return `${text.slice(0, cutAt)}${CUT_NOTICE}${sections}`;
}
