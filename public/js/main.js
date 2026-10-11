// @ts-check
import { ApiError, askStream, fetchRoles, sendFeedback } from './api.js';
import { markRating, readFeedbackDetails, showFeedbackStatus } from './feedback.js';
import { findRefs } from './refs.js';
import { showRoles, showState } from './render.js';
import { focusSource } from './sources.js';
import { fromServerEvent, INITIAL_STATE, isBusy, next } from './state.js';
import { loadRole, saveRole } from './storage.js';

// Wiring only: this file connects the tested page modules to the browser's events and the network,
// and holds no logic of its own that is worth a test. It is checked by hand and by the live test.

const refs = findRefs();
/** @type {import('./render.js').RoleSummary[]} */
let roles = [];
let state = /** @type {import('./state.js').PageState} */ (INITIAL_STATE);
/** @type {AbortController | undefined} */
let controller;

/**
 * Applies something that happened and redraws the page.
 * @param {import('./state.js').PageAction} action - What happened.
 */
function dispatch(action) {
  const before = state;
  state = next(state, action);
  if (state !== before) {
    showState(refs, state);
  }
}

/**
 * Asks a question and feeds what comes back into the state.
 * @param {{ question: string, roleId: string, detailLevel: 'default' | 'more' }} request - What to ask.
 */
async function ask({ question, roleId, detailLevel }) {
  const role = roles.find(({ id }) => id === roleId);
  if (role === undefined || isBusy(state)) {
    return;
  }
  controller = new AbortController();
  dispatch({ type: 'ask', question, role: role.id, roleDepth: role.depth, detailLevel });
  try {
    await askStream({
      question,
      role: role.id,
      detailLevel,
      signal: controller.signal,
      onEvent: (event) => {
        const action = fromServerEvent(event);
        if (action !== undefined) {
          dispatch(action);
        }
      },
    });
    dispatch({ type: 'ended' });
  } catch (error) {
    if (!(error instanceof DOMException && error.name === 'AbortError')) {
      const message = error instanceof ApiError ? error.message : 'Something went wrong.';
      dispatch({ type: 'error', kind: 'request', message });
    }
  }
  if (state.phase === 'done' && state.answer?.result.status === 'clarify') {
    refs.question.focus();
  }
}

/** Stops the question that is running. */
function stop() {
  if (!isBusy(state)) {
    return;
  }
  dispatch({ type: 'stop' });
  controller?.abort();
}

/**
 * Sends feedback for the answer on screen and says what happened.
 * @param {'up' | 'down'} rating - The thumb pressed.
 */
async function sendRating(rating) {
  const answerId = state.answer?.answerId;
  if (answerId === undefined) {
    return;
  }
  markRating(refs, rating);
  if (rating === 'down') {
    return;
  }
  await submitFeedback(answerId, rating);
}

/**
 * Sends the feedback and shows whether it was saved.
 * @param {string} answerId - The answer's id.
 * @param {'up' | 'down'} rating - The rating.
 * @param {{ comment?: string, wrongSourceKey?: string }} [details] - What was added.
 */
async function submitFeedback(answerId, rating, details = {}) {
  try {
    await sendFeedback({ answerId, rating, ...details });
    showFeedbackStatus(refs, 'Thank you. Your feedback was saved.', true);
  } catch (error) {
    const message = error instanceof ApiError ? error.message : 'It could not be sent.';
    showFeedbackStatus(refs, message, false);
  }
}

/**
 * Starts loading the roles and selects the remembered one.
 */
async function loadRoleChoices() {
  try {
    roles = await fetchRoles();
    showRoles(refs, roles, loadRole());
  } catch (error) {
    refs.roleDescription.textContent =
      error instanceof ApiError ? error.message : 'The roles could not be loaded.';
  }
}

refs.form.addEventListener('submit', (event) => {
  event.preventDefault();
  const question = /** @type {HTMLTextAreaElement} */ (refs.question).value.trim();
  const roleId = /** @type {HTMLSelectElement} */ (refs.role).value;
  if (question !== '') {
    ask({ question, roleId, detailLevel: 'default' });
  }
});

refs.question.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    /** @type {HTMLFormElement} */ (refs.form).requestSubmit();
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    stop();
  }
});

refs.role.addEventListener('change', () => {
  const id = /** @type {HTMLSelectElement} */ (refs.role).value;
  saveRole(id);
  showRoles(refs, roles, id);
});

refs.stop.addEventListener('click', stop);
refs.retry.addEventListener('click', () =>
  ask({ question: state.question, roleId: state.role, detailLevel: state.detailLevel }),
);
refs.moreDetail.addEventListener('click', () =>
  ask({ question: state.question, roleId: state.role, detailLevel: 'more' }),
);
refs.thumbsUp.addEventListener('click', () => sendRating('up'));
refs.thumbsDown.addEventListener('click', () => sendRating('down'));
refs.feedbackForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const answerId = state.answer?.answerId;
  if (answerId !== undefined) {
    submitFeedback(answerId, 'down', readFeedbackDetails(refs));
  }
});
refs.result.addEventListener('click', (event) => {
  const chip = event.target instanceof Element ? event.target.closest('button.cite') : null;
  if (chip !== null) {
    focusSource(refs.sourcesList, chip.getAttribute('data-key') ?? '');
  }
});

loadRoleChoices();
showState(refs, state);
