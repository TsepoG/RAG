// @ts-check
import { el } from '../dom.js';
import { icon } from './icons.js';

/** The name of the product, under its mark. */
export const PRODUCT_NAME = 'Knowledge Assistant';

/** What the product reads from. */
export const PRODUCT_SOURCES = 'Confluence + GitHub';

/** Said under the roles once a conversation has started. */
export const ROLE_LOCKED_NOTE =
  'Role is locked for this conversation. Changing it starts a new one.';

/** Said under the roles before the first question. */
export const ROLE_FREE_NOTE =
  'Answers are written for this role. You can change it until you ask your first question.';

/**
 * A role as the page lists it.
 * @typedef {object} RoleSummary
 * @property {string} id - The role id.
 * @property {string} displayName - What the role is called.
 * @property {string} description - One line about the role.
 * @property {number} depth - How technical its answers are, from 1 to 3.
 * @property {string[]} [suggestedQuestions] - Questions to offer under "Try asking".
 */

/**
 * What the sidebar is drawn from.
 * @typedef {object} SidebarInput
 * @property {ReadonlyArray<RoleSummary>} roles - The roles to choose from.
 * @property {string | undefined} selectedId - The role chosen, or the role of the conversation.
 * @property {boolean} locked - Whether a question has been asked, so the role can no longer change.
 * @property {{ turn: number, maxTurns: number, ended: boolean } | undefined} conversation - How far the conversation is, once there is one.
 * @property {number} sourcesUsed - How many different sources the answers cite.
 * @property {boolean} busy - Whether a question is being answered.
 */

/**
 * Counts the different sources the answers of a conversation cite. A key means the same source for
 * the whole conversation, so each key is counted once.
 * @param {ReadonlyArray<{ answer: { result: { sources: ReadonlyArray<{ key: string }> } } | undefined }>} turns - The turns.
 * @returns {number} How many sources.
 */
export function countSourcesUsed(turns) {
  const keys = new Set(
    turns.flatMap(({ answer }) => answer?.result.sources.map(({ key }) => key) ?? []),
  );
  return keys.size;
}

/**
 * Builds the mark and the name of the product.
 * @returns {HTMLElement} The brand.
 */
export function buildBrand() {
  return el('div', { className: 'brand' }, [
    el('span', { className: 'brand__mark' }, [icon('brand', { size: 18 })]),
    el('span', { className: 'brand__text' }, [
      el('span', { className: 'brand__name', text: PRODUCT_NAME }),
      el('span', { className: 'brand__sources', text: PRODUCT_SOURCES }),
    ]),
  ]);
}

/**
 * Builds the list of roles. Before the first question each is a button that can be chosen; after
 * it only the chosen role is shown, with a lock and a note that it cannot change.
 * @param {SidebarInput} input - What the sidebar is drawn from.
 * @returns {HTMLElement} The group of roles.
 */
function buildRoles({ roles, selectedId, locked }) {
  const heading = el('span', {
    className: 'sidebar__heading',
    text: 'Answering as',
    attributes: { id: 'roles-heading' },
  });
  const options = locked
    ? roles
        .filter(({ id }) => id === selectedId)
        .map(({ displayName }) =>
          el('div', { className: 'role-option role-option--selected role-option--locked' }, [
            el('span', { text: displayName }),
            el('span', { className: 'visually-hidden', text: ' (locked for this conversation)' }),
            icon('lock', { size: 16 }),
          ]),
        )
    : roles.map(({ id, displayName }) => {
        const selected = id === selectedId;
        const button = el(
          'button',
          {
            className: selected ? 'role-option role-option--selected' : 'role-option',
            attributes: { type: 'button', 'data-role': id, 'aria-pressed': String(selected) },
          },
          [el('span', { text: displayName })],
        );
        if (selected) {
          button.append(icon('check', { size: 16, strokeWidth: 2.2 }));
        }
        return button;
      });
  return el('div', { className: 'roles' }, [
    heading,
    el(
      'div',
      {
        className: 'roles__list',
        attributes: { role: 'group', 'aria-labelledby': 'roles-heading' },
      },
      options,
    ),
    el('p', { className: 'roles__note', text: locked ? ROLE_LOCKED_NOTE : ROLE_FREE_NOTE }),
  ]);
}

/**
 * Builds the box that says how far the conversation is, with its buttons while it can go on.
 * @param {SidebarInput} input - What the sidebar is drawn from.
 * @returns {HTMLElement[]} The box, or nothing before there is a conversation.
 */
function buildConversationBox({ conversation, sourcesUsed, busy }) {
  if (conversation === undefined) {
    return [];
  }
  const { turn, maxTurns, ended } = conversation;
  const row = (/** @type {string} */ label, /** @type {string} */ value) =>
    el('div', { className: 'conversation-box__row' }, [
      el('span', { className: 'conversation-box__label', text: label }),
      el('strong', { className: 'conversation-box__value', text: value }),
    ]);
  const meter = el('progress', {
    className: 'meter',
    attributes: {
      max: String(maxTurns),
      value: String(Math.min(turn, maxTurns)),
      'aria-label': 'Questions used',
    },
  });
  const buttons =
    ended || busy
      ? []
      : [
          el('button', {
            className: 'button',
            text: 'New conversation',
            attributes: { type: 'button', 'data-action': 'new-conversation' },
          }),
          el('button', {
            className: 'button',
            text: 'Copy this conversation',
            attributes: { type: 'button', 'data-action': 'copy-conversation' },
          }),
        ];
  return [
    el('div', { className: 'conversation-box' }, [
      row('Conversation', ended ? `${turn} of ${maxTurns} · ended` : `Turn ${turn} of ${maxTurns}`),
      meter,
      ...(sourcesUsed > 0 ? [row('Sources used', String(sourcesUsed))] : []),
      ...buttons,
    ]),
  ];
}

/**
 * Builds what goes in the sidebar below the brand: the roles, and the box about the conversation.
 * The same content is what the drawer holds on a narrow screen.
 * @param {SidebarInput} input - What the sidebar is drawn from.
 * @returns {HTMLElement} The content.
 */
export function buildSidebarContent(input) {
  return el('div', { className: 'sidebar__content' }, [
    buildBrand(),
    buildRoles(input),
    ...buildConversationBox(input),
  ]);
}
