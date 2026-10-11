// @ts-check
import { clear, el, externalLink, setVisible } from './dom.js';
import { describeChips, renderSources } from './sources.js';

/**
 * What the server sends when a question is answered.
 * @typedef {import('./state.js').DonePayload} DonePayload
 */

/** The words in the badge for each confidence level, so the level never depends on colour alone. */
const LEVEL_LABELS = Object.freeze({
  high: 'High confidence',
  medium: 'Medium confidence',
  low: 'Low confidence',
});

/**
 * Shows the line that says how sure the answer is.
 * @param {import('./refs.js').PageRefs} refs - The page's elements.
 * @param {DonePayload} payload - The answer.
 */
function renderBanner(refs, { rendered, result }) {
  const hasBanner = rendered.banner !== '';
  setVisible(refs.banner, hasBanner);
  refs.bannerText.textContent = rendered.banner;
  refs.bannerBadge.textContent = rendered.level === null ? '' : LEVEL_LABELS[rendered.level];
  refs.bannerBadge.className = rendered.level === null ? 'badge' : `badge level-${rendered.level}`;
  const reason = result.status === 'answered' ? result.confidenceReason : '';
  refs.bannerReason.textContent = reason === '' ? '' : `Why: ${reason}`;
  setVisible(refs.bannerReason, reason !== '');
}

/**
 * Fills a list from text, and shows its section only when there is something in it.
 * @param {HTMLElement} section - The section.
 * @param {HTMLElement} list - The list inside it.
 * @param {HTMLElement[]} items - The list items.
 */
function fillList(section, list, items) {
  clear(list);
  list.append(...items);
  setVisible(section, items.length > 0);
}

/**
 * Shows the notes under the answer: conflicts, gaps, closest pages and who might know.
 * @param {import('./refs.js').PageRefs} refs - The page's elements.
 * @param {DonePayload} payload - The answer.
 */
function renderNotes(refs, { rendered, html }) {
  fillList(
    refs.conflicts,
    refs.conflictsList,
    html.conflicts.map((conflict) => {
      const item = el('li');
      // The server has already turned this into safe HTML; see renderAnswerHtml.
      item.innerHTML = conflict;
      return item;
    }),
  );
  fillList(
    refs.gaps,
    refs.gapsList,
    rendered.gaps.map((gap) => el('li', { text: gap })),
  );
  fillList(
    refs.closest,
    refs.closestList,
    rendered.closestPages.map((page) => el('li', {}, [externalLink(page.title, page.url)])),
  );
  fillList(
    refs.who,
    refs.whoList,
    rendered.whoToAsk.map(({ name, sourceKeys }) =>
      el('li', { text: sourceKeys.length === 0 ? name : `${name} (${sourceKeys.join(', ')})` }),
    ),
  );
}

/**
 * Shows the final answer: the banner, the answer text with its citation chips, the notes and the
 * Sources panel. The answer is the one place HTML from the server is put in the page; the server
 * sanitises it, and the page's content security policy does not allow inline scripts either.
 * @param {import('./refs.js').PageRefs} refs - The page's elements.
 * @param {DonePayload} payload - The answer.
 */
export function renderAnswer(refs, payload) {
  renderBanner(refs, payload);
  setVisible(refs.draftNote, false);
  refs.answer.className = payload.result.status === 'clarify' ? 'answer clarify' : 'answer';
  refs.answer.innerHTML = payload.html.answer;
  renderNotes(refs, payload);
  renderSources(refs, payload.result);
  const keys = new Set(payload.result.sources.map(({ key }) => key));
  describeChips(refs.answer, keys);
  describeChips(refs.conflictsList, keys);
}
