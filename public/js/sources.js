// @ts-check
import { clear, el, externalLink, setVisible } from './dom.js';

/**
 * A source the answer cited.
 * @typedef {import('./state.js').DonePayload['result']['sources'][number]} CitedSource
 */

/** The id of the list item for a source, which the chips point to. */
const SOURCE_ID_PREFIX = 'source-';
const TITLE_ID_PREFIX = 'source-title-';
const HIGHLIGHT = 'highlight';
/** How much of a commit id is shown. */
const SHORT_SHA = 7;

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
 * @returns {HTMLElement[]} The tags, possibly none.
 */
function tagsFor(source) {
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
  return tags;
}

/**
 * Builds one entry of the Sources list.
 * @param {CitedSource} source - A cited source from the result.
 * @returns {HTMLElement} The list item.
 */
function sourceItem(source) {
  const title = el('span', { attributes: { id: `${TITLE_ID_PREFIX}${source.key}` } }, [
    externalLink(source.friendlyLabel ?? source.title, source.url),
  ]);
  return el('li', { attributes: { id: `${SOURCE_ID_PREFIX}${source.key}`, tabindex: '-1' } }, [
    el('span', { className: 'source-key', text: `[${source.key}]` }),
    title,
    ...tagsFor(source),
  ]);
}

/**
 * Fills the "Also consulted" list.
 * @param {{ consulted: HTMLElement, consultedSummary: HTMLElement, consultedList: HTMLElement }} refs - Its elements.
 * @param {Array<{ key?: string, title: string, url: string }>} items - What was looked at but not cited.
 */
function renderConsulted(refs, items) {
  clear(refs.consultedList);
  setVisible(refs.consulted, items.length > 0);
  refs.consultedSummary.textContent = `Also consulted (${items.length})`;
  for (const item of items) {
    refs.consultedList.append(el('li', {}, [externalLink(item.title, item.url)]));
  }
}

/**
 * Draws the Sources panel: each cited source with its key, link and trust tags, and the sources
 * that were looked at but not cited.
 * @param {{ sources: HTMLElement, sourcesList: HTMLElement, consulted: HTMLElement, consultedSummary: HTMLElement, consultedList: HTMLElement }} refs - The panel's elements.
 * @param {{ sources: CitedSource[], alsoConsulted: Array<{ key?: string, title: string, url: string }> }} result - The result.
 */
export function renderSources(refs, { sources, alsoConsulted }) {
  clear(refs.sourcesList);
  for (const source of sources) {
    refs.sourcesList.append(sourceItem(source));
  }
  renderConsulted(refs, alsoConsulted);
  setVisible(refs.sources, sources.length > 0 || alsoConsulted.length > 0);
}

/**
 * Makes each citation chip in some HTML point to the title of its source, so a screen reader
 * says which source a chip is.
 * @param {HTMLElement} root - The element holding the answer or a conflict.
 * @param {ReadonlySet<string>} keys - The keys of the sources in the panel.
 */
export function describeChips(root, keys) {
  for (const chip of root.querySelectorAll('button.cite')) {
    const key = chip.getAttribute('data-key') ?? '';
    if (keys.has(key)) {
      chip.setAttribute('aria-describedby', `${TITLE_ID_PREFIX}${key}`);
    }
  }
}

/**
 * Scrolls to a source, highlights it and moves focus to it, as clicking its chip does.
 * @param {HTMLElement} list - The Sources list.
 * @param {string} key - The key of the source.
 * @returns {boolean} Whether the source was in the list.
 */
export function focusSource(list, key) {
  // Compared as text rather than put in a selector, so no key can change what is selected.
  const target = [...list.children].find(({ id }) => id === `${SOURCE_ID_PREFIX}${key}`);
  for (const item of list.querySelectorAll(`.${HIGHLIGHT}`)) {
    item.classList.remove(HIGHLIGHT);
  }
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  target.classList.add(HIGHLIGHT);
  target.scrollIntoView({ block: 'nearest' });
  target.focus();
  return true;
}
