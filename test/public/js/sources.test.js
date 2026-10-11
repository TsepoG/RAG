// @vitest-environment happy-dom
// @ts-check
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { describeChips, focusSource, renderSources } from '../../../public/js/sources.js';
import { chip, loadPage, makePayload } from '../../helpers/page.js';

/** @type {import('../../../public/js/refs.js').PageRefs} */
let refs;

beforeEach(() => {
  refs = loadPage();
});

describe('renderSources', () => {
  it('lists each cited source with its key and a link that opens safely', () => {
    renderSources(refs, makePayload().result);

    const items = refs.sourcesList.querySelectorAll('li');
    const link = items[0].querySelector('a');
    expect(items).toHaveLength(2);
    expect(items[0].id).toBe('source-C1');
    expect(items[0].textContent).toContain('[C1]');
    expect(link?.textContent).toBe('Refund Policy v3 — Confluence (PAY)');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(refs.sources.hidden).toBe(false);
  });

  it('marks a stale page and a source that is the assistant’s own reading', () => {
    renderSources(refs, makePayload().result);

    const [page, file] = refs.sourcesList.querySelectorAll('li');
    expect(page.textContent).toContain('may be out of date');
    expect(page.textContent).not.toContain('my reading');
    expect(file.textContent).toContain('my reading');
    expect(file.textContent).not.toContain('out of date');
  });

  it('shows the commit a file is pinned to, in short form', () => {
    renderSources(refs, makePayload().result);

    expect(refs.sourcesList.querySelectorAll('li')[1].textContent).toContain('commit 9c1e2ab');
    expect(refs.sourcesList.querySelectorAll('li')[1].textContent).not.toContain('9c1e2ab4');
  });

  it('shows no commit for a folder or a commit source', () => {
    const result = makePayload().result;
    result.sources = [
      /** @type {any} */ ({ ...result.sources[1], kind: 'directory', inferred: false }),
    ];

    renderSources(refs, result);

    expect(refs.sourcesList.textContent).not.toContain('commit ');
  });

  it('shows a source with a link that is not https as text only', () => {
    const result = makePayload().result;
    result.sources = [{ ...result.sources[0], url: 'javascript:alert(1)' }];

    renderSources(refs, result);

    expect(refs.sourcesList.querySelector('a')).toBeNull();
    expect(refs.sourcesList.textContent).toContain('Refund Policy v3');
  });

  it('writes a title that holds HTML as text', () => {
    const result = makePayload().result;
    result.sources = [{ ...result.sources[0], friendlyLabel: '<img src=x onerror=alert(1)>' }];

    renderSources(refs, result);

    expect(refs.sourcesList.querySelector('img')).toBeNull();
  });

  it('falls back to the title when there is no friendly label', () => {
    const result = makePayload().result;
    const plain = { ...result.sources[0] };
    Reflect.deleteProperty(plain, 'friendlyLabel');
    result.sources = [plain];

    renderSources(refs, result);

    expect(refs.sourcesList.querySelector('a')?.textContent).toBe('Refund Policy');
  });

  it('lists what was also consulted, with a count', () => {
    renderSources(refs, makePayload().result);

    expect(refs.consulted.hidden).toBe(false);
    expect(refs.consultedSummary.textContent).toBe('Also consulted (1)');
    expect(refs.consultedList.querySelector('a')?.textContent).toBe('Returns FAQ');
  });

  it('hides the also-consulted list when there is nothing in it', () => {
    const result = makePayload().result;
    result.alsoConsulted = [];

    renderSources(refs, result);

    expect(refs.consulted.hidden).toBe(true);
    expect(refs.sources.hidden).toBe(false);
  });

  it('hides the whole panel when there is nothing to show', () => {
    const result = makePayload().result;
    result.sources = [];
    result.alsoConsulted = [];

    renderSources(refs, result);

    expect(refs.sources.hidden).toBe(true);
  });

  it('shows only the consulted list when nothing was cited', () => {
    const result = makePayload().result;
    result.sources = [];

    renderSources(refs, result);

    expect(refs.sources.hidden).toBe(false);
    expect(refs.sourcesList.children).toHaveLength(0);
  });

  it('replaces what was there before', () => {
    renderSources(refs, makePayload().result);
    renderSources(refs, makePayload().result);

    expect(refs.sourcesList.children).toHaveLength(2);
    expect(refs.consultedList.children).toHaveLength(1);
  });
});

describe('describeChips', () => {
  it('points each chip at the title of its source', () => {
    refs.answer.innerHTML = `<p>${chip('C1')}${chip('G1', true)}</p>`;

    describeChips(refs.answer, new Set(['C1', 'G1']));

    const [first, second] = refs.answer.querySelectorAll('button.cite');
    expect(first.getAttribute('aria-describedby')).toBe('source-title-C1');
    expect(second.getAttribute('aria-describedby')).toBe('source-title-G1');
  });

  it('leaves a chip with no source in the panel alone', () => {
    refs.answer.innerHTML = chip('C9');

    describeChips(refs.answer, new Set(['C1']));

    expect(refs.answer.querySelector('button')?.hasAttribute('aria-describedby')).toBe(false);
  });

  it('leaves a chip with no key alone', () => {
    refs.answer.innerHTML = '<button type="button" class="cite">?</button>';

    describeChips(refs.answer, new Set(['C1']));

    expect(refs.answer.querySelector('button')?.hasAttribute('aria-describedby')).toBe(false);
  });

  it('points to a title that exists once the panel is drawn', () => {
    renderSources(refs, makePayload().result);
    refs.answer.innerHTML = chip('C1');

    describeChips(refs.answer, new Set(['C1']));

    const target = refs.answer.querySelector('button')?.getAttribute('aria-describedby') ?? '';
    expect(document.getElementById(target)?.textContent).toContain('Refund Policy');
  });
});

describe('focusSource', () => {
  it('scrolls to the source, highlights it and moves focus to it', () => {
    renderSources(refs, makePayload().result);
    const item = /** @type {HTMLElement} */ (refs.sourcesList.querySelector('#source-G1'));
    item.scrollIntoView = vi.fn();

    expect(focusSource(refs.sourcesList, 'G1')).toBe(true);

    expect(item.classList.contains('highlight')).toBe(true);
    expect(item.scrollIntoView).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(item);
  });

  it('moves the highlight when another chip is used', () => {
    renderSources(refs, makePayload().result);
    for (const item of refs.sourcesList.querySelectorAll('li')) {
      /** @type {HTMLElement} */ (item).scrollIntoView = vi.fn();
    }

    focusSource(refs.sourcesList, 'C1');
    focusSource(refs.sourcesList, 'G1');

    expect(refs.sourcesList.querySelectorAll('.highlight')).toHaveLength(1);
    expect(refs.sourcesList.querySelector('#source-G1')?.classList.contains('highlight')).toBe(
      true,
    );
  });

  it('says so, and clears the highlight, when the source is not there', () => {
    renderSources(refs, makePayload().result);
    for (const item of refs.sourcesList.querySelectorAll('li')) {
      /** @type {HTMLElement} */ (item).scrollIntoView = vi.fn();
    }
    focusSource(refs.sourcesList, 'C1');

    expect(focusSource(refs.sourcesList, 'C9')).toBe(false);
    expect(refs.sourcesList.querySelectorAll('.highlight')).toHaveLength(0);
  });

  it('copes with a key that is not a valid selector', () => {
    expect(focusSource(refs.sourcesList, '1 > x')).toBe(false);
  });
});
