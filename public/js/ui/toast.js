// @ts-check
import { el } from '../dom.js';
import { icon } from './icons.js';

/** How long a toast stays on screen, in ms. */
export const TOAST_MS = 3000;

/**
 * Creates a small message that appears for a few seconds, to show that something the reader asked
 * for has happened. It is only for the eye: screen readers are told through the live region, so
 * the toast is hidden from them and nothing is read twice. It never takes focus, and it stays
 * while the pointer is over it so it can be read at leisure.
 * @param {HTMLElement} parent - Where to put it, usually the body.
 * @returns {{ element: HTMLElement, show: (text: string) => void }} The toast and a way to show it.
 */
export function createToast(parent) {
  const element = el('div', { className: 'toast', attributes: { 'aria-hidden': 'true' } });
  element.hidden = true;
  parent.append(element);
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  let hovered = false;

  /** Starts the countdown to hiding, unless the pointer is over the toast. */
  function startCountdown() {
    clearTimeout(timer);
    if (hovered) {
      return;
    }
    timer = setTimeout(() => {
      element.hidden = true;
    }, TOAST_MS);
  }

  element.addEventListener('mouseenter', () => {
    hovered = true;
    clearTimeout(timer);
  });
  element.addEventListener('mouseleave', () => {
    hovered = false;
    if (!element.hidden) {
      startCountdown();
    }
  });
  return {
    element,
    show(text) {
      element.replaceChildren(icon('check', { size: 16, strokeWidth: 2.4 }), el('span', { text }));
      element.hidden = false;
      startCountdown();
    },
  };
}
