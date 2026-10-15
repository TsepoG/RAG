// @ts-check

/** The ids of the elements the page draws into, by the name used in the code. */
const IDS = Object.freeze({
  form: 'ask-form',
  role: 'role',
  roleDescription: 'role-description',
  roleConfirm: 'role-confirm',
  roleConfirmText: 'role-confirm-text',
  roleConfirmYes: 'role-confirm-yes',
  roleConfirmNo: 'role-confirm-no',
  turnCounter: 'turn-counter',
  newConversation: 'new-conversation',
  notice: 'notice',
  messages: 'messages',
  live: 'live',
  fullMessage: 'full-message',
  question: 'question',
  ask: 'ask',
  stop: 'stop',
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
