// @ts-check

/** Said in place of a page that is outside the allowed Confluence spaces. */
const REMOVED_NOTICE = 'Content removed: outside the allowed Confluence spaces.';

// A tag that opens or closes a source wrapper, in any spacing or case. Content is not allowed to
// contain one, so a page cannot close its own wrapper or announce a source it was not given.
const SOURCE_TAG = /<(?=[\s/]*source)/gi;
const ATTRIBUTE_ESCAPES = Object.freeze({
  '&': '&amp;',
  '"': '&quot;',
  '<': '&lt;',
  '>': '&gt;',
});
const ATTRIBUTE_SPECIALS = /[&"<>]/g;

/**
 * Makes a value safe to put inside a double-quoted attribute.
 * @param {string} value - The value.
 * @returns {string} The value with &, ", < and > escaped.
 */
function escapeAttribute(value) {
  return value.replace(
    ATTRIBUTE_SPECIALS,
    (character) => ATTRIBUTE_ESCAPES[/** @type {keyof typeof ATTRIBUTE_ESCAPES} */ (character)],
  );
}

/**
 * Wraps fetched content so the model sees the key of the source next to its text. Any source tag
 * inside the content is defused by escaping its `<`, which keeps the wrapper intact and the key
 * unforgeable: content cannot end its own wrapper or claim to be another source.
 * @param {{ key: string, type: string, title: string }} source - The source's key, type and title.
 * @param {string} text - What the tool returned.
 * @returns {string} The text inside a `<source>` element.
 */
export function wrapAsSource({ key, type, title }, text) {
  const attributes = [
    `key="${escapeAttribute(key)}"`,
    `type="${escapeAttribute(type)}"`,
    `title="${escapeAttribute(title)}"`,
  ].join(' ');
  return `<source ${attributes}>\n${text.replace(SOURCE_TAG, '&lt;')}\n</source>`;
}

/**
 * The text the model gets in place of content that must not reach it.
 * @returns {string} A short notice that says nothing about the content.
 */
export function removedNotice() {
  return REMOVED_NOTICE;
}
