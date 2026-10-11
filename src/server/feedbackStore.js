// @ts-check
import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { AppError } from '../errors/index.js';

/** The file feedback is added to, one JSON object per line. */
export const FEEDBACK_FILE = 'feedback.jsonl';

/**
 * What the person said about an answer.
 * @typedef {object} FeedbackInput
 * @property {'up' | 'down'} rating - Thumbs up or down.
 * @property {string} [comment] - Anything they wanted to add.
 * @property {string} [wrongSourceKey] - The key of a source they say is wrong.
 */

/**
 * Where feedback goes, and how, so a test can use a folder of its own and a clock it controls.
 * @typedef {object} FeedbackStoreDeps
 * @property {string} dir - The folder, for example `data`; created when it is missing.
 * @property {{ now: () => Date }} [clock] - Time source; defaults to the system clock.
 * @property {typeof appendFile} [appendFile] - Adds text to a file.
 * @property {typeof mkdir} [mkdir] - Creates a folder.
 */

/**
 * Builds the line to store. The fields are listed one by one, so nothing else that is in the
 * record, such as the answer text or a token, can end up in the file.
 * @param {import('./answers.js').AnswerRecord} answer - What is known about the answer.
 * @param {FeedbackInput} input - What the person said.
 * @param {Date} when - When they said it.
 * @returns {string} One JSON object, without a line break.
 */
export function buildFeedbackLine(answer, input, when) {
  return JSON.stringify({
    timestamp: when.toISOString(),
    question: answer.question,
    role: answer.role,
    detailLevel: answer.detailLevel,
    status: answer.status,
    confidence: answer.confidence,
    citedKeys: answer.citedKeys,
    rating: input.rating,
    comment: input.comment ?? null,
    wrongSourceKey: input.wrongSourceKey ?? null,
    model: answer.model ?? null,
  });
}

/**
 * Adds one piece of feedback to the feedback file.
 * @param {import('./answers.js').AnswerRecord} answer - What is known about the answer.
 * @param {FeedbackInput} input - What the person said.
 * @param {FeedbackStoreDeps} deps - Where and how to write.
 * @returns {Promise<void>} Resolves once the line is written.
 * @throws {AppError} When the file cannot be written.
 */
export async function appendFeedback(answer, input, deps) {
  const {
    dir,
    clock = { now: () => new Date() },
    appendFile: add = appendFile,
    mkdir: make = mkdir,
  } = deps;
  const line = buildFeedbackLine(answer, input, clock.now());
  try {
    await make(dir, { recursive: true });
    await add(join(dir, FEEDBACK_FILE), `${line}\n`, 'utf8');
  } catch (error) {
    throw new AppError('Could not save the feedback', { cause: error });
  }
}
