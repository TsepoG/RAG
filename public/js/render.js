// @ts-check
import { renderAnswer } from './answer.js';
import { clear, el, setVisible } from './dom.js';
import { resetFeedback } from './feedback.js';
import { canShowMoreDetail, isBusy } from './state.js';

/** Shown before the first progress line arrives. */
const STARTING = 'Starting…';

/** Shown after the person pressed Stop. */
const STOPPED = 'Stopped.';
const STOPPED_WITH_DRAFT = 'Stopped. What you see is an unchecked draft.';

/**
 * A role as the picker shows it.
 * @typedef {{ id: string, displayName: string, description: string, depth: number }} RoleSummary
 */

/**
 * Fills the role picker and selects a role.
 * @param {import('./refs.js').PageRefs} refs - The page's elements.
 * @param {ReadonlyArray<RoleSummary>} roles - The roles to offer.
 * @param {string | undefined} selectedId - The role to select; the first when it is not offered.
 * @returns {RoleSummary | undefined} The role that is selected.
 */
export function showRoles(refs, roles, selectedId) {
  const select = /** @type {HTMLSelectElement} */ (refs.role);
  clear(select);
  select.append(
    ...roles.map(({ id, displayName }) =>
      el('option', { text: displayName, attributes: { value: id } }),
    ),
  );
  select.disabled = roles.length === 0;
  const chosen = roles.find(({ id }) => id === selectedId) ?? roles[0];
  if (chosen !== undefined) {
    select.value = chosen.id;
  }
  refs.roleDescription.textContent = chosen?.description ?? '';
  return chosen;
}

/**
 * Hides every part of the result and empties it.
 * @param {import('./refs.js').PageRefs} refs - The page's elements.
 */
function clearResult(refs) {
  for (const part of [
    refs.notice,
    refs.error,
    refs.banner,
    refs.draftNote,
    refs.conflicts,
    refs.gaps,
    refs.closest,
    refs.followUp,
    refs.moreDetail,
    refs.sources,
    refs.who,
  ]) {
    setVisible(part, false);
  }
  refs.progress.textContent = '';
  refs.answer.className = 'answer';
  clear(refs.answer);
}

/**
 * Shows the answer as it streams: muted plain text, until the checked answer replaces it.
 * @param {import('./refs.js').PageRefs} refs - The page's elements.
 * @param {import('./state.js').PageState} state - The state.
 */
function showDraft(refs, state) {
  refs.answer.className = 'answer draft';
  refs.answer.textContent = state.draft;
  setVisible(refs.draftNote, state.draft !== '');
}

/**
 * Shows the state after the person stopped, or after a failure.
 * @param {import('./refs.js').PageRefs} refs - The page's elements.
 * @param {import('./state.js').PageState} state - The state.
 */
function showEnded(refs, state) {
  if (state.failure !== undefined) {
    refs.errorMessage.textContent = state.failure.message;
    setVisible(refs.error, true);
    return;
  }
  if (state.draft !== '') {
    showDraft(refs, state);
  }
  refs.notice.textContent = state.draft === '' ? STOPPED : STOPPED_WITH_DRAFT;
  setVisible(refs.notice, true);
}

/**
 * Shows the finished answer and the controls that follow it.
 * @param {import('./refs.js').PageRefs} refs - The page's elements.
 * @param {import('./state.js').PageState} state - The state, with an answer.
 */
function showFinished(refs, state) {
  const { answer } = state;
  if (answer === undefined) {
    return;
  }
  renderAnswer(refs, answer);
  resetFeedback(refs, answer.result.sources);
  setVisible(refs.followUp, true);
  setVisible(refs.moreDetail, canShowMoreDetail(state));
}

/**
 * Draws the whole page for a state. The page changes only through this, so what is on screen
 * always matches the state.
 * @param {import('./refs.js').PageRefs} refs - The page's elements.
 * @param {import('./state.js').PageState} state - The state.
 */
export function showState(refs, state) {
  const busy = isBusy(state);
  /** @type {HTMLButtonElement} */ (refs.ask).disabled = busy;
  setVisible(refs.stop, busy);
  refs.form.toggleAttribute('aria-busy', busy);
  setVisible(refs.result, state.phase !== 'idle');
  clearResult(refs);
  if (busy) {
    refs.progress.textContent = state.progress === '' ? STARTING : state.progress;
    showDraft(refs, state);
  } else if (state.phase === 'done') {
    showFinished(refs, state);
  } else if (state.phase !== 'idle') {
    showEnded(refs, state);
  }
}
