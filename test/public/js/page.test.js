// @vitest-environment happy-dom
// @ts-check
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

  it('can take focus on the banner, so focus can move there when an answer arrives', () => {
    expect(loadPage().banner.getAttribute('tabindex')).toBe('-1');
  });

  it('tells a visitor without JavaScript that it is needed', () => {
    expect(inertPage().querySelector('noscript')?.textContent).toContain('needs JavaScript');
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

describe('the skip link', () => {
  const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';

  it('is the first thing the Tab key reaches', () => {
    loadPage();

    const [first] = [...document.querySelectorAll(FOCUSABLE)].filter(
      (element) => !element.hasAttribute('disabled') && !element.closest('[hidden]'),
    );

    expect(first.classList.contains('skip')).toBe(true);
  });

  it('points to the question box, which exists and can take the focus', () => {
    loadPage();
    const link = document.querySelector('a.skip');
    const target = document.querySelector(link?.getAttribute('href') ?? '#nothing');

    expect(link?.getAttribute('href')).toBe('#question');
    expect(target?.tagName).toBe('TEXTAREA');
  });

  it('can take the focus, and nothing in the page takes it back on load', () => {
    loadPage();
    const link = /** @type {HTMLElement} */ (document.querySelector('a.skip'));

    link.focus();

    expect(document.activeElement).toBe(link);
  });

  it('sits in a navigation landmark, so it is found by screen reader users too', () => {
    loadPage();

    expect(document.querySelector('nav.skip-nav a.skip')).not.toBeNull();
  });

  describe('in the stylesheet', () => {
    const css = readFileSync(resolve('public/css/app.css'), 'utf8');
    const ruleFor = (/** @type {string} */ selector) => {
      const start = css.indexOf(`${selector} {`);
      return start === -1 ? '' : css.slice(start, css.indexOf('}', start));
    };

    it('is always visible: nothing hides it, moves it off screen or clips it', () => {
      const rule = ruleFor('.skip');

      expect(rule).not.toBe('');
      const found = [
        'display: none',
        'visibility: hidden',
        '-9999px',
        'clip',
        'opacity: 0',
        'translate',
      ].filter((hiding) => rule.includes(hiding));

      expect(found).toEqual([]);
    });

    it('is not hidden by a rule for when it does not have focus', () => {
      expect(css).not.toContain('.skip:not(:focus)');
    });

    it('turns bright yellow with black text and a border when it has focus', () => {
      const rule = ruleFor('.skip:focus');

      expect(rule).toContain('background: #ffd400');
      expect(rule).toContain('color: #000000');
      expect(rule).toContain('border: 3px solid #000000');
    });
  });
});
