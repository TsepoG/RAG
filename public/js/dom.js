// @ts-check

/** The only kind of link the page will follow to a source. */
const HTTPS = 'https:';

/**
 * Creates an element. Text is always set as text, never as HTML.
 * @param {string} tag - The tag name.
 * @param {{ className?: string, text?: string, attributes?: Record<string, string> }} [options] - Class, text and attributes.
 * @param {Array<Node | string>} [children] - What goes inside, after the text.
 * @returns {HTMLElement} The element.
 */
export function el(tag, { className, text, attributes = {} } = {}, children = []) {
  const element = document.createElement(tag);
  if (className !== undefined) {
    element.className = className;
  }
  if (text !== undefined) {
    element.textContent = text;
  }
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, value);
  }
  element.append(...children);
  return element;
}

/**
 * Checks a link that came from a page or a search result before it is put in the page. Only an
 * https link is used; anything else, such as a `javascript:` link, gets no link at all.
 * @param {string | undefined} url - The link.
 * @returns {string | undefined} The link in its normal form, or undefined when it is not allowed.
 */
export function safeHref(url) {
  try {
    const parsed = new URL(url ?? '');
    return parsed.protocol === HTTPS ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Makes a link to an outside page that opens in a new tab and tells the page nothing about us.
 * With no safe link, it is plain text instead.
 * @param {string} text - What the link says.
 * @param {string | undefined} url - Where it goes.
 * @returns {HTMLElement} An anchor, or a span when the link is not safe.
 */
export function externalLink(text, url) {
  const href = safeHref(url);
  return href === undefined
    ? el('span', { text })
    : el('a', { text, attributes: { href, target: '_blank', rel: 'noopener noreferrer' } });
}

/**
 * Shows or hides an element.
 * @param {HTMLElement} element - The element.
 * @param {boolean} visible - Whether it should show.
 */
export function setVisible(element, visible) {
  element.hidden = !visible;
}
