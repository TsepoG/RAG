// @ts-check
import { z } from 'zod';

// Messages describe the rule, never the offending value, in the style of the config schema.

const ROLE_ID_PATTERN = /^[a-z][a-z\d_]*$/;
const MIN_DEPTH = 1;
const MAX_DEPTH = 3;
const MAX_EXAMPLES = 3;
const SOURCE_ORDERS = [
  ['confluence', 'github'],
  ['github', 'confluence'],
];
const SOURCE_ORDER_MESSAGE = 'must be [confluence, github] or [github, confluence]';

const text = z
  .string({ error: (issue) => (issue.input === undefined ? 'is required' : 'must be text') })
  .trim()
  .min(1, 'must not be empty');

const textList = (/** @type {number} */ min) =>
  z
    .array(text, {
      error: (issue) => (issue.input === undefined ? 'is required' : 'must be a list'),
    })
    .min(min, min === 0 ? 'must be a list' : 'must have at least one entry');

const example = z
  .object({ question: text, answer: text }, { error: 'must have a question and an answer' })
  .strict();

/**
 * Schema for one role file. Unknown fields are rejected so a misspelt field is caught instead of
 * silently ignored.
 */
export const roleSchema = z
  .object({
    id: text.regex(ROLE_ID_PATTERN, 'must be lower snake_case, such as product_owner'),
    displayName: text,
    description: text.refine((value) => !value.includes('\n'), 'must be a single line'),
    audience: text,
    depth: z
      .number({ error: `must be ${MIN_DEPTH}, 2 or ${MAX_DEPTH}` })
      .int(`must be ${MIN_DEPTH}, 2 or ${MAX_DEPTH}`)
      .min(MIN_DEPTH, `must be ${MIN_DEPTH}, 2 or ${MAX_DEPTH}`)
      .max(MAX_DEPTH, `must be ${MIN_DEPTH}, 2 or ${MAX_DEPTH}`),
    vocabulary: textList(1),
    bannedTerms: textList(0),
    sourcePriority: z
      .array(z.string(), { error: SOURCE_ORDER_MESSAGE })
      .refine(
        (order) => SOURCE_ORDERS.some((allowed) => allowed.join() === order.join()),
        SOURCE_ORDER_MESSAGE,
      ),
    answerShape: textList(1),
    examples: z
      .array(example, { error: 'must be a list of question and answer pairs' })
      .min(1, 'must have at least one example')
      .max(MAX_EXAMPLES, `must have at most ${MAX_EXAMPLES} examples`),
    version: z
      .number({ error: 'must be a whole number from 1' })
      .int('must be a whole number from 1')
      .min(1, 'must be a whole number from 1'),
  })
  .strict();

/**
 * A validated role profile.
 * @typedef {Readonly<z.output<typeof roleSchema>>} Role
 */
