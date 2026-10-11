// @ts-check
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { AppError } from '../errors/index.js';
import {
  buildReport,
  FEEDBACK_PATH,
  parseFeedbackLines,
  parseResults,
  parseReviewCsv,
  resolveRunFolder,
  RESULTS_FILE,
  REVIEW_FILE,
  summariseFeedback,
} from '../eval/index.js';
import { describeError, EXIT_FAILURE } from './shared.js';

const USAGE = 'Usage: npm run eval:report -- <run folder name or path> [--compare <earlier run>]';
const REPORT_FILE = 'report.md';

/**
 * Reads a file, or gives undefined when it does not exist.
 * @param {string} path - The file.
 * @returns {Promise<string | undefined>} The text, or undefined when there is no such file.
 * @throws {unknown} Any other failure to read it.
 */
async function readIfThere(path) {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error instanceof Error && Reflect.get(error, 'code') === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

/**
 * Reads a run's results.
 * @param {string} folder - The run's folder.
 * @returns {Promise<ReturnType<typeof parseResults>>} The run and its cases.
 * @throws {AppError} When there is no results file.
 */
async function readRun(folder) {
  const text = await readIfThere(join(folder, RESULTS_FILE));
  if (text === undefined) {
    throw new AppError(`There is no ${RESULTS_FILE} in ${folder}.`);
  }
  return parseResults(text);
}

/**
 * Writes `report.md` for a run: the MVP targets, correctness and calibration from the review sheet,
 * every automatic measure, a comparison with an earlier run when `--compare` is given, and a
 * summary of the web page's feedback. A missing review sheet or feedback file is not an error; the
 * report says what could not be measured.
 */
async function main() {
  try {
    const { values, positionals } = parseArgs({
      args: process.argv.slice(2),
      options: { compare: { type: 'string' } },
      allowPositionals: true,
    });
    if (positionals.length !== 1) {
      throw new AppError(USAGE);
    }
    const folder = resolveRunFolder(positionals[0]);
    const { header, entries } = await readRun(folder);
    const scores = entries.map(({ score }) => score);
    const sheet = await readIfThere(join(folder, REVIEW_FILE));
    const review =
      sheet === undefined
        ? undefined
        : parseReviewCsv(
            sheet,
            entries.map(({ id }) => id),
          );
    const feedbackText = await readIfThere(FEEDBACK_PATH);
    const parsed = feedbackText === undefined ? undefined : parseFeedbackLines(feedbackText);
    const earlier =
      values.compare === undefined ? undefined : await readRun(resolveRunFolder(values.compare));
    const report = buildReport({
      header,
      scores,
      judgements: review?.judgements ?? new Map(),
      review,
      feedback:
        parsed === undefined
          ? undefined
          : { summary: summariseFeedback(parsed.records), skipped: parsed.skipped },
      previous:
        earlier === undefined
          ? undefined
          : { header: earlier.header, scores: earlier.entries.map(({ score }) => score) },
    });
    await writeFile(join(folder, REPORT_FILE), report);
    process.stdout.write(`${report}\nWritten to ${join(folder, REPORT_FILE)}\n`);
  } catch (error) {
    if (!(error instanceof AppError)) {
      throw error;
    }
    process.stderr.write(`${describeError(error)}\n`);
    process.exitCode = EXIT_FAILURE;
  }
}

await main();
