// @ts-check
import { isAbsolute, join } from 'node:path';
import { z } from 'zod';
import { EvalError } from '../errors/index.js';

/** The name of the file a run's cases are written to. */
export const RESULTS_FILE = 'results.jsonl';

/** Where runs are written, relative to the working directory. */
export const RESULTS_DIRECTORY = 'eval/results';

/**
 * Finds a run's folder from what was typed: a bare name is looked for under `eval/results`, and
 * anything with a path in it is used as it is.
 * @param {string} name - A folder name or path.
 * @returns {string} The folder.
 */
export function resolveRunFolder(name) {
  const hasPath = isAbsolute(name) || name.includes('/') || name.includes('\\');
  return hasPath ? name : join(RESULTS_DIRECTORY, name);
}

/** The name of the file a run's summary is written to. */
export const SUMMARY_FILE = 'summary.md';

const runLine = z.looseObject({
  type: z.literal('run'),
  startedAt: z.string(),
  commit: z.string(),
  dirty: z.boolean(),
  model: z.string(),
  roles: z.record(z.string(), z.number()),
  basePromptHash: z.string(),
  requests: z.looseObject({ used: z.number(), casesRun: z.number(), stoppedEarly: z.boolean() }),
  interrupted: z.boolean(),
});

const caseLine = z.looseObject({
  type: z.literal('case'),
  id: z.string(),
  role: z.string(),
  question: z.string(),
  score: z.looseObject({ id: z.string(), status: z.string(), passed: z.boolean() }),
});

/**
 * The first line of a results file: what the run was tied to and what it used.
 * @typedef {import('./run.js').RunInfo & {
 *   startedAt: string,
 *   requests: { limit?: number, used: number, casesRun: number, stoppedEarly: boolean },
 *   interrupted: boolean,
 * }} RunHeader
 */

/**
 * Writes a run as JSON lines: one line for the run, then one for each case. A line never holds a
 * line break, so the file can be read back one line at a time.
 * @param {RunHeader} header - What the run was tied to and what it used.
 * @param {ReadonlyArray<import('./run.js').RunEntry>} entries - The cases, as they ran.
 * @returns {string} The file's text, ending with a line break.
 */
export function formatResults(header, entries) {
  const lines = [
    { type: 'run', ...header },
    ...entries.map((entry) => ({ type: 'case', ...entry })),
  ];
  return `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`;
}

/**
 * Reads a results file back.
 * @param {string} text - The file's text.
 * @returns {{ header: RunHeader, entries: import('./run.js').RunEntry[] }} The run and its cases.
 * @throws {EvalError} When a line is not JSON, or the file does not start with a run line.
 */
export function parseResults(text) {
  const lines = text.split('\n').filter((line) => line.trim() !== '');
  const [first, ...rest] = lines.map((line, index) => {
    try {
      return /** @type {unknown} */ (JSON.parse(line));
    } catch (error) {
      throw new EvalError(`Line ${index + 1} of the results is not JSON.`, { cause: error });
    }
  });
  const header = runLine.safeParse(first);
  if (!header.success) {
    throw new EvalError('The results must start with a line that describes the run.');
  }
  const entries = rest.map((line, index) => {
    const parsed = caseLine.safeParse(line);
    if (!parsed.success) {
      throw new EvalError(`Line ${index + 2} of the results is not a case.`);
    }
    return withoutType(parsed.data);
  });
  return {
    header: /** @type {RunHeader} */ (/** @type {unknown} */ (withoutType(header.data))),
    entries: /** @type {import('./run.js').RunEntry[]} */ (/** @type {unknown} */ (entries)),
  };
}

/**
 * Removes the `type` that marks what kind of line it was.
 * @param {Record<string, unknown>} line - The parsed line.
 * @returns {Record<string, unknown>} The same fields without `type`.
 */
function withoutType(line) {
  return Object.fromEntries(Object.entries(line).filter(([name]) => name !== 'type'));
}
