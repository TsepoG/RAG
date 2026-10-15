// @ts-check
import { parseArgs } from 'node:util';
import { EvalError } from '../errors/index.js';

/** Shown when the arguments are not understood. */
export const EVAL_USAGE =
  'Usage: npm run eval -- [--subset smoke|full] [--case <id>] [--ids <id,id,...>] [--role <id>] [--path single|conversation] [--max-requests <n>] [--yes]';

const SUBSETS = new Set(['smoke', 'full']);
const PATHS = new Set(['single', 'conversation']);

/**
 * What the command line asked for.
 * @typedef {object} EvalArguments
 * @property {'smoke' | 'full' | undefined} subset - Which cases to run; `full` unless `--subset smoke`
 *   or `--ids` is given, when it is only what was asked for.
 * @property {string[] | undefined} ids - Only these cases (with `--subset smoke`, these and the smoke ones).
 * @property {string | undefined} caseId - Only this case.
 * @property {string | undefined} role - Only this role's cases.
 * @property {'single' | 'conversation'} path - How each case is asked: as a question on its own
 *   (the default; a conversation case is skipped), or as a conversation, one turn after another.
 * @property {number | undefined} maxRequests - The most Copilot requests to use.
 * @property {boolean} yes - Whether to start without asking.
 */

/**
 * Reads a comma-separated list of case ids.
 * @param {unknown} value - What `--ids` was given.
 * @returns {string[] | undefined} The ids, or undefined when the option was not used.
 * @throws {EvalError} When the list has nothing in it.
 */
function parseIds(value) {
  if (typeof value !== 'string') {
    return undefined;
  }
  const ids = [
    ...new Set(
      value
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id !== ''),
    ),
  ];
  if (ids.length === 0) {
    throw new EvalError(`--ids needs at least one case id. ${EVAL_USAGE}`);
  }
  return ids;
}

/**
 * Reads the command line of `eval`.
 * @param {ReadonlyArray<string>} argv - The arguments after the script name.
 * @returns {EvalArguments} What was asked for.
 * @throws {EvalError} When an option is unknown, has no value, or has a value that is not allowed;
 *   the message says which, and the usage.
 */
export function parseEvalArguments(argv) {
  /** @type {ReturnType<typeof parseArgs>['values']} */
  let values;
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: {
        subset: { type: 'string' },
        case: { type: 'string' },
        ids: { type: 'string' },
        role: { type: 'string' },
        path: { type: 'string' },
        'max-requests': { type: 'string' },
        yes: { type: 'boolean' },
      },
      allowPositionals: false,
      strict: true,
    }));
  } catch (error) {
    throw new EvalError(EVAL_USAGE, { cause: error });
  }
  const ids = parseIds(values.ids);
  const subset = String(values.subset ?? (ids === undefined ? 'full' : ''));
  if (subset !== '' && !SUBSETS.has(subset)) {
    throw new EvalError(`--subset must be smoke or full, not "${subset}". ${EVAL_USAGE}`);
  }
  const path = String(values.path ?? 'single');
  if (!PATHS.has(path)) {
    throw new EvalError(`--path must be single or conversation, not "${path}". ${EVAL_USAGE}`);
  }
  const rawMax = values['max-requests'];
  const maxRequests = rawMax === undefined ? undefined : Number(rawMax);
  if (maxRequests !== undefined && (!Number.isInteger(maxRequests) || maxRequests < 1)) {
    throw new EvalError(`--max-requests must be a whole number of at least 1. ${EVAL_USAGE}`);
  }
  return {
    subset: subset === '' ? undefined : /** @type {'smoke' | 'full'} */ (subset),
    ids,
    caseId: typeof values.case === 'string' ? values.case : undefined,
    role: typeof values.role === 'string' ? values.role : undefined,
    path: /** @type {'single' | 'conversation'} */ (path),
    maxRequests,
    yes: values.yes === true,
  };
}
