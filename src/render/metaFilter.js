// @ts-check

/**
 * Takes the `answer-meta` block out of text as it streams in, so the page never shows it.
 * @typedef {object} MetaStreamFilter
 * @property {(text: string) => string} push - Gives the next piece of the reply and returns the
 *   part that is safe to show now. A line that might open a code fence is held back until the
 *   line is complete.
 * @property {() => string} flush - Call once the reply has ended. Returns any held-back text
 *   that turned out not to be part of the block.
 */

const FENCE_CHARACTER = '`';
const MIN_FENCE_LENGTH = 3;
const BLOCK_INFO = 'answer-meta';

/**
 * Reads a line as a code fence.
 * @param {string} line - A line, complete or not.
 * @returns {{ ticks: number, info: string }} How many backticks start the line, and the text after them.
 */
function readFence(line) {
  const trimmed = line.trim();
  let ticks = 0;
  while (trimmed[ticks] === FENCE_CHARACTER) {
    ticks += 1;
  }
  return { ticks, info: trimmed.slice(ticks).trim() };
}

/**
 * Whether the start of a line leaves open that it is a code fence, so it cannot be shown yet.
 * Only backticks so far, or a fence whose label is still arriving, can be one; an ordinary line,
 * or one that opens with inline code, cannot.
 * @param {string} line - The line so far.
 * @returns {boolean} True when the line must be held back.
 */
function mightBeFence(line) {
  const { ticks } = readFence(line);
  const trimmed = line.trim();
  return trimmed === '' || ticks === trimmed.length || ticks >= MIN_FENCE_LENGTH;
}

/**
 * Whether a complete line opens the block.
 * @param {string} line - The line.
 * @returns {{ ticks: number } | undefined} The fence length, or undefined when it is something else.
 */
function opensBlock(line) {
  const { ticks, info } = readFence(line);
  return ticks >= MIN_FENCE_LENGTH && info.toLowerCase() === BLOCK_INFO ? { ticks } : undefined;
}

/**
 * Creates a filter for one reply. Ordinary text passes straight through; the `answer-meta` block
 * (an opening fence tagged `answer-meta`, to the matching closing fence or to the end of the reply)
 * is dropped, and every other code block is kept. Text after the block is kept too.
 * @returns {MetaStreamFilter} The filter.
 */
export function createMetaStreamFilter() {
  let dropping = false;
  let openTicks = 0;
  // The current line so far, when it has not been shown or dropped yet.
  let line = '';
  // True once the current line is known to be ordinary and is being shown as it arrives.
  let showing = false;

  /**
   * Handles a line that ended with a newline.
   * @returns {string} What to show for it.
   */
  function finishLine() {
    const finished = line;
    const wasShowing = showing;
    line = '';
    showing = false;
    if (dropping) {
      const { ticks, info } = readFence(finished);
      dropping = !(ticks >= openTicks && info === '');
      return '';
    }
    if (wasShowing) {
      return '\n';
    }
    const opening = opensBlock(finished);
    if (opening !== undefined) {
      dropping = true;
      openTicks = opening.ticks;
      return '';
    }
    return `${finished}\n`;
  }

  /**
   * Handles one character of the reply.
   * @param {string} character - The character.
   * @returns {string} What to show for it.
   */
  function addCharacter(character) {
    if (character === '\n') {
      return finishLine();
    }
    if (dropping) {
      line += character;
      return '';
    }
    if (showing) {
      return character;
    }
    line += character;
    if (mightBeFence(line)) {
      return '';
    }
    const released = line;
    line = '';
    showing = true;
    return released;
  }

  return {
    push(text) {
      let shown = '';
      for (const character of text) {
        shown += addCharacter(character);
      }
      return shown;
    },
    flush() {
      const held = line;
      line = '';
      showing = false;
      const hidden = dropping || opensBlock(held) !== undefined;
      dropping = false;
      return hidden ? '' : held;
    },
  };
}
