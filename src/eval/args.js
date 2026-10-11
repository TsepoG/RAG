// @ts-check
import { parseArgs } from 'node:util';
import { EvalError } from '../errors/index.js';

/** Shown when the arguments are not understood. */
export const EVAL_USAGE =
  'Usage: npm run eval -- [--subset smoke|full] [--case <id>] [--role <id>] [--max-requests <n>] [--yes]';

const SUBSETS = new Set(['smoke', 'full']);

/**
 * What the command line asked for.
 * @typedef {object} EvalArguments
 * @property {'smoke' | 'full'} subset - Which cases to run; `full` unless `--subset smoke`.
 * @property {string | undefined} caseId - Only this case.
 * @property {string | undefined} role - Only this role's cases.
 * @property {number | undefined} maxRequests - The most Copilot requests to use.
 * @property {boolean} yes - Whether to start without asking.
 */

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
        role: { type: 'string' },
        'max-requests': { type: 'string' },
        yes: { type: 'boolean' },
      },
      allowPositionals: false,
      strict: true,
    }));
  } catch (error) {
    throw new EvalError(EVAL_USAGE, { cause: error });
  }
  const subset = String(values.subset ?? 'full');
  if (!SUBSETS.has(subset)) {
    throw new EvalError(`--subset must be smoke or full, not "${subset}". ${EVAL_USAGE}`);
  }
  const rawMax = values['max-requests'];
  const maxRequests = rawMax === undefined ? undefined : Number(rawMax);
  if (maxRequests !== undefined && (!Number.isInteger(maxRequests) || maxRequests < 1)) {
    throw new EvalError(`--max-requests must be a whole number of at least 1. ${EVAL_USAGE}`);
  }
  return {
    subset: /** @type {'smoke' | 'full'} */ (subset),
    caseId: typeof values.case === 'string' ? values.case : undefined,
    role: typeof values.role === 'string' ? values.role : undefined,
    maxRequests,
    yes: values.yes === true,
  };
}
