// @ts-check
import { EvalError } from '../errors/index.js';
import { parseCsv, toCsv } from './csv.js';

/** The verdicts the owner may give an answered case. */
export const VERDICTS = Object.freeze(/** @type {const} */ (['correct', 'partial', 'wrong']));

/** The columns of the review sheet. The owner fills in the last two. */
export const REVIEW_COLUMNS = Object.freeze([
  'id',
  'role',
  'question',
  'reference',
  'answer',
  'sources',
  'status',
  'confidence',
  'verdict',
  'note',
]);

/** The name of the sheet inside a run's folder. */
export const REVIEW_FILE = 'review.csv';

/**
 * One row of the sheet, before the owner has judged it.
 * @typedef {object} ReviewRow
 * @property {string} id - The case id.
 * @property {string} role - The role id.
 * @property {string} question - What was asked.
 * @property {string} reference - The expected answer, for the reviewer.
 * @property {string} answer - What the assistant said.
 * @property {string} sources - The sources it cited.
 * @property {string} status - The status it returned.
 * @property {string} confidence - The confidence it claimed, or empty.
 */

/**
 * The owner's judgement of one answer.
 * @typedef {{ verdict: typeof VERDICTS[number], note: string }} Judgement
 */

/**
 * Writes the sources an answer cited, one per phrase.
 * @param {Record<string, unknown> | undefined} result - The stored answer.
 * @returns {string} For example `[C1] Refund Policy; [G1] src/refunds/window.js`.
 */
function sourcesText(result) {
  const sources = Array.isArray(result?.sources) ? result.sources : [];
  return sources.map(({ key, title }) => `[${key}] ${title}`).join('; ');
}

/**
 * Builds the rows of the review sheet from a run's cases.
 * @param {ReadonlyArray<import('./run.js').RunEntry>} entries - The cases, as they ran.
 * @returns {ReviewRow[]} One row per case, in the order they ran.
 */
export function buildReviewRows(entries) {
  return entries.map(({ id, role, question, reference, score, result, error }) => ({
    id,
    role,
    question,
    reference,
    answer:
      error === undefined
        ? String(result?.answer ?? '')
        : `ERROR (${error.kind}): ${error.message}`,
    sources: sourcesText(result),
    status: score.status,
    confidence: score.confidence ?? '',
  }));
}

/**
 * Writes the review sheet: a header, then a row per case with empty `verdict` and `note` columns.
 * @param {ReadonlyArray<ReviewRow>} rows - The rows.
 * @returns {string} The CSV text.
 */
export function toReviewCsv(rows) {
  return toCsv([
    [...REVIEW_COLUMNS],
    ...rows.map((row) => [
      row.id,
      row.role,
      row.question,
      row.reference,
      row.answer,
      row.sources,
      row.status,
      row.confidence,
      '',
      '',
    ]),
  ]);
}

/**
 * What reading the sheet back found.
 * @typedef {object} ReviewResult
 * @property {Map<string, Judgement>} judgements - The cases the owner judged, by id.
 * @property {string[]} blank - Ids of rows with no verdict yet.
 * @property {string[]} missing - Ids that are in the run but have no row in the sheet.
 */

/**
 * Whether text is one of the verdicts.
 * @param {string} text - The text.
 * @returns {text is Judgement['verdict']} True for correct, partial or wrong.
 */
function isVerdict(text) {
  return VERDICTS.some((verdict) => verdict === text);
}

/**
 * Finds a column in the header.
 * @param {ReadonlyArray<string>} header - The header cells.
 * @param {string} name - The column name.
 * @returns {number} Its position.
 * @throws {EvalError} When the column is missing.
 */
function columnOf(header, name) {
  const index = header.findIndex((cell) => cell.trim().toLowerCase() === name);
  if (index === -1) {
    throw new EvalError(`The review sheet has no "${name}" column.`);
  }
  return index;
}

/**
 * Reads the owner's verdicts from the sheet. Every problem is reported together. A blank verdict
 * is allowed (and listed), because a case that was not answered needs none.
 * @param {string} text - The CSV text.
 * @param {ReadonlyArray<string>} ids - The ids of the cases in the run.
 * @returns {ReviewResult} The verdicts, the rows still blank, and the cases with no row.
 * @throws {EvalError} For a missing column, an unknown id, a repeated id or a verdict that is not
 *   correct, partial or wrong.
 */
export function parseReviewCsv(text, ids) {
  const [header, ...rows] = parseCsv(text);
  if (header === undefined) {
    throw new EvalError('The review sheet is empty.');
  }
  const idColumn = columnOf(header, 'id');
  const verdictColumn = columnOf(header, 'verdict');
  const noteColumn = header.findIndex((cell) => cell.trim().toLowerCase() === 'note');
  const known = new Set(ids);
  /** @type {Map<string, Judgement>} */
  const judgements = new Map();
  /** @type {string[]} */
  const seen = [];
  /** @type {string[]} */
  const blank = [];
  /** @type {string[]} */
  const problems = [];
  rows.forEach((cells, index) => {
    const id = (cells[idColumn] ?? '').trim();
    const verdict = (cells[verdictColumn] ?? '').trim().toLowerCase();
    const where = `Row ${index + 2} ("${id}")`;
    if (!known.has(id)) {
      problems.push(`${where}: this case is not in the run`);
    } else if (seen.includes(id)) {
      problems.push(`${where}: the id appears more than once`);
    } else if (verdict === '') {
      blank.push(id);
    } else if (!isVerdict(verdict)) {
      problems.push(`${where}: "${verdict}" is not one of ${VERDICTS.join(', ')}`);
    } else {
      judgements.set(id, {
        verdict,
        note: noteColumn === -1 ? '' : (cells[noteColumn] ?? '').trim(),
      });
    }
    seen.push(id);
  });
  if (problems.length > 0) {
    throw new EvalError(
      ['The review sheet has problems:', ...problems.map((line) => `- ${line}`)].join('\n'),
    );
  }
  return { judgements, blank, missing: ids.filter((id) => !seen.includes(id)) };
}
