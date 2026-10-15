// @ts-check
import { el } from '../dom.js';

/**
 * How a button can be pressed. A busy button stays focusable, so focus is not lost when it is
 * pressed, but does nothing and says it is busy; a disabled one cannot be reached at all.
 * @typedef {'enabled' | 'disabled' | 'busy'} ButtonMode
 */

/**
 * Builds a button that the page's one click handler acts on.
 * @param {object} options - What the button is.
 * @param {string} options.action - What it does, such as `recheck`, `reask`, `more`, `sources`, `up` or `down`.
 * @param {string} options.answerId - The answer it is for.
 * @param {string} [options.text] - What it says; leave it out for a button that holds an icon.
 * @param {string} [options.label] - What a screen reader says, for a button with no words.
 * @param {string} [options.className] - Its classes.
 * @param {ButtonMode} [options.mode] - Whether it can be pressed.
 * @returns {HTMLElement} The button.
 */
export function actionButton({
  action,
  answerId,
  text,
  label,
  className = 'button',
  mode = 'enabled',
}) {
  const button = el('button', {
    className,
    text,
    attributes: {
      type: 'button',
      'data-action': action,
      'data-answer-id': answerId,
      'data-focus-id': `${answerId}:${action}`,
      ...(label === undefined ? {} : { 'aria-label': label }),
    },
  });
  /** @type {HTMLButtonElement} */ (button).disabled = mode === 'disabled';
  if (mode === 'busy') {
    button.setAttribute('aria-disabled', 'true');
  }
  return button;
}
