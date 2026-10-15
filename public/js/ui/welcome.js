// @ts-check
import { el } from '../dom.js';
import { icon } from './icons.js';

/** The question the screen asks. */
export const WELCOME_HEADING = 'What would you like to know?';

/** The line under it. */
export const WELCOME_INTRO =
  "Ask about the system in plain language. I'll answer from your Confluence pages and GitHub code, and show you exactly where each fact came from.";

/**
 * What the assistant promises, each with the icon that stands for it.
 * @type {ReadonlyArray<{ icon: 'link' | 'bar-chart' | 'search', title: string, text: string }>}
 */
const PROMISES = Object.freeze([
  { icon: 'link', title: 'Every answer is sourced', text: 'Links to the exact page or file.' },
  {
    icon: 'bar-chart',
    title: 'Says how sure it is',
    text: 'High, medium or low, with the reason.',
  },
  { icon: 'search', title: "Admits what it can't find", text: 'No guessing to fill the gaps.' },
]);

/**
 * Builds the three promises.
 * @returns {HTMLElement} The tiles.
 */
function buildPromises() {
  return el(
    'ul',
    { className: 'promises' },
    PROMISES.map((promise) =>
      el('li', { className: 'promise' }, [
        icon(promise.icon, { size: 20 }),
        el('span', { className: 'promise__title', text: promise.title }),
        el('span', { className: 'promise__text', text: promise.text }),
      ]),
    ),
  );
}

/**
 * Builds the questions to try, one button each. Pressing one hands its text to `onPick`, which puts
 * it in the question box; nothing is sent.
 * @param {ReadonlyArray<string>} questions - The role's suggested questions.
 * @param {(question: string) => void} onPick - Called with the question that was pressed.
 * @returns {HTMLElement[]} The section, or nothing when the role has no suggestions.
 */
function buildSuggestions(questions, onPick) {
  if (questions.length === 0) {
    return [];
  }
  const buttons = questions.map((question) => {
    const button = el('button', {
      className: 'suggestion',
      text: question,
      attributes: { type: 'button' },
    });
    button.addEventListener('click', () => onPick(question));
    return button;
  });
  return [
    el(
      'section',
      { className: 'suggestions', attributes: { 'aria-labelledby': 'suggestions-heading' } },
      [
        el('h2', {
          className: 'suggestions__heading',
          text: 'Try asking',
          attributes: { id: 'suggestions-heading' },
        }),
        el('div', { className: 'suggestions__list' }, buttons),
      ],
    ),
  ];
}

/**
 * Builds the screen shown before the first question: the heading, what the assistant promises,
 * and, when the chosen role has any, questions to try.
 * @param {{ suggestedQuestions?: ReadonlyArray<string> }} role - The chosen role.
 * @param {(question: string) => void} onPick - Called with a suggested question when it is pressed.
 * @returns {HTMLElement} The welcome screen.
 */
export function buildWelcome({ suggestedQuestions = [] }, onPick) {
  return el('section', { className: 'welcome', attributes: { 'aria-label': 'Welcome' } }, [
    el('div', { className: 'welcome__intro' }, [
      el('h1', { className: 'welcome__heading', text: WELCOME_HEADING }),
      el('p', { className: 'welcome__text', text: WELCOME_INTRO }),
    ]),
    buildPromises(),
    ...buildSuggestions(suggestedQuestions, onPick),
  ]);
}
