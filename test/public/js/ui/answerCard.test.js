// @vitest-environment happy-dom
// @ts-check
import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildAnswerCard,
  buildErrorCard,
  CHANGED_HEADLINE,
  REASK_TEXT,
} from '../../../../public/js/ui/answerCard.js';
import { chip, FETCHED_AT, makeAnswer } from '../../../helpers/page.js';

const NOW = FETCHED_AT + 5 * 60_000;

beforeEach(() => {
  document.body.innerHTML = '';
});

/**
 * Builds a card.
 * @param {Record<string, any>} [changes] - Parts of the answer to change.
 * @param {Partial<import('../../../../public/js/ui/answerCard.js').CardInput>} [input] - Parts of the input to change.
 * @returns {HTMLElement} The card, in the document.
 */
function build(changes = {}, input = {}) {
  const card = buildAnswerCard({
    answer: makeAnswer(changes),
    now: NOW,
    sourcesOpen: false,
    checking: false,
    canReask: false,
    canMoreDetail: false,
    rating: undefined,
    ...input,
  });
  document.body.append(card);
  return card;
}

/** The parts of an answer that make it a reply that is not an answer. */
const NOT_ANSWER = {
  confidence: null,
  confidenceReason: '',
  sources: [],
  alsoConsulted: [],
};

/**
 * @param {HTMLElement} card - A card.
 * @returns {string | null | undefined} The words of its pill.
 */
const pillText = (card) => card.querySelector('.pill')?.textContent;

describe('the header', () => {
  it('shows an icon and words for high confidence, with the turn', () => {
    const card = build({ rendered: { level: 'high' }, result: { confidence: 'high' } });

    const pill = /** @type {HTMLElement} */ (card.querySelector('.pill'));
    expect(pill.className).toBe('pill pill--high');
    expect(pill.textContent).toBe('High confidence');
    expect(pill.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(card.querySelector('.answer-card__turn')?.textContent).toBe('Turn 1');
  });

  it.each([
    ['medium', 'Medium confidence', 'icon--alert-circle'],
    ['low', 'Low confidence', 'icon--alert-triangle'],
    ['high', 'High confidence', 'icon--check'],
  ])('shows %s confidence as %j with its own icon', (level, words, iconClass) => {
    const card = build({ rendered: { level }, result: { confidence: level } });

    expect(pillText(card)).toBe(words);
    expect(card.querySelector('.pill')?.className).toBe(`pill pill--${level}`);
    expect(card.querySelector('.pill svg')?.getAttribute('class')).toContain(iconClass);
  });

  it('treats an answer with no level as low confidence, the cautious reading', () => {
    const card = build({ rendered: { level: null } });

    expect(pillText(card)).toBe('Low confidence');
  });

  it('shows the turn of the answer', () => {
    expect(build({ turn: 4 }).querySelector('.answer-card__turn')?.textContent).toBe('Turn 4');
  });

  it('is an article that carries the answer id the page acts on', () => {
    const card = build();

    expect(card.tagName).toBe('ARTICLE');
    expect(card.getAttribute('data-answer-id')).toBe('a1');
    expect(card.classList.contains('card')).toBe(true);
  });
});

describe('what it says under the pill', () => {
  it('says nothing more for a high answer that was not capped', () => {
    const card = build({
      rendered: { level: 'high', banner: 'Confirmed.' },
      result: { confidence: 'high', capsApplied: [] },
    });

    expect(card.querySelector('.answer-card__banner')).toBeNull();
    expect(card.querySelector('.answer-card__reason')).toBeNull();
  });

  it('says how sure the role puts it for a medium answer, and the reason when it was capped', () => {
    const card = build({
      rendered: { banner: 'Mostly confirmed.' },
      result: {
        confidenceReason: 'A source is only my reading.',
        capsApplied: [{ code: 'inferred' }],
      },
    });

    expect(card.querySelector('.answer-card__banner')?.textContent).toBe('Mostly confirmed.');
    expect(card.querySelector('.answer-card__reason')?.textContent).toBe(
      'Why: A source is only my reading.',
    );
  });

  it('gives the banner but no reason for a medium answer no rule lowered', () => {
    const card = build({ rendered: { banner: 'Mostly confirmed.' }, result: { capsApplied: [] } });

    expect(card.querySelector('.answer-card__banner')).not.toBeNull();
    expect(card.querySelector('.answer-card__reason')).toBeNull();
  });

  it('gives a reason even for a high answer when a rule lowered it', () => {
    const card = build({
      rendered: { level: 'high', banner: 'Confirmed.' },
      result: { confidence: 'high', confidenceReason: 'Because.', capsApplied: [{ code: 'gaps' }] },
    });

    expect(card.querySelector('.answer-card__reason')?.textContent).toBe('Why: Because.');
  });

  it('leaves out the reason when it is empty, and the banner when it is empty', () => {
    const card = build({
      rendered: { banner: '' },
      result: { confidenceReason: '', capsApplied: [{ code: 'gaps' }] },
    });

    expect(card.querySelector('.answer-card__banner')).toBeNull();
    expect(card.querySelector('.answer-card__reason')).toBeNull();
  });

  it('treats an answer that carries no list of caps as one that was not capped', () => {
    const card = build({ result: { capsApplied: undefined } });

    expect(card.querySelector('.answer-card__reason')).toBeNull();
  });
});

describe('the answer text', () => {
  it('puts the safe HTML from the server in the answer, and nothing else as HTML', () => {
    const card = build({ html: { answer: `<p>Thirty days ${chip('C1')}.</p>` } });

    const text = /** @type {HTMLElement} */ (card.querySelector('.answer-card__text'));
    expect(text.querySelector('p')?.textContent).toBe('Thirty days C1.');
    expect(text.querySelector('button.cite')?.getAttribute('data-key')).toBe('C1');
  });

  it('points each citation chip at the title of its source', () => {
    const card = build();

    expect(card.querySelector('button.cite')?.getAttribute('aria-describedby')).toBe(
      'source-title-a1-C1',
    );
  });

  it('marks a clarifying question so it can be set apart', () => {
    const card = build({
      result: { status: 'clarify', ...NOT_ANSWER },
      rendered: { level: null, banner: '', text: 'Which one?', gaps: [], whoToAsk: [] },
      html: { answer: '<p>Which one?</p>' },
    });

    expect(card.querySelector('.answer-card__text--clarify')?.textContent).toBe('Which one?');
    expect(pillText(card)).toBe('Needs a bit more detail');
  });
});

describe('a changed source', () => {
  const changed = { changedKeys: ['G1'] };

  it('says so in a box with a refresh icon, and names the source', () => {
    const card = build(changed);

    const box = /** @type {HTMLElement} */ (card.querySelector('.notice--changed'));
    expect(box.querySelector('strong')?.textContent).toBe(CHANGED_HEADLINE);
    expect(CHANGED_HEADLINE).toBe('A source has changed since this answer was written.');
    expect(box.textContent).toContain('G1 was updated after it was read.');
    expect(box.querySelector('svg')?.getAttribute('class')).toContain('icon--refresh');
  });

  it('names several changed sources in one sentence', () => {
    const two = build({ changedKeys: ['C1', 'G1'] });
    const three = build({ changedKeys: ['C1', 'C2', 'G1'] });

    expect(two.querySelector('.notice--changed')?.textContent).toContain(
      'C1 and G1 were updated after they were read.',
    );
    expect(three.querySelector('.notice--changed')?.textContent).toContain(
      'C1, C2 and G1 were updated after they were read.',
    );
  });

  it('offers Re-ask with the latest version when the conversation can take it', () => {
    const card = build(changed, { canReask: true });

    const button = /** @type {HTMLElement} */ (card.querySelector('.notice--changed button'));
    expect(button.textContent).toBe(REASK_TEXT);
    expect(button.getAttribute('data-action')).toBe('reask');
    expect(button.getAttribute('data-answer-id')).toBe('a1');
  });

  it('says it is changed but offers no button when a new question cannot be asked', () => {
    const card = build(changed, { canReask: false });

    expect(card.querySelector('.notice--changed')).not.toBeNull();
    expect(card.querySelector('.notice--changed button')).toBeNull();
  });

  it('shows no box when nothing changed', () => {
    expect(build().querySelector('.notice--changed')).toBeNull();
  });
});

describe('what it could not confirm and where sources disagree', () => {
  it('lists the gaps under a heading of their own', () => {
    const card = build();

    const note = /** @type {HTMLElement} */ (card.querySelector('.note'));
    expect(note.querySelector('h3')?.textContent).toBe("What I'm not sure about");
    expect(note.querySelector('li')?.textContent).toBe('The refund window for gift cards');
  });

  it('lists each conflict, with its own chips described', () => {
    const card = build({
      rendered: { gaps: [] },
      html: {
        conflicts: [`<p>The page says 30 days ${chip('C1')}; the code says 14 ${chip('G1')}.</p>`],
      },
    });

    const note = /** @type {HTMLElement} */ (card.querySelector('.note--conflicts'));
    expect(note.querySelector('h3')?.textContent).toBe('Where sources disagree');
    expect(note.querySelectorAll('button.cite')).toHaveLength(2);
    expect(note.querySelector('button.cite')?.getAttribute('aria-describedby')).toBe(
      'source-title-a1-C1',
    );
  });

  it('leaves out a note that has nothing in it', () => {
    const card = build({ rendered: { gaps: [], whoToAsk: [] } });

    expect(card.querySelector('.note')).toBeNull();
  });

  it('lists who might know, with the keys of the sources they own', () => {
    const card = build({ rendered: { gaps: [] } });

    const note = /** @type {HTMLElement} */ (card.querySelector('.note'));
    expect(note.querySelector('h3')?.textContent).toBe('Who might know');
    expect(note.textContent).toContain('@acme/payments (G1)');
  });

  it('lists a person with no sources by name alone', () => {
    const card = build({
      rendered: { gaps: [], whoToAsk: [{ name: 'The payments team', sourceKeys: [] }] },
    });

    expect(card.querySelector('.note li')?.textContent).toBe('The payments team');
  });
});

describe('not found, and out of scope', () => {
  const notFound = {
    result: { status: 'not_found', ...NOT_ANSWER },
    rendered: {
      level: null,
      banner: "I couldn't find anything about this.",
      text: '',
      gaps: [],
      conflicts: [],
      closestPages: [
        { key: 'C2', title: 'Payments FAQ', url: 'https://acme.atlassian.net/wiki/2' },
        { title: 'Returns', url: 'https://acme.atlassian.net/wiki/3' },
      ],
      whoToAsk: [{ name: 'The payments team', sourceKeys: [] }],
    },
    html: { answer: '', conflicts: [] },
    sourceStates: [],
  };

  it('shows a neutral pill with a magnifier and the role words as text', () => {
    const card = build(notFound);

    expect(pillText(card)).toBe('Not found in the docs');
    expect(card.querySelector('.pill')?.className).toBe('pill pill--neutral');
    expect(card.querySelector('.pill svg')?.getAttribute('class')).toContain('icon--search-minus');
    expect(card.querySelector('.answer-card__text p')?.textContent).toBe(
      "I couldn't find anything about this.",
    );
    expect(card.querySelector('.answer-card__text img')).toBeNull();
  });

  it('shows where it looked, as links, and who might know, in a panel', () => {
    const card = build(notFound);

    const panel = /** @type {HTMLElement} */ (card.querySelector('.answer-card__panel'));
    const titles = [...panel.querySelectorAll('h3')].map(({ textContent }) => textContent);
    expect(titles).toEqual(['Where I looked', 'Who might know']);
    expect(panel.querySelector('a')?.textContent).toBe('Payments FAQ');
    expect(panel.querySelector('a')?.getAttribute('href')).toBe(
      'https://acme.atlassian.net/wiki/2',
    );
    expect(panel.textContent).toContain('The payments team');
  });

  it('leaves out Who might know when nobody is suggested', () => {
    const card = build({ ...notFound, rendered: { ...notFound.rendered, whoToAsk: [] } });

    const titles = [...card.querySelectorAll('.answer-card__panel h3')].map((h) => h.textContent);
    expect(titles).toEqual(['Where I looked']);
  });

  it('leaves out Where I looked when no page was consulted', () => {
    const card = build({ ...notFound, rendered: { ...notFound.rendered, closestPages: [] } });

    const titles = [...card.querySelectorAll('.answer-card__panel h3')].map((h) => h.textContent);
    expect(titles).toEqual(['Who might know']);
  });

  it('leaves out the panel when it would be empty', () => {
    const card = build({
      ...notFound,
      rendered: { ...notFound.rendered, closestPages: [], whoToAsk: [] },
    });

    expect(card.querySelector('.answer-card__panel')).toBeNull();
  });

  it('has no sources and no Re-check for a reply with nothing cited', () => {
    const card = build(notFound);

    expect(card.querySelector('.sources')).toBeNull();
    expect(card.querySelector('[data-action="recheck"]')).toBeNull();
  });

  it('shows out of scope with a no-entry icon and the role words', () => {
    const card = build({
      result: { status: 'out_of_scope', ...NOT_ANSWER },
      rendered: {
        level: null,
        banner: "I don't have that information.",
        text: '',
        gaps: [],
        whoToAsk: [],
      },
      html: { answer: '', conflicts: [] },
      sourceStates: [],
    });

    expect(pillText(card)).toBe('Outside what I can answer');
    expect(card.querySelector('.pill svg')?.getAttribute('class')).toContain('icon--no-entry');
    expect(card.querySelector('.answer-card__text')?.textContent).toBe(
      "I don't have that information.",
    );
    expect(card.querySelector('.answer-card__panel')).toBeNull();
  });
});

describe('the sources', () => {
  it('are a section of the card, closed unless the page says they are open', () => {
    const closed = build();
    const open = build({}, { sourcesOpen: true });

    expect(closed.querySelector('.sources__toggle')?.getAttribute('aria-expanded')).toBe('false');
    expect(open.querySelector('.sources__toggle')?.getAttribute('aria-expanded')).toBe('true');
  });

  it('say a check is running on the Re-check button', () => {
    const card = build({}, { sourcesOpen: true, checking: true });

    expect(card.querySelector('[data-action="recheck"]')?.textContent).toBe('Checking…');
  });
});

describe('the foot of the card', () => {
  it('offers Show more detail only when the page says it can', () => {
    const without = build();
    const withButton = build({}, { canMoreDetail: true });

    expect(without.querySelector('[data-action="more"]')).toBeNull();
    const button = /** @type {HTMLElement} */ (withButton.querySelector('[data-action="more"]'));
    expect(button.textContent).toBe('Show more detail →');
    expect(button.getAttribute('data-answer-id')).toBe('a1');
  });

  it('has a thumbs up and a thumbs down with names for a screen reader, neither pressed yet', () => {
    const card = build();

    const [up, down] = [...card.querySelectorAll('.feedback__thumbs button')];
    expect(up.getAttribute('aria-label')).toBe('Helpful');
    expect(down.getAttribute('aria-label')).toBe('Not helpful');
    expect(up.getAttribute('aria-pressed')).toBe('false');
    expect(down.getAttribute('aria-pressed')).toBe('false');
    expect(up.getAttribute('data-action')).toBe('up');
    expect(down.getAttribute('data-action')).toBe('down');
    expect(up.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(card.querySelector('[role="group"]')?.getAttribute('aria-label')).toBe(
      'Was this helpful?',
    );
  });

  it('marks the thumb that was pressed and says what happened', () => {
    const card = build({}, { rating: { rating: 'up', saved: true, message: 'Thank you.' } });

    const [up, down] = /** @type {HTMLButtonElement[]} */ ([
      ...card.querySelectorAll('.feedback__thumbs button'),
    ]);
    expect(up.getAttribute('aria-pressed')).toBe('true');
    expect(down.getAttribute('aria-pressed')).toBe('false');
    expect(up.disabled).toBe(true);
    expect(down.disabled).toBe(true);
    expect(card.querySelector('output')?.textContent).toBe('Thank you.');
  });

  it('opens a form after a thumbs down, listing the sources it cited', () => {
    const card = build({}, { rating: { rating: 'down', saved: false, message: '' } });

    const form = /** @type {HTMLFormElement} */ (card.querySelector('form.feedback-form'));
    expect(form.getAttribute('data-answer-id')).toBe('a1');
    expect(form.elements.namedItem('comment')).not.toBeNull();
    const options = [...form.querySelectorAll('option')].map(({ value }) => value);
    expect(options).toEqual(['', 'C1', 'G1']);
    expect(form.querySelector('button[type="submit"]')?.textContent).toBe('Send feedback');
  });

  it('closes the form once the feedback is saved, and has no form after a thumbs up', () => {
    const saved = build({}, { rating: { rating: 'down', saved: true, message: 'Saved.' } });
    const up = build({}, { rating: { rating: 'up', saved: false, message: '' } });

    expect(saved.querySelector('form')).toBeNull();
    expect(up.querySelector('form')).toBeNull();
  });
});

describe('the whole card', () => {
  it('puts HTML only in the answer text and the sentences of a conflict', () => {
    const card = build({
      html: {
        answer: '<p>Safe <em>text</em></p>',
        conflicts: ['<p>One <strong>side</strong></p>'],
      },
      rendered: {
        gaps: ['<img src=x onerror=alert(1)>'],
        whoToAsk: [{ name: '<b>Team</b>', sourceKeys: [] }],
      },
      result: {
        sources: [
          {
            key: 'C1',
            type: 'confluence',
            title: '<script>x</script>',
            url: 'https://a.example/1',
          },
        ],
        alsoConsulted: [{ title: '<i>Other</i>', url: 'https://a.example/2' }],
      },
    });

    expect(card.querySelector('script')).toBeNull();
    expect(card.querySelector('img')).toBeNull();
    expect(card.querySelector('b')).toBeNull();
    expect(card.querySelector('i')).toBeNull();
    expect(card.querySelector('.note li')?.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(card.querySelector('.source-row__title')?.textContent).toBe('<script>x</script>');
    expect(card.querySelector('.answer-card__text em')).not.toBeNull();
    expect(card.querySelector('.note__conflict strong')).not.toBeNull();
  });

  it('has no inline style on anything it builds', () => {
    const card = build(
      { changedKeys: ['G1'] },
      { canReask: true, canMoreDetail: true, sourcesOpen: true },
    );

    expect(card.querySelectorAll('[style]')).toHaveLength(0);
  });

  it('gives every button a name a screen reader can say', () => {
    const card = build(
      { changedKeys: ['G1'] },
      { canReask: true, canMoreDetail: true, sourcesOpen: true },
    );

    for (const button of card.querySelectorAll('button:not(.cite)')) {
      const name = button.getAttribute('aria-label') ?? button.textContent;
      expect(name?.trim()).not.toBe('');
    }
  });
});

describe('buildErrorCard', () => {
  it('shows a red pill, what went wrong as an alert, and the turn', () => {
    const card = buildErrorCard({
      turn: 3,
      message: 'The assistant took too long.',
      canRetry: false,
    });

    expect(card.tagName).toBe('ARTICLE');
    expect(card.getAttribute('data-turn')).toBe('3');
    expect(pillText(card)).toBe('Something went wrong');
    expect(card.querySelector('.pill')?.className).toBe('pill pill--low');
    expect(card.querySelector('.answer-card__turn')?.textContent).toBe('Turn 3');
    const message = /** @type {HTMLElement} */ (card.querySelector('.answer-card__error'));
    expect(message.textContent).toBe('The assistant took too long.');
    expect(message.getAttribute('role')).toBe('alert');
  });

  it('offers Try again only when the failure allows it', () => {
    const without = buildErrorCard({ turn: 1, message: 'No.', canRetry: false });
    const withRetry = buildErrorCard({ turn: 2, message: 'Maybe.', canRetry: true });

    expect(without.querySelector('button')).toBeNull();
    const button = /** @type {HTMLElement} */ (withRetry.querySelector('button'));
    expect(button.textContent).toBe('Try again');
    expect(button.getAttribute('data-action')).toBe('retry');
    expect(button.getAttribute('data-turn')).toBe('2');
    expect(button.getAttribute('data-focus-id')).toBe('turn-2:retry');
  });

  it('shows the message as text, never as markup', () => {
    const card = buildErrorCard({
      turn: 1,
      message: '<img src=x onerror=alert(1)>',
      canRetry: false,
    });

    expect(card.querySelector('img')).toBeNull();
    expect(card.querySelector('.answer-card__error')?.textContent).toBe(
      '<img src=x onerror=alert(1)>',
    );
  });
});
