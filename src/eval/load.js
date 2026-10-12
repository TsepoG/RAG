// @ts-check
import { readFile as readTextFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { EvalError } from '../errors/index.js';
import { caseSchema, fileSchema } from './schema.js';

/** Where the owner's real eval set is, relative to the working directory. */
export const EVAL_FILE = 'eval/questions.yaml';

/** The committed example, shown when the real set is missing. */
export const EXAMPLE_FILE = 'eval/questions.example.yaml';

/** The tag of the subset that is re-run after each change. */
const SMOKE_TAG = 'smoke';

/**
 * What `loadCases` needs, all replaceable in tests.
 * @typedef {object} LoadOptions
 * @property {string} [file] - The YAML file to read.
 * @property {(path: string, encoding: 'utf8') => Promise<string>} [readFile] - Reads a file.
 * @property {ReadonlySet<string> | ReadonlyMap<string, unknown>} roles - The role ids that exist.
 */

/**
 * Which cases to run.
 * @typedef {object} Selection
 * @property {'smoke' | 'full'} [subset] - `smoke` is the cases tagged smoke; `full` is all. Left
 *   out, it is all, unless `ids` is given.
 * @property {ReadonlyArray<string>} [ids] - These cases; together with a subset, both.
 * @property {string} [caseId] - Only the case with this id.
 * @property {string} [role] - Only the cases for this role.
 */

/**
 * Describes where a problem is, by case id when there is one.
 * @param {unknown} entry - The raw case.
 * @param {number} index - Its place in the list, from 0.
 * @returns {string} The case id, or its place in the list.
 */
function label(entry, index) {
  const id = typeof entry === 'object' && entry !== null ? Reflect.get(entry, 'id') : undefined;
  return typeof id === 'string' && id !== '' ? `Case "${id}"` : `Case #${index + 1}`;
}

/**
 * Reads the file as text, with a message that says what to do when it is missing.
 * @param {string} file - The path.
 * @param {(path: string, encoding: 'utf8') => Promise<string>} readFile - Reads a file.
 * @returns {Promise<string>} The text.
 * @throws {EvalError} When the file cannot be read.
 */
async function readCases(file, readFile) {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    const missing = error instanceof Error && Reflect.get(error, 'code') === 'ENOENT';
    const hint = missing ? ` Copy ${EXAMPLE_FILE} to ${EVAL_FILE} and write your own cases.` : '';
    throw new EvalError(`Cannot read the eval set ${file}.${hint}`, { cause: error });
  }
}

/**
 * Parses the YAML text into the raw list of cases.
 * @param {string} source - The file text.
 * @param {string} file - The path, for messages.
 * @returns {unknown[]} The raw cases.
 * @throws {EvalError} When the text is not YAML or has no `cases` list.
 */
function parseCases(source, file) {
  /** @type {unknown} */
  let document;
  try {
    document = parse(source);
  } catch (error) {
    throw new EvalError(`${file} is not valid YAML.`, { cause: error });
  }
  const shape = fileSchema.safeParse(document);
  if (!shape.success) {
    throw new EvalError(`${file} must have a top-level "cases" list.`);
  }
  return shape.data.cases;
}

/**
 * Checks each case and collects every problem, so one run of the loader reports them all.
 * @param {unknown[]} entries - The raw cases.
 * @param {ReadonlySet<string> | ReadonlyMap<string, unknown>} roles - The role ids that exist.
 * @returns {{ cases: import('./schema.js').EvalCase[], problems: string[] }} The valid cases and the problems.
 */
function validate(entries, roles) {
  /** @type {import('./schema.js').EvalCase[]} */
  const cases = [];
  /** @type {string[]} */
  const problems = [];
  const seen = new Set();
  entries.forEach((entry, index) => {
    const where = label(entry, index);
    const result = caseSchema.safeParse(entry);
    if (!result.success) {
      for (const issue of result.error.issues) {
        problems.push(`${where}: ${issue.path.join('.') || 'case'}: ${issue.message}`);
      }
      return;
    }
    const { id, role } = result.data;
    if (seen.has(id)) {
      problems.push(`${where}: the id is used more than once`);
    }
    if (!roles.has(role)) {
      problems.push(
        `${where}: unknown role "${role}". Valid roles: ${[...roleIds(roles)].join(', ')}`,
      );
    }
    seen.add(id);
    cases.push(result.data);
  });
  return { cases, problems };
}

/**
 * The role ids in a set or a map.
 * @param {ReadonlySet<string> | ReadonlyMap<string, unknown>} roles - The roles.
 * @returns {Iterable<string>} The ids.
 */
function roleIds(roles) {
  return roles instanceof Map ? roles.keys() : /** @type {ReadonlySet<string>} */ (roles);
}

/**
 * Loads and checks the eval set. Every problem in the file is reported at once, each with the id
 * of its case. Cases still marked `draft: true` are loaded, so they can be reviewed; the runner
 * refuses them with {@link assertRunnable}.
 * @param {LoadOptions} options - The file, how to read it, and the roles that exist.
 * @returns {Promise<ReadonlyArray<Readonly<import('./schema.js').EvalCase>>>} The cases, in file order.
 * @throws {EvalError} When the file is missing, is not valid, or has a case that is not.
 */
export async function loadCases({ file = EVAL_FILE, readFile = readTextFile, roles }) {
  const entries = parseCases(await readCases(file, readFile), file);
  const { cases, problems } = validate(entries, roles);
  if (problems.length > 0) {
    const lines = problems.map((line) => `- ${line}`);
    throw new EvalError([`${file} has problems:`, ...lines].join('\n'));
  }
  return Object.freeze(cases.map((one) => Object.freeze(one)));
}

/**
 * Whether a case belongs to the chosen subset or list of ids. With ids and no subset, only the
 * listed cases; with both, the listed cases and the subset together.
 * @param {import('./schema.js').EvalCase} one - The case.
 * @param {Selection} selection - What to keep.
 * @returns {boolean} Whether it is in.
 */
function isSelected(one, { subset, ids }) {
  const inSubset = subset === 'full' || (subset === 'smoke' && one.tags.includes(SMOKE_TAG));
  if (ids === undefined) {
    return subset === undefined || inSubset;
  }
  return ids.includes(one.id) || inSubset;
}

/**
 * Picks the cases to run.
 * @param {ReadonlyArray<import('./schema.js').EvalCase>} cases - All the cases.
 * @param {Selection} [selection] - What to keep.
 * @returns {import('./schema.js').EvalCase[]} The chosen cases, in file order.
 * @throws {EvalError} When nothing is chosen, or `caseId` or one of `ids` names no case.
 */
export function selectCases(cases, selection = {}) {
  const { caseId, role, ids } = selection;
  const unknown = [...(caseId === undefined ? [] : [caseId]), ...(ids ?? [])].filter(
    (wanted) => !cases.some(({ id }) => id === wanted),
  );
  if (unknown.length > 0) {
    const quoted = unknown.map((id) => '"' + id + '"').join(', ');
    throw new EvalError(`There is no case with the id ${quoted}.`);
  }
  const chosen = cases.filter(
    (one) =>
      isSelected(one, selection) &&
      (caseId === undefined || one.id === caseId) &&
      (role === undefined || one.role === role),
  );
  if (chosen.length === 0) {
    throw new EvalError('No case matches that selection.');
  }
  return chosen;
}

/**
 * Refuses to run a selection that still has unverified cases.
 * @param {ReadonlyArray<import('./schema.js').EvalCase>} cases - The chosen cases.
 * @throws {EvalError} Naming each case that is still a draft.
 */
export function assertRunnable(cases) {
  const drafts = cases.filter(({ draft }) => draft).map(({ id }) => id);
  if (drafts.length > 0) {
    throw new EvalError(
      `These cases are still drafts. Check each one and remove "draft: true" before running: ${drafts.join(', ')}`,
    );
  }
}
