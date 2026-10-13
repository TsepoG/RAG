// @vitest-environment happy-dom
// @ts-check
import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildSourcesPanel,
  checkBadge,
  describeChips,
  focusSource,
  refreshAges,
  sourceItemId,
  sourceTitleId,
} from '../../../public/js/sourcesPanel.js';
import { chip, FETCHED_AT, makeAnswer } from '../../helpers/page.js';

const MINUTE = 60_000;
const NOW = FETCHED_AT + 5 * MINUTE;

beforeEach(() => {
  document.body.innerHTML = '';
});

/**
 * Builds a source state for a test.
 * @param {Record<string, any>} [changes] - Parts to change.
 * @returns {import('../../../src/server/conversationView.js').SourceState} The state.
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

describe('the ids', () => {
  it('put the answer in the id of a source, so two answers can cite the same key', () => {
    expect(sourceItemId('a1', 'C1')).toBe('source-a1-C1');
    expect(sourceItemId('a2', 'C1')).not.toBe(sourceItemId('a1', 'C1'));
    expect(sourceTitleId('a1', 'C1')).toBe('source-title-a1-C1');
  });
});

describe('buildSourcesPanel', () => {
  it('is collapsed, says how many sources there are, and lists each with its key and link', () => {
    const panel = /** @type {HTMLDetailsElement} */ (buildSourcesPanel(makeAnswer(), NOW, false));
    document.body.append(panel);

    expect(panel.tagName).toBe('DETAILS');
    expect(panel.open).toBe(false);
    expect(panel.querySelector('summary')?.textContent).toBe('Sources (2)');
    const items = [...panel.querySelectorAll('ol > li')];
    expect(items.map(({ id }) => id)).toEqual(['source-a1-C1', 'source-a1-G1']);
    expect(items[0]?.querySelector('.source-key')?.textContent).toBe('[C1]');
    const link = items[0]?.querySelector('a');
    expect(link?.textContent).toBe('Refund Policy v3 — Confluence (PAY)');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('opens when told to', () => {
    const panel = /** @type {HTMLDetailsElement} */ (buildSourcesPanel(makeAnswer(), NOW, true));

    expect(panel.open).toBe(true);
  });

  it('says which turn each source was fetched in', () => {
    const answer = makeAnswer({
      sourceStates: [
        state({ key: 'C1', fetchedInTurn: 1 }),
        state({ key: 'G1', fetchedInTurn: 3 }),
      ],
    });

    const tags = [...(buildSourcesPanel(answer, NOW, false)?.querySelectorAll('li') ?? [])].map(
      (item) => [...item.querySelectorAll('.tag')].map(({ textContent }) => textContent),
    );

    expect(tags[0]).toContain('fetched in turn 1');
    expect(tags[1]).toContain('fetched in turn 3');
  });

  it('tags a stale page, a reading of the model, and the commit of a file', () => {
    const tags = [
      ...(buildSourcesPanel(makeAnswer(), NOW, false)?.querySelectorAll('.tag') ?? []),
    ].map(({ textContent }) => textContent);

    expect(tags).toEqual(
      expect.arrayContaining(['may be out of date', 'my reading', 'commit 9c1e2ab']),
    );
  });

  it('lists what was looked at but not cited, apart from the sources', () => {
    const panel = buildSourcesPanel(makeAnswer(), NOW, false);

    expect(panel?.querySelector('details.consulted summary')?.textContent).toBe(
      'Also consulted (1)',
    );
    expect(panel?.querySelector('details.consulted a')?.textContent).toBe('Returns FAQ');
  });

  it('shows a panel for an answer that only consulted, and none for one with nothing', () => {
    const consultedOnly = makeAnswer({ result: { sources: [] } });
    const nothing = makeAnswer({ result: { sources: [], alsoConsulted: [] } });

    expect(
      buildSourcesPanel(consultedOnly, NOW, false)?.querySelector('summary')?.textContent,
    ).toBe('Sources (0)');
    expect(buildSourcesPanel(nothing, NOW, false)).toBeUndefined();
  });

  it('names the source by its title when it has no friendly label, and does not link an unsafe address', () => {
    const answer = makeAnswer({
      result: {
        sources: [
          { key: 'C1', type: 'confluence', title: 'Plain title', url: 'javascript:alert(1)' },
        ],
        alsoConsulted: [],
      },
      sourceStates: [state()],
    });

    const item = buildSourcesPanel(answer, NOW, false)?.querySelector('li');

    expect(item?.textContent).toContain('Plain title');
    expect(item?.querySelector('a')).toBeNull();
  });

  it('copes with a source the conversation has no state for', () => {
    const answer = makeAnswer({ sourceStates: [] });

    const item = buildSourcesPanel(answer, NOW, false)?.querySelector('li');

    expect(item?.querySelector('.check')).toBeNull();
    expect(item?.textContent).not.toContain('fetched in turn');
  });

  it('shows the latest check beside each source', () => {
    const answer = makeAnswer({
      sourceStates: [
        state({ key: 'C1', check: { status: 'unchanged', checkedAt: NOW - 2 * MINUTE } }),
        state({ key: 'G1', changed: true }),
      ],
    });

    const badges = [
      ...(buildSourcesPanel(answer, NOW, false)?.querySelectorAll('.check') ?? []),
    ].map(({ textContent }) => textContent);

    expect(badges).toEqual(['✓ checked 2 min ago', 'changed since this answer']);
  });
});

describe('checkBadge', () => {
  it('has nothing for a source nobody has checked, or that the conversation does not know', () => {
    expect(checkBadge(state(), NOW)).toBeUndefined();
    expect(checkBadge(undefined, NOW)).toBeUndefined();
  });

  it('says how long ago an unchanged source was checked', () => {
    const badge = checkBadge(
      state({ check: { status: 'unchanged', checkedAt: NOW - MINUTE } }),
      NOW,
    );

    expect(badge?.textContent).toBe('✓ checked 1 min ago');
    expect(badge?.className).toBe('check check-unchanged');
    expect(badge?.getAttribute('data-checked-at')).toBe(String(NOW - MINUTE));
  });

  it('says a source changed, whether a check found it or a later fetch did', () => {
    const byCheck = checkBadge(state({ check: { status: 'changed', checkedAt: NOW } }), NOW);
    const byFetch = checkBadge(
      state({ changed: true, check: { status: 'unchanged', checkedAt: NOW } }),
      NOW,
    );

    for (const badge of [byCheck, byFetch]) {
      expect(badge?.textContent).toBe('changed since this answer');
      expect(badge?.className).toBe('check check-changed');
    }
  });

  it('says a source could not be checked', () => {
    const badge = checkBadge(state({ check: { status: 'unavailable', checkedAt: NOW } }), NOW);

    expect(badge?.textContent).toBe("couldn't check");
    expect(badge?.className).toBe('check check-unavailable');
    expect(badge?.hasAttribute('data-checked-at')).toBe(false);
  });
});

describe('refreshAges', () => {
  it('brings the time up to date without touching anything else', () => {
    const panel = buildSourcesPanel(
      makeAnswer({
        sourceStates: [
          state({ check: { status: 'unchanged', checkedAt: NOW } }),
          state({ key: 'G1' }),
        ],
      }),
      NOW,
      false,
    );
    document.body.append(/** @type {HTMLElement} */ (panel));

    refreshAges(document.body, NOW + 3 * MINUTE);

    expect(document.querySelector('.check')?.textContent).toBe('✓ checked 3 min ago');
  });
});

describe('chips and sources', () => {
  /**
   * An answer card with a chip and a Sources panel.
   * @returns {HTMLElement} The card.
   */
  function card() {
    const answer = makeAnswer();
    const wrapper = document.createElement('div');
    wrapper.className = 'card';
    wrapper.innerHTML = `<p>See ${chip('C1')} and ${chip('C9')}.</p>`;
    wrapper.append(/** @type {HTMLElement} */ (buildSourcesPanel(answer, NOW, false)));
    document.body.append(wrapper);
    return wrapper;
  }

  it('points each chip to the title of its source, and leaves an unknown key alone', () => {
    const wrapper = card();

    describeChips(wrapper, 'a1', new Set(['C1']));

    const [known, unknown] = wrapper.querySelectorAll('button.cite');
    expect(known?.getAttribute('aria-describedby')).toBe('source-title-a1-C1');
    expect(unknown?.hasAttribute('aria-describedby')).toBe(false);
  });

  it('opens the panel, highlights the source and focuses it when its chip is used', () => {
    const wrapper = card();

    expect(focusSource(wrapper, 'a1', 'C1')).toBe(true);

    const panel = /** @type {HTMLDetailsElement} */ (wrapper.querySelector('details.sources'));
    const item = wrapper.querySelector('#source-a1-C1');
    expect(panel.open).toBe(true);
    expect(item?.classList.contains('highlight')).toBe(true);
    expect(document.activeElement).toBe(item);
  });

  it('moves the highlight when another chip is used', () => {
    const wrapper = card();
    focusSource(wrapper, 'a1', 'C1');

    focusSource(wrapper, 'a1', 'G1');

    expect(wrapper.querySelectorAll('.highlight')).toHaveLength(1);
    expect(wrapper.querySelector('#source-a1-G1')?.classList.contains('highlight')).toBe(true);
  });

  it('says so, and changes nothing, for a key the card does not list', () => {
    const wrapper = card();

    expect(focusSource(wrapper, 'a1', 'C9')).toBe(false);
    expect(/** @type {HTMLDetailsElement} */ (wrapper.querySelector('details.sources')).open).toBe(
      false,
    );
  });

  it('says so for a card with no Sources panel', () => {
    const wrapper = document.createElement('div');

    expect(focusSource(wrapper, 'a1', 'C1')).toBe(false);
  });

  it('cannot be tricked into selecting something else by an odd key', () => {
    const wrapper = card();

    expect(focusSource(wrapper, 'a1', '"] , body')).toBe(false);
  });
});
