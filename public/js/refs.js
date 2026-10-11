// @ts-check

/** The ids of the elements the page draws into, by the name used in the code. */
const IDS = Object.freeze({
  form: 'ask-form',
  role: 'role',
  roleDescription: 'role-description',
  question: 'question',
  ask: 'ask',
  stop: 'stop',
  result: 'result',
  progress: 'progress',
  notice: 'notice',
  error: 'error',
  errorMessage: 'error-message',
  retry: 'retry',
  banner: 'banner',
  bannerBadge: 'banner-badge',
  bannerText: 'banner-text',
  bannerReason: 'banner-reason',
  draftNote: 'draft-note',
  answer: 'answer',
  conflicts: 'conflicts',
  conflictsList: 'conflicts-list',
  gaps: 'gaps',
  gapsList: 'gaps-list',
  closest: 'closest',
  closestList: 'closest-list',
  followUp: 'follow-up',
  moreDetail: 'more-detail',
  thumbsUp: 'thumbs-up',
  thumbsDown: 'thumbs-down',
  feedbackForm: 'feedback-form',
  feedbackComment: 'feedback-comment',
  feedbackSource: 'feedback-source',
  feedbackSend: 'feedback-send',
  feedbackStatus: 'feedback-status',
  sources: 'sources',
  sourcesList: 'sources-list',
  consulted: 'consulted',
  consultedSummary: 'consulted-summary',
  consultedList: 'consulted-list',
  who: 'who',
  whoList: 'who-list',
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
