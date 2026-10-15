// @ts-check
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (/** @type {string} */ path) => readFileSync(resolve(path), 'utf8');

const tokens = read('public/css/tokens.css');
const base = read('public/css/base.css');

describe('design tokens', () => {
  it.each([
    ['--color-page', '#f4f6fa'],
    ['--color-ink', '#0f1729'],
    ['--color-body', '#3b4556'],
    ['--color-muted', '#556070'],
    ['--color-accent', '#2446f5'],
    ['--color-accent-strong', '#1530c4'],
    ['--color-high-text', '#0e5e46'],
    ['--color-medium-text', '#8a3d00'],
    ['--color-low-text', '#9b1c1c'],
    ['--color-neutral-text', '#2b3444'],
  ])('defines %s as %s, as the design specifies', (name, value) => {
    expect(tokens).toContain(`${name}: ${value};`);
  });

  it('has no lighter grey for text than muted: the mockups grey that fails contrast is absent', () => {
    expect(tokens.toLowerCase()).not.toContain('#8a93a3');
    expect(base.toLowerCase()).not.toContain('#8a93a3');
  });
});

describe('base styles and fonts', () => {
  const urls = [...base.matchAll(/url\('([^']+)'\)/g)].map(([, url]) => url);

  it('declares Geist at four weights and Geist Mono at two, each with font-display swap', () => {
    expect(base.match(/font-family: 'Geist';/g)).toHaveLength(4);
    expect(base.match(/font-family: 'Geist Mono';/g)).toHaveLength(2);
    expect(base.match(/font-display: swap;/g)).toHaveLength(6);
  });

  it('loads every font from this app, and each file is there', () => {
    expect(urls).toHaveLength(6);
    for (const url of urls) {
      expect(url.startsWith('/fonts/')).toBe(true);
      expect(existsSync(resolve(`public${url}`))).toBe(true);
    }
  });

  it('keeps the font licence next to the fonts', () => {
    expect(read('public/fonts/OFL.txt')).toContain('SIL OPEN FONT LICENSE');
  });

  it('falls back to a system font while Geist loads', () => {
    expect(tokens).toMatch(/--font-ui: 'Geist', system-ui/);
    expect(tokens).toMatch(/--font-mono: 'Geist Mono', ui-monospace/);
  });

  it('draws a keyboard focus ring and stops animation for people who ask', () => {
    expect(base).toContain(':focus-visible');
    expect(base).toMatch(/prefers-reduced-motion: reduce[\s\S]*animation: none/);
  });

  it('has no colour of its own: it only uses the tokens', () => {
    expect(base).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
});

describe('the page', () => {
  it('loads the tokens and the base styles before the page styles', () => {
    const html = read('public/index.html');

    const order = ['/css/tokens.css', '/css/base.css', '/css/app.css'].map((href) =>
      html.indexOf(href),
    );

    expect(order.every((position) => position > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('adds no source to the content security policy for the fonts', () => {
    const policy = read('src/server/headers.js');

    expect(policy).toContain('"default-src \'self\'"');
    expect(policy).not.toContain('font-src');
  });
});
