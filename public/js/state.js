// @ts-check

/** The deepest role depth; a role at it has no more detail to give. */
const MOST_TECHNICAL_DEPTH = 3;

/** Shown when the stream ends before the answer is complete. */
const CONNECTION_LOST = 'The connection closed before the answer finished. Please try again.';

/**
 * What the server sends when a question is answered.
 * @typedef {import('../../src/server/donePayload.js').DonePayload} DonePayload
 */

/**
 * Where a question is in its life.
 * @typedef {'idle' | 'asking' | 'streaming' | 'done' | 'error' | 'stopped'} Phase
 */

/**
 * What the page shows, as plain data. The page draws it; nothing else changes it.
 * @typedef {object} PageState
 * @property {Phase} phase - Where the question is.
 * @property {string} question - The question asked.
 * @property {string} role - The role id it was asked as.
 * @property {number} roleDepth - That role's depth, to know whether more detail is possible.
 * @property {'default' | 'more'} detailLevel - The level it was asked at.
 * @property {string} progress - The latest progress line; empty before the first.
 * @property {string} draft - The answer text streamed so far.
 * @property {DonePayload | undefined} answer - The `done` payload from the server, once there is one.
 * @property {{ kind: string, message: string } | undefined} failure - What went wrong, if anything.
 */

/**
 * Something that happened.
 * @typedef {{ type: 'ask', question: string, role: string, roleDepth: number, detailLevel: 'default' | 'more' }
 *   | { type: 'progress', message: string }
 *   | { type: 'token', text: string }
 *   | { type: 'done', payload: DonePayload }
 *   | { type: 'error', kind: string, message: string }
 *   | { type: 'stop' }
 *   | { type: 'ended' }
 *   | { type: 'reset' }} PageAction
 */

/**
 * The state before anything is asked.
 * @type {Readonly<PageState>}
 */
export const INITIAL_STATE = Object.freeze({
  phase: 'idle',
  question: '',
  role: '',
  roleDepth: 0,
  detailLevel: 'default',
  progress: '',
  draft: '',
  answer: undefined,
  failure: undefined,
});

/**
 * Whether a question is being answered right now.
 * @param {PageState} state - The state.
 * @returns {boolean} True while asking or streaming.
 */
export function isBusy({ phase }) {
  return phase === 'asking' || phase === 'streaming';
}

/**
 * Reads a text field from event data of unknown shape.
 * @param {unknown} data - The parsed data.
 * @param {string} key - The field.
 * @returns {string} The field when it is text, otherwise an empty string.
 */
function textOf(data, key) {
  const value = typeof data === 'object' && data !== null ? Reflect.get(data, key) : undefined;
  return typeof value === 'string' ? value : '';
}

/**
 * Turns an event from the server into an action. An event it does not know gives undefined.
 * @param {{ event: string, data: unknown }} message - The event, with its data parsed.
 * @returns {PageAction | undefined} The action, or undefined for an unknown event.
 */
export function fromServerEvent({ event, data }) {
  switch (event) {
    case 'progress':
      return { type: 'progress', message: textOf(data, 'message') };
    case 'token':
      return { type: 'token', text: textOf(data, 'text') };
    case 'done':
      return { type: 'done', payload: /** @type {DonePayload} */ (data) };
    case 'error':
      return {
        type: 'error',
        kind: textOf(data, 'kind') || 'internal',
        message: textOf(data, 'message'),
      };
    default:
      return undefined;
  }
}

/**
 * The state for a question that has just been asked.
 * @param {Extract<PageAction, { type: 'ask' }>} action - The question.
 * @returns {PageState} The state.
 */
function startQuestion({ question, role, roleDepth, detailLevel }) {
  return { ...INITIAL_STATE, phase: 'asking', question, role, roleDepth, detailLevel };
}

/**
 * The state after the person, or the server, stopped the question. The draft is kept.
 * @param {PageState} state - The state now.
 * @returns {PageState} The state.
 */
function stopped(state) {
  return { ...state, phase: 'stopped', progress: '' };
}

/**
 * The state after a failure. The draft is kept.
 * @param {PageState} state - The state now.
 * @param {{ kind: string, message: string }} failure - What went wrong.
 * @returns {PageState} The state.
 */
function failed(state, { kind, message }) {
  return { ...state, phase: 'error', progress: '', failure: { kind, message } };
}

/**
 * Works out the next state. Pure. Events that arrive when they no longer matter, such as a token
 * after Stop, change nothing.
 * @param {PageState} state - The state now.
 * @param {PageAction} action - What happened.
 * @returns {PageState} The next state; the same object when nothing changed.
 */
export function next(state, action) {
  if (action.type === 'ask') {
    return isBusy(state) ? state : startQuestion(action);
  }
  if (action.type === 'reset') {
    return isBusy(state) ? state : INITIAL_STATE;
  }
  if (!isBusy(state)) {
    return state;
  }
  switch (action.type) {
    case 'progress':
      return { ...state, progress: action.message };
    case 'token':
      return { ...state, phase: 'streaming', draft: state.draft + action.text };
    case 'done':
      return { ...state, phase: 'done', progress: '', answer: action.payload };
    case 'error':
      return action.kind === 'cancelled' ? stopped(state) : failed(state, action);
    case 'stop':
      return stopped(state);
    case 'ended':
      return failed(state, { kind: 'connection', message: CONNECTION_LOST });
    default:
      return state;
  }
}

/**
 * Whether "Show more detail" is offered: the answer was given, at the usual level, for a role that
 * is not already at the most technical depth.
 * @param {PageState} state - The state.
 * @returns {boolean} True when the button should show.
 */
export function canShowMoreDetail(state) {
  return (
    state.phase === 'done' &&
    state.answer?.result?.status === 'answered' &&
    state.detailLevel === 'default' &&
    state.roleDepth < MOST_TECHNICAL_DEPTH
  );
}
