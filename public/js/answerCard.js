// @ts-check
import { el, externalLink } from './dom.js';
import { buildSourcesPanel, describeChips } from './sourcesPanel.js';

/** The words in the badge for each confidence level, so the level never depends on colour alone. */
const LEVEL_LABELS = Object.freeze({
  high: 'High confidence',
  medium: 'Medium confidence',
  low: 'Low confidence',
});

/** Said under the banner when a source the answer cites has changed. */
const CHANGED_NOTE = 'A source this answer cites has changed since it was written.';

/**
 * What a card is drawn from.
 * @typedef {object} CardInput
 * @property {import('./chatState.js').AnswerView} answer - The answer.
 * @property {number} now - The time now, in ms.
 * @property {boolean} sourcesOpen - Whether the Sources panel is open.
 * @property {boolean} checking - Whether the sources are being checked now.
 * @property {boolean} canReask - Whether "Re-ask with the latest version" is offered.
 * @property {boolean} canMoreDetail - Whether "Show more detail" is offered.
 * @property {import('./chatState.js').Rating | undefined} rating - What the reader said about it.
 */

/**
 * Builds a button that the page's one click handler acts on.
 * @param {string} action - What it does: `recheck`, `reask`, `more`, `up` or `down`.
 * @param {string} answerId - The answer it is for.
 * @param {string} text - What it says.
 * @param {'enabled' | 'disabled' | 'busy'} [mode] - Whether it can be pressed. A busy button stays
 *   focusable, so focus is not lost when it is pressed, but does nothing and says it is busy.
 * @returns {HTMLElement} The button.
 */
function actionButton(action, answerId, text, mode = 'enabled') {
  const button = el('button', {
    text,
    attributes: {
      type: 'button',
      'data-action': action,
      'data-answer-id': answerId,
      'data-focus-id': `${answerId}:${action}`,
    },
  });
  /** @type {HTMLButtonElement} */ (button).disabled = mode === 'disabled';
  if (mode === 'busy') {
    button.setAttribute('aria-disabled', 'true');
  }
  return button;
}

/**
 * Builds the line that says how sure the answer is.
 * @param {import('./chatState.js').AnswerView} answer - The answer.
 * @returns {HTMLElement | undefined} The banner, or undefined when there is none.
 */
function buildBanner({ rendered, result, changedKeys }) {
  if (rendered.banner === '') {
    return undefined;
  }
  const reason = result.status === 'answered' ? result.confidenceReason : '';
  return el('div', { className: 'banner', attributes: { tabindex: '-1' } }, [
    el('p', { className: 'banner-line' }, [
      el('span', {
        className: rendered.level === null ? 'badge' : `badge level-${rendered.level}`,
        text: rendered.level === null ? '' : LEVEL_LABELS[rendered.level],
      }),
      el('span', { text: rendered.banner }),
    ]),
    ...(reason === '' ? [] : [el('p', { className: 'hint', text: `Why: ${reason}` })]),
    ...(changedKeys.length === 0
      ? []
      : [el('p', { className: 'changed-note', text: CHANGED_NOTE })]),
  ]);
}

/**
 * Builds a titled list, or nothing when the list is empty.
 * @param {string} title - The heading.
 * @param {HTMLElement[]} items - The list items.
 * @param {string} [className] - A class for the section.
 * @returns {HTMLElement[]} The section, or none.
 */
function section(title, items, className = '') {
  return items.length === 0
    ? []
    : [el('section', { className }, [el('h4', { text: title }), el('ul', {}, items)])];
}

/**
 * Builds the notes under the answer: conflicts, gaps, closest pages and who might know.
 * @param {import('./chatState.js').AnswerView} answer - The answer.
 * @returns {HTMLElement[]} The sections that have something in them.
 */
function buildNotes({ rendered, html }) {
  const conflicts = html.conflicts.map((conflict) => {
    const item = el('li');
    // The server has already turned this into safe HTML; see renderAnswerHtml.
    item.innerHTML = conflict;
    return item;
  });
  return [
    ...section('The documentation and the code disagree', conflicts, 'conflicts'),
    ...section(
      "What I couldn't confirm",
      rendered.gaps.map((gap) => el('li', { text: gap })),
    ),
    ...section(
      'Closest pages I checked',
      rendered.closestPages.map((page) => el('li', {}, [externalLink(page.title, page.url)])),
    ),
    ...section(
      'Who might know',
      rendered.whoToAsk.map(({ name, sourceKeys }) =>
        el('li', { text: sourceKeys.length === 0 ? name : `${name} (${sourceKeys.join(', ')})` }),
      ),
    ),
  ];
}

/**
 * Builds the thumbs, and the form after a thumbs down.
 * @param {import('./chatState.js').AnswerView} answer - The answer.
 * @param {import('./chatState.js').Rating | undefined} rating - What the reader said.
 * @returns {HTMLElement} The feedback controls.
 */
function buildFeedback({ answerId, result }, rating) {
  const locked = rating?.saved === true;
  const mode = locked ? 'disabled' : 'enabled';
  const up = actionButton('up', answerId, 'Yes', mode);
  const down = actionButton('down', answerId, 'No', mode);
  up.setAttribute('aria-pressed', String(rating?.rating === 'up'));
  down.setAttribute('aria-pressed', String(rating?.rating === 'down'));
  up.append(el('span', { className: 'visually-hidden', text: ', this was helpful' }));
  down.append(el('span', { className: 'visually-hidden', text: ', this was not helpful' }));
  const commentId = `feedback-comment-${answerId}`;
  const sourceId = `feedback-source-${answerId}`;
  const form =
    rating?.rating === 'down' && !locked
      ? [
          el('form', { className: 'feedback-form', attributes: { 'data-answer-id': answerId } }, [
            el('label', { text: 'What was wrong? (optional)', attributes: { for: commentId } }),
            el('textarea', {
              attributes: { id: commentId, name: 'comment', rows: '2', maxlength: '1000' },
            }),
            el('label', {
              text: 'A source that was wrong (optional)',
              attributes: { for: sourceId },
            }),
            el('select', { attributes: { id: sourceId, name: 'source' } }, [
              el('option', { text: 'None', attributes: { value: '' } }),
              ...result.sources.map(({ key, title }) =>
                el('option', { text: `[${key}] ${title}`, attributes: { value: key } }),
              ),
            ]),
            el('button', { text: 'Send feedback', attributes: { type: 'submit' } }),
          ]),
        ]
      : [];
  return el('div', { className: 'feedback-area' }, [
    el('fieldset', { className: 'feedback' }, [
      el('legend', { text: 'Was this helpful?' }),
      up,
      down,
    ]),
    ...form,
    el('output', { className: 'hint', text: rating?.message ?? '' }),
  ]);
}

/**
 * Builds the answer of one turn: the banner, the answer with its citation chips, the notes, the
 * Sources panel, the buttons that act on it, and the feedback controls. The answer is the one
 * place HTML from the server is put in the page; the server sanitises it, and the page's content
 * security policy does not allow inline scripts either.
 * @param {CardInput} input - What to draw.
 * @returns {HTMLElement} The card.
 */
export function buildAnswerCard({
  answer,
  now,
  sourcesOpen,
  checking,
  canReask,
  canMoreDetail,
  rating,
}) {
  const { answerId, result } = answer;
  const body = el('div', {
    className: result.status === 'clarify' ? 'answer clarify' : 'answer',
  });
  body.innerHTML = answer.html.answer;
  const panel = buildSourcesPanel(answer, now, sourcesOpen);
  const banner = buildBanner(answer);
  const card = el('div', { className: 'card', attributes: { 'data-answer-id': answerId } }, [
    ...(banner === undefined ? [] : [banner]),
    body,
    ...buildNotes(answer),
    ...(panel === undefined ? [] : [panel]),
    el('div', { className: 'card-actions' }, [
      ...(result.sources.length === 0
        ? []
        : [
            actionButton(
              'recheck',
              answerId,
              checking ? 'Checking…' : 'Re-check sources',
              checking ? 'busy' : 'enabled',
            ),
          ]),
      ...(canReask ? [actionButton('reask', answerId, 'Re-ask with the latest version')] : []),
      ...(canMoreDetail ? [actionButton('more', answerId, 'Show more detail')] : []),
    ]),
    buildFeedback(answer, rating),
  ]);
  // Over the whole card, so the chips in a conflict point to their source too.
  describeChips(card, answerId, new Set(result.sources.map(({ key }) => key)));
  return card;
}
