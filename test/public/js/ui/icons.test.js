// @vitest-environment happy-dom
// @ts-check
import { describe, expect, it } from 'vitest';
import { icon } from '../../../../public/js/ui/icons.js';

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

  it('takes a size and a line thickness', () => {
    const svg = icon('check', { size: 12, strokeWidth: 3 });

    expect(svg.getAttribute('width')).toBe('12');
    expect(svg.getAttribute('stroke-width')).toBe('3');
  });
});
