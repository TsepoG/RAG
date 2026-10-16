// @ts-check
import { el, safeHref } from '../dom.js';
import { agoText } from '../time.js';
import { actionButton } from './actions.js';

/** How much of a commit id is shown. */
const SHORT_SHA = 7;

/** The words for the two ways a source can fail a check, and for a source that is not up to date. */
const CHANGED_TEXT = 'Changed since this answer';
const UNAVAILABLE_TEXT = "Couldn't check";

/** Shown when a source's own words are not enough to say where it is from. */
const UNKNOWN_KIND = 'Source';

/** The arrow on the toggle: pointing down while the list is closed, up while it is open. */
const ARROW_CLOSED = ' ▾';
const ARROW_OPEN = ' ▴';

/** The separator between the parts of the line under a source's title. */
const META_SEPARATOR = ' · ';

/**
 * A source the answer cited.
 * @typedef {import('../chatState.js').AnswerView['result']['sources'][number]} CitedSource
 */

/**
 * What is known about a cited source in the conversation.
 * @typedef {import('../../../src/server/conversationView.js').SourceState} SourceState
 */

/**
 * A page or file that was looked at and not cited.
 * @typedef {import('../chatState.js').AnswerView['result']['alsoConsulted'][number]} ConsultedSource
 */

/**
 * The id of the list item for a source of one answer. Answers share keys, so the answer is in it.
 * @param {string} answerId - The answer.
 * @param {string} key - The citation key.
 * @returns {string} The id.
 */
export function sourceItemId(answerId, key) {
  return `source-${answerId}-${key}`;
}

/**
 * The id of the title of a source of one answer, which its chips point to.
 * @param {string} answerId - The answer.
 * @param {string} key - The citation key.
 * @returns {string} The id.
 */
export function sourceTitleId(answerId, key) {
  return `source-title-${answerId}-${key}`;
}

/**
 * The id of the list of sources of one answer, which its toggle controls.
 * @param {string} answerId - The answer.
 * @returns {string} The id.
 */
function listId(answerId) {
  return `sources-list-${answerId}`;
}

/**
 * Whether a source has changed, by a later fetch or by the latest check.
 * @param {SourceState | undefined} state - What is known about it.
 * @returns {boolean} True when it has changed.
 */
function isChanged(state) {
  return state !== undefined && (state.changed || state.check?.status === 'changed');
}

/**
 * Builds what the latest check found about a source, or nothing if there has been none. A source
 * that has changed says so whatever the last check said, because a later fetch can find it
 * changed too.
 * @param {SourceState | undefined} state - What is known about the source.
 * @param {number} now - The time now, in ms.
 * @returns {HTMLElement | undefined} The status, or undefined before any check.
 */
export function checkBadge(state, now) {
  if (state === undefined) {
    return undefined;
  }
  if (isChanged(state)) {
    return el('span', {
      className: 'source-status source-status--changed',
      text: CHANGED_TEXT,
    });
  }
  if (state.check === null) {
    return undefined;
  }
  if (state.check.status === 'unavailable') {
    return el('span', {
      className: 'source-status source-status--unavailable',
      text: UNAVAILABLE_TEXT,
    });
  }
  return el('span', {
    className: 'source-status source-status--checked',
    text: `✓ checked ${agoText(now, state.check.checkedAt)}`,
    attributes: { 'data-checked-at': String(state.check.checkedAt) },
  });
}

/**
 * Says which kind of source a page or file that was only looked at is, from its key or its address.
 * @param {ConsultedSource} item - The item.
 * @returns {string} "Confluence", "GitHub" or a general word.
 */
function kindOfConsulted({ key, url }) {
  if (key?.startsWith('C') === true) {
    return 'Confluence';
  }
  if (key?.startsWith('G') === true) {
    return 'GitHub';
  }
  const host = safeHref(url) === undefined ? '' : new URL(url).hostname;
  if (host === 'github.com') {
    return 'GitHub';
  }
  return host.endsWith('.atlassian.net') ? 'Confluence' : UNKNOWN_KIND;
}

/**
 * Builds the line under a cited source's title: where it is from, the turn it was fetched in, and
 * anything the reader should weigh.
 * @param {CitedSource} source - The source.
 * @param {SourceState | undefined} state - What is known about it.
 * @returns {string} The line.
 */
function metaOf(source, state) {
  const parts = [
    source.type === 'confluence' ? 'Confluence' : 'GitHub',
    ...(state?.fetchedInTurn === undefined ? [] : [`fetched in turn ${state.fetchedInTurn}`]),
    ...(source.type === 'confluence' && source.stale === true ? ['may be out of date'] : []),
    ...(source.inferred === true ? ['my reading'] : []),
    ...(source.type === 'github' && source.kind === 'file' && source.commitSha
      ? [`commit ${String(source.commitSha).slice(0, SHORT_SHA)}`]
      : []),
  ];
  return parts.join(META_SEPARATOR);
}

/**
 * The shape of one row of the list, whether the source was cited or only looked at.
 * @typedef {object} RowInput
 * @property {string} answerId - The answer.
 * @property {string | undefined} key - The citation key, when it has one.
 * @property {'confluence' | 'github'} kind - Which chip colour it gets.
 * @property {string} title - What to call it.
 * @property {boolean} mono - Whether the title is a file path, shown in the code font.
 * @property {string} meta - The line under the title.
 * @property {string | undefined} url - Where it is.
 * @property {HTMLElement | undefined} status - What the latest check found.
 * @property {boolean} changed - Whether the row is drawn as changed.
 */

/**
 * Builds one row of the list: the key, the title, where it is from and what the check found. The
 * whole row is the link to the source.
 * @param {RowInput} input - What the row says.
 * @returns {HTMLElement} The list item.
 */
function sourceRow({ answerId, key, kind, title, mono, meta, url, status, changed }) {
  /** @type {Record<string, string>} */
  const titleAttributes = key === undefined ? {} : { id: sourceTitleId(answerId, key) };
  const text = el('span', { className: 'source-row__text' }, [
    el('span', {
      className: mono ? 'source-row__title source-row__title--mono' : 'source-row__title',
      text: title,
      attributes: titleAttributes,
    }),
    el('span', { className: 'source-row__meta', text: meta }),
  ]);
  const children = [
    ...(key === undefined ? [] : [el('span', { className: `chip chip--${kind}`, text: key })]),
    text,
    ...(status === undefined ? [] : [status]),
  ];
  const href = safeHref(url);
  const link =
    href === undefined
      ? el('div', { className: 'source-row__link' }, children)
      : el(
          'a',
          {
            className: 'source-row__link',
            attributes: { href, target: '_blank', rel: 'noopener noreferrer' },
          },
          children,
        );
  return el(
    'li',
    {
      className: changed ? 'source-row source-row--changed' : 'source-row',
      attributes: {
        ...(key === undefined ? {} : { id: sourceItemId(answerId, key) }),
        tabindex: '-1',
      },
    },
    [link],
  );
}

/**
 * Builds the row of a cited source.
 * @param {string} answerId - The answer.
 * @param {CitedSource} source - The source.
 * @param {SourceState | undefined} state - What is known about it.
 * @param {number} now - The time now, in ms.
 * @returns {HTMLElement} The list item.
 */
function citedRow(answerId, source, state, now) {
  const path = source.type === 'github' ? source.path : undefined;
  return sourceRow({
    answerId,
    key: source.key,
    kind: source.type,
    title: path ?? source.title,
    mono: path !== undefined,
    meta: metaOf(source, state),
    url: source.url,
    status: checkBadge(state, now),
    changed: isChanged(state),
  });
}

/**
 * Builds the row of a page or file that was only looked at: no check, and it says so.
 * @param {string} answerId - The answer.
 * @param {ConsultedSource} item - The item.
 * @returns {HTMLElement} The list item.
 */
function consultedRow(answerId, item) {
  return sourceRow({
    answerId,
    key: item.key,
    kind: item.key?.startsWith('G') === true ? 'github' : 'confluence',
    title: item.title,
    mono: false,
    meta: `${kindOfConsulted(item)}${META_SEPARATOR}also consulted`,
    url: item.url,
    status: undefined,
    changed: false,
  });
}

/**
 * Sums up the checks of an answer's sources in a few words, for the closed list: how many changed,
 * or when the sources were last checked, or that they could not be.
 * @param {ReadonlyArray<SourceState | undefined>} states - What is known about each cited source.
 * @param {number} now - The time now, in ms.
 * @returns {HTMLElement | undefined} The summary, or undefined before any check.
 */
function summaryOf(states, now) {
  const known = states.filter((state) => state !== undefined);
  const changed = known.filter(isChanged).length;
  if (changed > 0) {
    return el('span', {
      className: 'sources__summary sources__summary--changed',
      text: `${changed} changed`,
    });
  }
  const checks = known.flatMap(({ check }) => (check === null ? [] : [check]));
  const checked = checks.filter(({ status }) => status !== 'unavailable');
  if (checked.length > 0) {
    const oldest = Math.min(...checked.map(({ checkedAt }) => checkedAt));
    return el('span', {
      className: 'sources__summary sources__summary--checked',
      text: `✓ checked ${agoText(now, oldest)}`,
      attributes: { 'data-checked-at': String(oldest) },
    });
  }
  return checks.length === 0
    ? undefined
    : el('span', {
        className: 'sources__summary sources__summary--unavailable',
        text: "Couldn't check",
      });
}

/**
 * Opens or closes the list of sources of one answer, without drawing it again. The toggle says
 * which, the list shows or hides, the Re-check button shows with the list, and the short summary
 * shows while it is closed.
 * @param {HTMLElement} section - The element from {@link buildSourcesSection}.
 * @param {boolean} open - Whether the list should show.
 */
export function setSourcesOpen(section, open) {
  // The section is built by this file, so these parts are always there.
  const toggle = /** @type {HTMLElement} */ (section.querySelector('.sources__toggle'));
  const list = /** @type {HTMLElement} */ (section.querySelector('.sources__list'));
  const arrow = /** @type {HTMLElement} */ (toggle.querySelector('.sources__arrow'));
  toggle.setAttribute('aria-expanded', String(open));
  arrow.textContent = open ? ARROW_OPEN : ARROW_CLOSED;
  list.hidden = !open;
  for (const element of section.querySelectorAll('.sources__summary')) {
    /** @type {HTMLElement} */ (element).hidden = open;
  }
  for (const element of section.querySelectorAll('.sources__recheck')) {
    /** @type {HTMLElement} */ (element).hidden = !open;
  }
}

/**
 * Builds the Sources part of an answer: a toggle with the number of sources, a short summary of
 * their checks while it is closed, and, once opened, a Re-check button and a list of each cited
 * source with the turn it was fetched in and what the latest check found, then the pages and files
 * that were looked at and not cited.
 * @param {import('../chatState.js').AnswerView} answer - The answer.
 * @param {{ now: number, open: boolean, checking: boolean }} options - The time, whether it is open, and whether a check is running.
 * @returns {HTMLElement | undefined} The section, or undefined when the answer cites nothing.
 */
export function buildSourcesSection(answer, { now, open, checking }) {
  const { answerId, result } = answer;
  const { sources, alsoConsulted } = result;
  if (sources.length === 0) {
    return undefined;
  }
  const states = new Map(answer.sourceStates.map((state) => [state.key, state]));
  const toggle = el(
    'button',
    {
      className: 'button button--small sources__toggle',
      attributes: {
        type: 'button',
        'data-action': 'sources',
        'data-answer-id': answerId,
        'data-focus-id': `${answerId}:sources`,
        'aria-expanded': 'false',
        'aria-controls': listId(answerId),
      },
    },
    [
      el('span', { text: `Sources (${sources.length})` }),
      el('span', { className: 'sources__arrow', attributes: { 'aria-hidden': 'true' } }),
    ],
  );
  const summary = summaryOf(
    sources.map(({ key }) => states.get(key)),
    now,
  );
  const recheck = actionButton({
    action: 'recheck',
    answerId,
    text: checking ? 'Checking…' : 'Re-check sources',
    className: 'button button--small sources__recheck',
    mode: checking ? 'busy' : 'enabled',
  });
  const rows = [
    ...sources.map((source) => citedRow(answerId, source, states.get(source.key), now)),
    ...alsoConsulted.map((item) => consultedRow(answerId, item)),
  ];
  const section = el(
    'section',
    { className: 'sources', attributes: { 'data-answer-id': answerId } },
    [
      el('div', { className: 'sources__header' }, [
        toggle,
        ...(summary === undefined ? [] : [summary]),
        recheck,
      ]),
      el('ul', { className: 'sources__list', attributes: { id: listId(answerId) } }, rows),
    ],
  );
  setSourcesOpen(section, open);
  return section;
}

/**
 * Makes each citation chip in some HTML point to the title of its source, so a screen reader
 * says which source a chip is.
 * @param {HTMLElement} root - The element holding the answer or a conflict.
 * @param {string} answerId - The answer.
 * @param {ReadonlySet<string>} keys - The keys of the sources in the list.
 */
export function describeChips(root, answerId, keys) {
  for (const chip of root.querySelectorAll('button.cite')) {
    const key = /** @type {string} */ (chip.getAttribute('data-key'));
    if (keys.has(key)) {
      chip.setAttribute('aria-describedby', sourceTitleId(answerId, key));
    }
  }
}

/**
 * Opens the sources of an answer, scrolls to one, highlights it and moves focus to it, as clicking
 * its chip does.
 * @param {HTMLElement} card - The answer's card.
 * @param {string} answerId - The answer.
 * @param {string} key - The key of the source.
 * @returns {boolean} Whether the source was in the card.
 */
export function focusSource(card, answerId, key) {
  // Compared as text rather than put in a selector, so no key can change what is selected.
  const target = [...card.querySelectorAll('li')].find(
    ({ id }) => id === sourceItemId(answerId, key),
  );
  for (const row of card.querySelectorAll('.source-row--highlight')) {
    row.classList.remove('source-row--highlight');
  }
  const section = target?.closest('.sources');
  if (!(section instanceof HTMLElement) || !(target instanceof HTMLElement)) {
    return false;
  }
  setSourcesOpen(section, true);
  target.classList.add('source-row--highlight');
  target.scrollIntoView({ block: 'nearest' });
  target.focus();
  return true;
}

/**
 * Brings the "checked N min ago" text up to date without drawing the answers again.
 * @param {ParentNode} root - Where to look.
 * @param {number} now - The time now, in ms.
 */
export function refreshAges(root, now) {
  for (const badge of root.querySelectorAll('[data-checked-at]')) {
    const checkedAt = Number(badge.getAttribute('data-checked-at'));
    badge.textContent = `✓ checked ${agoText(now, checkedAt)}`;
  }
}
