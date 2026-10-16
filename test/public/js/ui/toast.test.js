// @vitest-environment happy-dom
// @ts-check
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createToast, TOAST_MS } from '../../../../public/js/ui/toast.js';

beforeEach(() => {
  document.body.innerHTML = '';
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createToast', () => {
  it('is put in the parent, hidden, and hidden from screen readers so nothing is read twice', () => {
    const { element } = createToast(document.body);

    expect(document.body.contains(element)).toBe(true);
    expect(element.hidden).toBe(true);
    expect(element.getAttribute('aria-hidden')).toBe('true');
    expect(element.className).toBe('toast');
  });

  it('shows the words with a check, as text, and hides them again after a few seconds', () => {
    const { element, show } = createToast(document.body);

    show('Conversation copied');

    expect(element.hidden).toBe(false);
    expect(element.textContent).toBe('Conversation copied');
    expect(element.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    vi.advanceTimersByTime(TOAST_MS - 1);
    expect(element.hidden).toBe(false);
    vi.advanceTimersByTime(1);
    expect(element.hidden).toBe(true);
    expect(TOAST_MS).toBe(3000);
  });

  it('starts the time again when it is shown a second time, and shows the new words', () => {
    const { element, show } = createToast(document.body);
    show('First');
    vi.advanceTimersByTime(2000);

    show('Second');
    vi.advanceTimersByTime(2000);

    expect(element.hidden).toBe(false);
    expect(element.textContent).toBe('Second');
    vi.advanceTimersByTime(1000);
    expect(element.hidden).toBe(true);
  });

  it('stays while the pointer is over it, and hides a few seconds after the pointer leaves', () => {
    const { element, show } = createToast(document.body);
    show('Conversation copied');

    element.dispatchEvent(new Event('mouseenter'));
    vi.advanceTimersByTime(TOAST_MS * 3);
    expect(element.hidden).toBe(false);

    element.dispatchEvent(new Event('mouseleave'));
    vi.advanceTimersByTime(TOAST_MS - 1);
    expect(element.hidden).toBe(false);
    vi.advanceTimersByTime(1);
    expect(element.hidden).toBe(true);
  });

  it('does not start counting when it is shown under the pointer, until the pointer leaves', () => {
    const { element, show } = createToast(document.body);
    element.dispatchEvent(new Event('mouseenter'));

    show('Conversation copied');
    vi.advanceTimersByTime(TOAST_MS * 2);
    expect(element.hidden).toBe(false);

    element.dispatchEvent(new Event('mouseleave'));
    vi.advanceTimersByTime(TOAST_MS);
    expect(element.hidden).toBe(true);
  });

  it('does nothing when the pointer leaves after it is already gone', () => {
    const { element, show } = createToast(document.body);
    show('Conversation copied');
    vi.advanceTimersByTime(TOAST_MS);

    element.dispatchEvent(new Event('mouseleave'));

    expect(element.hidden).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cannot take focus: it has no tab stop and holds nothing that can', () => {
    const { element, show } = createToast(document.body);
    show('Conversation copied');

    expect(element.hasAttribute('tabindex')).toBe(false);
    expect(element.querySelector('a, button, input, textarea, select, [tabindex]')).toBeNull();
  });

  it('shows the words as text, never as markup', () => {
    const { element, show } = createToast(document.body);

    show('<img src=x onerror=alert(1)>');

    expect(element.querySelector('img')).toBeNull();
    expect(element.textContent).toBe('<img src=x onerror=alert(1)>');
  });
});

describe('the toast style', () => {
  const css = readFileSync(resolve('public/css/components.css'), 'utf8');
  const start = css.indexOf('.toast {');
  const rule = css.slice(start, css.indexOf('}', start));

  it('has no animation or transition, so there is nothing to turn off for reduced motion', () => {
    expect(start).toBeGreaterThan(-1);
    expect(rule).not.toMatch(/animation|transition/);
  });
});
