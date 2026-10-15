// @vitest-environment happy-dom
// @ts-check
import { describe, expect, it } from 'vitest';
import { buildEndCard, describeEnd, summariseChecks } from '../../../../public/js/ui/endCard.js';

/**
 * A turn that was answered, with the states of the sources it cites.
 * @param {Array<{ key: string, changed?: boolean, check?: { status: string } | null }>} states - The sources.
 * @returns {{ answer: { sourceStates: Array<{ key: string, changed: boolean, check: { status: string } | null }> } }} The turn.
 */
function answered(states) {
  return {
    answer: {
      sourceStates: states.map(({ key, changed = false, check = null }) => ({
        key,
        changed,
        check,
      })),
    },
  };
}

const UNCHANGED = { status: 'unchanged' };

describe('describeEnd', () => {
  it.each([
    [
      'turns',
      'This conversation has reached its 5 questions',
      'Long conversations make answers less reliable',
    ],
    ['budget', 'This conversation has read as much as it can', 'share of source text'],
    [
      'truncated',
      "Earlier sources dropped out of the assistant's memory",
      'no answer relies on text it can no longer see',
    ],
    ['session-error', 'The assistant lost this conversation', 'connection'],
    [
      'abort-unconfirmed',
      "This conversation was stopped and can't continue",
      "didn't confirm it had stopped",
    ],
    ['replaced', 'A newer conversation took over', 'Only one conversation runs at a time'],
    ['deleted', 'This conversation was closed', 'Start a new one'],
  ])('writes words for the reason %s', (reason, title, body) => {
    const words = describeEnd(reason, 5);

    expect(words.title).toBe(title);
    expect(words.body).toContain(body);
  });

  it('names the number of questions in a conversation that is full', () => {
    expect(describeEnd('turns', 3).title).toBe('This conversation has reached its 3 questions');
  });

  it.each([
    'gone',
    'idle',
    'shutdown',
    '',
    'something new',
    'toString',
    '__proto__',
    'constructor',
  ])('writes the words for an expired conversation for the reason %j', (reason) => {
    expect(describeEnd(reason, 5)).toEqual({
      title: 'This conversation has expired',
      body: 'It was idle too long or the app restarted. Start a new one to keep going.',
    });
  });

  it('writes different words for every reason it knows', () => {
    const reasons = [
      'turns',
      'budget',
      'truncated',
      'session-error',
      'abort-unconfirmed',
      'replaced',
      'deleted',
      'gone',
    ];

    const titles = new Set(reasons.map((reason) => describeEnd(reason, 5).title));

    expect(titles.size).toBe(reasons.length);
  });
});

describe('summariseChecks', () => {
  it('counts each source once, as the latest answer that cites it has it', () => {
    const summary = summariseChecks([
      answered([{ key: 'C1' }, { key: 'G1', check: UNCHANGED }]),
      answered([
        { key: 'C1', check: UNCHANGED },
        { key: 'G2', changed: true },
      ]),
    ]);

    expect(summary).toEqual({ total: 3, unchanged: 2, changed: 1, unavailable: 0, unchecked: 0 });
  });

  it('counts a source as changed when the latest check found it so', () => {
    const summary = summariseChecks([answered([{ key: 'C1', check: { status: 'changed' } }])]);

    expect(summary).toMatchObject({ total: 1, changed: 1, unchanged: 0 });
  });

  it('counts a source that could not be checked, and one never checked', () => {
    const summary = summariseChecks([
      answered([
        { key: 'C1', check: { status: 'unavailable' } },
        { key: 'C2' },
        { key: 'C3', check: UNCHANGED },
      ]),
    ]);

    expect(summary).toEqual({ total: 3, unchanged: 1, changed: 0, unavailable: 1, unchecked: 1 });
  });

  it('counts a changed source as changed even when it could not be checked again', () => {
    const summary = summariseChecks([
      answered([{ key: 'C1', changed: true, check: { status: 'unavailable' } }]),
    ]);

    expect(summary).toMatchObject({ changed: 1, unavailable: 0 });
  });

  it('counts nothing when no answer cites a source', () => {
    expect(summariseChecks([{ answer: undefined }])).toEqual({
      total: 0,
      unchanged: 0,
      changed: 0,
      unavailable: 0,
      unchecked: 0,
    });
    expect(summariseChecks([])).toMatchObject({ total: 0 });
  });
});

describe('buildEndCard', () => {
  const summary = { total: 6, unchanged: 5, changed: 1, unavailable: 0, unchecked: 0 };

  /**
   * @param {Partial<{ reason: string, maxTurns: number, summary: import('../../../../public/js/ui/endCard.js').CheckSummary }>} [changes] - Parts to change.
   * @returns {HTMLElement} The card.
   */
  function build(changes = {}) {
    return buildEndCard({ reason: 'turns', maxTurns: 5, summary, ...changes });
  }

  it('is a section called Conversation ended, with the reason as a title that can take focus', () => {
    const card = build();

    expect(card.tagName).toBe('SECTION');
    expect(card.getAttribute('aria-label')).toBe('Conversation ended');
    const title = /** @type {HTMLElement} */ (card.querySelector('h2'));
    expect(title.textContent).toBe('This conversation has reached its 5 questions');
    expect(title.getAttribute('tabindex')).toBe('-1');
    expect(card.querySelector('.end-card__body')?.textContent).toContain(
      'Start a new one to keep going.',
    );
  });

  it('says how the final check came out, and where a changed source is shown', () => {
    const line = /** @type {HTMLElement} */ (build().querySelector('.end-card__summary'));

    expect(line.textContent).toBe(
      'Final check of all 6 sources: 5 unchanged, 1 changed (shown on the answer that used it)',
    );
    expect(line.querySelector('.summary__unchanged')?.textContent).toBe('5 unchanged');
    expect(line.querySelector('.summary__changed')?.textContent).toBe('1 changed');
    expect(line.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('leaves out the parts that are zero, and the note when nothing changed', () => {
    const line = build({
      summary: { total: 2, unchanged: 2, changed: 0, unavailable: 0, unchecked: 0 },
    }).querySelector('.end-card__summary');

    expect(line?.textContent).toBe('Final check of all 2 sources: 2 unchanged');
  });

  it('says source, not sources, for one', () => {
    const line = build({
      summary: { total: 1, unchanged: 1, changed: 0, unavailable: 0, unchecked: 0 },
    }).querySelector('.end-card__summary');

    expect(line?.textContent).toBe('Final check of all 1 source: 1 unchanged');
  });

  it('does not call it a final check of all sources when some were never checked', () => {
    const line = build({
      reason: 'idle',
      summary: { total: 4, unchanged: 1, changed: 0, unavailable: 1, unchecked: 2 },
    }).querySelector('.end-card__summary');

    expect(line?.textContent).toBe(
      "Checks on 4 sources: 1 unchanged, 1 couldn't be checked, 2 not checked",
    );
  });

  it('says nothing about checks when the answers cited no sources', () => {
    const card = build({
      summary: { total: 0, unchanged: 0, changed: 0, unavailable: 0, unchecked: 0 },
    });

    expect(card.querySelector('.end-card__summary')).toBeNull();
  });

  it('offers Start a new conversation first, then Copy this conversation', () => {
    const buttons = [...build().querySelectorAll('button')];

    expect(buttons.map((button) => button.textContent)).toEqual([
      'Start a new conversation',
      'Copy this conversation',
    ]);
    expect(buttons.map((button) => button.getAttribute('data-action'))).toEqual([
      'new-conversation',
      'copy-conversation',
    ]);
    expect(buttons[0].classList.contains('button--primary')).toBe(true);
  });

  it('writes the words for every reason the page knows', () => {
    for (const reason of ['budget', 'truncated', 'session-error', 'abort-unconfirmed', 'gone']) {
      expect(build({ reason }).querySelector('h2')?.textContent).toBe(describeEnd(reason, 5).title);
    }
  });

  it('puts no inline style on anything', () => {
    expect(build().querySelectorAll('[style]')).toHaveLength(0);
  });
});
