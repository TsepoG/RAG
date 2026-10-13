// @ts-check
import { canAsk, isBusy } from './chatState.js';
import { clear, el, setVisible } from './dom.js';

/** What the counter says before the first question. */
const NO_QUESTIONS = 'No questions yet.';

/** Said when a conversation was closed without being full. */
const ENDED_MESSAGE = 'This conversation has ended — start a new one to keep going.';

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
 * Says how far the conversation has got.
 * @param {import('./chatState.js').ConversationInfo | undefined} conversation - The conversation.
 * @returns {string} For example "Turn 2 of 5".
 */
function counterText(conversation) {
  return conversation === undefined || conversation.turnCount === 0
    ? NO_QUESTIONS
    : `Turn ${conversation.turnCount} of ${conversation.maxTurns}`;
}

/**
 * Says why no more questions can be asked, if that is so.
 * @param {import('./chatState.js').ConversationInfo | undefined} conversation - The conversation.
 * @returns {string} The message, or an empty string when questions can still be asked.
 */
function stoppedMessage(conversation) {
  if (conversation?.full) {
    return conversation.fullMessage ?? ENDED_MESSAGE;
  }
  return conversation?.ended ? ENDED_MESSAGE : '';
}

/**
 * Draws everything on the page except the turns: the counter, the notice, the question box, the
 * buttons and the message that says the conversation is full. The page changes only through this
 * and the turn list, so what is on screen always matches the state.
 * @param {import('./refs.js').PageRefs} refs - The page's elements.
 * @param {import('./chatState.js').ChatState} state - The state.
 */
export function showShell(refs, state) {
  const busy = isBusy(state);
  const message = stoppedMessage(state.conversation);
  refs.turnCounter.textContent = counterText(state.conversation);
  setVisible(refs.newConversation, state.conversation !== undefined || state.turns.length > 0);
  refs.notice.textContent = state.notice;
  setVisible(refs.notice, state.notice !== '');
  /** @type {HTMLButtonElement} */ (refs.ask).disabled = !canAsk(state);
  /** @type {HTMLTextAreaElement} */ (refs.question).disabled = message !== '';
  setVisible(refs.stop, busy);
  refs.form.toggleAttribute('aria-busy', busy);
  refs.fullMessage.textContent = message;
  setVisible(refs.fullMessage, message !== '');
}

/**
 * Shows or hides the question "Start a new conversation as this role?".
 * @param {import('./refs.js').PageRefs} refs - The page's elements.
 * @param {string | undefined} roleName - The role asked for; undefined hides the question.
 */
export function showRoleConfirm(refs, roleName) {
  refs.roleConfirmText.textContent =
    roleName === undefined
      ? ''
      : `Start a new conversation as ${roleName}? The current conversation will end.`;
  setVisible(refs.roleConfirm, roleName !== undefined);
}
