// @vitest-environment happy-dom
// @ts-check
import { describe, expect, it } from 'vitest';
import {
  buildBrand,
  buildSidebarContent,
  countSourcesUsed,
  PRODUCT_NAME,
  ROLE_FREE_NOTE,
  ROLE_LOCKED_NOTE,
} from '../../../../public/js/ui/sidebar.js';

const ROLES = [
  { id: 'dev', displayName: 'Developer', description: 'Writes code.', depth: 3 },
  { id: 'ba', displayName: 'Business Analyst', description: 'Writes rules.', depth: 2 },
  { id: 'po', displayName: 'Product Owner', description: 'Owns it.', depth: 1 },
];

/**
 * Builds the sidebar content.
 * @param {Partial<import('../../../../public/js/ui/sidebar.js').SidebarInput>} [changes] - Parts to change.
 * @returns {HTMLElement} The content.
 */
function build(changes = {}) {
  return buildSidebarContent({
    roles: ROLES,
    selectedId: 'po',
    locked: false,
    conversation: undefined,
    sourcesUsed: 0,
    busy: false,
    ...changes,
  });
}

/** A conversation at turn 2 of 5. */
const MID = { turn: 2, maxTurns: 5, ended: false };

describe('countSourcesUsed', () => {
  it('counts each key once, however many answers cite it', () => {
    const answer = (/** @type {string[]} */ keys) => ({
      answer: { result: { sources: keys.map((key) => ({ key })) } },
    });

    expect(countSourcesUsed([answer(['C1', 'G1']), answer(['C1', 'G2']), answer(['C3'])])).toBe(4);
  });

  it('skips turns that have no answer, and counts nothing for no turns', () => {
    expect(countSourcesUsed([{ answer: undefined }])).toBe(0);
    expect(countSourcesUsed([])).toBe(0);
  });
});

describe('buildBrand', () => {
  it('shows the mark, the name and what the product reads from', () => {
    const brand = buildBrand();

    expect(brand.querySelector('.brand__name')?.textContent).toBe(PRODUCT_NAME);
    expect(PRODUCT_NAME).toBe('Knowledge Assistant');
    expect(brand.querySelector('.brand__sources')?.textContent).toBe('Confluence + GitHub');
    expect(brand.querySelector('.brand__mark svg')?.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('the roles before the first question', () => {
  it('are buttons in a group called Answering as, with the chosen one pressed', () => {
    const content = build();

    const group = /** @type {HTMLElement} */ (content.querySelector('[role="group"]'));
    const heading = /** @type {HTMLElement} */ (content.querySelector('#roles-heading'));
    expect(heading.textContent).toBe('Answering as');
    expect(group.getAttribute('aria-labelledby')).toBe('roles-heading');
    const buttons = [...group.querySelectorAll('button')];
    expect(buttons.map((button) => button.textContent)).toEqual([
      'Developer',
      'Business Analyst',
      'Product Owner',
    ]);
    expect(buttons.map((button) => button.getAttribute('aria-pressed'))).toEqual([
      'false',
      'false',
      'true',
    ]);
    expect(buttons.map((button) => button.getAttribute('data-role'))).toEqual(['dev', 'ba', 'po']);
  });

  it('give the chosen role a check and no other role one', () => {
    const buttons = [...build().querySelectorAll('.roles button')];

    expect(buttons.map((button) => button.querySelector('svg') !== null)).toEqual([
      false,
      false,
      true,
    ]);
    expect(buttons[2].classList.contains('role-option--selected')).toBe(true);
  });

  it('say the role can be changed until the first question', () => {
    expect(build().querySelector('.roles__note')?.textContent).toBe(ROLE_FREE_NOTE);
  });

  it('show no conversation box', () => {
    expect(build().querySelector('.conversation-box')).toBeNull();
  });

  it('are plain buttons with names, never links or inputs', () => {
    const buttons = [...build().querySelectorAll('.roles button')];

    expect(buttons.every((button) => button.getAttribute('type') === 'button')).toBe(true);
  });
});

describe('the role after the first question', () => {
  it('shows only the chosen role, with a lock and the words for a screen reader', () => {
    const content = build({ locked: true, conversation: MID });

    expect(content.querySelectorAll('.roles button')).toHaveLength(0);
    const option = /** @type {HTMLElement} */ (content.querySelector('.role-option'));
    expect(option.tagName).toBe('DIV');
    expect(option.textContent).toContain('Product Owner');
    expect(option.querySelector('.visually-hidden')?.textContent).toBe(
      ' (locked for this conversation)',
    );
    expect(option.querySelector('svg')?.getAttribute('class')).toContain('icon--lock');
    expect(option.classList.contains('role-option--locked')).toBe(true);
  });

  it('says the role is locked and changing it starts a new conversation', () => {
    const content = build({ locked: true, conversation: MID });

    expect(content.querySelector('.roles__note')?.textContent).toBe(ROLE_LOCKED_NOTE);
    expect(ROLE_LOCKED_NOTE).toBe(
      'Role is locked for this conversation. Changing it starts a new one.',
    );
  });
});

describe('the conversation box', () => {
  it('says which turn it is, with a bar that shows how many of the questions are used', () => {
    const content = build({ locked: true, conversation: MID });

    const box = /** @type {HTMLElement} */ (content.querySelector('.conversation-box'));
    expect(box.textContent).toContain('Turn 2 of 5');
    const meter = /** @type {HTMLProgressElement} */ (box.querySelector('progress'));
    expect(meter.max).toBe(5);
    expect(meter.value).toBe(2);
    expect(meter.getAttribute('aria-label')).toBe('Questions used');
  });

  it('never fills the bar past its end', () => {
    const content = build({ locked: true, conversation: { turn: 9, maxTurns: 5, ended: false } });

    expect(/** @type {HTMLProgressElement} */ (content.querySelector('progress')).value).toBe(5);
  });

  it('counts the sources used, once there are some', () => {
    const none = build({ locked: true, conversation: MID });
    const some = build({ locked: true, conversation: MID, sourcesUsed: 5 });

    expect(none.textContent).not.toContain('Sources used');
    expect(some.querySelector('.conversation-box')?.textContent).toContain('Sources used5');
  });

  it('offers New conversation and Copy this conversation while it can go on', () => {
    const content = build({ locked: true, conversation: MID });

    const buttons = [...content.querySelectorAll('.conversation-box button')];
    expect(buttons.map((button) => button.textContent)).toEqual([
      'New conversation',
      'Copy this conversation',
    ]);
    expect(buttons.map((button) => button.getAttribute('data-action'))).toEqual([
      'new-conversation',
      'copy-conversation',
    ]);
  });

  it('offers no buttons while a question runs', () => {
    const content = build({ locked: true, conversation: MID, busy: true });

    expect(content.querySelectorAll('.conversation-box button')).toHaveLength(0);
    expect(content.querySelector('.conversation-box')?.textContent).toContain('Turn 2 of 5');
  });

  it('says it has ended, and offers no buttons, because the end card has them', () => {
    const content = build({
      locked: true,
      conversation: { turn: 5, maxTurns: 5, ended: true },
      sourcesUsed: 6,
    });

    const box = /** @type {HTMLElement} */ (content.querySelector('.conversation-box'));
    expect(box.textContent).toContain('5 of 5 · ended');
    expect(box.querySelectorAll('button')).toHaveLength(0);
    expect(/** @type {HTMLProgressElement} */ (box.querySelector('progress')).value).toBe(5);
  });

  it('puts no inline style on anything', () => {
    const content = build({ locked: true, conversation: MID, sourcesUsed: 3 });

    expect(content.querySelectorAll('[style]')).toHaveLength(0);
  });

  it('shows a role name as text, never as markup', () => {
    const content = build({
      roles: [{ id: 'x', displayName: '<img src=x onerror=alert(1)>', description: '', depth: 1 }],
      selectedId: 'x',
    });

    expect(content.querySelector('img')).toBeNull();
    expect(content.querySelector('.role-option')?.textContent).toBe('<img src=x onerror=alert(1)>');
  });
});
