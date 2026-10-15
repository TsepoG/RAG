// @vitest-environment happy-dom
// @ts-check
import { describe, expect, it } from 'vitest';
import { NO_STEPS, recordDraft, recordProgress } from '../../../../public/js/steps.js';
import { buildProgressCard, DRAFT_LABEL } from '../../../../public/js/ui/progress.js';

/**
 * A running turn after some progress lines and some draft text.
 * @param {string[]} messages - The progress lines.
 * @param {string} [draft] - The draft text so far.
 * @returns {Parameters<typeof buildProgressCard>[0]} What the card is built from.
 */
function running(messages, draft = '') {
  let progress = /** @type {import('../../../../public/js/steps.js').StepProgress} */ (NO_STEPS);
  for (const message of messages) {
    progress = recordProgress(progress, message);
  }
  if (draft !== '') {
    progress = recordDraft(progress);
  }
  return { ...progress, draft };
}

/**
 * @param {HTMLElement} card - The card.
 * @returns {string[]} Each row's status and label, without the hidden words.
 */
function rowsOf(card) {
  return [...card.querySelectorAll('li')].map(
    (row) =>
      `${/progress__step--(\w+)/.exec(row.className)?.[1]}: ${row.querySelector('.progress__label')?.textContent}`,
  );
}

describe('buildProgressCard', () => {
  it('is a busy article, so the page tells assistive technology it is still working', () => {
    const card = buildProgressCard(running([]));

    expect(card.tagName).toBe('ARTICLE');
    expect(card.getAttribute('aria-busy')).toBe('true');
    expect(card.getAttribute('aria-label')).toBe('Working on the answer');
    expect(card.classList.contains('card--working')).toBe(true);
  });

  it('lists the steps in an ordered list called Progress', () => {
    const card = buildProgressCard(
      running(['Searching Confluence…', 'Opening a Confluence page…']),
    );

    const list = card.querySelector('ol');
    expect(list?.getAttribute('aria-label')).toBe('Progress');
    expect(rowsOf(card)).toEqual([
      'done: Searched Confluence',
      'current: Reading a Confluence page',
      'future: Writing and checking the answer',
    ]);
  });

  it('shows only the waiting writing step before the first progress line', () => {
    expect(rowsOf(buildProgressCard(running([])))).toEqual([
      'future: Writing and checking the answer',
    ]);
  });

  it('gives a done step a check, a current one a spinner, and a waiting one an empty ring', () => {
    const card = buildProgressCard(running(['Searching Confluence…', 'Searching the code…']));

    const [done, current, future] = [...card.querySelectorAll('.progress__marker')];
    expect(done.className).toContain('progress__marker--done');
    expect(done.querySelector('svg')).not.toBeNull();
    expect(current.className).toContain('progress__marker--current');
    expect(current.querySelector('svg')).toBeNull();
    expect(future.className).toContain('progress__marker--future');
    expect(future.querySelector('svg')).toBeNull();
  });

  it('hides the markers from screen readers and says the status in words instead', () => {
    const card = buildProgressCard(running(['Searching Confluence…', 'Searching the code…']));

    const rows = [...card.querySelectorAll('li')];
    expect(rows.map((row) => row.querySelector('.visually-hidden')?.textContent)).toEqual([
      'Done: ',
      'In progress: ',
      'Waiting: ',
    ]);
    expect(
      [...card.querySelectorAll('.progress__marker')].every(
        (marker) => marker.getAttribute('aria-hidden') === 'true',
      ),
    ).toBe(true);
  });

  it('labels each row with the kind of step it is', () => {
    const card = buildProgressCard(running(['Searching the code…']));

    expect(card.querySelector('li')?.getAttribute('data-step')).toBe('code-search');
  });

  it('has no draft until text arrives', () => {
    const card = buildProgressCard(running(['Searching the code…']));

    expect(card.querySelector('.progress__draft')).toBeNull();
    expect(card.textContent).not.toContain(DRAFT_LABEL);
  });

  it('shows the draft under the steps with its label and a caret once text arrives', () => {
    const card = buildProgressCard(running(['Searching the code…'], 'The order cannot be'));

    const draft = card.querySelector('.progress__draft');
    expect(draft?.querySelector('.progress__draft-label')?.textContent).toBe(DRAFT_LABEL);
    expect(draft?.querySelector('.progress__draft-text')?.textContent).toBe('The order cannot be');
    expect(draft?.querySelector('.progress__caret')?.getAttribute('aria-hidden')).toBe('true');
    expect(rowsOf(card).at(-1)).toBe('current: Writing and checking the answer');
  });

  it('shows the draft as text, never as markup', () => {
    const card = buildProgressCard(running([], '<img src=x onerror=alert(1)> **bold**'));

    expect(card.querySelector('img')).toBeNull();
    expect(card.querySelector('.progress__draft-text')?.textContent).toBe(
      '<img src=x onerror=alert(1)> **bold**',
    );
  });

  it('shows a step label as text, never as markup', () => {
    const card = buildProgressCard(
      running(['Rewriting the answer for a <b>Boss</b>…', 'Checking releases…']),
    );

    expect(card.querySelector('b')).toBeNull();
    expect(rowsOf(card)[0]).toBe('done: Reworded the answer for <b>Boss</b>');
  });

  it('puts no inline style on anything it builds', () => {
    const card = buildProgressCard(running(['Searching the code…'], 'Draft'));

    expect(card.querySelectorAll('[style]')).toHaveLength(0);
  });
});
