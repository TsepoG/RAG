// @ts-check
import { clear, el, setVisible } from './dom.js';

/** The text of the option that names no source. */
const NO_SOURCE = 'None';

/**
 * Starts the feedback controls afresh for a new answer.
 * @param {import('./refs.js').PageRefs} refs - The page's elements.
 * @param {ReadonlyArray<{ key: string, title: string }>} sources - The sources the answer cited.
 */
export function resetFeedback(refs, sources) {
  refs.thumbsUp.setAttribute('aria-pressed', 'false');
  refs.thumbsDown.setAttribute('aria-pressed', 'false');
  for (const button of [refs.thumbsUp, refs.thumbsDown, refs.feedbackSend]) {
    /** @type {HTMLButtonElement} */ (button).disabled = false;
  }
  setVisible(refs.feedbackForm, false);
  /** @type {HTMLTextAreaElement} */ (refs.feedbackComment).value = '';
  refs.feedbackStatus.textContent = '';
  clear(refs.feedbackSource);
  refs.feedbackSource.append(
    el('option', { text: NO_SOURCE, attributes: { value: '' } }),
    ...sources.map(({ key, title }) =>
      el('option', { text: `[${key}] ${title}`, attributes: { value: key } }),
    ),
  );
}

/**
 * Shows which thumb was pressed, and opens the form for more detail after a thumbs down.
 * @param {import('./refs.js').PageRefs} refs - The page's elements.
 * @param {'up' | 'down'} rating - The thumb pressed.
 */
export function markRating(refs, rating) {
  refs.thumbsUp.setAttribute('aria-pressed', String(rating === 'up'));
  refs.thumbsDown.setAttribute('aria-pressed', String(rating === 'down'));
  setVisible(refs.feedbackForm, rating === 'down');
}

/**
 * Reads what the person added in the form.
 * @param {import('./refs.js').PageRefs} refs - The page's elements.
 * @returns {{ comment?: string, wrongSourceKey?: string }} Only the parts they filled in.
 */
export function readFeedbackDetails(refs) {
  const comment = /** @type {HTMLTextAreaElement} */ (refs.feedbackComment).value.trim();
  const wrongSourceKey = /** @type {HTMLSelectElement} */ (refs.feedbackSource).value;
  return {
    ...(comment === '' ? {} : { comment }),
    ...(wrongSourceKey === '' ? {} : { wrongSourceKey }),
  };
}

/**
 * Says what happened to the feedback, and locks the controls once it is saved.
 * @param {import('./refs.js').PageRefs} refs - The page's elements.
 * @param {string} message - What to tell the person.
 * @param {boolean} saved - Whether it was saved; if so, it cannot be sent again.
 */
export function showFeedbackStatus(refs, message, saved) {
  refs.feedbackStatus.textContent = message;
  if (saved) {
    for (const button of [refs.thumbsUp, refs.thumbsDown, refs.feedbackSend]) {
      /** @type {HTMLButtonElement} */ (button).disabled = true;
    }
  }
}
