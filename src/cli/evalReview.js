// @ts-check
import { access, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AppError } from '../errors/index.js';
import {
  buildReviewRows,
  parseResults,
  resolveRunFolder,
  RESULTS_FILE,
  REVIEW_FILE,
  toReviewCsv,
} from '../eval/index.js';
import { describeError, EXIT_FAILURE } from './shared.js';

const USAGE = 'Usage: npm run eval:review -- <run folder name or path>';

/**
 * Whether a file exists.
 * @param {string} path - The file.
 * @returns {Promise<boolean>} True when it can be read.
 */
async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Writes `review.csv` for a run: one row per case with the question, the reference, what the
 * assistant said and its sources, and empty `verdict` and `note` columns for the owner to fill in.
 * It never replaces a sheet that already exists, because that would throw away the verdicts in it.
 */
async function main() {
  try {
    const [name, ...extra] = process.argv.slice(2);
    if (name === undefined || extra.length > 0) {
      throw new AppError(USAGE);
    }
    const folder = resolveRunFolder(name);
    const target = join(folder, REVIEW_FILE);
    if (await exists(target)) {
      throw new AppError(`${target} already exists. Move or delete it to write a fresh sheet.`);
    }
    const text = await readFile(join(folder, RESULTS_FILE), 'utf8').catch((error) => {
      throw new AppError(`Cannot read ${join(folder, RESULTS_FILE)}.`, { cause: error });
    });
    const { entries } = parseResults(text);
    await writeFile(target, toReviewCsv(buildReviewRows(entries)));
    process.stdout.write(
      `Wrote ${target} with ${entries.length} rows. Fill in the verdict column (correct, partial or wrong) for each answered case.\n`,
    );
  } catch (error) {
    if (!(error instanceof AppError)) {
      throw error;
    }
    process.stderr.write(`${describeError(error)}\n`);
    process.exitCode = EXIT_FAILURE;
  }
}

await main();
