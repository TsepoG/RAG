// @ts-check
import { el } from '../dom.js';
import { icon } from './icons.js';
import { PRODUCT_NAME } from './sidebar.js';

/** The id of the panel the menu button opens, which holds the sidebar's content. */
export const DRAWER_ID = 'sidebar';

/** What a screen reader calls the menu button and the drawer. */
const MENU_LABEL = 'Conversation menu';

/** Everything a keyboard can land on inside the drawer. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Builds the bar shown on a narrow screen: the logo, the name and the menu button, then a strip
 * with the role and how far the conversation is.
 * @param {{ roleName: string, turnText: string }} input - The role's name and the words about the turn, or an empty string before there is one.
 * @returns {{ element: HTMLElement, toggle: HTMLButtonElement, update: (input: { roleName: string, turnText: string }) => void }} The bar, its menu button, and a way to change the strip.
 */
export function buildMobileBar({ roleName, turnText }) {
  const toggle = /** @type {HTMLButtonElement} */ (
    el(
      'button',
      {
        className: 'topbar__menu',
        attributes: {
          type: 'button',
          'aria-label': MENU_LABEL,
          'aria-expanded': 'false',
          'aria-controls': DRAWER_ID,
        },
      },
      [icon('menu', { size: 18 })],
    )
  );
  const role = el('span', { className: 'strip__role', text: roleName });
  const turn = el('span', { className: 'strip__turn', text: turnText });
  // One header holds both parts, so the whole bar is a landmark and no content sits outside one.
  const element = el('header', { className: 'mobilebar' }, [
    el('div', { className: 'topbar' }, [
      el('div', { className: 'topbar__brand' }, [
        el('span', { className: 'brand__mark brand__mark--small' }, [icon('brand', { size: 16 })]),
        el('span', { className: 'brand__name', text: PRODUCT_NAME }),
      ]),
      toggle,
    ]),
    el('div', { className: 'strip' }, [role, turn]),
  ]);
  return {
    element,
    toggle,
    update: (next) => {
      role.textContent = next.roleName;
      turn.textContent = next.turnText;
    },
  };
}

/**
 * Builds the button that closes the drawer, shown at the top of it on a narrow screen.
 * @returns {HTMLButtonElement} The button.
 */
export function buildDrawerClose() {
  return /** @type {HTMLButtonElement} */ (
    el(
      'button',
      {
        className: 'drawer__close',
        attributes: { type: 'button', 'aria-label': 'Close menu' },
      },
      [icon('close', { size: 18 })],
    )
  );
}

/**
 * Finds what a keyboard can land on inside an element, in order, leaving out what is hidden.
 * @param {HTMLElement} root - The element.
 * @returns {HTMLElement[]} The elements.
 */
function focusablesIn(root) {
  return [...root.querySelectorAll(FOCUSABLE)].flatMap((element) =>
    element instanceof HTMLElement && !element.closest('[hidden]') ? [element] : [],
  );
}

/**
 * Makes the sidebar a drawer that opens from the menu button. While it is open it is a modal
 * dialog: focus moves into it and stays there, Escape closes it (and does not reach anything
 * else, such as Stop), pressing outside it closes it, and focus goes back to the menu button.
 * @param {object} parts - The page's elements.
 * @param {HTMLElement} parts.panel - The sidebar.
 * @param {HTMLElement} parts.toggle - The menu button.
 * @param {HTMLElement} parts.backdrop - The cover behind the drawer; pressing it closes the drawer.
 * @returns {{ open: () => void, close: () => void, isOpen: () => boolean }} The drawer.
 */
export function createDrawer({ panel, toggle, backdrop }) {
  let isOpen = false;
  /** The role the panel has when it is not a drawer, put back when it closes. */
  /** @type {string | null} */
  let restingRole = null;

  /**
   * Keeps Tab inside the drawer, and closes it on Escape.
   * @param {KeyboardEvent} event - The key press.
   */
  function onKeydown(event) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== 'Tab') {
      return;
    }
    const items = focusablesIn(panel);
    const first = items[0];
    const last = items.at(-1);
    if (first === undefined || last === undefined) {
      event.preventDefault();
      return;
    }
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  /** Opens the drawer and moves focus into it. */
  function open() {
    if (isOpen) {
      return;
    }
    isOpen = true;
    panel.classList.add('is-open');
    restingRole = panel.getAttribute('role');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    backdrop.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    panel.addEventListener('keydown', onKeydown);
    focusablesIn(panel)[0]?.focus();
  }

  /** Closes the drawer and puts focus back on the menu button. */
  function close() {
    if (!isOpen) {
      return;
    }
    isOpen = false;
    panel.classList.remove('is-open');
    if (restingRole === null) {
      panel.removeAttribute('role');
    } else {
      panel.setAttribute('role', restingRole);
    }
    panel.removeAttribute('aria-modal');
    backdrop.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    panel.removeEventListener('keydown', onKeydown);
    toggle.focus();
  }

  toggle.addEventListener('click', () => (isOpen ? close() : open()));
  backdrop.addEventListener('click', close);
  backdrop.hidden = true;
  return { open, close, isOpen: () => isOpen };
}
