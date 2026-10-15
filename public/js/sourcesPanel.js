// @ts-check
import { el, externalLink } from './dom.js';
import { agoText } from './time.js';

/** How much of a commit id is shown. */
const SHORT_SHA = 7;

/** The words for each way a source can stand after a check. */
const CHANGED_TEXT = 'changed since this answer';
const UNAVAILABLE_TEXT = "couldn't check";

/**
 * A source the answer cited.
 * @typedef {import('./chatState.js').AnswerView['result']['sources'][number]} CitedSource
 */

/**
 * What is known about a cited source in the conversation.
 * @typedef {import('../../src/server/conversationView.js').SourceState} SourceState
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
 * Builds a small label next to a source.
 * @param {string} text - The label.
 * @returns {HTMLElement} The tag.
 */
function tag(text) {
  return el('span', { className: 'tag', text });
}

/**
 * Builds the tags that tell the reader how far to trust a source.
 * @param {CitedSource} source - A cited source from the result.
 * @param {SourceState | undefined} state - What is known about it in the conversation.
 * @returns {HTMLElement[]} The tags, possibly none.
 */
function tagsFor(source, state) {
  /** @type {HTMLElement[]} */
  const tags = [];
  if (source.type === 'confluence' && source.stale === true) {
    tags.push(tag('may be out of date'));
  }
  if (source.inferred === true) {
    tags.push(tag('my reading'));
  }
  if (source.type === 'github' && source.kind === 'file' && source.commitSha) {
    tags.push(tag(`commit ${String(source.commitSha).slice(0, SHORT_SHA)}`));
  }
  if (state?.fetchedInTurn !== undefined) {
    tags.push(tag(`fetched in turn ${state.fetchedInTurn}`));
  }
  return tags;
}

/**
 * Builds the badge that says what the latest check found, or nothing if there has been none.
 * A source that has changed says so, whatever the last check said, because a later fetch can find
 * it changed too.
 * @param {SourceState | undefined} state - What is known about the source.
 * @param {number} now - The time now, in ms.
 * @returns {HTMLElement | undefined} The badge, or undefined before any check.
 */
export function checkBadge(state, now) {
  if (state === undefined) {
    return undefined;
  }
  if (state.changed || state.check?.status === 'changed') {
    return el('span', { className: 'check check-changed', text: CHANGED_TEXT });
  }
  if (state.check === null) {
    return undefined;
  }
  if (state.check.status === 'unavailable') {
    return el('span', { className: 'check check-unavailable', text: UNAVAILABLE_TEXT });
  }
  return el('span', {
    className: 'check check-unchanged',
    text: `✓ checked ${agoText(now, state.check.checkedAt)}`,
    attributes: { 'data-checked-at': String(state.check.checkedAt) },
  });
}

/**
 * Builds one entry of the Sources list.
 * @param {string} answerId - The answer.
 * @param {CitedSource} source - A cited source from the result.
 * @param {SourceState | undefined} state - What is known about it in the conversation.
 * @param {number} now - The time now, in ms.
 * @returns {HTMLElement} The list item.
 */
function sourceItem(answerId, source, state, now) {
  const title = el('span', { attributes: { id: sourceTitleId(answerId, source.key) } }, [
    externalLink(source.friendlyLabel ?? source.title, source.url),
  ]);
  const badge = checkBadge(state, now);
  return el('li', { attributes: { id: sourceItemId(answerId, source.key), tabindex: '-1' } }, [
    el('span', { className: 'source-key', text: `[${source.key}]` }),
    title,
    ...tagsFor(source, state),
    ...(badge === undefined ? [] : [badge]),
  ]);
}

/**
 * Builds the "Also consulted" list.
 * @param {Array<{ title: string, url: string }>} items - What was looked at but not cited.
 * @returns {HTMLElement} The details element.
 */
function consulted(items) {
  return el('details', { className: 'consulted' }, [
    el('summary', { text: `Also consulted (${items.length})` }),
    el(
      'ul',
      {},
      items.map((item) => el('li', {}, [externalLink(item.title, item.url)])),
    ),
  ]);
}

/**
 * Builds the Sources panel of one answer: collapsed by default, with each cited source, the turn
 * it was fetched in, and what the latest check found, and the sources that were looked at but not
 * cited.
 * @param {import('./chatState.js').AnswerView} answer - The answer.
 * @param {number} now - The time now, in ms.
 * @param {boolean} open - Whether the panel is open.
 * @returns {HTMLElement | undefined} The panel, or undefined when the answer has no sources to show.
 */
export function buildSourcesPanel(answer, now, open) {
  const { sources, alsoConsulted } = answer.result;
  if (sources.length === 0 && alsoConsulted.length === 0) {
    return undefined;
  }
  const states = new Map(answer.sourceStates.map((state) => [state.key, state]));
  const panel = el(
    'details',
    { className: 'sources', attributes: { 'data-answer-id': answer.answerId } },
    [
      el('summary', { text: `Sources (${sources.length})` }),
      el(
        'ol',
        {},
        sources.map((source) => sourceItem(answer.answerId, source, states.get(source.key), now)),
      ),
      ...(alsoConsulted.length === 0 ? [] : [consulted(alsoConsulted)]),
    ],
  );
  /** @type {HTMLDetailsElement} */ (panel).open = open;
  return panel;
}

/**
 * Makes each citation chip in some HTML point to the title of its source, so a screen reader
 * says which source a chip is.
 * @param {HTMLElement} root - The element holding the answer or a conflict.
 * @param {string} answerId - The answer.
 * @param {ReadonlySet<string>} keys - The keys of the sources in the panel.
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
 * Opens the Sources panel of an answer, scrolls to a source, highlights it and moves focus to it,
 * as clicking its chip does.
 * @param {HTMLElement} card - The answer's card.
 * @param {string} answerId - The answer.
 * @param {string} key - The key of the source.
 * @returns {boolean} Whether the source was in the card.
 */
export function focusSource(card, answerId, key) {
  const panel = card.querySelector('details.sources');
  // Compared as text rather than put in a selector, so no key can change what is selected.
  const target = [...card.querySelectorAll('li')].find(
    ({ id }) => id === sourceItemId(answerId, key),
  );
  for (const item of card.querySelectorAll('.highlight')) {
    item.classList.remove('highlight');
  }
  if (!(panel instanceof HTMLDetailsElement) || !(target instanceof HTMLElement)) {
    return false;
  }
  panel.open = true;
  target.classList.add('highlight');
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
