// @ts-check
import { el, safeHref } from '../dom.js';
import { CONFIDENCE_LABELS, ERROR_LABEL, STATUS_LABELS } from './labels.js';

/** Said through the live region when the text is on the clipboard. */
export const COPIED_MESSAGE = 'Conversation copied';

/** Said through the live region when the clipboard could not be used and the text is shown instead. */
export const SHOWN_MESSAGE = 'The conversation is shown so that you can copy it.';

/** Written under a question that never got an answer because it was stopped. */
const STOPPED_NOTE = 'Stopped before an answer.';

/** Marks, in a list of sources, one that changed after the answer was written. */
const CHANGED_NOTE = 'changed since this answer was written';

/** Characters that mean something in markdown; each gets a backslash in text that is not markdown. */
const MARKDOWN_SPECIALS = /[\\`*_[\]<>]/g;

/**
 * Makes a piece of plain text safe to put in markdown, such as a page title with a bracket in it.
 * Line breaks become spaces so the text stays on its line.
 * @param {string} text - The text.
 * @returns {string} The text with its markdown characters escaped.
 */
export function escapeMarkdown(text) {
  const oneLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .join(' ');
  return oneLine.replaceAll(MARKDOWN_SPECIALS, (found) => `\\${found}`);
}

/**
 * Quotes text, line by line, so that whatever it holds cannot turn into a heading or a list.
 * @param {string} text - The text.
 * @returns {string} The text as a block quote.
 */
function quote(text) {
  return text
    .split('\n')
    .map((line) => (line === '' ? '>' : `> ${line}`))
    .join('\n');
}

/**
 * Writes a list of lines as a markdown list.
 * @param {string[]} lines - The items.
 * @returns {string} One bullet per item.
 */
function bullets(lines) {
  return lines.map((line) => `- ${line}`).join('\n');
}

/**
 * Writes one source: its key, its title and where it is, as `[KEY] title — URL`. A link that is not
 * https is left out, as on the page.
 * @param {{ key?: string, title: string, url?: string }} source - The source.
 * @param {string} [note] - Something to add, such as that it changed.
 * @returns {string} The line, without its bullet.
 */
function sourceLine({ key, title, url }, note) {
  const href = safeHref(url);
  const parts = [
    key === undefined ? escapeMarkdown(title) : `[${key}] ${escapeMarkdown(title)}`,
    href,
  ].filter((part) => part !== undefined);
  const line = parts.join(' — ');
  return note === undefined ? line : `${line} (${note})`;
}

/**
 * Writes the sources an answer cites, and the ones it only looked at.
 * @param {import('../chatState.js').AnswerView} answer - The answer.
 * @returns {string[]} The markdown blocks.
 */
function sourceBlocks({ result, changedKeys }) {
  const cited = result.sources.map((source) =>
    sourceLine(source, changedKeys.includes(source.key) ? CHANGED_NOTE : undefined),
  );
  const consulted = result.alsoConsulted.map((page) => sourceLine(page));
  return [
    cited.length === 0 ? '**Sources:** none' : `**Sources:**\n\n${bullets(cited)}`,
    ...(consulted.length === 0 ? [] : [`**Also consulted:**\n\n${bullets(consulted)}`]),
  ];
}

/**
 * Writes the part of an answer that says how sure it is, or what kind of reply it is.
 * @param {import('../chatState.js').AnswerView} answer - The answer.
 * @returns {string} The line.
 */
function standingLine({ result }) {
  if (result.status === 'answered' && result.confidence !== null) {
    const reason = result.confidenceReason === '' ? '' : ` ${result.confidenceReason}`;
    return `**Confidence:** ${CONFIDENCE_LABELS[result.confidence]}.${reason}`;
  }
  return `**Reply:** ${STATUS_LABELS[/** @type {keyof typeof STATUS_LABELS} */ (result.status)]}`;
}

/**
 * Writes an answer: its text, how sure it is, what it could not confirm and where it came from.
 * @param {import('../chatState.js').AnswerView} answer - The answer.
 * @returns {string[]} The markdown blocks.
 */
function answerBlocks(answer) {
  const { rendered, result } = answer;
  const body = [rendered.banner, rendered.text].filter((part) => part !== '');
  const closest = rendered.closestPages.map((page) => sourceLine(page));
  const asks = rendered.whoToAsk.map(({ name }) => escapeMarkdown(name));
  /** @type {Array<[string, string[]]>} */
  const lists = [
    ["What I'm not sure about", rendered.gaps.map(escapeMarkdown)],
    ['Where sources disagree', rendered.conflicts.map(escapeMarkdown)],
    ['Where I looked', closest],
    ['Who might know', asks],
  ];
  return [
    '**Answer:**',
    result.status === 'answered' ? rendered.text : body.join('\n\n'),
    standingLine(answer),
    ...lists
      .filter(([, items]) => items.length > 0)
      .map(([title, items]) => `**${title}:**\n\n${bullets(items)}`),
    ...sourceBlocks(answer),
  ];
}

/**
 * Writes one turn: the question, then the answer or what became of it.
 * @param {import('../chatState.js').TurnView} turn - The turn.
 * @returns {string} The turn as markdown.
 */
function turnBlock({ turn, question, phase, answer, failure }) {
  const heading = `## Turn ${turn}`;
  const asked = `**Question:**\n\n${quote(question)}`;
  if (answer !== undefined) {
    return [heading, asked, ...answerBlocks(answer)].join('\n\n');
  }
  const note = phase === 'stopped' ? STOPPED_NOTE : `${ERROR_LABEL}. ${failure ?? ''}`.trim();
  return [heading, asked, `_${escapeMarkdown(note)}_`].join('\n\n');
}

/**
 * Writes a whole conversation as markdown: a title with the role and the date, then each turn with
 * its question, its answer with the citation keys, how sure it was and why, and its sources. It
 * uses only what the page already holds.
 * @param {{ roleName: string, date: Date, turns: ReadonlyArray<import('../chatState.js').TurnView> }} conversation - The conversation.
 * @returns {string} The markdown, ending in one new line.
 */
export function conversationToMarkdown({ roleName, date, turns }) {
  const day = date.toISOString().slice(0, 10);
  const title = `# Conversation as ${escapeMarkdown(roleName)}, ${day}`;
  return `${[title, ...turns.map(turnBlock)].join('\n\n')}\n`;
}

/**
 * Puts a conversation on the clipboard. When the clipboard is not there or refuses, it shows the
 * text to copy by hand instead. Either way the reader is told through the live region.
 * @param {object} options - What to copy and how.
 * @param {string} options.markdown - The conversation as markdown.
 * @param {{ writeText: (text: string) => Promise<void> } | undefined} options.clipboard - `navigator.clipboard`, when there is one.
 * @param {(message: string) => void} options.announce - Says something through the live region.
 * @param {(markdown: string) => void} options.showFallback - Shows the text so that it can be copied by hand.
 * @returns {Promise<'copied' | 'shown'>} What happened.
 */
export async function copyConversation({ markdown, clipboard, announce, showFallback }) {
  try {
    if (clipboard === undefined) {
      throw new TypeError('There is no clipboard.');
    }
    await clipboard.writeText(markdown);
  } catch {
    showFallback(markdown);
    announce(SHOWN_MESSAGE);
    return 'shown';
  }
  announce(COPIED_MESSAGE);
  return 'copied';
}

/**
 * Builds the box that shows the conversation when the clipboard cannot be used: a read-only text
 * area with the text, a hint on how to copy it, and a button that closes it. Escape closes it too.
 * It is added to the page and focused by the caller; see {@link selectDialogText}.
 * @param {string} markdown - The conversation as markdown.
 * @param {() => void} onClose - Called when the reader closes the box.
 * @returns {HTMLElement} The box.
 */
export function buildCopyDialog(markdown, onClose) {
  const area = el('textarea', {
    className: 'copy-dialog__text',
    attributes: { readonly: '', rows: '12', 'aria-label': 'The conversation, ready to copy' },
  });
  area.textContent = markdown;
  const close = el('button', {
    className: 'button',
    text: 'Close',
    attributes: { type: 'button' },
  });
  close.addEventListener('click', onClose);
  const dialog = el(
    'div',
    {
      className: 'copy-dialog',
      attributes: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'copy-dialog-title' },
    },
    [
      el('h2', {
        className: 'copy-dialog__title',
        text: 'Copy this conversation',
        attributes: { id: 'copy-dialog-title' },
      }),
      el('p', {
        className: 'copy-dialog__hint',
        text: 'Your browser did not allow copying automatically. The text is selected: press Ctrl+C (or ⌘C on a Mac) to copy it.',
      }),
      area,
      close,
    ],
  );
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
    }
  });
  return dialog;
}

/**
 * Focuses the text in a copy box and selects all of it, so that one key press copies it.
 * @param {HTMLElement} dialog - The box from {@link buildCopyDialog}, once it is on the page.
 */
export function selectDialogText(dialog) {
  const area = /** @type {HTMLTextAreaElement} */ (dialog.querySelector('textarea'));
  area.focus();
  area.select();
}
