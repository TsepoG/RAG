// @ts-check
import { z } from 'zod';
import { ANSWER_STATUSES, CONFIDENCE_LEVELS } from '../honesty/index.js';

/** The tags a case may carry. `smoke` marks the small subset that is re-run after each change. */
export const CASE_TAGS = Object.freeze(
  /** @type {const} */ ([
    'smoke',
    'not-found',
    'out-of-scope',
    'clarify',
    'style-trap',
    'stale',
    'conflict',
    'both-sources',
  ]),
);

/** The two places a source can come from. */
export const SOURCE_TYPES = Object.freeze(/** @type {const} */ (['confluence', 'github']));

/** The same limit as the web page and the API, so every eval question could be asked there. */
const MAX_QUESTION_LENGTH = 2000;

/** The most turns a conversation can have, the same as the highest `CONVERSATION_MAX_TURNS`. */
export const MAX_CASE_TURNS = 10;

/** The fewest turns of a multi-turn case; one turn is an ordinary case. */
const MIN_CASE_TURNS = 2;

const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

const text = z.string().trim().min(1, 'must not be empty');

const expectedSource = z
  .object({
    type: z.enum(SOURCE_TYPES, { error: `must be ${SOURCE_TYPES.join(' or ')}` }),
    match: text,
  })
  .strict();

const expectation = z
  .object({
    status: z.enum(ANSWER_STATUSES, { error: `must be one of ${ANSWER_STATUSES.join(', ')}` }),
    sources: z.array(expectedSource).optional(),
    mustNotCite: z.array(expectedSource).optional(),
    maxConfidence: z.enum(CONFIDENCE_LEVELS).optional(),
    // Only meaningful in a conversation: the answer must cite a source an earlier turn fetched.
    reusesEarlier: z.boolean().optional(),
    reference: text,
  })
  .strict();

const question = text.max(MAX_QUESTION_LENGTH, `must be at most ${MAX_QUESTION_LENGTH} characters`);

const turnSchema = z.object({ question, expect: expectation }).strict();

/**
 * What a case may hold before it is checked: a question and expectation, or turns.
 * @typedef {object} RawCase
 * @property {string} [question] - The question of a single-question case.
 * @property {z.output<typeof expectation>} [expect] - What it expects.
 * @property {Array<z.output<typeof turnSchema>>} [turns] - The turns of a conversation.
 */

/**
 * Checks that an expectation only asks for what its status allows.
 * @param {z.output<typeof expectation>} expected - What the case or turn expects.
 * @param {ReadonlyArray<string | number>} where - The path to it, for the messages.
 * @param {z.RefinementCtx} context - Where problems are reported.
 */
function checkExpectation(expected, where, context) {
  const { status, sources, mustNotCite, maxConfidence, reusesEarlier } = expected;
  /** @type {Array<[unknown, string, string]>} */
  const needsAnswer = [
    [sources, 'sources', 'only an answered case can expect sources to be cited'],
    [maxConfidence, 'maxConfidence', 'only an answered case has a confidence'],
    [mustNotCite, 'mustNotCite', 'only an answered case cites anything'],
    [reusesEarlier, 'reusesEarlier', 'only an answered case cites anything'],
  ];
  for (const [value, field, message] of needsAnswer) {
    if (status !== 'answered' && value !== undefined) {
      context.addIssue({ code: 'custom', path: [...where, field], message });
    }
  }
}

/**
 * Checks that a case is one form or the other, and that every expectation is allowed.
 * @param {RawCase} value - The case.
 * @param {z.RefinementCtx} context - Where problems are reported.
 */
function checkCase(value, context) {
  const single = value.question !== undefined || value.expect !== undefined;
  if (single && value.turns !== undefined) {
    context.addIssue({
      code: 'custom',
      path: ['turns'],
      message: 'a case has either question and expect, or turns, not both',
    });
  }
  if (!single && value.turns === undefined) {
    context.addIssue({
      code: 'custom',
      path: ['question'],
      message: 'a case needs a question and expect, or turns',
    });
  }
  if (single && value.question === undefined) {
    context.addIssue({ code: 'custom', path: ['question'], message: 'is required' });
  }
  if (single && value.expect === undefined) {
    context.addIssue({ code: 'custom', path: ['expect'], message: 'is required' });
  }
  if (value.expect !== undefined) {
    checkExpectation(value.expect, ['expect'], context);
  }
  value.turns?.forEach((one, index) =>
    checkExpectation(one.expect, ['turns', index, 'expect'], context),
  );
}

/**
 * One eval case. `draft: true` marks a case the owner has not verified yet; the runner refuses it.
 * A case is a single question (`question` and `expect`) or a conversation (`turns`, at least two).
 * Once loaded, both have `question` and `expect` for the first turn, and a conversation also has
 * `followUps`, its other turns, so code that only knows single questions still works on the first.
 */
export const caseSchema = z
  .object({
    id: z
      .string()
      .regex(ID_PATTERN, 'must be lower-case words joined by dashes, such as po-refund-window'),
    role: text,
    question: question.optional(),
    tags: z
      .array(z.enum(CASE_TAGS, { error: `must be one of ${CASE_TAGS.join(', ')}` }))
      .default([]),
    draft: z.boolean().default(false),
    expect: expectation.optional(),
    turns: z
      .array(turnSchema)
      .min(
        MIN_CASE_TURNS,
        `must have at least ${MIN_CASE_TURNS} turns; write one question as an ordinary case`,
      )
      .max(MAX_CASE_TURNS, `must have at most ${MAX_CASE_TURNS} turns`)
      .optional(),
  })
  .strict()
  .superRefine(checkCase)
  .transform(({ turns, question: first, expect: firstExpect, ...rest }) => {
    if (turns === undefined) {
      return {
        ...rest,
        question: /** @type {string} */ (first),
        expect: /** @type {z.output<typeof expectation>} */ (firstExpect),
      };
    }
    const [start, ...followUps] = turns;
    return { ...rest, question: start.question, expect: start.expect, followUps };
  });

/**
 * One turn of a conversation: what is asked and what is expected of the answer.
 * @typedef {z.output<typeof turnSchema>} CaseTurn
 */

/**
 * One eval case as it is used after loading. `followUps` is there only for a conversation.
 * @typedef {{
 *   id: string,
 *   role: string,
 *   question: string,
 *   tags: Array<(typeof CASE_TAGS)[number]>,
 *   draft: boolean,
 *   expect: z.output<typeof expectation>,
 *   followUps?: CaseTurn[],
 * }} EvalCase
 */

/**
 * The whole file: a `cases` list, so the file can start with comments and a note.
 */
export const fileSchema = z
  .object({ cases: z.array(z.unknown(), { error: 'must be a list of cases' }) })
  .strict();
