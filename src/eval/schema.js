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
    reference: text,
  })
  .strict();

/**
 * One eval case. `draft: true` marks a case the owner has not verified yet; the runner refuses it.
 */
export const caseSchema = z
  .object({
    id: z
      .string()
      .regex(ID_PATTERN, 'must be lower-case words joined by dashes, such as po-refund-window'),
    role: text,
    question: text.max(MAX_QUESTION_LENGTH, `must be at most ${MAX_QUESTION_LENGTH} characters`),
    tags: z
      .array(z.enum(CASE_TAGS, { error: `must be one of ${CASE_TAGS.join(', ')}` }))
      .default([]),
    draft: z.boolean().default(false),
    expect: expectation,
  })
  .strict()
  .superRefine((value, context) => {
    const { status, sources, mustNotCite, maxConfidence } = value.expect;
    if (status !== 'answered' && sources !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['expect', 'sources'],
        message: 'only an answered case can expect sources to be cited',
      });
    }
    if (status !== 'answered' && maxConfidence !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['expect', 'maxConfidence'],
        message: 'only an answered case has a confidence',
      });
    }
    if (status !== 'answered' && mustNotCite !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['expect', 'mustNotCite'],
        message: 'only an answered case cites anything',
      });
    }
  });

/**
 * One eval case as it is used after loading.
 * @typedef {z.output<typeof caseSchema>} EvalCase
 */

/**
 * The whole file: a `cases` list, so the file can start with comments and a note.
 */
export const fileSchema = z
  .object({ cases: z.array(z.unknown(), { error: 'must be a list of cases' }) })
  .strict();
