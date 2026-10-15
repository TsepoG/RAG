// @vitest-environment happy-dom
// @ts-check
import { describe, expect, it, vi } from 'vitest';
import { buildWelcome, WELCOME_HEADING } from '../../../../public/js/ui/welcome.js';

const QUESTIONS = [
  'In plain terms, what does Shortlist do?',
  'Can we trust the backtest results yet?',
];

describe('buildWelcome', () => {
  it('asks what the reader would like to know, and says how it will answer', () => {
    const welcome = buildWelcome({}, vi.fn());

    expect(welcome.querySelector('h1')?.textContent).toBe(WELCOME_HEADING);
    expect(WELCOME_HEADING).toBe('What would you like to know?');
    expect(welcome.querySelector('.welcome__text')?.textContent).toContain(
      'Confluence pages and GitHub code',
    );
  });

  it('is a section called Welcome', () => {
    const welcome = buildWelcome({}, vi.fn());

    expect(welcome.tagName).toBe('SECTION');
    expect(welcome.getAttribute('aria-label')).toBe('Welcome');
  });

  it('makes three promises, each with an icon hidden from screen readers', () => {
    const tiles = [...buildWelcome({}, vi.fn()).querySelectorAll('.promise')];

    expect(tiles.map((tile) => tile.querySelector('.promise__title')?.textContent)).toEqual([
      'Every answer is sourced',
      'Says how sure it is',
      "Admits what it can't find",
    ]);
    expect(tiles.map((tile) => tile.querySelector('.promise__text')?.textContent)).toEqual([
      'Links to the exact page or file.',
      'High, medium or low, with the reason.',
      'No guessing to fill the gaps.',
    ]);
    expect(
      tiles.every((tile) => tile.querySelector('svg')?.getAttribute('aria-hidden') === 'true'),
    ).toBe(true);
  });

  it('offers each suggested question as a button under Try asking', () => {
    const welcome = buildWelcome({ suggestedQuestions: QUESTIONS }, vi.fn());

    expect(welcome.querySelector('.suggestions h2')?.textContent).toBe('Try asking');
    const buttons = [...welcome.querySelectorAll('.suggestion')];
    expect(buttons.map((button) => button.textContent)).toEqual(QUESTIONS);
    expect(buttons.every((button) => button.getAttribute('type') === 'button')).toBe(true);
  });

  it('hands the question to the page when one is pressed, and sends nothing itself', () => {
    const onPick = vi.fn();
    const welcome = buildWelcome({ suggestedQuestions: QUESTIONS }, onPick);
    let submitted = false;
    welcome.addEventListener('submit', () => {
      submitted = true;
    });

    /** @type {HTMLElement} */ (welcome.querySelectorAll('.suggestion')[1]).click();

    expect(onPick).toHaveBeenCalledExactlyOnceWith(QUESTIONS[1]);
    expect(submitted).toBe(false);
    expect(welcome.querySelector('form')).toBeNull();
  });

  it('shows no Try asking when the role has no suggestions', () => {
    expect(buildWelcome({}, vi.fn()).querySelector('.suggestions')).toBeNull();
    expect(
      buildWelcome({ suggestedQuestions: [] }, vi.fn()).querySelector('.suggestions'),
    ).toBeNull();
  });

  it('shows a suggestion as text, never as markup', () => {
    const welcome = buildWelcome({ suggestedQuestions: ['<img src=x onerror=alert(1)>'] }, vi.fn());

    expect(welcome.querySelector('img')).toBeNull();
    expect(welcome.querySelector('.suggestion')?.textContent).toBe('<img src=x onerror=alert(1)>');
  });
});
