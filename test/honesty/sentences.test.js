// @ts-check
import { describe, expect, it } from 'vitest';
import {
  findUncitedSentences,
  markCitationsAsInferred,
  MAX_REPORTED_LENGTH,
  MAX_UNCITED_SENTENCES,
  sentencesCitingOnly,
} from '../../src/honesty/index.js';

const FENCE = '```';
const isFolder = (/** @type {string} */ key) => ['G3', 'G4'].includes(key);

describe('findUncitedSentences claims', () => {
  it('finds nothing in an answer where every sentence is cited', () => {
    const answer =
      'Refunds are allowed within 30 days of the order date [C1]. Large refunds need a manager to approve them [C1][G1].';

    expect(findUncitedSentences(answer)).toEqual([]);
  });

  it('finds a sentence with no citation', () => {
    const answer =
      'Refunds are allowed within 30 days of the order date [C1]. Large refunds also need a manager to approve them.';

    expect(findUncitedSentences(answer)).toEqual([
      'Large refunds also need a manager to approve them.',
    ]);
  });

  it('counts a citation written after the full stop as belonging to the sentence before it', () => {
    const answer =
      'Refunds are allowed within 30 days of the order date. [C1] Large refunds need a manager to approve them. [C1][G1]';

    expect(findUncitedSentences(answer)).toEqual([]);
  });

  it.each(['[C1]', '[G2*]', '[C1][G2]', '[C1, G2]', '[C1*, G2]'])(
    'counts %s as a citation',
    (citation) => {
      expect(
        findUncitedSentences(`Refunds are allowed within 30 days of the order ${citation}.`),
      ).toEqual([]);
    },
  );

  it('does not count a bracket that is not a citation', () => {
    const answer = 'Refunds are allowed within 30 days of the order [see below].';

    expect(findUncitedSentences(answer)).toHaveLength(1);
  });

  it('judges each sentence of a wrapped paragraph on its own', () => {
    const answer = [
      'Refunds are allowed within 30 days of the order',
      'date [C1]. Large refunds need a manager to',
      'approve them.',
    ].join('\n');

    expect(findUncitedSentences(answer)).toEqual([
      'Large refunds need a manager to\napprove them.',
    ]);
  });

  it('judges questions and exclamations as sentences too', () => {
    const answer =
      'Is the refund window really thirty days long? It is definitely not in the docs!';

    expect(findUncitedSentences(answer)).toHaveLength(2);
  });

  it('finds nothing in an empty answer', () => {
    expect(findUncitedSentences('')).toEqual([]);
  });
});

describe('findUncitedSentences what is not judged', () => {
  it.each([
    ['a heading', '# Eligibility rules for refunds in the shop\n'],
    ['a deeper heading', '### Eligibility rules for refunds in the shop'],
    [
      'a fenced block with a language',
      `Refunds are checked here [G1]:\n\n${FENCE}js\nconst eligible = order.age < 30 && order.refunded === false;\n${FENCE}\n`,
    ],
    [
      'table rows',
      '| Order age | Refund allowed in the shop |\n| --- | --- |\n| under 30 days | yes, always allowed |',
    ],
  ])('skips %s', (_name, answer) => {
    expect(findUncitedSentences(answer)).toEqual([]);
  });

  it('judges the text after a code block again', () => {
    const answer = `${FENCE}\nconst a = 1;\n${FENCE}\nThis constant decides how long a refund may take.`;

    expect(findUncitedSentences(answer)).toHaveLength(1);
  });

  it('skips a list lead-in that ends in a colon, but judges the items', () => {
    const answer = [
      'The rules for approving large refunds are as follows:',
      '- A manager must approve refunds over 5000 [C1]',
      '- Refunds below that amount are approved automatically by the system',
    ].join('\n');

    expect(findUncitedSentences(answer)).toEqual([
      'Refunds below that amount are approved automatically by the system',
    ]);
  });

  it.each(['- ', '* ', '+ ', '1. ', '12) '])(
    'does not count the list marker %j as text',
    (marker) => {
      const [sentence] = findUncitedSentences(
        `${marker}Refunds below that amount are approved at once`,
      );

      expect(sentence).toBe('Refunds below that amount are approved at once');
    },
  );

  it('keeps a wrapped list item together', () => {
    const answer = '- Refunds below that amount are\n  approved at once by the system [C1]';

    expect(findUncitedSentences(answer)).toEqual([]);
  });

  it('starts a new item at the next list marker', () => {
    const answer =
      '- Refunds below that amount are approved [C1]\n- Others wait for a manager to decide';

    expect(findUncitedSentences(answer)).toEqual(['Others wait for a manager to decide']);
  });

  it('starts a new paragraph after a list when the next line is not indented', () => {
    const answer =
      '- One cited item in the list here today [C1]\nAnd this paragraph makes a claim of its own.';

    expect(findUncitedSentences(answer)).toEqual(['And this paragraph makes a claim of its own.']);
  });

  it.each([
    ['five words', 'Refunds take thirty days only.', 0],
    ['six words', 'Refunds take thirty days only, sadly.', 1],
    ['a short answer', 'Yes, it is.', 0],
    ['a short note', 'Not built yet.', 0],
  ])('judges only sentences of six words or more: %s', (_name, answer, expected) => {
    expect(findUncitedSentences(answer)).toHaveLength(expected);
  });

  it.each([
    [
      'a heading',
      "## What I couldn't confirm\n- No page describes partial refunds in the system\n",
    ],
    [
      'a typographic apostrophe',
      '## What I couldn’t confirm\n- No page describes partial refunds in the system',
    ],
    ['a gaps heading', '### Gaps\n- No page describes partial refunds in the system'],
    [
      'a conflicts heading',
      '## Conflicts between the pages and code\nThe page says thirty days but the code says fourteen.',
    ],
    [
      'a bold label',
      "**What I couldn't confirm**\n- No page describes partial refunds in the system",
    ],
    ['a label with a colon', 'Gaps:\n- No page describes partial refunds in the system'],
  ])('skips the section the application writes itself: %s', (_name, section) => {
    expect(findUncitedSentences(section)).toEqual([]);
  });

  it('judges the prose again after a skipped heading section ends at the next heading', () => {
    const answer = [
      '## Gaps',
      '- No page describes partial refunds in the system',
      '## Details',
      'The refund window is thirty days from delivery.',
    ].join('\n');

    expect(findUncitedSentences(answer)).toEqual([
      'The refund window is thirty days from delivery.',
    ]);
  });

  it('judges the prose again after a skipped label section ends at a blank line', () => {
    const answer = [
      'Gaps:',
      '- No page describes partial refunds in the system',
      '',
      'The refund window is thirty days from delivery.',
    ].join('\n');

    expect(findUncitedSentences(answer)).toEqual([
      'The refund window is thirty days from delivery.',
    ]);
  });

  it('does not skip an ordinary sentence that starts with the word "gaps"', () => {
    expect(
      findUncitedSentences('Gaps in the documentation make this hard to confirm.'),
    ).toHaveLength(1);
  });

  it('does not end a label section at a blank line before it has any content', () => {
    const answer = 'Gaps:\n\n- No page describes partial refunds in the system';

    expect(findUncitedSentences(answer)).toEqual([]);
  });
});

describe('findUncitedSentences sentence boundaries', () => {
  it.each([
    ['e.g.', 'Refunds apply to most orders, e.g. those paid by card, within thirty days [C1].'],
    ['i.e.', 'Refunds need approval, i.e. a manager must sign off on large amounts [C1].'],
    ['etc.', 'The policy covers cards, vouchers, gift cards etc. and cash payments too [C1].'],
    ['a version number', 'The policy changed in v1.2 and again in v2.0 of the shop software [C1].'],
    ['a file name', 'Refunds are decided in refund_policy.ts and nowhere else in the repo [G1].'],
    ['a decimal', 'The limit is 5000.50 units per refund request in the standard plan [C1].'],
    [
      'an abbreviation before a number',
      'Refunds apply to most orders paid by card, e.g. 30 days after delivery of the goods [C1].',
    ],
    [
      'an abbreviation before a capital',
      'Compare the old refund policy page vs. Version 2 of the same policy page [C1].',
    ],
    ['an initial', 'The page was written by J. Smith in the platform team last year [C1].'],
    [
      'an abbreviation at the start',
      'Approx. thirty days apply to all standard orders placed online [C1].',
    ],
  ])('does not split a sentence at %s', (_name, answer) => {
    expect(findUncitedSentences(answer)).toEqual([]);
  });

  it('splits at a full stop followed by a capital, a digit or an opening mark', () => {
    const answer =
      'Refunds are decided by the policy service. 30 days is the limit for every order. "Approved" means the money was returned. (Some exceptions exist for gift cards.) `refund()` does the work for every request.';

    expect(findUncitedSentences(answer)).toHaveLength(5);
  });

  it('does not split at a full stop followed by a lowercase word', () => {
    const answer = 'This is the end. it goes on and on without any citation at all today';

    expect(findUncitedSentences(answer)).toHaveLength(1);
  });

  it('treats a run of full stops as one ending', () => {
    expect(
      findUncitedSentences('Refunds are decided somewhere in the policy service... Probably so.'),
    ).toHaveLength(1);
  });

  it('handles a closing mark after the full stop', () => {
    const answer =
      '(Refunds are decided by the policy service.) **Large ones need a manager to sign off.**';

    expect(findUncitedSentences(answer)).toHaveLength(2);
  });

  it('handles Windows line endings', () => {
    const answer =
      'Refunds are decided by the policy service [C1].\r\n\r\nLarge ones need a manager to sign off.\r\n';

    expect(findUncitedSentences(answer)).toEqual(['Large ones need a manager to sign off.']);
  });
});

describe('findUncitedSentences what is reported', () => {
  it('reports at most five sentences', () => {
    const answer = Array.from(
      { length: 8 },
      (_, index) => `Claim number ${index} is made here without any source.`,
    ).join(' ');

    const found = findUncitedSentences(answer);

    expect(found).toHaveLength(MAX_UNCITED_SENTENCES);
    expect(found[0]).toBe('Claim number 0 is made here without any source.');
  });

  it('cuts a long sentence and marks the cut', () => {
    const found = findUncitedSentences(`${'word '.repeat(100)}end.`);

    expect(found[0]).toHaveLength(MAX_REPORTED_LENGTH);
    expect(found[0].endsWith('…')).toBe(true);
  });

  it('does not cut a sentence of exactly the allowed length', () => {
    const text = `${'a'.repeat(MAX_REPORTED_LENGTH - 11)} b c d e f.`;

    expect(findUncitedSentences(text)).toEqual([text]);
  });
});

describe('sentencesCitingOnly', () => {
  it('finds a sentence whose only citations are of that kind', () => {
    const answer =
      'The ingest code lives in its own folder under src [G3]. Refunds take 30 days [C1].';

    expect(sentencesCitingOnly(answer, isFolder)).toEqual([
      'The ingest code lives in its own folder under src [G3].',
    ]);
  });

  it('counts every citation of the sentence, across brackets', () => {
    expect(sentencesCitingOnly('Both folders hold the code [G3][G4].', isFolder)).toHaveLength(1);
    expect(sentencesCitingOnly('Both folders hold the code [G3, G4].', isFolder)).toHaveLength(1);
  });

  it('leaves out a sentence that also cites another kind of source', () => {
    expect(sentencesCitingOnly('The folder holds the code [G3][C1].', isFolder)).toEqual([]);
    expect(sentencesCitingOnly('The folder holds the code [G3, G1].', isFolder)).toEqual([]);
  });

  it('leaves out a sentence with no citation', () => {
    expect(sentencesCitingOnly('The folder holds the code.', isFolder)).toEqual([]);
  });

  it('counts a citation that is already marked as an interpretation', () => {
    expect(sentencesCitingOnly('The folder holds the code [G3*].', isFolder)).toHaveLength(1);
  });

  it('judges short sentences too, because they still cite', () => {
    expect(sentencesCitingOnly('Code is here [G3].', isFolder)).toHaveLength(1);
  });
});

describe('markCitationsAsInferred', () => {
  it('adds an asterisk to the citations of a sentence that rests on folders alone', () => {
    const answer =
      'The ingest code lives in its own folder under src [G3]. Refunds take 30 days [C1].';

    expect(markCitationsAsInferred(answer, isFolder)).toEqual({
      answer: 'The ingest code lives in its own folder under src [G3*]. Refunds take 30 days [C1].',
      sentences: ['The ingest code lives in its own folder under src [G3].'],
    });
  });

  it('marks every key of a combined bracket and of adjacent brackets', () => {
    const answer = 'One [G3, G4]. Two [G3][G4]. Three [C1].';

    expect(markCitationsAsInferred(answer, isFolder).answer).toBe(
      'One [G3*][G4*]. Two [G3*][G4*]. Three [C1].',
    );
  });

  it('leaves a sentence that also cites a file alone', () => {
    const answer = 'The folder and the file agree [G3][G1].';

    expect(markCitationsAsInferred(answer, isFolder)).toEqual({ answer, sentences: [] });
  });

  it('keeps an asterisk that is already there', () => {
    expect(markCitationsAsInferred('Code is here [G3*].', isFolder).answer).toBe(
      'Code is here [G3*].',
    );
  });

  it('returns an answer with nothing to mark exactly as it was', () => {
    const answer = '# Title [G3]\n\nPlain text with no citations at all.\n';

    expect(markCitationsAsInferred(answer, isFolder)).toEqual({ answer, sentences: [] });
  });

  it('leaves everything around the marked citations as it was', () => {
    const answer = `# Title\n\n- The folder holds the code [G3]\n- Other things happen elsewhere [C1]\n\n${FENCE}\ncode [G3]\n${FENCE}\n`;

    expect(markCitationsAsInferred(answer, isFolder).answer).toBe(
      answer.replace('code [G3]\n- Other', 'code [G3*]\n- Other'),
    );
  });
});

describe('findUncitedSentences short paragraphs that end with a citation', () => {
  const CLAIM_A = 'Refunds are allowed within thirty days of the order date.';
  const CLAIM_B = 'Large refunds also need a manager to approve them first.';
  const CLAIM_C = 'The approval is recorded in the order history for audit.';
  const CLAIM_D = 'Staff can see the history from the order detail screen.';

  it('counts a paragraph of up to three sentences as cited when the last one cites', () => {
    const answer = `${CLAIM_A} ${CLAIM_B} ${CLAIM_C} [C1]`;

    expect(findUncitedSentences(answer)).toEqual([]);
  });

  it('does not cover a paragraph of four sentences', () => {
    const answer = `${CLAIM_A} ${CLAIM_B} ${CLAIM_C} ${CLAIM_D} [C1]`;

    expect(findUncitedSentences(answer)).toEqual([CLAIM_A, CLAIM_B, CLAIM_C]);
  });

  it('does not cover a short paragraph whose last sentence has no citation', () => {
    const answer = `${CLAIM_A} [C1] ${CLAIM_B}`;

    expect(findUncitedSentences(answer)).toEqual([CLAIM_B]);
  });

  it('does not let a citation in the next paragraph cover this one', () => {
    const answer = `${CLAIM_A}\n\n${CLAIM_B} [C1]`;

    expect(findUncitedSentences(answer)).toEqual([CLAIM_A]);
  });

  it('judges each list item as its own paragraph', () => {
    const answer = `- ${CLAIM_A} [C1]\n- ${CLAIM_B}`;

    expect(findUncitedSentences(answer)).toEqual([CLAIM_B]);
  });

  it('counts a citation with an asterisk as a citation', () => {
    expect(findUncitedSentences(`${CLAIM_A} ${CLAIM_B} [G1*]`)).toEqual([]);
  });
});
