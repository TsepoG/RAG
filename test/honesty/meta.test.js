// @ts-check
import { describe, expect, it } from 'vitest';
import { parseAnswerMeta } from '../../src/honesty/index.js';

const FENCE = '```';
const ANSWER = 'Refunds take 30 days [C1]. Large ones need approval [G1].';
const META = {
  status: 'answered',
  confidence: 'medium',
  confidenceReason: 'One part is my reading of the code.',
  gaps: ['No page describes partial refunds'],
  conflicts: [],
};

/**
 * Writes a reply the way the model should: the answer, then the block.
 * @param {unknown} meta - What goes inside the block (an object is written as JSON).
 * @param {string} [fence] - The fence to use.
 * @returns {string} The block.
 */
function block(meta, fence = FENCE) {
  const body = typeof meta === 'string' ? meta : JSON.stringify(meta);
  return `${fence}answer-meta\n${body}\n${fence}`;
}

describe('parseAnswerMeta a valid block at the end', () => {
  it('returns the checked block and the answer without it', () => {
    const result = parseAnswerMeta(`${ANSWER}\n\n${block(META)}\n`);

    expect(result).toEqual({ answer: ANSWER, meta: META });
  });

  it('leaves no trace of the block in the answer', () => {
    expect(parseAnswerMeta(`${ANSWER}\n${block(META)}`).answer).not.toContain('answer-meta');
  });

  it('keeps the answer text exactly, including its own code blocks and line breaks', () => {
    const own = `Use it like this:\n\n${FENCE}js\nrefund(order);\n${FENCE}\n\n- one\n- two`;

    expect(parseAnswerMeta(`${own}\n\n${block(META)}`).answer).toBe(own);
  });

  it('accepts a longer fence and a tag in capitals', () => {
    const reply = `${ANSWER}\n\n\`\`\`\`ANSWER-META\n${JSON.stringify(META)}\n\`\`\`\``;

    expect(parseAnswerMeta(reply)).toEqual({ answer: ANSWER, meta: META });
  });

  it('accepts Windows line endings', () => {
    const reply = `${ANSWER}\r\n\r\n${block(META).replaceAll('\n', '\r\n')}\r\n`;

    expect(parseAnswerMeta(reply).meta).toEqual(META);
  });

  it('accepts a block spread over several lines', () => {
    const pretty = JSON.stringify(META, null, 2);

    expect(parseAnswerMeta(`${ANSWER}\n${block(pretty)}`).meta).toEqual(META);
  });

  it('accepts a block that is all there is', () => {
    expect(parseAnswerMeta(block(META))).toEqual({ answer: '', meta: META });
  });

  it.each([
    ['not_found', { status: 'not_found' }],
    ['out_of_scope', { status: 'out_of_scope' }],
    ['clarify', { status: 'clarify', clarifyingQuestion: 'Which refunds do you mean?' }],
  ])('accepts %s without a confidence', (_name, extra) => {
    const meta = { confidenceReason: 'Nothing relevant.', gaps: [], conflicts: [], ...extra };

    expect(parseAnswerMeta(`${ANSWER}\n${block(meta)}`).meta).toEqual(meta);
  });

  it('accepts conflicts with both sides and their keys', () => {
    const conflicts = [
      {
        topic: 'Refund window',
        docSays: '30 days',
        docKeys: ['C1'],
        codeSays: '14 days',
        codeKeys: ['G2'],
      },
    ];

    const result = parseAnswerMeta(`${ANSWER}\n${block({ ...META, conflicts })}`);

    expect(result.meta?.conflicts).toEqual(conflicts);
  });

  it('ignores a field it does not know instead of rejecting the block', () => {
    const result = parseAnswerMeta(`${ANSWER}\n${block({ ...META, notes: 'extra' })}`);

    expect(result.metaError).toBeUndefined();
    expect(result.meta).toEqual(META);
  });

  it('trims the text of the fields', () => {
    const result = parseAnswerMeta(
      `${ANSWER}\n${block({ ...META, confidenceReason: '  Why.  ' })}`,
    );

    expect(result.meta?.confidenceReason).toBe('Why.');
  });
});

describe('parseAnswerMeta more than one block', () => {
  it('uses only the last block and leaves an earlier one in the text', () => {
    const first = block({ ...META, confidence: 'high' });
    const reply = `${ANSWER}\n\n${first}\n\nMore text.\n\n${block(META)}`;

    const result = parseAnswerMeta(reply);

    expect(result.meta).toEqual(META);
    expect(result.answer).toBe(`${ANSWER}\n\n${first}\n\nMore text.`);
    expect(result.warning).toBeUndefined();
  });

  it('does not take an ordinary code block for the block', () => {
    const reply = `${ANSWER}\n\n${FENCE}json\n${JSON.stringify(META)}\n${FENCE}`;

    expect(parseAnswerMeta(reply)).toEqual({ answer: reply, metaError: 'missing' });
  });

  it('does not close a long fence with a shorter one', () => {
    const reply = `${ANSWER}\n\n\`\`\`\`answer-meta\n${JSON.stringify(META)}\n${FENCE}\nstill inside`;

    expect(parseAnswerMeta(reply).metaError).toBe('invalid-json');
  });
});

describe('parseAnswerMeta a block that is not at the end', () => {
  it('accepts it, puts the text after it back into the answer and warns', () => {
    const reply = `${ANSWER}\n\n${block(META)}\n\nHope that helps.`;

    expect(parseAnswerMeta(reply)).toEqual({
      answer: `${ANSWER}\n\nHope that helps.`,
      meta: META,
      warning: 'not-at-end',
    });
  });

  it('keeps the text after the block when the block comes first', () => {
    const result = parseAnswerMeta(`${block(META)}\n\n${ANSWER}`);

    expect(result).toEqual({ answer: ANSWER, meta: META, warning: 'not-at-end' });
  });

  it('does not warn for trailing blank space', () => {
    expect(parseAnswerMeta(`${ANSWER}\n${block(META)}\n\n   \n`).warning).toBeUndefined();
  });

  it('still reports a bad block that is not at the end, and still removes it', () => {
    const result = parseAnswerMeta(`${ANSWER}\n${block('{oops')}\nAfter.`);

    expect(result).toEqual({
      answer: `${ANSWER}\n\nAfter.`,
      metaError: 'invalid-json',
      warning: 'not-at-end',
    });
  });
});

describe('parseAnswerMeta a missing or bad block', () => {
  it('reports a reply with no block as missing and leaves it alone', () => {
    expect(parseAnswerMeta(ANSWER)).toEqual({ answer: ANSWER, metaError: 'missing' });
  });

  it('reports an empty reply as missing', () => {
    expect(parseAnswerMeta('')).toEqual({ answer: '', metaError: 'missing' });
  });

  it.each(['{oops', '', 'not json at all', '{"status": "answered",}'])(
    'reports %j as invalid JSON and still removes the block',
    (body) => {
      expect(parseAnswerMeta(`${ANSWER}\n${block(body)}`)).toEqual({
        answer: ANSWER,
        metaError: 'invalid-json',
      });
    },
  );

  it('treats a block that is never closed as running to the end', () => {
    const reply = `${ANSWER}\n\n${FENCE}answer-meta\n${JSON.stringify(META).slice(0, 40)}`;

    expect(parseAnswerMeta(reply)).toEqual({ answer: ANSWER, metaError: 'invalid-json' });
  });

  it('reads a block that is never closed but complete', () => {
    const reply = `${ANSWER}\n\n${FENCE}answer-meta\n${JSON.stringify(META)}`;

    expect(parseAnswerMeta(reply)).toEqual({ answer: ANSWER, meta: META });
  });

  it('reports a fence with nothing after it as invalid JSON', () => {
    expect(parseAnswerMeta(`${ANSWER}\n${FENCE}answer-meta`)).toEqual({
      answer: ANSWER,
      metaError: 'invalid-json',
    });
  });
});

describe('parseAnswerMeta a block of the wrong shape', () => {
  it.each([
    ['an unknown status', { ...META, status: 'maybe' }, ['status']],
    ['an out-of-range confidence', { ...META, confidence: 'certain' }, ['confidence']],
    ['a numeric confidence', { ...META, confidence: 3 }, ['confidence']],
    ['an answer with no confidence', { ...META, confidence: undefined }, ['confidence']],
    [
      'a clarify with no question',
      { ...META, status: 'clarify', confidence: undefined },
      ['clarifyingQuestion'],
    ],
    ['no reason', { ...META, confidenceReason: undefined }, ['confidenceReason']],
    ['an empty reason', { ...META, confidenceReason: '  ' }, ['confidenceReason']],
    [
      'a reason that is far too long',
      { ...META, confidenceReason: 'x'.repeat(301) },
      ['confidenceReason'],
    ],
    ['gaps that are not a list', { ...META, gaps: 'none' }, ['gaps']],
    ['no gaps field', { ...META, gaps: undefined }, ['gaps']],
    [
      'too many gaps',
      { ...META, gaps: Array.from({ length: 11 }, (_, i) => `gap ${i}`) },
      ['gaps'],
    ],
    ['a gap that is not text', { ...META, gaps: [1] }, ['gaps.0']],
    ['conflicts that are not a list', { ...META, conflicts: {} }, ['conflicts']],
    [
      'a conflict missing a side',
      { ...META, conflicts: [{ topic: 'x', docSays: 'y' }] },
      ['conflicts.0.docKeys', 'conflicts.0.codeSays', 'conflicts.0.codeKeys'],
    ],
    [
      'too many conflicts',
      {
        ...META,
        conflicts: Array.from({ length: 6 }, () => ({
          topic: 't',
          docSays: 'd',
          docKeys: [],
          codeSays: 'c',
          codeKeys: [],
        })),
      },
      ['conflicts'],
    ],
    ['a JSON array', [], ['(block)']],
    ['a JSON string', 'text', ['(block)']],
    ['null', null, ['(block)']],
  ])(
    'reports %s as an invalid shape, names the fields, and removes the block',
    (_name, meta, fields) => {
      const body = JSON.stringify(meta ?? null);

      expect(parseAnswerMeta(`${ANSWER}\n${block(body)}`)).toEqual({
        answer: ANSWER,
        metaError: 'invalid-shape',
        metaFields: fields,
      });
    },
  );
});
