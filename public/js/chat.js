// @ts-check
import { ApiError } from './api.js';
import {
  canAsk,
  conversationFromTranscript,
  fromServerEvent,
  INITIAL_CHAT,
  isBusy,
  next,
} from './chatState.js';
import { showRoleConfirm, showRoles, showShell } from './shell.js';
import { focusSource, refreshAges } from './sourcesPanel.js';
import { drawTurns } from './turnList.js';

/** How often the "checked N min ago" text is brought up to date, in ms. */
export const AGE_REFRESH_MS = 30_000;

/** Said when the conversation the tab had open is gone, for instance after a server restart. */
export const FRESH_START =
  'Your earlier conversation was no longer there (the server may have restarted), so this is a fresh start.';

/** Said when a check was asked for too soon after the last. */
const RECHECK_TOO_SOON = 'Those sources were checked a moment ago. Try again in a few seconds.';

/** Said when the sources could not be checked at all. */
const RECHECK_FAILED = 'The sources could not be checked just now.';

/**
 * What the chat needs from the server, so tests can use fakes.
 * @typedef {object} ChatApi
 * @property {typeof import('./api.js').fetchRoles} fetchRoles - Loads the roles.
 * @property {typeof import('./api.js').createConversation} createConversation - Starts a conversation.
 * @property {typeof import('./api.js').sendMessage} sendMessage - Asks a question in it.
 * @property {typeof import('./api.js').fetchConversation} fetchConversation - Reads it back.
 * @property {typeof import('./api.js').deleteConversation} deleteConversation - Ends it.
 * @property {typeof import('./api.js').recheckAnswer} recheckAnswer - Checks an answer's sources now.
 * @property {typeof import('./api.js').sendFeedback} sendFeedback - Sends a thumb.
 */

/**
 * What the chat remembers between visits.
 * @typedef {object} ChatStorage
 * @property {() => string | undefined} loadRole - The role chosen last time.
 * @property {(roleId: string) => unknown} saveRole - Remembers the role.
 * @property {() => string | undefined} loadConversationId - The conversation this tab had open.
 * @property {(conversationId: string) => unknown} saveConversationId - Remembers it.
 * @property {() => unknown} clearConversationId - Forgets it.
 */

/**
 * Whether an error is the request being aborted, which is the reader stopping it.
 * @param {unknown} error - What was thrown.
 * @returns {boolean} True for an AbortError.
 */
function isAbort(error) {
  return error instanceof DOMException && error.name === 'AbortError';
}

/**
 * Reads an attribute the page wrote itself, so it is always there.
 * @param {Element} element - The element.
 * @param {string} name - The attribute.
 * @returns {string} Its value.
 */
function attribute(element, name) {
  return /** @type {string} */ (element.getAttribute(name));
}

/**
 * Creates the chat: it connects the page's elements, the server and the state. All the logic that
 * decides what happens lives in the modules it uses; this holds the order of things.
 * @param {object} deps - What it works with.
 * @param {import('./refs.js').PageRefs} deps.refs - The page's elements.
 * @param {ChatApi} deps.api - The server.
 * @param {ChatStorage} deps.storage - What is remembered.
 * @param {{ now: () => number }} deps.clock - The time source.
 * @returns {{
 *   start: () => Promise<void>,
 *   tick: () => void,
 *   state: () => import('./chatState.js').ChatState,
 * }} The chat.
 */
export function createChat({ refs, api, storage, clock }) {
  let state = /** @type {import('./chatState.js').ChatState} */ (INITIAL_CHAT);
  /** @type {import('./shell.js').RoleSummary[]} */
  let roles = [];
  /** @type {AbortController | undefined} */
  let controller;
  /** @type {string | undefined} */
  let pendingRole;
  const memory = new WeakMap();
  const openSources = new Set();

  /** Draws the page for the state. */
  function render() {
    showShell(refs, state);
    drawTurns(/** @type {HTMLOListElement} */ (refs.messages), memory, state, {
      now: clock.now(),
      openSources,
    });
  }

  /**
   * Applies something that happened and draws the page.
   * @param {import('./chatState.js').ChatAction} action - What happened.
   */
  function dispatch(action) {
    const before = state;
    state = next(state, action);
    if (state !== before) {
      render();
    }
  }

  /**
   * The role chosen in the picker.
   * @returns {import("./shell.js").RoleSummary | undefined} The role, if the roles are loaded.
   */
  const chosenRole = () =>
    roles.find(({ id }) => id === /** @type {HTMLSelectElement} */ (refs.role).value);

  /**
   * Reads where the conversation stands from the server, after a turn ended without an answer.
   * @returns {Promise<void>} Resolves once the state is up to date.
   */
  async function refreshConversation() {
    const id = state.conversation?.conversationId;
    if (id === undefined) {
      return;
    }
    try {
      const transcript = await api.fetchConversation(id);
      dispatch({ type: 'conversationState', conversation: conversationFromTranscript(transcript) });
      return;
    } catch (error) {
      if (error instanceof ApiError && error.code === 'conversation_ended') {
        dispatch({ type: 'gone' });
      }
    }
  }

  /**
   * Starts the conversation on the first question.
   * @returns {Promise<boolean>} Whether there is a conversation to ask in.
   */
  async function ensureConversation() {
    if (state.conversation !== undefined) {
      return true;
    }
    const role = chosenRole();
    if (role === undefined) {
      return false;
    }
    try {
      const { conversationId, maxTurns } = await api.createConversation(role.id);
      storage.saveConversationId(conversationId);
      dispatch({
        type: 'started',
        conversation: {
          conversationId,
          role: role.id,
          roleDepth: role.depth,
          maxTurns,
          turnCount: 0,
          full: null,
          fullMessage: null,
          ended: null,
        },
      });
      return true;
    } catch (error) {
      dispatch({
        type: 'notice',
        text: error instanceof ApiError ? error.message : 'The conversation could not be started.',
      });
      return false;
    }
  }

  /**
   * Tells screen readers an answer has arrived, and puts the cursor back in the question box.
   * @param {import('./chatState.js').AnswerView} answer - The answer.
   */
  function announce(answer) {
    refs.live.textContent = `Answer ready. ${answer.rendered.banner}`.trim();
    refs.question.focus();
  }

  /**
   * Asks a question and feeds what comes back into the state.
   * @param {{ question: string, detailLevel: 'default' | 'more', reaskAnswerId?: string }} request - What to ask.
   * @returns {Promise<void>} Resolves when the turn has ended.
   */
  async function ask({ question, detailLevel, reaskAnswerId }) {
    if (!canAsk(state) || !(await ensureConversation())) {
      return;
    }
    const conversationId = /** @type {string} */ (state.conversation?.conversationId);
    controller = new AbortController();
    dispatch({ type: 'ask', question, detailLevel });
    try {
      await api.sendMessage({
        conversationId,
        question,
        detailLevel,
        reaskAnswerId,
        signal: controller.signal,
        onEvent: (event) => {
          const action = fromServerEvent(event);
          if (action !== undefined) {
            dispatch(action);
          }
          if (action?.type === 'done') {
            announce(action.payload);
          }
        },
      });
      dispatch({ type: 'ended' });
    } catch (error) {
      if (!isAbort(error)) {
        await failAsk(error);
      }
    }
    if (state.turns.at(-1)?.phase !== 'answered') {
      await refreshConversation();
    }
  }

  /**
   * Shows why a question could not be asked.
   * @param {unknown} error - What was thrown.
   * @returns {Promise<void>} Resolves once shown.
   */
  async function failAsk(error) {
    const message = error instanceof ApiError ? error.message : 'Something went wrong.';
    dispatch({ type: 'error', kind: 'request', message });
    if (error instanceof ApiError && error.code === 'conversation_ended') {
      dispatch({ type: 'gone' });
    }
  }

  /** Stops the question that is running; the conversation goes on. */
  function stop() {
    if (isBusy(state)) {
      dispatch({ type: 'stop' });
      controller?.abort();
    }
  }

  /**
   * Checks an answer's sources now.
   * @param {string} answerId - The answer.
   * @returns {Promise<void>} Resolves once the result is shown.
   */
  async function recheck(answerId) {
    const id = state.conversation?.conversationId;
    if (id === undefined || state.checking.includes(answerId)) {
      return;
    }
    dispatch({ type: 'checking', answerId, on: true });
    try {
      const payload = await api.recheckAnswer(id, answerId);
      dispatch({ type: 'recheck', payload });
      if (payload.ignored) {
        dispatch({ type: 'notice', text: RECHECK_TOO_SOON });
      }
    } catch (error) {
      if (error instanceof ApiError && error.code === 'conversation_ended') {
        dispatch({ type: 'gone' });
      } else {
        dispatch({
          type: 'notice',
          text: error instanceof ApiError ? error.message : RECHECK_FAILED,
        });
      }
    }
    dispatch({ type: 'checking', answerId, on: false });
  }

  /**
   * Finds the turn that gave an answer.
   * @param {string} answerId - The answer.
   * @returns {import('./chatState.js').TurnView | undefined} The turn.
   */
  const turnOf = (answerId) => state.turns.find(({ answer }) => answer?.answerId === answerId);

  /**
   * Asks the same question again as a new turn, for the latest versions of the sources.
   * @param {string} answerId - The answer to ask again.
   * @returns {Promise<void>} Resolves when the turn has ended.
   */
  async function reask(answerId) {
    const turn = turnOf(answerId);
    if (turn !== undefined) {
      await ask({ question: turn.question, detailLevel: 'default', reaskAnswerId: answerId });
    }
  }

  /**
   * Asks for more detail on the newest answer, as a follow-up one step more technical.
   * @param {string} answerId - The answer.
   * @returns {Promise<void>} Resolves when the turn has ended.
   */
  async function moreDetail(answerId) {
    const turn = turnOf(answerId);
    if (turn !== undefined) {
      await ask({ question: turn.question, detailLevel: 'more' });
    }
  }

  /**
   * Sends feedback and says whether it was saved.
   * @param {string} answerId - The answer.
   * @param {'up' | 'down'} rating - The rating.
   * @param {{ comment?: string, wrongSourceKey?: string }} [details] - What was added.
   * @returns {Promise<void>} Resolves once the result is shown.
   */
  async function submitFeedback(answerId, rating, details = {}) {
    try {
      await api.sendFeedback({ answerId, rating, ...details });
      dispatch({
        type: 'rated',
        answerId,
        saved: true,
        message: 'Thank you. Your feedback was saved.',
      });
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'It could not be sent.';
      dispatch({ type: 'rated', answerId, saved: false, message });
    }
  }

  /**
   * Handles a thumb.
   * @param {string} answerId - The answer.
   * @param {'up' | 'down'} rating - The thumb pressed.
   * @returns {Promise<void>} Resolves once the result is shown.
   */
  async function rate(answerId, rating) {
    dispatch({ type: 'rate', answerId, rating });
    if (rating === 'up') {
      await submitFeedback(answerId, rating);
    }
  }

  /**
   * Ends the conversation and starts over.
   * @returns {Promise<void>} Resolves once the page is cleared.
   */
  async function newConversation() {
    stop();
    const id = state.conversation?.conversationId;
    storage.clearConversationId();
    dispatch({ type: 'reset' });
    refs.live.textContent = '';
    refs.question.focus();
    if (id !== undefined) {
      try {
        await api.deleteConversation(id);
      } catch {
        // It may already be gone, which is what was wanted.
      }
    }
  }

  /**
   * Handles a change of role. While a conversation has questions in it, the role cannot change
   * under it, so the reader is asked first.
   */
  function changeRole() {
    const select = /** @type {HTMLSelectElement} */ (refs.role);
    const role = chosenRole();
    if (role === undefined) {
      return;
    }
    if (
      state.turns.length > 0 &&
      state.conversation !== undefined &&
      state.conversation.role !== role.id
    ) {
      pendingRole = role.id;
      showRoleConfirm(refs, role.displayName);
      return;
    }
    storage.saveRole(role.id);
    showRoles(refs, roles, select.value);
  }

  /**
   * Answers the question "Start a new conversation as this role?".
   * @param {boolean} yes - Whether the reader said yes.
   * @returns {Promise<void>} Resolves once done.
   */
  async function answerRoleConfirm(yes) {
    showRoleConfirm(refs, undefined);
    const chosen = pendingRole;
    pendingRole = undefined;
    if (yes && chosen !== undefined) {
      storage.saveRole(chosen);
      await newConversation();
      showRoles(refs, roles, chosen);
    } else {
      showRoles(refs, roles, state.conversation?.role);
    }
  }

  /**
   * Shows the conversation this tab had open, or says it is gone.
   * @returns {Promise<void>} Resolves once shown.
   */
  async function restore() {
    const id = storage.loadConversationId();
    if (id === undefined) {
      return;
    }
    try {
      const transcript = await api.fetchConversation(id);
      const role = roles.find((candidate) => candidate.id === transcript.role);
      dispatch({ type: 'restored', transcript, roleDepth: role?.depth ?? 0 });
      showRoles(refs, roles, transcript.role);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'conversation_ended') {
        storage.clearConversationId();
        dispatch({ type: 'notice', text: FRESH_START });
      }
    }
  }

  /**
   * Acts on a click inside the conversation: a citation chip, or one of the buttons on an answer.
   * @param {MouseEvent} event - The click.
   */
  function onMessagesClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    const chip = target?.closest('button.cite') ?? null;
    const card = target?.closest('.card');
    if (chip !== null && card instanceof HTMLElement) {
      // The page wrote these attributes itself, so they are there.
      focusSource(card, attribute(card, 'data-answer-id'), attribute(chip, 'data-key'));
      return;
    }
    const button = target?.closest('[data-action]') ?? null;
    if (button === null) {
      return;
    }
    const answerId = attribute(button, 'data-answer-id');
    const actions = {
      recheck: () => recheck(answerId),
      reask: () => reask(answerId),
      more: () => moreDetail(answerId),
      up: () => rate(answerId, 'up'),
      down: () => rate(answerId, 'down'),
    };
    const action = actions[/** @type {keyof typeof actions} */ (attribute(button, 'data-action'))];
    void action?.();
  }

  /**
   * Sends the feedback form of an answer.
   * @param {SubmitEvent} event - The submit.
   */
  function onFeedbackSubmit(event) {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !form.classList.contains('feedback-form')) {
      return;
    }
    event.preventDefault();
    const comment = /** @type {HTMLTextAreaElement} */ (
      form.elements.namedItem('comment')
    ).value.trim();
    const source = /** @type {HTMLSelectElement} */ (form.elements.namedItem('source')).value;
    void submitFeedback(attribute(form, 'data-answer-id'), 'down', {
      ...(comment === '' ? {} : { comment }),
      ...(source === '' ? {} : { wrongSourceKey: source }),
    });
  }

  /** Connects the page's events. */
  function attach() {
    refs.form.addEventListener('submit', (event) => {
      event.preventDefault();
      const field = /** @type {HTMLTextAreaElement} */ (refs.question);
      const question = field.value.trim();
      if (question !== '' && canAsk(state)) {
        field.value = '';
        void ask({ question, detailLevel: 'default' });
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
    refs.role.addEventListener('change', changeRole);
    refs.stop.addEventListener('click', stop);
    refs.newConversation.addEventListener('click', () => void newConversation());
    refs.roleConfirmYes.addEventListener('click', () => void answerRoleConfirm(true));
    refs.roleConfirmNo.addEventListener('click', () => void answerRoleConfirm(false));
    refs.messages.addEventListener('click', onMessagesClick);
    refs.messages.addEventListener('submit', (event) =>
      onFeedbackSubmit(/** @type {SubmitEvent} */ (event)),
    );
    // `toggle` does not bubble, so it is caught on the way down.
    refs.messages.addEventListener(
      'toggle',
      (event) => {
        const panel = event.target;
        if (panel instanceof HTMLDetailsElement && panel.classList.contains('sources')) {
          const id = attribute(panel, 'data-answer-id');
          if (panel.open) {
            openSources.add(id);
          } else {
            openSources.delete(id);
          }
        }
      },
      true,
    );
  }

  return {
    async start() {
      attach();
      render();
      try {
        roles = await api.fetchRoles();
        showRoles(refs, roles, storage.loadRole());
      } catch (error) {
        refs.roleDescription.textContent =
          error instanceof ApiError ? error.message : 'The roles could not be loaded.';
      }
      await restore();
    },
    tick() {
      refreshAges(refs.messages, clock.now());
    },
    state: () => state,
  };
}
