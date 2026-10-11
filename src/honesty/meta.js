// @ts-check
import { z } from 'zod';

/** What the model may report as the outcome of a question. */
export const ANSWER_STATUSES = Object.freeze(['answered', 'not_found', 'clarify', 'out_of_scope']);

/** How sure the model says it is, lowest last. */
export const CONFIDENCE_LEVELS = Object.freeze(['high', 'medium', 'low']);

const BLOCK_INFO = 'answer-meta';
const MIN_FENCE_LENGTH = 3;
const FENCE_CHARACTER = '`';
const MAX_TEXT_LENGTH = 300;
const MAX_GAPS = 10;
const MAX_CONFLICTS = 5;
const MAX_KEYS = 10;
const NOT_AT_END = /** @type {const} */ ('not-at-end');

const text = z.string().trim().min(1).max(MAX_TEXT_LENGTH);
const keys = z.array(z.string().trim().min(1).max(MAX_TEXT_LENGTH)).max(MAX_KEYS);

const conflictSchema = z.object({
  topic: text,
  docSays: text,
  docKeys: keys,
  codeSays: text,
  codeKeys: keys,
});

/**
 * The block the model ends its reply with. Unknown extra fields are ignored rather than rejected,
 * because a harmless extra field should not cost an answer its reported confidence.
 */
export const answerMetaSchema = z
  .object({
    status: z.enum(ANSWER_STATUSES),
    confidence: z.enum(CONFIDENCE_LEVELS).optional(),
    confidenceReason: text,
    gaps: z.array(text).max(MAX_GAPS),
    conflicts: z.array(conflictSchema).max(MAX_CONFLICTS),
    clarifyingQuestion: text.optional(),
  })
  .superRefine((meta, context) => {
    if (meta.status === 'answered' && meta.confidence === undefined) {
      context.addIssue({ code: 'custom', path: ['confidence'], message: 'is required' });
    }
    if (meta.status === 'clarify' && meta.clarifyingQuestion === undefined) {
      context.addIssue({ code: 'custom', path: ['clarifyingQuestion'], message: 'is required' });
    }
  });

/**
 * The checked block.
 * @typedef {z.output<typeof answerMetaSchema>} AnswerMeta
 */

/**
 * What reading the end of a reply found.
 * @typedef {object} ParsedAnswer
 * @property {string} answer - The reply without the `answer-meta` block.
 * @property {AnswerMeta} [meta] - The checked block, when there is a valid one.
 * @property {'missing' | 'invalid-json' | 'invalid-shape'} [metaError] - Why there is no valid
 *   block. The answer treats all three as "the confidence was not reported".
 * @property {'not-at-end'} [warning] - Set when text followed the block. The block was still
 *   used, and that text was put back into the answer.
 */

/**
 * Reads a line as a code fence.
 * @param {string} line - One line of the reply.
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
 * Finds the last `answer-meta` block. A block that is never closed runs to the end of the reply,
 * as it would if the reply was cut short.
 * @param {ReadonlyArray<string>} lines - The lines of the reply.
 * @returns {{ start: number, end: number, closed: boolean } | undefined} The first and last line
 *   of the block (the closing fence included when there is one), or undefined when there is none.
 */
function findLastBlock(lines) {
  /** @type {{ start: number, end: number, closed: boolean } | undefined} */
  let found;
  let index = 0;
  while (index < lines.length) {
    const opening = readFence(lines[index]);
    if (opening.ticks < MIN_FENCE_LENGTH || opening.info.toLowerCase() !== BLOCK_INFO) {
      index += 1;
      continue;
    }
    let end = index + 1;
    while (end < lines.length) {
      const closing = readFence(lines[end]);
      if (closing.ticks >= opening.ticks && closing.info === '') {
        break;
      }
      end += 1;
    }
    found = { start: index, end: Math.min(end, lines.length - 1), closed: end < lines.length };
    index = end + 1;
  }
  return found;
}

/**
 * Checks the text inside a block.
 * @param {string} body - The text between the fences.
 * @returns {{ meta: AnswerMeta } | { metaError: 'invalid-json' | 'invalid-shape' }} The block, or why not.
 */
function readBody(body) {
  let value;
  try {
    value = JSON.parse(body);
  } catch {
    return { metaError: 'invalid-json' };
  }
  const checked = answerMetaSchema.safeParse(value);
  return checked.success ? { meta: checked.data } : { metaError: 'invalid-shape' };
}

/**
 * Takes the `answer-meta` block off the end of the model's reply and checks it. The block never
 * stays in the answer, whether or not it is valid. Only the last block counts; any earlier one is
 * left in the text. Text after the block is kept in the answer and reported as a warning.
 * @param {string} reply - The model's whole reply.
 * @returns {ParsedAnswer} The answer, and the block or the reason there is none.
 */
export function parseAnswerMeta(reply) {
  const lines = reply.split('\n');
  const block = findLastBlock(lines);
  if (block === undefined) {
    return { answer: reply, metaError: 'missing' };
  }
  const body = lines.slice(block.start + 1, block.closed ? block.end : block.end + 1).join('\n');
  const before = lines.slice(0, block.start).join('\n').trimEnd();
  const after = lines
    .slice(block.end + 1)
    .join('\n')
    .trim();
  const answer = before === '' || after === '' ? `${before}${after}` : `${before}\n\n${after}`;
  return {
    answer,
    ...readBody(body),
    ...(after === '' ? {} : { warning: NOT_AT_END }),
  };
}
