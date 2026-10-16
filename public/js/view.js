// @ts-check
import { isBusy } from './chatState.js';
import { setVisible } from './dom.js';
import { drawTurns } from './turnList.js';
import { buildCopyDialog, selectDialogText } from './ui/copyConversation.js';
import { buildComposer, updateComposer } from './ui/composer.js';
import { buildDrawerClose, buildMobileBar, createDrawer } from './ui/drawer.js';
import { buildEndCard, summariseChecks } from './ui/endCard.js';
import { buildSidebarContent, countSourcesUsed } from './ui/sidebar.js';
import { refreshAges } from './ui/sources.js';
import { createToast } from './ui/toast.js';
import { buildWelcome } from './ui/welcome.js';

/**
 * How many questions a conversation holds, until the server says how many it holds. It is the
 * server's default, `CONVERSATION_MAX_TURNS`, and is used only before the first question.
 */
export const DEFAULT_MAX_TURNS = 5;

/** What the page needs to draw itself, besides the state. */
/**
 * @typedef {object} ViewInput
 * @property {import('./chatState.js').ChatState} state - The state.
 * @property {ReadonlyArray<import('./ui/sidebar.js').RoleSummary>} roles - The roles on offer.
 * @property {string | undefined} roleId - The role chosen before the first question.
 * @property {Set<string>} openSources - Ids of the answers whose Sources list is open.
 * @property {number} now - The time now, in ms.
 */

/**
 * Why a conversation can take no more questions, if it cannot: it is full, or it was closed.
 * @param {import('./chatState.js').ChatState} state - The state.
 * @returns {string | undefined} The reason, or undefined while it can go on.
 */
export function endReasonOf({ conversation }) {
  return conversation === undefined
    ? undefined
    : (conversation.full ?? conversation.ended ?? undefined);
}

/**
 * Puts focus back on the same control after its container was drawn again.
 * @param {HTMLElement} container - The container.
 * @param {Element | null} before - What had focus before it was drawn again, if it was inside the container.
 */
function restoreFocus(container, before) {
  if (before === null) {
    return;
  }
  const key = ['data-role', 'data-action'].find((name) => before.hasAttribute(name));
  if (key === undefined) {
    return;
  }
  const value = before.getAttribute(key);
  const same = [...container.querySelectorAll(`[${key}]`)].find(
    (element) => element.getAttribute(key) === value,
  );
  if (same instanceof HTMLElement) {
    same.focus();
  }
}

/**
 * Creates the page's view: everything on screen except what the reader types. It builds the
 * question box once, mounts the parts of the page, and draws them again from the state, changing
 * only what changed so focus and what the reader has typed stay where they are.
 * @param {object} deps - What it works with.
 * @param {import('./refs.js').PageRefs} deps.refs - The page's places.
 * @returns {{
 *   field: HTMLTextAreaElement,
 *   form: HTMLFormElement,
 *   render: (input: ViewInput) => void,
 *   tick: (now: number) => void,
 *   announce: (text: string) => void,
 *   showToast: (text: string) => void,
 *   focusAfterAnswer: () => void,
 *   focusQuestion: () => void,
 *   showCopyDialog: (markdown: string) => void,
 *   closeDrawer: () => void,
 * }} The view.
 */
export function createView({ refs }) {
  const form = buildComposer({
    turnsUsed: 0,
    maxTurns: DEFAULT_MAX_TURNS,
    busy: false,
    hidden: false,
  });
  const field = /** @type {HTMLTextAreaElement} */ (form.querySelector('textarea'));
  refs.composer.replaceChildren(form);
  const bar = buildMobileBar({ roleName: '', turnText: '' });
  refs.mobileBar.replaceChildren(bar.element);
  const drawer = createDrawer({ panel: refs.sidebar, toggle: bar.toggle, backdrop: refs.backdrop });
  const toast = createToast(document.body);
  const turnMemory = new WeakMap();
  /** The last things drawn, so a part is drawn again only when what it shows has changed. */
  const drawn = { sidebar: '', welcome: '', end: '' };

  /**
   * Puts a question in the box and moves the cursor to its end, without sending it.
   * @param {string} question - The question.
   */
  function pick(question) {
    field.value = question;
    field.focus();
    field.setSelectionRange(question.length, question.length);
  }

  /**
   * Draws the sidebar, and the drawer's button to close it, when what they show has changed.
   * @param {import('./ui/sidebar.js').SidebarInput} sidebar - What the sidebar shows.
   */
  function drawSidebar(sidebar) {
    const key = JSON.stringify(sidebar);
    if (key === drawn.sidebar) {
      return;
    }
    drawn.sidebar = key;
    const active = document.activeElement;
    const before = refs.sidebar.contains(active) ? active : null;
    const close = buildDrawerClose();
    close.addEventListener('click', drawer.close);
    refs.sidebar.replaceChildren(close, buildSidebarContent(sidebar));
    restoreFocus(refs.sidebar, before);
  }

  /**
   * Draws the welcome screen for a role when the role has changed.
   * @param {import('./ui/sidebar.js').RoleSummary | undefined} role - The role.
   */
  function drawWelcome(role) {
    const key = `${role?.id}|${role?.suggestedQuestions?.join('\n')}`;
    if (key !== drawn.welcome) {
      drawn.welcome = key;
      refs.welcome.replaceChildren(buildWelcome(role ?? {}, pick));
    }
  }

  /**
   * Draws the end card when the conversation can go no further, and removes it otherwise.
   * @param {string | undefined} reason - Why it ended, if it did.
   * @param {number} maxTurns - The turn limit.
   * @param {import('./chatState.js').ChatState} state - The state.
   */
  function drawEnd(reason, maxTurns, state) {
    const summary = summariseChecks(state.turns);
    const key = reason === undefined ? '' : JSON.stringify([reason, maxTurns, summary]);
    if (key === drawn.end) {
      return;
    }
    drawn.end = key;
    refs.end.replaceChildren(
      ...(reason === undefined ? [] : [buildEndCard({ reason, maxTurns, summary })]),
    );
  }

  return {
    field,
    form,
    render(input) {
      const { state, roles, roleId, openSources, now } = input;
      const conversation = state.conversation;
      const started = state.turns.length > 0;
      const reason = endReasonOf(state);
      const busy = isBusy(state);
      const role = roles.find(({ id }) => id === (conversation?.role ?? roleId)) ?? roles[0];
      const maxTurns = conversation?.maxTurns ?? DEFAULT_MAX_TURNS;
      const turn = Math.max(conversation?.turnCount ?? 0, state.turns.at(-1)?.turn ?? 0);
      drawSidebar({
        roles,
        selectedId: role?.id,
        locked: started,
        conversation: started ? { turn, maxTurns, ended: reason !== undefined } : undefined,
        sourcesUsed: countSourcesUsed(state.turns),
        busy,
      });
      bar.update({
        roleName: role?.displayName ?? '',
        turnText: started ? `Turn ${turn} of ${maxTurns}` : '',
      });
      setVisible(refs.welcome, !started);
      drawWelcome(role);
      refs.notice.textContent = state.notice;
      setVisible(refs.notice, state.notice !== '');
      drawTurns(/** @type {HTMLOListElement} */ (refs.messages), turnMemory, state, {
        now,
        openSources,
      });
      drawEnd(reason, maxTurns, state);
      updateComposer(form, { turnsUsed: turn, maxTurns, busy, hidden: reason !== undefined });
    },
    tick: (now) => refreshAges(refs.messages, now),
    announce: (text) => {
      refs.live.textContent = text;
    },
    focusAfterAnswer: () => {
      const title = refs.end.querySelector('h2');
      (title ?? field).focus();
    },
    focusQuestion: () => field.focus(),
    showCopyDialog: (markdown) => {
      const opener = /** @type {HTMLElement} */ (document.activeElement);
      const dialog = buildCopyDialog(markdown, () => {
        dialog.remove();
        opener.focus();
      });
      document.body.append(dialog);
      selectDialogText(dialog);
    },
    showToast: toast.show,
    closeDrawer: drawer.close,
  };
}
