// @vitest-environment happy-dom
// @ts-check
import { describe, expect, it } from 'vitest';
import { buildAnswerCard } from '../../../public/js/answerCard.js';
import { chip, FETCHED_AT, makeAnswer } from '../../helpers/page.js';

/**
 * Builds a card with usual inputs.
 * @param {Record<string, any>} [changes] - Parts of the input to change.
 * @returns {HTMLElement} The card.
 */
function card(changes = {}) {
  return buildAnswerCard({
    answer: makeAnswer(),
    now: FETCHED_AT,
    sourcesOpen: false,
    checking: false,
    canReask: false,
    canMoreDetail: false,
    rating: undefined,
    ...changes,
  });
}

/**
 * The texts of the buttons in a card.
 * @param {HTMLElement} root - The card.
 * @returns {string[]} Their texts.
 */
function buttonTexts(root) {
  return [...root.querySelectorAll('button[data-action]')].map(
    ({ textContent }) => textContent ?? '',
  );
}

describe('the banner', () => {
  it('says the level in words as well as colour, then the banner text and the reason', () => {
    const banner = card().querySelector('.banner');

    expect(banner?.querySelector('.badge')?.textContent).toBe('Medium confidence');
    expect(banner?.querySelector('.badge')?.className).toBe('badge level-medium');
    expect(banner?.textContent).toContain('Mostly confirmed. Part of this is my reading.');
    expect(banner?.textContent).toContain('Why: Part of this is my reading.');
  });

  it('can take the focus', () => {
    expect(card().querySelector('.banner')?.getAttribute('tabindex')).toBe('-1');
  });

  it('has no badge and no reason for an answer with no confidence', () => {
    const answer = makeAnswer({
      result: { status: 'not_found', confidence: null },
      rendered: { level: null, banner: 'I could not find this.' },
    });

    const banner = card({ answer }).querySelector('.banner');

    expect(banner?.querySelector('.badge')?.textContent).toBe('');
    expect(banner?.textContent).not.toContain('Why:');
  });

  it('is left out when there is nothing to say', () => {
    const answer = makeAnswer({ rendered: { level: null, banner: '' } });

    expect(card({ answer }).querySelector('.banner')).toBeNull();
  });

  it('says a cited source has changed when one has', () => {
    const changed = card({ answer: makeAnswer({ changedKeys: ['C1'] }) });

    expect(changed.querySelector('.changed-note')?.textContent).toContain(
      'has changed since it was written',
    );
    expect(card().querySelector('.changed-note')).toBeNull();
  });
});

describe('the answer', () => {
  it('is the server’s HTML, with the chips in it', () => {
    const answer = card().querySelector('.answer');

    expect(answer?.textContent).toContain('Refunds are allowed for 30 days');
    expect(answer?.querySelector('button.cite')?.getAttribute('data-key')).toBe('C1');
  });

  it('points each chip to its source title', () => {
    expect(card().querySelector('button.cite')?.getAttribute('aria-describedby')).toBe(
      'source-title-a1-C1',
    );
  });

  it('points the chips in a conflict to their source too', () => {
    const answer = makeAnswer({
      rendered: { conflicts: ['x'] },
      html: {
        answer: '<p>x</p>',
        conflicts: [`The page says A ${chip('C1')} but the code says B.`],
      },
    });

    const conflict = card({ answer }).querySelector('.conflicts li button.cite');

    expect(conflict?.getAttribute('aria-describedby')).toBe('source-title-a1-C1');
  });

  it('is shown larger when it is a clarifying question', () => {
    const answer = makeAnswer({ result: { status: 'clarify' } });

    expect(card({ answer }).querySelector('.answer')?.className).toBe('answer clarify');
    expect(card().querySelector('.answer')?.className).toBe('answer');
  });
});

describe('the notes', () => {
  it('lists conflicts, what could not be confirmed, closest pages and who might know', () => {
    const answer = makeAnswer({
      rendered: {
        gaps: ['The gift card window'],
        closestPages: [{ title: 'Returns FAQ', url: 'https://acme.atlassian.net/wiki/x' }],
        whoToAsk: [
          { name: '@acme/payments', sourceKeys: ['G1'] },
          { name: 'Sam', sourceKeys: [] },
        ],
      },
      html: { answer: '<p>x</p>', conflicts: ['<p>A <em>clash</em></p>'] },
    });

    const headings = [...card({ answer }).querySelectorAll('h4')].map(
      ({ textContent }) => textContent,
    );
    const root = card({ answer });

    expect(headings).toEqual([
      'The documentation and the code disagree',
      "What I couldn't confirm",
      'Closest pages I checked',
      'Who might know',
    ]);
    expect(root.querySelector('.conflicts li em')?.textContent).toBe('clash');
    expect(root.textContent).toContain('@acme/payments (G1)');
    expect(root.textContent).toContain('Sam');
    expect(root.querySelector('a[href="https://acme.atlassian.net/wiki/x"]')).not.toBeNull();
  });

  it('leaves out a list with nothing in it', () => {
    const answer = makeAnswer({ rendered: { gaps: [], whoToAsk: [], closestPages: [] } });

    expect(card({ answer }).querySelectorAll('h4')).toHaveLength(0);
  });
});

describe('the Sources panel and the buttons', () => {
  it('is collapsed unless it was open', () => {
    expect(/** @type {HTMLDetailsElement} */ (card().querySelector('details.sources')).open).toBe(
      false,
    );
    expect(
      /** @type {HTMLDetailsElement} */ (
        card({ sourcesOpen: true }).querySelector('details.sources')
      ).open,
    ).toBe(true);
  });

  it('has a Re-check button for an answer with sources, and none for one without', () => {
    const none = makeAnswer({ result: { sources: [], alsoConsulted: [] } });

    expect(buttonTexts(card())).toContain('Re-check sources');
    expect(buttonTexts(card({ answer: none }))).not.toContain('Re-check sources');
    expect(card({ answer: none }).querySelector('details.sources')).toBeNull();
  });

  it('shows the Re-check button as busy while the sources are checked, and keeps it focusable', () => {
    const button = /** @type {HTMLButtonElement} */ (
      card({ checking: true }).querySelector('[data-action="recheck"]')
    );

    expect(button.textContent).toBe('Checking…');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.disabled).toBe(false);
  });

  it('offers a re-ask and more detail only when told to', () => {
    expect(buttonTexts(card())).toEqual([
      'Re-check sources',
      'Yes, this was helpful',
      'No, this was not helpful',
    ]);
    expect(buttonTexts(card({ canReask: true, canMoreDetail: true }))).toEqual([
      'Re-check sources',
      'Re-ask with the latest version',
      'Show more detail',
      'Yes, this was helpful',
      'No, this was not helpful',
    ]);
  });

  it('gives every button what the page needs to act on it and to find it again', () => {
    const button = card({ canReask: true }).querySelector('[data-action="reask"]');

    expect(button?.getAttribute('data-answer-id')).toBe('a1');
    expect(button?.getAttribute('data-focus-id')).toBe('a1:reask');
    expect(button?.getAttribute('type')).toBe('button');
  });
});

describe('the feedback controls', () => {
  it('start unpressed and without a form', () => {
    const root = card();

    expect(root.querySelector('[data-action="up"]')?.getAttribute('aria-pressed')).toBe('false');
    expect(root.querySelector('[data-action="down"]')?.getAttribute('aria-pressed')).toBe('false');
    expect(root.querySelector('form.feedback-form')).toBeNull();
  });

  it('show which thumb was pressed, and a form with the cited sources after a thumbs down', () => {
    const root = card({ rating: { rating: 'down', saved: false, message: '' } });

    expect(root.querySelector('[data-action="down"]')?.getAttribute('aria-pressed')).toBe('true');
    const form = root.querySelector('form.feedback-form');
    expect(form?.getAttribute('data-answer-id')).toBe('a1');
    expect([...(form?.querySelectorAll('option') ?? [])].map(({ value }) => value)).toEqual([
      '',
      'C1',
      'G1',
    ]);
    expect(form?.querySelector('label[for="feedback-comment-a1"]')).not.toBeNull();
    expect(form?.querySelector('label[for="feedback-source-a1"]')).not.toBeNull();
  });

  it('lock the thumbs, close the form and say so once the feedback is saved', () => {
    const root = card({ rating: { rating: 'down', saved: true, message: 'Thank you.' } });

    expect(root.querySelector('form.feedback-form')).toBeNull();
    expect(
      /** @type {HTMLButtonElement} */ (root.querySelector('[data-action="up"]')).disabled,
    ).toBe(true);
    expect(root.querySelector('.feedback-area output')?.textContent).toBe('Thank you.');
  });

  it('keep the form and say why when the feedback could not be sent', () => {
    const root = card({
      rating: { rating: 'down', saved: false, message: 'It could not be sent.' },
    });

    expect(root.querySelector('form.feedback-form')).not.toBeNull();
    expect(root.querySelector('.feedback-area output')?.textContent).toBe('It could not be sent.');
  });
});
