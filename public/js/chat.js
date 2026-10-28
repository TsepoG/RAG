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
import { orderRoles } from './roleOrder.js';
import {
  createSignInState,
  EXPIRED_MESSAGE,
  isSignInError,
  isSignInEvent,
  SIGN_OUT_FAILED,
  SIGNED_OUT_MESSAGE,
  STATUS_FAILED,
} from './signIn.js';
import { conversationToMarkdown, COPIED_MESSAGE, copyConversation } from './ui/copyConversation.js';
import { focusSource, setSourcesOpen } from './ui/sources.js';
import { createView } from './view.js';

/** How often the "checked N min ago" text is brought up to date, in ms. */
export const AGE_REFRESH_MS = 30_000;

/** Said when the conversation the tab had open is gone, for instance after a server restart. */
export const FRESH_START =
  'Your earlier conversation was no longer there (the server may have restarted), so this is a fresh start.';

/** Said when a check was asked for too soon after the last. */
const RECHECK_TOO_SOON = 'Those sources were checked a moment ago. Try again in a few seconds.';

/** Said when the sources could not be checked at all. */
const RECHECK_FAILED = 'The sources could not be checked just now.';

/** Said when the list of roles could not be loaded. */
const ROLES_FAILED = 'The roles could not be loaded.';

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
 * @property {typeof import('./api.js').fetchAuthStatus} [fetchAuthStatus] - Says whether someone
 *   is signed in to Atlassian; without it, nobody needs to sign in.
 * @property {typeof import('./api.js').signOut} [signOut] - Signs out of Atlassian.
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
 * Creates the chat: it connects the page's view, the server and the state. All the logic that
 * decides what happens lives in the modules it uses; this holds the order of things.
 * @param {object} deps - What it works with.
 * @param {import('./refs.js').PageRefs} deps.refs - The page's places.
 * @param {ChatApi} deps.api - The server.
 * @param {ChatStorage} deps.storage - What is remembered.
 * @param {{ now: () => number }} deps.clock - The time source.
 * @param {{ writeText: (text: string) => Promise<void> } | undefined} [deps.clipboard] - The clipboard; the browser's by default.
 * @returns {{
 *   start: () => Promise<void>,
 *   tick: () => void,
 *   state: () => import('./chatState.js').ChatState,
 * }} The chat.
 */
export function createChat({
  refs,
  api,
  storage,
  clock,
  clipboard = globalThis.navigator?.clipboard,
}) {
  const view = createView({ refs });
  let state = /** @type {import('./chatState.js').ChatState} */ (INITIAL_CHAT);
  /** @type {import('./ui/sidebar.js').RoleSummary[]} */
  let roles = [];
  /** @type {string | undefined} */
  let roleId;
  /** @type {AbortController | undefined} */
  let controller;
  const openSources = new Set();
  const signIn = createSignInState();

  /** Draws the page for the state. */
  function render() {
    view.render({ state, roles, roleId, openSources, now: clock.now(), signIn: signIn.view() });
  }

  /** Shows that the Atlassian sign-in is needed: the sign-in screen, or the expired banner. */
  function needSignIn() {
    signIn.markNeeded();
    view.announce(EXPIRED_MESSAGE);
    render();
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
   * The role chosen before the first question, or the first the server offers.
   * @returns {import('./ui/sidebar.js').RoleSummary | undefined} The role, if the roles are loaded.
   */
  const chosenRole = () => roles.find(({ id }) => id === roleId) ?? roles[0];

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
      if (isSignInError(error)) {
        needSignIn();
        return false;
      }
      dispatch({
        type: 'notice',
        text: error instanceof ApiError ? error.message : 'The conversation could not be started.',
      });
      return false;
    }
  }

  /**
   * Tells screen readers an answer has arrived, and puts the cursor where the reader goes next.
   * @param {import('./chatState.js').AnswerView} answer - The answer.
   */
  function announceAnswer(answer) {
    view.announce(`Answer ready. ${answer.rendered.banner}`.trim());
    view.focusAfterAnswer();
  }

  /**
   * Shows why a question could not be asked.
   * @param {unknown} error - What was thrown.
   * @returns {void}
   */
  function failAsk(error) {
    const message = error instanceof ApiError ? error.message : 'Something went wrong.';
    dispatch({ type: 'error', kind: 'request', message });
    if (error instanceof ApiError && error.code === 'conversation_ended') {
      dispatch({ type: 'gone' });
    }
    if (isSignInError(error)) {
      needSignIn();
    }
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
            announceAnswer(action.payload);
          }
          if (isSignInEvent(event)) {
            needSignIn();
          }
        },
      });
      dispatch({ type: 'ended' });
    } catch (error) {
      if (!isAbort(error)) {
        failAsk(error);
      }
    }
    if (state.turns.at(-1)?.phase !== 'answered') {
      await refreshConversation();
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
   * Asks the same question again as a new turn.
   * @param {import('./chatState.js').TurnView | undefined} turn - The turn whose question to ask.
   * @param {{ detailLevel: 'default' | 'more', reaskAnswerId?: string }} how - The level, and the answer being asked again.
   * @returns {Promise<void>} Resolves when the turn has ended.
   */
  async function askAgain(turn, { detailLevel, reaskAnswerId }) {
    if (turn !== undefined) {
      await ask({ question: turn.question, detailLevel, reaskAnswerId });
    }
  }

  /**
   * Finds the turn that gave an answer.
   * @param {string} answerId - The answer.
   * @returns {import('./chatState.js').TurnView | undefined} The turn.
   */
  const turnOf = (answerId) => state.turns.find(({ answer }) => answer?.answerId === answerId);

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
    view.announce('');
    view.closeDrawer();
    view.focusQuestion();
    if (id !== undefined) {
      try {
        await api.deleteConversation(id);
      } catch {
        // It may already be gone, which is what was wanted.
      }
    }
  }

  /**
   * Signs out of Atlassian. The server revokes the sign-in and ends the conversation; the page
   * forgets the conversation and shows the sign-in screen. It asks for no confirmation.
   * @returns {Promise<void>} Resolves once the page shows the outcome.
   */
  async function signOutNow() {
    if (api.signOut === undefined) {
      return;
    }
    stop();
    try {
      await api.signOut();
    } catch {
      dispatch({ type: 'notice', text: SIGN_OUT_FAILED });
      return;
    }
    storage.clearConversationId();
    signIn.signedOut();
    dispatch({ type: 'reset' });
    view.closeDrawer();
    render();
    view.showToast(SIGNED_OUT_MESSAGE);
    view.announce(SIGNED_OUT_MESSAGE);
  }

  /**
   * Reads whether someone is signed in to Atlassian, when the server has a sign-in.
   * @returns {Promise<void>} Resolves once known, or once the failure is shown.
   */
  async function loadSignIn() {
    if (api.fetchAuthStatus === undefined) {
      return;
    }
    try {
      signIn.load(await api.fetchAuthStatus());
      render();
    } catch {
      dispatch({ type: 'notice', text: STATUS_FAILED });
    }
  }

  /**
   * Chooses the role to ask as. Once a question is asked the role is locked, so this does nothing.
   * @param {string} id - The role.
   */
  function selectRole(id) {
    if (state.turns.length === 0 && roles.some((role) => role.id === id)) {
      roleId = id;
      storage.saveRole(id);
      render();
    }
  }

  /**
   * Puts the whole conversation on the clipboard, or shows it to copy by hand.
   * @returns {Promise<void>} Resolves once it is done.
   */
  async function copy() {
    const role = roles.find(({ id }) => id === state.conversation?.role);
    const outcome = await copyConversation({
      markdown: conversationToMarkdown({
        roleName: role?.displayName ?? 'Unknown role',
        date: new Date(clock.now()),
        turns: state.turns,
      }),
      clipboard,
      announce: view.announce,
      showFallback: view.showCopyDialog,
    });
    if (outcome === 'copied') {
      view.showToast(COPIED_MESSAGE);
    }
  }

  /**
   * Shows the conversation the tab had open, or says it is gone.
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
      const answerId = attribute(card, 'data-answer-id');
      if (focusSource(card, answerId, attribute(chip, 'data-key'))) {
        openSources.add(answerId);
      }
      return;
    }
    const button = target?.closest('[data-action]') ?? null;
    if (button !== null) {
      onAnswerAction(button);
    }
  }

  /**
   * Acts on a button of an answer or of a failed turn.
   * @param {Element} button - The button.
   */
  function onAnswerAction(button) {
    const action = attribute(button, 'data-action');
    if (action === 'retry') {
      const turn = state.turns.find(
        (candidate) => candidate.turn === Number(attribute(button, 'data-turn')),
      );
      void askAgain(turn, { detailLevel: turn?.detailLevel ?? 'default' });
      return;
    }
    const answerId = attribute(button, 'data-answer-id');
    if (action === 'sources') {
      toggleSources(button, answerId);
      return;
    }
    const actions = {
      recheck: () => recheck(answerId),
      reask: () => askAgain(turnOf(answerId), { detailLevel: 'default', reaskAnswerId: answerId }),
      more: () => askAgain(turnOf(answerId), { detailLevel: 'more' }),
      up: () => rate(answerId, 'up'),
      down: () => rate(answerId, 'down'),
    };
    void actions[/** @type {keyof typeof actions} */ (action)]?.();
  }

  /**
   * Opens or closes the Sources of an answer, and remembers it so a redraw keeps it so.
   * @param {Element} button - The toggle.
   * @param {string} answerId - The answer.
   */
  function toggleSources(button, answerId) {
    const section = /** @type {HTMLElement} */ (button.closest('.sources'));
    const open = button.getAttribute('aria-expanded') !== 'true';
    setSourcesOpen(section, open);
    if (open) {
      openSources.add(answerId);
    } else {
      openSources.delete(answerId);
    }
  }

  /**
   * Acts on a click on a role, or on a button of the sidebar, the end card or the question box.
   * @param {MouseEvent} event - The click.
   */
  function onPageClick(event) {
    const target = event.target instanceof Element ? event.target : null;
    const role = target?.closest('[data-role]') ?? null;
    if (role !== null) {
      selectRole(attribute(role, 'data-role'));
      view.closeDrawer();
      return;
    }
    const action = target?.closest('[data-action]')?.getAttribute('data-action');
    if (action === 'new-conversation') {
      void newConversation();
    } else if (action === 'copy-conversation') {
      view.closeDrawer();
      void copy();
    } else if (action === 'stop') {
      stop();
    } else if (action === 'sign-out') {
      void signOutNow();
    }
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
    view.form.addEventListener('submit', (event) => {
      event.preventDefault();
      const question = view.field.value.trim();
      if (question !== '' && canAsk(state)) {
        view.field.value = '';
        void ask({ question, detailLevel: 'default' });
      }
    });
    view.field.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        view.form.requestSubmit();
      }
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        stop();
      }
    });
    for (const place of [refs.sidebar, refs.end, view.form]) {
      place.addEventListener('click', onPageClick);
    }
    refs.messages.addEventListener('click', onMessagesClick);
    refs.messages.addEventListener('submit', (event) =>
      onFeedbackSubmit(/** @type {SubmitEvent} */ (event)),
    );
  }

  return {
    async start() {
      attach();
      render();
      await loadSignIn();
      try {
        roles = orderRoles(await api.fetchRoles());
        const remembered = storage.loadRole();
        roleId = roles.some(({ id }) => id === remembered) ? remembered : roles[0]?.id;
        render();
      } catch (error) {
        dispatch({
          type: 'notice',
          text: error instanceof ApiError ? error.message : ROLES_FAILED,
        });
      }
      await restore();
    },
    tick() {
      view.tick(clock.now());
    },
    state: () => state,
  };
}
