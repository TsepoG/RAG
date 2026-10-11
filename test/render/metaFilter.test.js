// @ts-check
import { describe, expect, it } from 'vitest';
import { createMetaStreamFilter } from '../../src/render/index.js';

const FENCE = '```';
const REPORT = '{"status":"answered","confidence":"high"}';
const ANSWER = 'Refunds take 30 days [C1].\n\n';
const BLOCK = `${FENCE}answer-meta\n${REPORT}\n${FENCE}\n`;

/**
 * Runs a reply through a new filter in the given pieces and joins what it shows.
 * @param {string[]} pieces - The pieces of the reply, in order.
 * @returns {string} Everything shown, including what `flush` returns.
 */
function shown(pieces) {
  const filter = createMetaStreamFilter();
  return pieces.map((piece) => filter.push(piece)).join('') + filter.flush();
}

/**
 * Cuts a reply into pieces of a given size.
 * @param {string} text - The reply.
 * @param {number} size - Characters per piece.
 * @returns {string[]} The pieces.
 */
function cut(text, size) {
  return Array.from({ length: Math.ceil(text.length / size) }, (_, index) =>
    text.slice(index * size, (index + 1) * size),
  );
}

describe('createMetaStreamFilter ordinary text', () => {
  it('shows text with no fence at once, without waiting for the end of the line', () => {
    const filter = createMetaStreamFilter();

    expect(filter.push('Refunds take')).toBe('Refunds take');
    expect(filter.push(' 30 days')).toBe(' 30 days');
    expect(filter.push('.\nNext line')).toBe('.\nNext line');
    expect(filter.flush()).toBe('');
  });

  it('shows a line that opens with inline code at once', () => {
    const filter = createMetaStreamFilter();

    expect(filter.push('`refund()` is called')).toBe('`refund()` is called');
  });

  it('shows nothing for an empty piece, and an empty reply as nothing', () => {
    const filter = createMetaStreamFilter();

    expect(filter.push('')).toBe('');
    expect(filter.flush()).toBe('');
  });

  it('keeps text with Windows line endings as it is', () => {
    expect(shown(['One.\r\nTwo.\r\n'])).toBe('One.\r\nTwo.\r\n');
  });
});

describe('createMetaStreamFilter the answer-meta block', () => {
  it('drops the block at the end of the reply', () => {
    expect(shown([ANSWER + BLOCK])).toBe(ANSWER);
  });

  it('drops it without a final newline', () => {
    expect(shown([`${ANSWER}${FENCE}answer-meta\n${REPORT}\n${FENCE}`])).toBe(ANSWER);
  });

  it('keeps the text after the block', () => {
    expect(shown([`${ANSWER}${BLOCK}Hope that helps.`])).toBe(`${ANSWER}Hope that helps.`);
  });

  it('drops every block, not only the last', () => {
    expect(shown([`A.\n${BLOCK}B.\n${BLOCK}`])).toBe('A.\nB.\n');
  });

  it('drops a block that is never closed, to the end', () => {
    expect(shown([`${ANSWER}${FENCE}answer-meta\n{"status":"ans`])).toBe(ANSWER);
  });

  it('drops a block whose opening line has no newline yet when the reply ends', () => {
    expect(shown([`${ANSWER}${FENCE}answer-meta`])).toBe(ANSWER);
  });

  it.each([
    ['indented', `  ${FENCE}answer-meta\n${REPORT}\n  ${FENCE}\n`],
    ['in capitals', `${FENCE}ANSWER-META\n${REPORT}\n${FENCE}\n`],
    ['with a long fence', `${FENCE}\`answer-meta\n${REPORT}\n${FENCE}\`\n`],
    ['with Windows line endings', `${FENCE}answer-meta\r\n${REPORT}\r\n${FENCE}\r\n`],
    ['with space after the tag', `${FENCE}answer-meta  \n${REPORT}\n${FENCE}\n`],
  ])('drops a block that is %s', (_name, block) => {
    expect(shown([ANSWER + block])).toBe(ANSWER);
  });

  it('does not close a long fence with a shorter one', () => {
    const text = `A.\n${FENCE}\`answer-meta\n${REPORT}\n${FENCE}\nstill inside\n${FENCE}\`\nB.`;

    expect(shown([text])).toBe('A.\nB.');
  });

  it('keeps a fence that mentions answer-meta in the middle of its label', () => {
    const text = `${FENCE}json answer-meta\n{}\n${FENCE}\n`;

    expect(shown([text])).toBe(text);
  });
});

describe('createMetaStreamFilter other code blocks', () => {
  it('keeps a code block with a language', () => {
    const text = `Use it like this:\n${FENCE}js\nrefund(order);\n${FENCE}\nDone.`;

    expect(shown([text])).toBe(text);
  });

  it('keeps a code block with no language', () => {
    const text = `${FENCE}\nplain\n${FENCE}\n`;

    expect(shown([text])).toBe(text);
  });

  it('keeps a code block and still drops the report after it', () => {
    const code = `${FENCE}js\nrefund(order);\n${FENCE}\n`;

    expect(shown([`${code}\n${BLOCK}`])).toBe(`${code}\n`);
  });

  it('holds a line that might be a fence until it can tell, then shows it', () => {
    const filter = createMetaStreamFilter();

    expect(filter.push('``')).toBe('');
    expect(filter.push('`js')).toBe('');
    expect(filter.push('\n')).toBe(`${FENCE}js\n`);
  });

  it('shows a held line at the end if it never became a fence', () => {
    const filter = createMetaStreamFilter();

    expect(filter.push(FENCE)).toBe('');
    expect(filter.flush()).toBe(FENCE);
  });

  it('shows a short run of backticks that turns out to be text', () => {
    const filter = createMetaStreamFilter();

    expect(filter.push('``')).toBe('');
    expect(filter.push(' is empty code')).toBe('`` is empty code');
  });
});

describe('createMetaStreamFilter pieces of any size', () => {
  const reply = `Intro [C1].\n\n${FENCE}js\nconst a = 1;\n${FENCE}\n\nEnd.\n\n${BLOCK}`;
  const expected = 'Intro [C1].\n\n```js\nconst a = 1;\n```\n\nEnd.\n\n';

  it.each([1, 2, 3, 5, 7, 11, 100])('gives the same text in pieces of %i characters', (size) => {
    expect(shown(cut(reply, size))).toBe(expected);
  });

  it('gives the same text wherever the reply is split in two', () => {
    for (let at = 0; at <= reply.length; at += 1) {
      expect(shown([reply.slice(0, at), reply.slice(at)])).toBe(expected);
    }
  });

  it('never shows any part of the block at any split', () => {
    const filter = createMetaStreamFilter();
    const all = cut(reply, 1)
      .map((piece) => filter.push(piece))
      .join('');

    expect(all + filter.flush()).not.toMatch(/answer-meta|status/);
  });
});
