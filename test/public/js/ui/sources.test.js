// @vitest-environment happy-dom
// @ts-check
import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildSourcesSection,
  checkBadge,
  describeChips,
  focusSource,
  refreshAges,
  setSourcesOpen,
  sourceItemId,
  sourceTitleId,
} from '../../../../public/js/ui/sources.js';
import { chip, FETCHED_AT, makeAnswer } from '../../../helpers/page.js';

const MINUTE = 60_000;
const NOW = FETCHED_AT + 5 * MINUTE;

beforeEach(() => {
  document.body.innerHTML = '';
});

/**
 * Builds a source state for a test.
 * @param {Record<string, any>} [changes] - Parts to change.
 * @returns {import('../../../../src/server/conversationView.js').SourceState} The state.
 */
function state(changes = {}) {
  return {
    key: 'C1',
    fetchedInTurn: 1,
    fetchedAt: FETCHED_AT,
    changed: false,
    check: null,
    ...changes,
  };
}

/**
 * Builds the sources section of an answer.
 * @param {Record<string, any>} [changes] - Parts of the answer to change.
 * @param {{ open?: boolean, checking?: boolean }} [options] - Whether it is open, and whether a check is running.
 * @returns {HTMLElement} The section, in the document.
 */
function build(changes = {}, { open = false, checking = false } = {}) {
  const section = /** @type {HTMLElement} */ (
    buildSourcesSection(makeAnswer(changes), { now: NOW, open, checking })
  );
  document.body.append(section);
  return section;
}

/**
 * The checks of the two default sources.
 * @param {Record<string, any>} first - Changes to the state of C1.
 * @param {Record<string, any>} [second] - Changes to the state of G1.
 * @returns {Record<string, any>} The answer parts to pass to `build`.
 */
function states(first, second = {}) {
  return { sourceStates: [state(first), state({ key: 'G1', ...second })] };
}

describe('the ids', () => {
  it('put the answer in the id of a source, so two answers can cite the same key', () => {
    expect(sourceItemId('a1', 'C1')).toBe('source-a1-C1');
    expect(sourceItemId('a2', 'C1')).not.toBe(sourceItemId('a1', 'C1'));
    expect(sourceTitleId('a1', 'C1')).toBe('source-title-a1-C1');
  });
});

describe('buildSourcesSection', () => {
  it('is left out when the answer cites nothing, even if it looked at pages', () => {
    const answer = makeAnswer({ result: { sources: [] } });

    expect(buildSourcesSection(answer, { now: NOW, open: false, checking: false })).toBeUndefined();
  });

  it('has a toggle that says how many sources there are, closed by default', () => {
    const section = build();

    const toggle = /** @type {HTMLElement} */ (section.querySelector('.sources__toggle'));
    expect(toggle.tagName).toBe('BUTTON');
    expect(toggle.textContent).toBe('Sources (2) ▾');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('data-action')).toBe('sources');
    expect(toggle.getAttribute('data-answer-id')).toBe('a1');
    expect(toggle.getAttribute('aria-controls')).toBe(section.querySelector('ul')?.id);
    expect(/** @type {HTMLElement} */ (section.querySelector('ul')).hidden).toBe(true);
  });

  it('shows the list, the up arrow and the Re-check button when it is open', () => {
    const section = build({}, { open: true });

    const toggle = /** @type {HTMLElement} */ (section.querySelector('.sources__toggle'));
    expect(toggle.textContent).toBe('Sources (2) ▴');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(/** @type {HTMLElement} */ (section.querySelector('ul')).hidden).toBe(false);
    expect(/** @type {HTMLElement} */ (section.querySelector('.sources__recheck')).hidden).toBe(
      false,
    );
  });

  it('hides the Re-check button while it is closed', () => {
    const section = build();

    expect(/** @type {HTMLElement} */ (section.querySelector('.sources__recheck')).hidden).toBe(
      true,
    );
  });

  it('lists each cited source, then each page that was only looked at', () => {
    const section = build();

    const rows = [...section.querySelectorAll('li.source-row')];
    expect(rows.map((row) => row.id)).toEqual(['source-a1-C1', 'source-a1-G1', '']);
    expect(rows.map((row) => row.querySelector('.source-row__title')?.textContent)).toEqual([
      'Refund Policy',
      'src/refund.js',
      'Returns FAQ',
    ]);
  });

  it('gives a Confluence key a Confluence chip and a GitHub key a GitHub chip', () => {
    const section = build();

    const chips = [...section.querySelectorAll('.chip')];
    expect(chips.map(({ textContent }) => textContent)).toEqual(['C1', 'G1']);
    expect(chips[0].className).toBe('chip chip--confluence');
    expect(chips[1].className).toBe('chip chip--github');
  });

  it('shows a file path in the code font and a page title in the usual font', () => {
    const section = build();

    const [page, file] = [...section.querySelectorAll('.source-row__title')];
    expect(page.classList.contains('source-row__title--mono')).toBe(false);
    expect(file.classList.contains('source-row__title--mono')).toBe(true);
  });

  it('says where each source is from, the turn it was fetched in and what to weigh', () => {
    const section = build();

    const metas = [...section.querySelectorAll('.source-row__meta')].map((m) => m.textContent);
    expect(metas).toEqual([
      'Confluence · fetched in turn 1 · may be out of date',
      'GitHub · fetched in turn 1 · my reading · commit 9c1e2ab',
      'Confluence · also consulted',
    ]);
  });

  it('says only where a source is from when nothing more is known about it', () => {
    const answer = {
      result: {
        sources: [{ key: 'G1', type: 'github', kind: 'directory', title: 'src/', url: '' }],
        alsoConsulted: [],
      },
      sourceStates: [],
    };

    const section = build(answer);

    expect(section.querySelector('.source-row__meta')?.textContent).toBe('GitHub');
  });

  it('makes the whole row the link to the source, opening in a new tab', () => {
    const section = build();

    const link = /** @type {HTMLAnchorElement} */ (section.querySelector('li a.source-row__link'));
    expect(link.getAttribute('href')).toBe('https://acme.atlassian.net/wiki/spaces/PAY/pages/1');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.querySelector('.chip')?.textContent).toBe('C1');
  });

  it('shows a source with no safe link as text, not a link', () => {
    const answer = {
      result: {
        sources: [{ key: 'C1', type: 'confluence', title: 'Page', url: 'javascript:alert(1)' }],
        alsoConsulted: [],
      },
    };

    const section = build(answer);

    expect(section.querySelector('a')).toBeNull();
    expect(section.querySelector('div.source-row__link')?.textContent).toContain('Page');
  });

  it('puts the title of a source where its chips point, and makes each row focusable by code', () => {
    const section = build();

    const row = /** @type {HTMLElement} */ (section.querySelector('#source-a1-C1'));
    expect(row.getAttribute('tabindex')).toBe('-1');
    expect(row.querySelector('#source-title-a1-C1')?.textContent).toBe('Refund Policy');
  });

  it('shows a page that was only looked at without a chip, a status or an id', () => {
    const section = build();

    const row = /** @type {HTMLElement} */ (section.querySelectorAll('li.source-row')[2]);
    expect(row.querySelector('.chip')).toBeNull();
    expect(row.querySelector('.source-status')).toBeNull();
    expect(row.id).toBe('');
  });

  it.each([
    [{ key: 'C7', title: 'x', url: 'https://x.example/' }, 'Confluence · also consulted'],
    [{ key: 'G7', title: 'x', url: 'https://x.example/' }, 'GitHub · also consulted'],
    [{ title: 'x', url: 'https://github.com/acme/app' }, 'GitHub · also consulted'],
    [{ title: 'x', url: 'https://acme.atlassian.net/wiki/1' }, 'Confluence · also consulted'],
    [{ title: 'x', url: 'https://elsewhere.example/' }, 'Source · also consulted'],
    [{ title: 'x', url: 'not a link' }, 'Source · also consulted'],
  ])('says what kind of page %j is by its key or its address', (item, expected) => {
    const section = build({ result: { alsoConsulted: [item] } });

    const rows = [...section.querySelectorAll('li.source-row')];
    expect(rows.at(-1)?.querySelector('.source-row__meta')?.textContent).toBe(expected);
  });
});

describe('what the check found, on each row', () => {
  it('says when a source was checked, counted from the time now', () => {
    const section = build(
      states({ check: { status: 'unchanged', checkedAt: NOW - MINUTE } }, { check: null }),
    );

    const status = /** @type {HTMLElement} */ (section.querySelector('.source-status'));
    expect(status.textContent).toBe('✓ checked 1 min ago');
    expect(status.className).toBe('source-status source-status--checked');
    expect(status.getAttribute('data-checked-at')).toBe(String(NOW - MINUTE));
  });

  it('says a source changed, and draws its row as changed', () => {
    const section = build(states({}, { changed: true }));

    const row = /** @type {HTMLElement} */ (section.querySelector('#source-a1-G1'));
    expect(row.classList.contains('source-row--changed')).toBe(true);
    expect(row.querySelector('.source-status')?.textContent).toBe('Changed since this answer');
  });

  it('says a source changed when the latest check found it so, even if it was not marked', () => {
    const section = build(states({ check: { status: 'changed', checkedAt: NOW } }));

    expect(section.querySelector('#source-a1-C1 .source-status')?.textContent).toBe(
      'Changed since this answer',
    );
  });

  it('says a check could not be done, and never that the source changed', () => {
    const section = build(states({ check: { status: 'unavailable', checkedAt: NOW } }));

    const status = section.querySelector('#source-a1-C1 .source-status');
    expect(status?.textContent).toBe("Couldn't check");
    expect(status?.className).toContain('source-status--unavailable');
    expect(section.querySelector('.source-row--changed')).toBeNull();
  });

  it('shows no status before any check', () => {
    const section = build();

    expect(section.querySelector('.source-status')).toBeNull();
  });

  it('shows no status for a source the conversation knows nothing about', () => {
    const section = build({ sourceStates: [] });

    expect(section.querySelector('.source-status')).toBeNull();
  });
});

describe('checkBadge', () => {
  it('is nothing for an unknown source or one never checked', () => {
    expect(checkBadge(undefined, NOW)).toBeUndefined();
    expect(checkBadge(state(), NOW)).toBeUndefined();
  });

  it('counts the minutes from the time it is given', () => {
    const badge = checkBadge(
      state({ check: { status: 'unchanged', checkedAt: NOW } }),
      NOW + 3 * MINUTE,
    );

    expect(badge?.textContent).toBe('✓ checked 3 min ago');
  });
});

describe('the summary while the sources are closed', () => {
  it('counts the sources that changed', () => {
    const section = build(states({ changed: true }, { changed: true }));

    const summary = section.querySelector('.sources__summary');
    expect(summary?.textContent).toBe('2 changed');
    expect(summary?.className).toContain('sources__summary--changed');
  });

  it('says when the sources were last checked, by the oldest check', () => {
    const section = build(
      states(
        { check: { status: 'unchanged', checkedAt: NOW - 4 * MINUTE } },
        { check: { status: 'unchanged', checkedAt: NOW - MINUTE } },
      ),
    );

    const summary = section.querySelector('.sources__summary');
    expect(summary?.textContent).toBe('✓ checked 4 min ago');
    expect(summary?.getAttribute('data-checked-at')).toBe(String(NOW - 4 * MINUTE));
  });

  it('says a check could not be done when that is all there is', () => {
    const section = build(states({ check: { status: 'unavailable', checkedAt: NOW } }));

    expect(section.querySelector('.sources__summary')?.textContent).toBe("Couldn't check");
  });

  it('counts only the sources that were checked when others could not be', () => {
    const section = build(
      states(
        { check: { status: 'unavailable', checkedAt: NOW } },
        { check: { status: 'unchanged', checkedAt: NOW - MINUTE } },
      ),
    );

    expect(section.querySelector('.sources__summary')?.textContent).toBe('✓ checked 1 min ago');
  });

  it('is left out before any check', () => {
    expect(build().querySelector('.sources__summary')).toBeNull();
  });

  it('is hidden while the list is open', () => {
    const section = build(states({ changed: true }), { open: true });

    expect(/** @type {HTMLElement} */ (section.querySelector('.sources__summary')).hidden).toBe(
      true,
    );
  });
});

describe('the Re-check button', () => {
  it('asks for a check of this answer', () => {
    const button = build().querySelector('.sources__recheck');

    expect(button?.textContent).toBe('Re-check sources');
    expect(button?.getAttribute('data-action')).toBe('recheck');
    expect(button?.getAttribute('data-answer-id')).toBe('a1');
    expect(button?.getAttribute('aria-disabled')).toBeNull();
  });

  it('says it is checking and stays focusable while a check runs', () => {
    const button = /** @type {HTMLButtonElement} */ (
      build({}, { open: true, checking: true }).querySelector('.sources__recheck')
    );

    expect(button.textContent).toBe('Checking…');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.disabled).toBe(false);
  });
});

describe('setSourcesOpen', () => {
  it('opens and closes the list, the arrow, the summary and the Re-check button together', () => {
    const section = build(states({ changed: true }));

    setSourcesOpen(section, true);
    expect(section.querySelector('.sources__toggle')?.getAttribute('aria-expanded')).toBe('true');
    expect(section.querySelector('.sources__arrow')?.textContent).toBe(' ▴');
    expect(/** @type {HTMLElement} */ (section.querySelector('ul')).hidden).toBe(false);

    setSourcesOpen(section, false);
    expect(section.querySelector('.sources__toggle')?.getAttribute('aria-expanded')).toBe('false');
    expect(section.querySelector('.sources__arrow')?.textContent).toBe(' ▾');
    expect(/** @type {HTMLElement} */ (section.querySelector('ul')).hidden).toBe(true);
    expect(/** @type {HTMLElement} */ (section.querySelector('.sources__summary')).hidden).toBe(
      false,
    );
    expect(/** @type {HTMLElement} */ (section.querySelector('.sources__recheck')).hidden).toBe(
      true,
    );
  });
});

describe('describeChips', () => {
  it('points each chip at the title of its source, and leaves chips for unknown keys alone', () => {
    const root = document.createElement('div');
    root.innerHTML = `${chip('C1')} ${chip('C9')}`;

    describeChips(root, 'a1', new Set(['C1']));

    const [known, unknown] = [...root.querySelectorAll('button.cite')];
    expect(known.getAttribute('aria-describedby')).toBe('source-title-a1-C1');
    expect(unknown.hasAttribute('aria-describedby')).toBe(false);
  });
});

describe('focusSource', () => {
  it('opens the sources, highlights the row and moves focus to it', () => {
    const section = build();
    const card = section.parentElement ?? document.body;

    const found = focusSource(card, 'a1', 'G1');

    const row = /** @type {HTMLElement} */ (section.querySelector('#source-a1-G1'));
    expect(found).toBe(true);
    expect(document.activeElement).toBe(row);
    expect(row.classList.contains('source-row--highlight')).toBe(true);
    expect(section.querySelector('.sources__toggle')?.getAttribute('aria-expanded')).toBe('true');
    expect(/** @type {HTMLElement} */ (section.querySelector('ul')).hidden).toBe(false);
  });

  it('moves the highlight when another chip is used', () => {
    const section = build();
    const card = section.parentElement ?? document.body;

    focusSource(card, 'a1', 'C1');
    focusSource(card, 'a1', 'G1');

    expect(section.querySelectorAll('.source-row--highlight')).toHaveLength(1);
    expect(
      section.querySelector('#source-a1-G1')?.classList.contains('source-row--highlight'),
    ).toBe(true);
  });

  it('says so, and changes nothing, when the source is not there', () => {
    const section = build();
    const card = section.parentElement ?? document.body;

    expect(focusSource(card, 'a1', 'C9')).toBe(false);
    expect(section.querySelector('.sources__toggle')?.getAttribute('aria-expanded')).toBe('false');
  });

  it('does not take a key as part of a selector', () => {
    const section = build();
    const card = section.parentElement ?? document.body;

    expect(focusSource(card, 'a1', 'C1"], body, ["x')).toBe(false);
  });
});

describe('refreshAges', () => {
  it('brings each checked text up to date, in the rows and the summary', () => {
    const section = build(states({ check: { status: 'unchanged', checkedAt: NOW - MINUTE } }));

    refreshAges(section, NOW + 9 * MINUTE);

    expect(
      [...section.querySelectorAll('[data-checked-at]')].map(({ textContent }) => textContent),
    ).toEqual(['✓ checked 10 min ago', '✓ checked 10 min ago']);
  });
});
