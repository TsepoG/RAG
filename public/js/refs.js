// @ts-check

/**
 * The ids of the elements the page draws into, by the name used in the code. Each is a place in
 * `index.html` that the page code fills; the question box itself is built by the code and is not
 * listed here.
 */
const IDS = Object.freeze({
  mobileBar: 'mobile-bar',
  backdrop: 'backdrop',
  sidebar: 'sidebar',
  notice: 'notice',
  welcome: 'welcome',
  messages: 'messages',
  live: 'live',
  end: 'end',
  composer: 'composer',
});

/**
 * The page's elements, found once.
 * @typedef {{ [K in keyof typeof IDS]: HTMLElement }} PageRefs
 */

/**
 * Finds every element the page draws into. A missing one is a mistake in the page, so it is
 * reported at once instead of failing later.
 * @param {ParentNode} [root] - Where to look; the document by default.
 * @returns {PageRefs} The elements.
 * @throws {Error} When an element is missing from the page.
 */
export function findRefs(root = document) {
  /** @type {Record<string, HTMLElement>} */
  const refs = {};
  for (const [name, id] of Object.entries(IDS)) {
    const element = root.querySelector(`#${id}`);
    if (!(element instanceof HTMLElement)) {
      throw new Error(`The page has no element with the id "${id}".`);
    }
    refs[name] = element;
  }
  return /** @type {PageRefs} */ (refs);
}
