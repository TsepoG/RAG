// @vitest-environment happy-dom
// @ts-check
import { describe, expect, it } from 'vitest';
import { ICON_NAMES, icon } from '../../../../public/js/ui/icons.js';

describe('icon', () => {
  it('draws the check as an svg that is hidden from screen readers', () => {
    const svg = icon('check');

    expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg');
    expect(svg.tagName.toLowerCase()).toBe('svg');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('focusable')).toBe('false');
    expect(svg.getAttribute('class')).toBe('icon icon--check');
  });

  it('draws the shape as a path and takes its colour from the text around it', () => {
    const svg = icon('check');

    expect(svg.querySelector('path')?.getAttribute('d')).toBe('M5 12l5 5 9-10');
    expect(svg.getAttribute('stroke')).toBe('currentColor');
    expect(svg.getAttribute('fill')).toBe('none');
  });

  it('is 16 pixels with lines 2 thick unless told otherwise', () => {
    const svg = icon('check');

    expect(svg.getAttribute('width')).toBe('16');
    expect(svg.getAttribute('height')).toBe('16');
    expect(svg.getAttribute('stroke-width')).toBe('2');
  });

  it('can be filled in, for a shape such as the stop square', () => {
    expect(icon('stop', { filled: true }).getAttribute('fill')).toBe('currentColor');
    expect(icon('stop').getAttribute('fill')).toBe('none');
  });

  it('takes a size and a line thickness', () => {
    const svg = icon('check', { size: 12, strokeWidth: 3 });

    expect(svg.getAttribute('width')).toBe('12');
    expect(svg.getAttribute('stroke-width')).toBe('3');
  });
});

describe('every icon', () => {
  it('has the names the cards use', () => {
    expect([...ICON_NAMES].sort()).toEqual([
      'alert-circle',
      'alert-triangle',
      'bar-chart',
      'brand',
      'check',
      'close',
      'help-circle',
      'link',
      'lock',
      'menu',
      'no-entry',
      'refresh',
      'search',
      'search-minus',
      'send',
      'stop',
      'thumbs-down',
      'thumbs-up',
    ]);
  });

  it.each(ICON_NAMES)('draws %s as a hidden svg with at least one path', (name) => {
    const svg = icon(name);

    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('class')).toBe(`icon icon--${name}`);
    expect(svg.querySelectorAll('path').length).toBeGreaterThan(0);
    for (const path of svg.querySelectorAll('path')) {
      expect(path.getAttribute('d')).toMatch(/^M/);
    }
  });
});
