// @ts-check
import { el, externalLink } from '../dom.js';
import { actionButton } from './actions.js';
import { icon } from './icons.js';
import { CONFIDENCE_LABELS, ERROR_LABEL, STATUS_LABELS } from './labels.js';
import { buildSourcesSection, describeChips } from './sources.js';

/** The bold sentence of the box that says a source has changed. */
export const CHANGED_HEADLINE = 'A source has changed since this answer was written.';

/** What the changed-source button says. */
export const REASK_TEXT = 'Re-ask with the latest version';

/**
 * What a card is drawn from.
 * @typedef {object} CardInput
 * @property {import('../chatState.js').AnswerView} answer - The answer.
 * @property {number} now - The time now, in ms.
 * @property {boolean} sourcesOpen - Whether the list of sources is open.
 * @property {boolean} checking - Whether the sources are being checked now.
 * @property {boolean} canReask - Whether "Re-ask with the latest version" is offered.
 * @property {boolean} canMoreDetail - Whether "Show more detail" is offered.
 * @property {import('../chatState.js').Rating | undefined} rating - What the reader said about it.
 */

/**
 * The look of a pill, with the icon that says the same thing as its colour.
 * @typedef {{ tone: 'high' | 'medium' | 'low' | 'neutral', icon: 'check' | 'alert-circle' | 'alert-triangle' | 'search-minus' | 'no-entry' | 'help-circle', label: string }} PillSpec
 */

/**
 * @type {Readonly<Record<'high' | 'medium' | 'low', PillSpec>>}
 */
const LEVEL_PILLS = Object.freeze({
  high: { tone: 'high', icon: 'check', label: CONFIDENCE_LABELS.high },
  medium: { tone: 'medium', icon: 'alert-circle', label: CONFIDENCE_LABELS.medium },
  low: { tone: 'low', icon: 'alert-triangle', label: CONFIDENCE_LABELS.low },
});

/**
 * @type {Readonly<Record<'not_found' | 'out_of_scope' | 'clarify', PillSpec>>}
 */
const STATUS_PILLS = Object.freeze({
  not_found: { tone: 'neutral', icon: 'search-minus', label: STATUS_LABELS.not_found },
  out_of_scope: { tone: 'neutral', icon: 'no-entry', label: STATUS_LABELS.out_of_scope },
  clarify: { tone: 'neutral', icon: 'help-circle', label: STATUS_LABELS.clarify },
});

/**
 * Works out the pill for an answer: its confidence if it is an answer, otherwise what kind of
 * reply it is.
 * @param {import('../chatState.js').AnswerView} answer - The answer.
 * @returns {PillSpec} The pill.
 */
function pillFor({ result, rendered }) {
  if (result.status === 'answered') {
    return LEVEL_PILLS[rendered.level ?? 'low'];
  }
  return STATUS_PILLS[result.status];
}

/**
 * Builds a pill: an icon and words on a coloured ground, so the state never depends on colour.
 * @param {PillSpec} spec - Its tone, icon and words.
 * @returns {HTMLElement} The pill.
 */
function buildPill({ tone, icon: name, label }) {
  return el('span', { className: `pill pill--${tone}` }, [
    icon(name, { size: 14, strokeWidth: 2.2 }),
    el('span', { text: label }),
  ]);
}

/**
 * Builds the top of a card: the pill and the turn.
 * @param {PillSpec} spec - The pill.
 * @param {number} turn - The turn.
 * @returns {HTMLElement} The header.
 */
function buildHeader(spec, turn) {
  return el('header', { className: 'answer-card__header' }, [
    buildPill(spec),
    el('span', { className: 'answer-card__turn', text: `Turn ${turn}` }),
  ]);
}

/**
 * Joins one or more keys into a phrase: "G2", "C1 and G2", "C1, C2 and G2".
 * @param {string[]} keys - The keys.
 * @returns {string} The phrase.
 */
function listKeys(keys) {
  return keys.length === 1 ? keys[0] : `${keys.slice(0, -1).join(', ')} and ${keys.at(-1)}`;
}

/**
 * Builds the box that says a cited source has changed, with the button that asks again.
 * @param {import('../chatState.js').AnswerView} answer - The answer.
 * @param {boolean} canReask - Whether the button is offered.
 * @returns {HTMLElement | undefined} The box, or undefined when nothing changed.
 */
function buildChangedNotice({ answerId, changedKeys }, canReask) {
  if (changedKeys.length === 0) {
    return undefined;
  }
  const plural = changedKeys.length > 1;
  const detail = `${listKeys(changedKeys)} ${plural ? 'were' : 'was'} updated after ${plural ? 'they were' : 'it was'} read.`;
  return el('div', { className: 'notice notice--changed' }, [
    icon('refresh', { size: 18 }),
    el('div', { className: 'notice__body' }, [
      el('p', { className: 'notice__text' }, [
        el('strong', { text: CHANGED_HEADLINE }),
        ` ${detail}`,
      ]),
      ...(canReask
        ? [
            actionButton({
              action: 'reask',
              answerId,
              text: REASK_TEXT,
              className: 'button button--warning',
            }),
          ]
        : []),
    ]),
  ]);
}

/**
 * Builds what the answer says about itself under the header: how sure the role says it is, and why
 * when the confidence was lowered. A plain high answer says nothing more than its pill.
 * @param {import('../chatState.js').AnswerView} answer - The answer.
 * @returns {HTMLElement[]} Up to two lines.
 */
function buildStanding({ result, rendered }) {
  if (result.status !== 'answered') {
    return [];
  }
  const capped = (result.capsApplied?.length ?? 0) > 0;
  const plainHigh = rendered.level === 'high' && !capped;
  return [
    ...(plainHigh || rendered.banner === ''
      ? []
      : [el('p', { className: 'answer-card__banner', text: rendered.banner })]),
    ...(capped && result.confidenceReason !== ''
      ? [el('p', { className: 'answer-card__reason', text: `Why: ${result.confidenceReason}` })]
      : []),
  ];
}

/**
 * Builds the answer itself. The server's sanitised HTML is the one thing in a card that is put in
 * the page as HTML; when the reply has no text of its own, the role's words are shown as text.
 * @param {import('../chatState.js').AnswerView} answer - The answer.
 * @returns {HTMLElement} The text.
 */
function buildText({ result, rendered, html }) {
  const body = el('div', {
    className:
      result.status === 'clarify'
        ? 'answer-card__text answer-card__text--clarify'
        : 'answer-card__text',
  });
  if (rendered.text === '') {
    body.append(el('p', { text: rendered.banner }));
  } else {
    body.innerHTML = html.answer;
  }
  return body;
}

/**
 * Builds a titled list, or nothing when the list is empty.
 * @param {string} title - The heading.
 * @param {HTMLElement[]} items - The list items.
 * @param {string} [modifier] - A class that sets the section apart.
 * @returns {HTMLElement[]} The section, or none.
 */
function section(title, items, modifier = '') {
  return items.length === 0
    ? []
    : [
        el('section', { className: `note ${modifier}`.trim() }, [
          el('h2', { className: 'note__title', text: title }),
          el('ul', { className: 'note__list' }, items),
        ]),
      ];
}

/**
 * Builds the people worth asking, as list items.
 * @param {import('../chatState.js').AnswerView['rendered']['whoToAsk']} people - Who the application suggests.
 * @returns {HTMLElement[]} The items.
 */
function peopleItems(people) {
  return people.map(({ name, sourceKeys }) =>
    el('li', { text: sourceKeys.length === 0 ? name : `${name} (${sourceKeys.join(', ')})` }),
  );
}

/**
 * Builds the panel that comes with a "not found": where the assistant looked, and who might know.
 * Either part is left out when it is empty, and so is the panel.
 * @param {import('../chatState.js').AnswerView['rendered']} rendered - The rendered answer.
 * @returns {HTMLElement[]} The panel, or none.
 */
function buildLookedPanel({ closestPages, whoToAsk }) {
  const looked = closestPages.map((page) => el('li', {}, [externalLink(page.title, page.url)]));
  const parts = [
    ...section('Where I looked', looked),
    ...section('Who might know', peopleItems(whoToAsk)),
  ];
  return parts.length === 0 ? [] : [el('div', { className: 'answer-card__panel' }, parts)];
}

/**
 * Builds the notes under an answer: what it could not confirm, where the sources disagree, and who
 * might know; or, for a "not found", the panel of where it looked.
 * @param {import('../chatState.js').AnswerView} answer - The answer.
 * @returns {HTMLElement[]} The sections that have something in them.
 */
function buildNotes({ result, rendered, html }) {
  if (result.status === 'not_found') {
    return buildLookedPanel(rendered);
  }
  const conflicts = html.conflicts.map((conflict) => {
    const item = el('li', { className: 'note__conflict' });
    // The server has already made this safe; see renderAnswerHtml.
    item.innerHTML = conflict;
    return item;
  });
  return [
    ...section(
      "What I'm not sure about",
      rendered.gaps.map((gap) => el('li', { text: gap })),
    ),
    ...section('Where sources disagree', conflicts, 'note--conflicts'),
    ...section('Who might know', peopleItems(rendered.whoToAsk)),
  ];
}

/**
 * Builds the thumbs, and the form that follows a thumbs down.
 * @param {import('../chatState.js').AnswerView} answer - The answer.
 * @param {import('../chatState.js').Rating | undefined} rating - What the reader said.
 * @returns {HTMLElement} The feedback controls.
 */
function buildFeedback({ answerId, result }, rating) {
  const locked = rating?.saved === true;
  const mode = locked ? 'disabled' : 'enabled';
  const thumb = (/** @type {'up' | 'down'} */ way) => {
    const button = actionButton({
      action: way,
      answerId,
      label: way === 'up' ? 'Helpful' : 'Not helpful',
      className: 'button button--icon',
      mode,
    });
    button.setAttribute('aria-pressed', String(rating?.rating === way));
    button.append(icon(way === 'up' ? 'thumbs-up' : 'thumbs-down', { size: 18 }));
    return button;
  };
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
            el('button', {
              className: 'button',
              text: 'Send feedback',
              attributes: { type: 'submit' },
            }),
          ]),
        ]
      : [];
  return el('div', { className: 'feedback' }, [
    el(
      'div',
      {
        className: 'feedback__thumbs',
        attributes: { role: 'group', 'aria-label': 'Was this helpful?' },
      },
      [thumb('up'), thumb('down')],
    ),
    ...form,
    el('output', { className: 'feedback__message', text: rating?.message ?? '' }),
  ]);
}

/**
 * Builds the foot of a card: "Show more detail" on the left and the thumbs on the right.
 * @param {import('../chatState.js').AnswerView} answer - The answer.
 * @param {boolean} canMoreDetail - Whether "Show more detail" is offered.
 * @param {import('../chatState.js').Rating | undefined} rating - What the reader said.
 * @returns {HTMLElement} The footer.
 */
function buildFooter(answer, canMoreDetail, rating) {
  return el('footer', { className: 'answer-card__footer' }, [
    ...(canMoreDetail
      ? [
          actionButton({
            action: 'more',
            answerId: answer.answerId,
            text: 'Show more detail →',
            className: 'button button--text',
          }),
        ]
      : []),
    buildFeedback(answer, rating),
  ]);
}

/**
 * Builds the answer of one turn: the pill, the notice of a changed source, the answer with its
 * citation chips, the notes, the Sources, and the buttons that act on it. The answer is the one
 * place HTML from the server is put in the page, apart from the sentences of a conflict; the server
 * makes both safe, and the page's content security policy does not allow inline scripts either.
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
  const notice = buildChangedNotice(answer, canReask);
  const sources = buildSourcesSection(answer, { now, open: sourcesOpen, checking });
  const card = el('article', {
    className: `card answer-card answer-card--${result.status}`,
    attributes: { 'data-answer-id': answerId },
  });
  card.append(
    buildHeader(pillFor(answer), answer.turn),
    ...buildStanding(answer),
    ...(notice === undefined ? [] : [notice]),
    buildText(answer),
    ...buildNotes(answer),
    ...(sources === undefined ? [] : [sources]),
    buildFooter(answer, canMoreDetail, rating),
  );
  // Over the whole card, so the chips in a conflict point to their source too.
  describeChips(card, answerId, new Set(result.sources.map(({ key }) => key)));
  return card;
}

/**
 * Builds the card for a turn that failed: a pill, what went wrong in words for the reader, and a
 * button to try again when the failure allows it.
 * @param {{ turn: number, message: string, canRetry: boolean }} input - The turn, the message and whether a retry is possible.
 * @returns {HTMLElement} The card.
 */
export function buildErrorCard({ turn, message, canRetry }) {
  const card = el('article', {
    className: 'card answer-card answer-card--error',
    attributes: { 'data-turn': String(turn) },
  });
  card.append(
    buildHeader({ tone: 'low', icon: 'alert-circle', label: ERROR_LABEL }, turn),
    el('p', { className: 'answer-card__error', text: message, attributes: { role: 'alert' } }),
  );
  if (canRetry) {
    const retry = el('button', {
      className: 'button',
      text: 'Try again',
      attributes: {
        type: 'button',
        'data-action': 'retry',
        'data-turn': String(turn),
        'data-focus-id': `turn-${turn}:retry`,
      },
    });
    card.append(retry);
  }
  return card;
}
