// @ts-check
import { stringify } from 'yaml';
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

/** The longest slug taken from a question, so ids stay readable. */
const SLUG_LENGTH = 40;

/** A line at the top of the drafts file, saying what to do with it. */
const DRAFT_HEADER = [
  '# Drafts made from thumbs-down feedback. Nothing here has been checked.',
  '# For each case: write the expected status, the sources it should cite and a short reference',
  '# answer, then delete "draft: true" and copy it into eval/questions.yaml.',
  '',
].join('\n');

/**
 * Makes a short readable piece of an id from a question.
 * @param {string} question - The question.
 * @returns {string} Lower-case words joined by dashes, at most 40 characters; `question` when it has none.
 */
function slugOf(question) {
  const words = question
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word !== '');
  const slug = words.join('-').slice(0, SLUG_LENGTH).replace(/-$/, '');
  return slug === '' ? 'question' : slug;
}

/**
 * Adds a number to an id until it is one that is not taken.
 * @param {string} base - The id to start from.
 * @param {ReadonlySet<string>} taken - Ids already in use.
 * @returns {string} `base`, or `base-2`, `base-3` and so on.
 */
function uniqueId(base, taken) {
  let id = base;
  let number = 1;
  while (taken.has(id)) {
    number += 1;
    id = `${base}-${number}`;
  }
  return id;
}

/**
 * The key two pieces of feedback share when they are about the same question for the same role.
 * @param {{ role: string, question: string }} one - The role and the question.
 * @returns {string} The key.
 */
function questionKey({ role, question }) {
  return `${role}|${question.trim().split(/\s+/).join(' ').toLowerCase()}`;
}

/**
 * Describes what the assistant did and what the person said, for the person writing the reference.
 * @param {FeedbackRecord} one - The thumbs-down feedback.
 * @returns {string} A reference that says plainly it still has to be written.
 */
function draftReference(one) {
  const given =
    one.confidence === null ? one.status : `${one.status}, ${one.confidence} confidence`;
  const parts = [
    'TO WRITE: what a correct answer says.',
    `The assistant gave: ${given}; it cited ${one.citedKeys.length === 0 ? 'nothing' : one.citedKeys.join(', ')}.`,
  ];
  if (one.comment !== null && one.comment !== '') {
    parts.push(`The person said: ${one.comment}`);
  }
  if (one.wrongSourceKey !== null) {
    parts.push(`They marked ${one.wrongSourceKey} as a wrong source.`);
  }
  return parts.join(' ');
}

/**
 * What turning feedback into drafts produced.
 * @typedef {object} DraftResult
 * @property {Array<Record<string, unknown>>} cases - The draft cases, each marked `draft: true`.
 * @property {number} repeats - Thumbs-down on a question that already has a draft or is in the set.
 */

/**
 * Turns each thumbs-down into a draft eval case for the owner to check. The expected status is a
 * placeholder (`answered`), because the feedback says the answer was bad and not what it should
 * have been. A question asked more than once, or already in the eval set, gets one case only.
 * @param {ReadonlyArray<FeedbackRecord>} records - All the feedback.
 * @param {ReadonlyArray<{ id: string, role: string, question: string }>} [existing] - Cases already
 *   in the eval set, so the same question is not drafted again.
 * @returns {DraftResult} The drafts, and how many repeats were skipped.
 */
export function feedbackToDraftCases(records, existing = []) {
  const seen = new Set(existing.map(questionKey));
  const ids = new Set(existing.map(({ id }) => id));
  /** @type {Array<Record<string, unknown>>} */
  const cases = [];
  let repeats = 0;
  for (const one of records.filter(({ rating }) => rating === 'down')) {
    if (seen.has(questionKey(one))) {
      repeats += 1;
      continue;
    }
    seen.add(questionKey(one));
    const base = `fb-${one.role.replaceAll('_', '-')}-${slugOf(one.question)}`;
    const id = uniqueId(base, ids);
    ids.add(id);
    cases.push({
      id,
      role: one.role,
      question: one.question,
      tags: [],
      draft: true,
      expect: { status: 'answered', reference: draftReference(one) },
    });
  }
  return { cases, repeats };
}

/**
 * Writes draft cases as the YAML file the owner will edit.
 * @param {ReadonlyArray<Record<string, unknown>>} cases - The drafts.
 * @returns {string} The file's text, starting with a note on what to do with it.
 */
export function formatDraftCases(cases) {
  return `${DRAFT_HEADER}${stringify({ cases }, { lineWidth: 0 })}`;
}
