// @vitest-environment happy-dom
// @ts-check
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildDrawerClose,
  buildMobileBar,
  createDrawer,
  DRAWER_ID,
} from '../../../../public/js/ui/drawer.js';

beforeEach(() => {
  document.body.innerHTML = '';
});

/**
 * Puts a mobile bar, a sidebar with some buttons and a backdrop in the document and makes the drawer.
 * @param {string} [panelHtml] - What is inside the sidebar.
 * @returns {{ drawer: ReturnType<typeof createDrawer>, panel: HTMLElement, toggle: HTMLButtonElement, backdrop: HTMLElement, bar: ReturnType<typeof buildMobileBar> }} The parts.
 */
function setup(
  panelHtml = '<button id="first">One</button><button id="middle">Two</button><button id="last">Three</button>',
) {
  const bar = buildMobileBar({ roleName: 'Product Owner', turnText: 'Turn 2 of 5' });
  const panel = document.createElement('aside');
  panel.id = DRAWER_ID;
  panel.innerHTML = panelHtml;
  const backdrop = document.createElement('div');
  document.body.append(bar.element, panel, backdrop);
  const drawer = createDrawer({ panel, toggle: bar.toggle, backdrop });
  return { drawer, panel, toggle: bar.toggle, backdrop, bar };
}

/**
 * Presses a key on an element.
 * @param {Element} target - Where the key is pressed.
 * @param {string} key - The key.
 * @param {boolean} [shiftKey] - Whether Shift is held.
 * @returns {KeyboardEvent} The event, to see if it was stopped.
 */
function press(target, key, shiftKey = false) {
  const event = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

describe('buildMobileBar', () => {
  it('has a menu button of a good size, named for a screen reader, that controls the sidebar', () => {
    const { toggle } = buildMobileBar({ roleName: 'QA', turnText: '' });

    expect(toggle.tagName).toBe('BUTTON');
    expect(toggle.getAttribute('aria-label')).toBe('Conversation menu');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-controls')).toBe(DRAWER_ID);
    expect(toggle.getAttribute('type')).toBe('button');
    expect(toggle.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('shows the name of the product in a header, and the role and the turn in a strip', () => {
    const { element } = buildMobileBar({ roleName: 'Product Owner', turnText: 'Turn 2 of 5' });

    expect(element.tagName).toBe('HEADER');
    expect(element.querySelector('.topbar .brand__name')?.textContent).toBe('Knowledge Assistant');
    expect(element.querySelector('.strip__role')?.textContent).toBe('Product Owner');
    expect(element.querySelector('.strip__turn')?.textContent).toBe('Turn 2 of 5');
  });

  it('changes the strip without building the bar again', () => {
    const bar = buildMobileBar({ roleName: 'QA', turnText: '' });

    bar.update({ roleName: 'Developer', turnText: 'Turn 1 of 5' });

    expect(bar.element.querySelector('.strip__role')?.textContent).toBe('Developer');
    expect(bar.element.querySelector('.strip__turn')?.textContent).toBe('Turn 1 of 5');
  });

  it('shows a role name as text, never as markup', () => {
    const { element } = buildMobileBar({ roleName: '<img src=x onerror=alert(1)>', turnText: '' });

    expect(element.querySelector('img')).toBeNull();
  });
});

describe('buildDrawerClose', () => {
  it('is a button named Close menu with an icon hidden from screen readers', () => {
    const button = buildDrawerClose();

    expect(button.getAttribute('aria-label')).toBe('Close menu');
    expect(button.getAttribute('type')).toBe('button');
    expect(button.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('the drawer', () => {
  it('starts closed, with the backdrop hidden', () => {
    const { drawer, panel, backdrop, toggle } = setup();

    expect(drawer.isOpen()).toBe(false);
    expect(panel.classList.contains('is-open')).toBe(false);
    expect(backdrop.hidden).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('opens from the menu button as a modal dialog, with the backdrop showing', () => {
    const { drawer, panel, backdrop, toggle } = setup();

    toggle.click();

    expect(drawer.isOpen()).toBe(true);
    expect(panel.classList.contains('is-open')).toBe(true);
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(panel.getAttribute('aria-modal')).toBe('true');
    expect(backdrop.hidden).toBe(false);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  it('moves focus to the first thing inside it', () => {
    const { toggle } = setup();

    toggle.click();

    expect(document.activeElement?.id).toBe('first');
  });

  it('skips what is hidden when it looks for the first thing', () => {
    const { toggle } = setup(
      '<div hidden><button id="hidden">x</button></div><button id="shown">Shown</button>',
    );

    toggle.click();

    expect(document.activeElement?.id).toBe('shown');
  });

  it('closes with the menu button, and puts focus back on it', () => {
    const { drawer, panel, backdrop, toggle } = setup();
    toggle.click();

    toggle.click();

    expect(drawer.isOpen()).toBe(false);
    expect(panel.classList.contains('is-open')).toBe(false);
    expect(panel.hasAttribute('role')).toBe(false);
    expect(panel.hasAttribute('aria-modal')).toBe(false);
    expect(backdrop.hidden).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(toggle);
  });

  it('goes back to the role it had, such as complementary, when it closes', () => {
    const { panel, toggle } = setup();
    panel.setAttribute('role', 'complementary');

    toggle.click();
    expect(panel.getAttribute('role')).toBe('dialog');
    toggle.click();

    expect(panel.getAttribute('role')).toBe('complementary');
    expect(panel.hasAttribute('aria-modal')).toBe(false);
  });

  it('closes on Escape, puts focus back, and keeps the key from reaching anything else', () => {
    const { drawer, toggle } = setup();
    const elsewhere = vi.fn();
    document.addEventListener('keydown', elsewhere);
    toggle.click();

    press(/** @type {Element} */ (document.activeElement), 'Escape');

    expect(drawer.isOpen()).toBe(false);
    expect(document.activeElement).toBe(toggle);
    expect(elsewhere).not.toHaveBeenCalled();
    document.removeEventListener('keydown', elsewhere);
  });

  it('closes when the backdrop is pressed', () => {
    const { drawer, toggle, backdrop } = setup();
    toggle.click();

    backdrop.click();

    expect(drawer.isOpen()).toBe(false);
    expect(document.activeElement).toBe(toggle);
  });

  it('keeps Tab inside: from the last thing it goes to the first', () => {
    const { toggle } = setup();
    toggle.click();
    /** @type {HTMLElement} */ (document.getElementById('last')).focus();

    const event = press(/** @type {Element} */ (document.activeElement), 'Tab');

    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement?.id).toBe('first');
  });

  it('keeps Shift+Tab inside: from the first thing it goes to the last', () => {
    const { toggle } = setup();
    toggle.click();

    const event = press(/** @type {Element} */ (document.activeElement), 'Tab', true);

    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement?.id).toBe('last');
  });

  it('lets Tab move on by itself between the first and the last', () => {
    const { toggle } = setup();
    toggle.click();
    /** @type {HTMLElement} */ (document.getElementById('middle')).focus();

    const forward = press(/** @type {Element} */ (document.activeElement), 'Tab');
    const back = press(/** @type {Element} */ (document.activeElement), 'Tab', true);

    expect(forward.defaultPrevented).toBe(false);
    expect(back.defaultPrevented).toBe(false);
  });

  it('keeps focus where it is when Tab is pressed and there is nothing to move to', () => {
    const { toggle } = setup('<p>Nothing to press</p>');
    toggle.click();

    const event = press(document.body, 'Tab');
    const panelEvent = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    });
    /** @type {HTMLElement} */ (document.getElementById(DRAWER_ID)).dispatchEvent(panelEvent);

    expect(event.defaultPrevented).toBe(false);
    expect(panelEvent.defaultPrevented).toBe(true);
  });

  it('ignores other keys', () => {
    const { drawer, toggle } = setup();
    toggle.click();

    const event = press(/** @type {Element} */ (document.activeElement), 'a');

    expect(event.defaultPrevented).toBe(false);
    expect(drawer.isOpen()).toBe(true);
  });

  it('does nothing when it is opened twice or closed while closed', () => {
    const { drawer, toggle } = setup();

    drawer.close();
    expect(document.activeElement).not.toBe(toggle);
    drawer.open();
    /** @type {HTMLElement} */ (document.getElementById('last')).focus();
    drawer.open();

    expect(document.activeElement?.id).toBe('last');
    expect(drawer.isOpen()).toBe(true);
  });

  it('stops listening for keys once it is closed', () => {
    const { toggle, panel } = setup();
    toggle.click();
    toggle.click();
    /** @type {HTMLElement} */ (document.getElementById('last')).focus();

    const event = press(panel, 'Tab');

    expect(event.defaultPrevented).toBe(false);
  });
});
