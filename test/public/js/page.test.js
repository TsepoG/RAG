// @vitest-environment happy-dom
// @ts-check
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findRefs } from '../../../public/js/refs.js';
import { loadPage, PAGE_HTML } from '../../helpers/page.js';

/**
 * The page parsed without being loaded, so its stylesheets and script are not fetched.
 * @returns {DocumentFragment} The page's elements.
 */
function inertPage() {
  const template = document.createElement('template');
  template.innerHTML = PAGE_HTML;
  return template.content;
}

describe('public/index.html', () => {
  it('has every place the page code draws into', () => {
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

  it('loads its script and styles from this server only, tokens and base styles first', () => {
    const page = inertPage();
    const urls = [...page.querySelectorAll('script[src], link[href]')].map(
      (element) => element.getAttribute('src') ?? element.getAttribute('href') ?? '',
    );

    expect(urls.every((url) => url.startsWith('/'))).toBe(true);
    expect(urls).toEqual([
      '/css/tokens.css',
      '/css/base.css',
      '/css/layout.css',
      '/css/components.css',
      '/js/main.js',
    ]);
  });

  it('has a heading for the page, hidden from the eye, so every screen has one', () => {
    const heading = inertPage().querySelector('main h1');

    expect(heading?.textContent).toBe('Knowledge Assistant');
    expect(heading?.classList.contains('visually-hidden')).toBe(true);
  });

  it('has a sidebar, a main area and a place for the phone bar, the drawer cover and the box', () => {
    const refs = loadPage();

    expect(refs.sidebar.getAttribute('role')).toBe('complementary');
    expect(refs.sidebar.getAttribute('aria-label')).toBe('Conversation settings');
    expect(document.querySelector('main')?.contains(refs.messages)).toBe(true);
    expect(document.querySelector('main')?.contains(refs.sidebar)).toBe(false);
    expect(refs.mobileBar.tagName).toBe('DIV');
    expect(refs.composer.classList.contains('composer-slot')).toBe(true);
  });

  it('starts with the notice and the drawer cover hidden, and nothing drawn yet', () => {
    const refs = loadPage();

    expect(refs.notice.hidden).toBe(true);
    expect(refs.backdrop.hidden).toBe(true);
    expect(refs.messages.children).toHaveLength(0);
    expect(refs.sidebar.children).toHaveLength(0);
  });

  it('announces each new answer politely, and lists the conversation as a list', () => {
    const refs = loadPage();

    expect(refs.live.tagName).toBe('OUTPUT');
    expect(refs.live.getAttribute('aria-live')).toBe('polite');
    expect(refs.messages.tagName).toBe('OL');
    expect(refs.messages.getAttribute('aria-label')).toBe('Conversation');
  });

  it('puts the question box after the conversation, so it can sit at the bottom of the page', () => {
    const refs = loadPage();

    expect(
      refs.messages.compareDocumentPosition(refs.composer) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      refs.messages.compareDocumentPosition(refs.end) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
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
  it('names the place that is missing', () => {
    document.body.innerHTML = '<p>nothing here</p>';

    expect(() => findRefs()).toThrow('The page has no element with the id "mobile-bar".');
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

  it('points to the question box, and sits in a navigation landmark', () => {
    loadPage();

    expect(document.querySelector('a.skip')?.getAttribute('href')).toBe('#question');
    expect(document.querySelector('nav.skip-nav a.skip')).not.toBeNull();
  });

  it('can take the focus, and nothing in the page takes it back on load', () => {
    loadPage();
    const link = /** @type {HTMLElement} */ (document.querySelector('a.skip'));

    link.focus();

    expect(document.activeElement).toBe(link);
  });

  describe('in the stylesheet', () => {
    const css = readFileSync(resolve('public/css/layout.css'), 'utf8');
    const tokens = readFileSync(resolve('public/css/tokens.css'), 'utf8');
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

      expect(rule).toContain('background: var(--color-skip-bg)');
      expect(rule).toContain('color: var(--color-skip-text)');
      expect(rule).toContain('border: 3px solid var(--color-skip-text)');
      expect(tokens).toContain('--color-skip-bg: #ffd400;');
      expect(tokens).toContain('--color-skip-text: #000000;');
    });
  });
});
