// @vitest-environment happy-dom
// @ts-check
import { describe, expect, it } from 'vitest';
import { actionButton } from '../../../../public/js/ui/actions.js';

describe('actionButton', () => {
  it('is a plain button that names its action and its answer for the page to act on', () => {
    const button = /** @type {HTMLButtonElement} */ (
      actionButton({ action: 'recheck', answerId: 'a1', text: 'Re-check sources' })
    );

    expect(button.tagName).toBe('BUTTON');
    expect(button.type).toBe('button');
    expect(button.className).toBe('button');
    expect(button.textContent).toBe('Re-check sources');
    expect(button.getAttribute('data-action')).toBe('recheck');
    expect(button.getAttribute('data-answer-id')).toBe('a1');
    expect(button.getAttribute('data-focus-id')).toBe('a1:recheck');
    expect(button.disabled).toBe(false);
    expect(button.hasAttribute('aria-disabled')).toBe(false);
  });

  it('takes its own classes and a name for a screen reader', () => {
    const button = actionButton({
      action: 'up',
      answerId: 'a1',
      label: 'Helpful',
      className: 'button button--icon',
    });

    expect(button.className).toBe('button button--icon');
    expect(button.getAttribute('aria-label')).toBe('Helpful');
    expect(button.textContent).toBe('');
  });

  it('can be disabled, which takes it out of reach', () => {
    const button = /** @type {HTMLButtonElement} */ (
      actionButton({ action: 'up', answerId: 'a1', text: 'x', mode: 'disabled' })
    );

    expect(button.disabled).toBe(true);
  });

  it('can be busy, which keeps it focusable but says it cannot be used', () => {
    const button = /** @type {HTMLButtonElement} */ (
      actionButton({ action: 'recheck', answerId: 'a1', text: 'Checking…', mode: 'busy' })
    );

    expect(button.disabled).toBe(false);
    expect(button.getAttribute('aria-disabled')).toBe('true');
  });
});
