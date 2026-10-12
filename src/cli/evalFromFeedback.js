// @ts-check
import { access, readFile, writeFile } from 'node:fs/promises';
import { AppError } from '../errors/index.js';
import {
  EVAL_FILE,
  FEEDBACK_PATH,
  feedbackToDraftCases,
  formatDraftCases,
  loadCases,
  parseFeedbackLines,
} from '../eval/index.js';
import { loadRoles } from '../roles/index.js';
import { describeError, EXIT_FAILURE } from './shared.js';

/** Where the drafts are written. It is git-ignored, like the eval set. */
const DRAFTS_FILE = 'eval/questions.from-feedback.yaml';

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
 * Turns the thumbs-down feedback in `data/feedback.jsonl` into draft eval cases in
 * `eval/questions.from-feedback.yaml`, for the owner to check and copy into the eval set. A
 * question that is already in the eval set, or was asked more than once, is drafted once at most.
 * It never replaces a drafts file that exists, because the owner may have started editing it.
 */
async function main() {
  try {
    if (await exists(DRAFTS_FILE)) {
      throw new AppError(`${DRAFTS_FILE} already exists. Move or delete it to make a fresh one.`);
    }
    const text = await readFile(FEEDBACK_PATH, 'utf8').catch((error) => {
      throw new AppError(
        `Cannot read ${FEEDBACK_PATH}. Give some feedback in the web page first.`,
        {
          cause: error,
        },
      );
    });
    const { records, skipped } = parseFeedbackLines(text);
    const existing = (await exists(EVAL_FILE)) ? await loadCases({ roles: await loadRoles() }) : [];
    const { cases, repeats } = feedbackToDraftCases(records, existing);
    if (cases.length === 0) {
      process.stdout.write('There is no new thumbs-down feedback to turn into cases.\n');
      return;
    }
    await writeFile(DRAFTS_FILE, formatDraftCases(cases));
    process.stdout.write(
      `Wrote ${cases.length} draft cases to ${DRAFTS_FILE} (${repeats} repeats skipped, ${skipped} unreadable lines). Check each one, then copy it into ${EVAL_FILE}.\n`,
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
