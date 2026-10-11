// @ts-check
import { describe, expect, it } from 'vitest';
import { checkStyle } from '../../src/style/index.js';

const FENCE = '```';
const PLAIN =
  'Refunds are allowed within 30 days of the order [C1]. Large ones need a manager [C1][G1*].';
const BANNED = ['function', 'class', 'endpoint'];

/**
 * Builds the part of a role the check reads.
 * @param {number} depth - The role's depth.
 * @param {string[]} [bannedTerms] - The words it bans.
 * @returns {{ depth: number, bannedTerms: string[] }} The role.
 */
const role = (depth, bannedTerms = BANNED) => ({ depth, bannedTerms });

/**
 * Checks an answer and returns the problems' types.
 * @param {string} answer - The answer.
 * @param {{ depth: number, bannedTerms: string[] }} forRole - The role.
 * @returns {string[]} The types of the problems found.
 */
const types = (answer, forRole) => checkStyle(answer, forRole).map(({ type }) => type);

/**
 * Checks an answer and returns the problems' messages.
 * @param {string} answer - The answer.
 * @param {{ depth: number, bannedTerms: string[] }} forRole - The role.
 * @returns {string[]} The messages.
 */
const messages = (answer, forRole) => checkStyle(answer, forRole).map(({ message }) => message);

describe('checkStyle an answer that suits the role', () => {
  it.each([1, 2, 3])('finds nothing wrong with plain text at depth %i', (depth) => {
    expect(checkStyle(PLAIN, role(depth))).toEqual([]);
  });

  it('finds nothing wrong with an empty answer', () => {
    expect(checkStyle('', role(1))).toEqual([]);
  });
});

describe('checkStyle code blocks', () => {
  const withBlock = `Here is how it works:\n\n${FENCE}js\nrefund(order);\n${FENCE}\n\nThat is all.`;

  it.each([1, 2])('rejects a code block at depth %i', (depth) => {
    expect(checkStyle(withBlock, role(depth))).toEqual([
      { type: 'code-block', message: 'it contains a code block' },
    ]);
  });

  it('allows a code block at depth 3', () => {
    expect(checkStyle(withBlock, role(3))).toEqual([]);
  });

  it('counts a block that is never closed', () => {
    expect(types(`Text\n${FENCE}\ncode`, role(2))).toEqual(['code-block']);
  });

  it('does not check what is inside a block for banned words or paths', () => {
    const answer = `Text\n${FENCE}\nfunction src/a.ts\n${FENCE}`;

    expect(types(answer, role(1))).toEqual(['code-block']);
  });

  it('reports a block once however many there are', () => {
    const answer = `${FENCE}\na\n${FENCE}\n\n${FENCE}\nb\n${FENCE}`;

    expect(types(answer, role(1))).toEqual(['code-block']);
  });
});

describe('checkStyle the answer-meta block', () => {
  const meta = `${FENCE}answer-meta\n{"status":"answered","confidenceReason":"The function in src/a.ts."}\n${FENCE}`;

  it.each([1, 2, 3])('is not part of the check at depth %i', (depth) => {
    expect(checkStyle(`${PLAIN}\n\n${meta}`, role(depth))).toEqual([]);
  });

  it('does not stop a real code block next to it from being found', () => {
    const answer = `${FENCE}\ncode\n${FENCE}\n\n${meta}`;

    expect(types(answer, role(1))).toEqual(['code-block']);
  });
});

describe('checkStyle inline code', () => {
  it('rejects inline code at depth 1 and lists it', () => {
    expect(messages('The `refund()` call decides [C1].', role(1))).toEqual([
      'it uses inline code (refund())',
    ]);
  });

  it('lists each span once and at most three, then counts the rest', () => {
    const answer = 'Uses `a`, `b`, `a`, `c`, `d` and `e`.';

    expect(messages(answer, role(1))).toEqual(['it uses inline code (a, b, c and 2 more)']);
  });

  it.each([2, 3])('allows inline code at depth %i', (depth) => {
    expect(checkStyle('The `refund()` call decides [C1].', role(depth))).toEqual([]);
  });

  it.each(['A single ` backtick is just text.', 'Two `` backticks together are empty.'])(
    'does not take %j for inline code',
    (answer) => {
      expect(checkStyle(answer, role(1))).toEqual([]);
    },
  );
});

describe('checkStyle file paths', () => {
  it.each([
    ['a file in a folder', 'It lives in src/refunds/policy.ts today.', 'src/refunds/policy.ts'],
    [
      'a path with an extension',
      'See config/payment.settings.yaml for it.',
      'config/payment.settings.yaml',
    ],
    ['a source folder', 'The code is under src/refunds for now.', 'src/refunds'],
    ['a docs folder', 'See docs/guide for details.', 'docs/guide'],
    ['a hidden folder', 'It runs from .github/workflows/ci.yml here.', '.github/workflows/ci.yml'],
    [
      'a path in brackets and a full stop',
      'It is explained (see lib/util/dates.js).',
      'lib/util/dates.js',
    ],
    ['a path in bold', 'The file is **app/main.py** in the repo.', 'app/main.py'],
  ])('rejects %s at depth 1', (_name, answer, path) => {
    expect(messages(answer, role(1))).toEqual([`it shows file paths (${path})`]);
  });

  it.each([
    'Pick one and/or the other.',
    'About 5/10 of orders are refunded.',
    'The date is 2026/10/11 for now.',
    'The score is 3.5/4 on average.',
    'Notes live in notes/2026.10 here.',
    'The file refund_policy.ts holds the rule.',
    'It costs 5 per month/user in the plan.',
    'Open https://acme.atlassian.net/wiki/spaces/ENG/pages/1/Policy.html to read more.',
    'Cited as [C1] and [G1*].',
  ])('does not take %j for a path', (answer) => {
    expect(checkStyle(answer, role(1))).toEqual([]);
  });

  it('lists each path once and at most three', () => {
    const answer = 'See src/a.ts, src/b.ts, src/a.ts, src/c.ts and src/d.ts.';

    expect(messages(answer, role(1))).toEqual([
      'it shows file paths (src/a.ts, src/b.ts, src/c.ts and 1 more)',
    ]);
  });

  it.each([2, 3])('allows paths at depth %i', (depth) => {
    expect(checkStyle('It lives in src/refunds/policy.ts.', role(depth))).toEqual([]);
  });

  it('does not report a path twice when it is also inline code', () => {
    expect(types('It lives in `src/refunds/policy.ts` today.', role(1))).toEqual(['inline-code']);
  });
});

describe('checkStyle banned words', () => {
  it.each([
    ['in lower case', 'The function decides it.'],
    ['in capitals', 'FUNCTION is the key.'],
    ['at the start of a sentence', 'Function matters here.'],
    ['as a plural', 'Many functions are involved.'],
    ['as a plural ending in es', 'There are two classes of order.'],
    ['next to a hyphen', 'It uses a class-based design.'],
    ['in brackets', 'It is a (function).'],
    ['inside inline code', 'It calls `function` here.'],
  ])('finds a banned word %s', (_name, answer) => {
    expect(types(answer, role(3))).toContain('banned-term');
  });

  it.each([
    'It is functional and works.',
    'The subclass is not meant.',
    'The functioning of it is unclear.',
    'A classification is applied.',
    'Endpointless talk.',
    'The malfunction was fixed.',
  ])('does not take part of a longer word: %j', (answer) => {
    expect(checkStyle(answer, role(3))).toEqual([]);
  });

  it('reports each banned word once, in the order the role lists them', () => {
    const answer = 'The endpoint and the function and the endpoint again, and a function.';

    expect(messages(answer, role(3))).toEqual([
      'it uses the word "function"',
      'it uses the word "endpoint"',
    ]);
  });

  it('is checked at every depth', () => {
    [1, 2, 3].forEach((depth) => {
      expect(types('The class is here.', role(depth))).toEqual(['banned-term']);
    });
  });

  it('allows everything a role with no banned words does not ban', () => {
    expect(checkStyle('The function is here.', role(3, []))).toEqual([]);
  });

  it('does not count a banned word inside a citation bracket', () => {
    expect(checkStyle('Cited here [C1].', role(3, ['C1']))).toEqual([]);
  });
});

describe('checkStyle several problems', () => {
  it('lists them in a fixed order: code block, inline code, path, then words', () => {
    const answer = `The \`isEligible\` function in src/refunds/policy.ts:\n\n${FENCE}\ncode\n${FENCE}`;

    expect(types(answer, role(1))).toEqual([
      'code-block',
      'inline-code',
      'file-path',
      'banned-term',
    ]);
  });
});
