// @vitest-environment happy-dom
// @ts-check
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

  it('shows the words as text, never as markup', () => {
    const { element, show } = createToast(document.body);

    show('<img src=x onerror=alert(1)>');

    expect(element.querySelector('img')).toBeNull();
    expect(element.textContent).toBe('<img src=x onerror=alert(1)>');
  });
});
