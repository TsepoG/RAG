// @ts-check
import { z } from 'zod';

/** Where the web page writes feedback, relative to the working directory. */
export const FEEDBACK_PATH = 'data/feedback.jsonl';

const record = z.looseObject({
  timestamp: z.string(),
  question: z.string(),
  role: z.string(),
  detailLevel: z.string(),
  status: z.string(),
  confidence: z.string().nullable(),
  citedKeys: z.array(z.string()),
  rating: z.enum(['up', 'down']),
  comment: z.string().nullable(),
  wrongSourceKey: z.string().nullable(),
  model: z.string().nullable(),
});

/**
 * One piece of feedback, as the web page saved it. It never holds the answer text.
 * @typedef {z.output<typeof record>} FeedbackRecord
 */

/**
 * Reads the feedback file. A line that cannot be read is skipped and counted, because the file is
 * only ever added to and one bad line should not hide the rest.
 * @param {string} text - The file's text.
 * @returns {{ records: FeedbackRecord[], skipped: number }} The feedback, and how many lines were skipped.
 */
export function parseFeedbackLines(text) {
  /** @type {FeedbackRecord[]} */
  const records = [];
  let skipped = 0;
  for (const line of text.split('\n').filter((one) => one.trim() !== '')) {
    const parsed = parseLine(line);
    if (parsed === undefined) {
      skipped += 1;
    } else {
      records.push(parsed);
    }
  }
  return { records, skipped };
}

/**
 * Reads one line of the feedback file.
 * @param {string} line - The line.
 * @returns {FeedbackRecord | undefined} The record, or undefined when the line is not valid.
 */
function parseLine(line) {
  try {
    const parsed = record.safeParse(JSON.parse(line));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Thumbs up and down.
 * @typedef {{ up: number, down: number }} Votes
 */

/**
 * What the feedback adds up to.
 * @typedef {object} FeedbackSummary
 * @property {number} total - How many pieces of feedback.
 * @property {Votes} votes - Thumbs up and down.
 * @property {number | undefined} upShare - The share of thumbs up; undefined when there is none.
 * @property {Record<string, Votes>} byRole - Votes for each role.
 * @property {Record<string, Votes>} byStatus - Votes for each status the answer had.
 * @property {Record<string, number>} wrongSources - How many times each source key was named as wrong.
 * @property {number} comments - How many pieces of feedback have a comment.
 */

/**
 * Counts votes by a key.
 * @param {ReadonlyArray<FeedbackRecord>} records - The feedback.
 * @param {(one: FeedbackRecord) => string} keyOf - The group each piece belongs to.
 * @returns {Record<string, Votes>} The votes for each group, in alphabetical order of group.
 */
function votesBy(records, keyOf) {
  /** @type {Record<string, Votes>} */
  const groups = {};
  for (const one of records) {
    groups[keyOf(one)] ??= { up: 0, down: 0 };
    groups[keyOf(one)][one.rating] += 1;
  }
  return Object.fromEntries(Object.entries(groups).sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * Adds up the feedback. Pure.
 * @param {ReadonlyArray<FeedbackRecord>} records - The feedback.
 * @returns {FeedbackSummary} The counts.
 */
export function summariseFeedback(records) {
  const up = records.filter(({ rating }) => rating === 'up').length;
  /** @type {Record<string, number>} */
  const wrongSources = {};
  for (const { wrongSourceKey } of records) {
    if (wrongSourceKey !== null) {
      wrongSources[wrongSourceKey] = (wrongSources[wrongSourceKey] ?? 0) + 1;
    }
  }
  return {
    total: records.length,
    votes: { up, down: records.length - up },
    upShare: records.length === 0 ? undefined : up / records.length,
    byRole: votesBy(records, ({ role }) => role),
    byStatus: votesBy(records, ({ status }) => status),
    wrongSources: Object.fromEntries(
      Object.entries(wrongSources).sort(([a], [b]) => a.localeCompare(b)),
    ),
    comments: records.filter(({ comment }) => comment !== null && comment !== '').length,
  };
}
