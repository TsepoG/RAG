// @vitest-environment happy-dom
// @ts-check
import { describe, expect, it } from 'vitest';
import { SECTION_TITLES } from '../../../src/honesty/index.js';
import { findRefs } from '../../../public/js/refs.js';
import { loadPage, PAGE_HTML } from '../../helpers/page.js';

/**
 * The page parsed without being loaded, so its stylesheet and script are not fetched.
 * @returns {DocumentFragment} The page's elements.
 */
function inertPage() {
  const template = document.createElement('template');
  template.innerHTML = PAGE_HTML;
  return template.content;
}

describe('public/index.html', () => {
  it('has every element the page code draws into', () => {
    expect(() => loadPage()).not.toThrow();
  });

  it('has no id twice', () => {
    loadPage();
    const ids = [...document.querySelectorAll('[id]')].map(({ id }) => id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has no inline script, style or event handler, which the content security policy would block', () => {
    const page = inertPage();

    expect(page.querySelectorAll('script:not([src])')).toHaveLength(0);
    expect(page.querySelectorAll('style')).toHaveLength(0);
    expect(page.querySelectorAll('[style]')).toHaveLength(0);
    const handlers = [...page.querySelectorAll('*')].flatMap((element) =>
      element.getAttributeNames().filter((name) => name.startsWith('on')),
    );
    expect(handlers).toEqual([]);
  });

  it('loads its script and styles from this server only', () => {
    const page = inertPage();
    const urls = [...page.querySelectorAll('script[src], link[href]')].map(
      (element) => element.getAttribute('src') ?? element.getAttribute('href') ?? '',
    );

    expect(urls.length).toBeGreaterThan(0);
    expect(urls.every((url) => url.startsWith('/'))).toBe(true);
  });

  it('gives every field a label', () => {
    loadPage();
    const fields = [...document.querySelectorAll('select, textarea')];

    expect(fields.length).toBeGreaterThan(0);
    const unlabelled = fields
      .filter(({ id }) => document.querySelector(`label[for="${id}"]`) === null)
      .map(({ id }) => id);
    expect(unlabelled).toEqual([]);
  });

  it('uses the same section headings as the terminal output', () => {
    const refs = loadPage();
    const heading = (/** @type {HTMLElement} */ section) =>
      section.querySelector('h3')?.textContent;

    expect(heading(refs.gaps)).toBe(SECTION_TITLES.gaps);
    expect(heading(refs.closest)).toBe(SECTION_TITLES.closestPages);
    expect(heading(refs.who)).toBe(SECTION_TITLES.whoToAsk);
  });

  it('starts with the result and every follow-up part hidden', () => {
    const refs = loadPage();

    for (const part of [refs.result, refs.stop, refs.error, refs.banner, refs.sources, refs.who]) {
      expect(part.hidden).toBe(true);
    }
  });

  it('declares its language and a viewport', () => {
    expect(PAGE_HTML).toContain('<html lang="en">');
    expect(PAGE_HTML).toContain('name="viewport"');
  });
});

describe('findRefs', () => {
  it('names the element that is missing', () => {
    document.body.innerHTML = '<p>nothing here</p>';

    expect(() => findRefs()).toThrow('The page has no element with the id "ask-form".');
  });
});
