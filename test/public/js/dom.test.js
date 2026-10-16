// @vitest-environment happy-dom
// @ts-check
import { describe, expect, it } from 'vitest';
import { el, externalLink, safeHref, setVisible } from '../../../public/js/dom.js';

describe('el', () => {
  it('makes an element with a class, text and attributes', () => {
    const element = el('a', { className: 'x', text: 'hi', attributes: { href: '/a' } });

    expect(element.outerHTML).toBe('<a class="x" href="/a">hi</a>');
  });

  it('sets text as text, never as HTML', () => {
    const element = el('p', { text: '<img src=x onerror=alert(1)>' });

    expect(element.children).toHaveLength(0);
    expect(element.textContent).toBe('<img src=x onerror=alert(1)>');
  });

  it('puts children inside, strings as text', () => {
    const element = el('p', {}, [el('b', { text: 'a' }), ' and <b>b</b>']);

    expect(element.innerHTML).toBe('<b>a</b> and &lt;b&gt;b&lt;/b&gt;');
  });

  it('needs no options', () => {
    expect(el('div').outerHTML).toBe('<div></div>');
  });
});

describe('safeHref', () => {
  it('keeps an https link', () => {
    expect(safeHref('https://acme.atlassian.net/wiki/spaces/PAY')).toBe(
      'https://acme.atlassian.net/wiki/spaces/PAY',
    );
  });

  it.each([
    'http://acme.example/page',
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:x',
    '//evil.example/x',
    '/relative/path',
    'not a url',
    '',
    undefined,
  ])('refuses %s', (url) => {
    expect(safeHref(url)).toBeUndefined();
  });
});

describe('externalLink', () => {
  it('opens in a new tab and sends no opener or referrer', () => {
    const link = externalLink('Page', 'https://github.com/acme/app');

    expect(link.tagName).toBe('A');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.getAttribute('href')).toBe('https://github.com/acme/app');
    expect(link.textContent).toBe('Page');
  });

  it('is plain text when the link is not safe', () => {
    const link = externalLink('Page', 'javascript:alert(1)');

    expect(link.tagName).toBe('SPAN');
    expect(link.hasAttribute('href')).toBe(false);
    expect(link.textContent).toBe('Page');
  });
});

describe('setVisible', () => {
  it('shows and hides', () => {
    const element = el('div');

    setVisible(element, false);
    expect(element.hidden).toBe(true);
    setVisible(element, true);
    expect(element.hidden).toBe(false);
  });
});
