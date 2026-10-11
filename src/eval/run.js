// @ts-check
import { createHash } from 'node:crypto';
import { buildBaseMessage } from '../copilot/index.js';
import { EvalError } from '../errors/index.js';
import { maskSecrets } from '../logger/index.js';
import { scoreCase, scoreFailure } from './score.js';

/** How many characters of a failure's message are kept. */
const MAX_ERROR_CHARS = 300;

/** How many hex digits of the prompt hash are kept; enough to tell two prompts apart. */
const HASH_LENGTH = 12;

/** The length of `YYYYMMDD-HHMMSS`. */
const DATE_PREFIX_LENGTH = 15;

/**
 * What a run is tied to, so two runs can be compared knowing what changed between them.
 * @typedef {object} RunInfo
 * @property {string} commit - The git commit the code was at.
 * @property {boolean} dirty - Whether the working tree had uncommitted changes.
 * @property {string} model - The model asked for, or `default`.
 * @property {Record<string, number>} roles - Each role's version.
 * @property {string} basePromptHash - A short hash of the base prompt every role shares.
 */

/**
 * One case as it ran: what was asked, how it scored, and the answer or the failure.
 * @typedef {object} RunEntry
 * @property {string} id - The case id.
 * @property {string} role - The role id.
 * @property {string} question - What was asked.
 * @property {ReadonlyArray<string>} tags - The case's tags.
 * @property {import('./score.js').CaseScore} score - How it scored.
 * @property {Record<string, unknown> | undefined} result - The answer, without the arguments of tool calls.
 * @property {{ kind: string, message: string } | undefined} error - Why there is no answer.
 */

/**
 * Reads what a run is tied to. The git lookup is a parameter so tests need no repository.
 * @param {object} input - Where to read it from.
 * @param {() => Promise<{ commit: string, dirty: boolean }>} input.git - Finds the commit and whether the tree is dirty.
 * @param {ReadonlyMap<string, { version: number }>} input.roles - The loaded roles.
 * @param {import('../config/index.js').AppConfig} input.config - The config.
 * @returns {Promise<RunInfo>} What the run is tied to.
 */
export async function collectRunInfo({ git, roles, config }) {
  const { commit, dirty } = await git();
  const base = buildBaseMessage({
    spaceKeys: config.atlassian.spaceKeys,
    repos: config.github.repos,
    siteUrl: config.atlassian.siteUrl,
    cloudId: config.atlassian.cloudId,
  });
  return {
    commit,
    dirty,
    model: config.copilot.model ?? 'default',
    roles: Object.fromEntries([...roles].map(([id, role]) => [id, role.version])),
    basePromptHash: createHash('sha256').update(base).digest('hex').slice(0, HASH_LENGTH),
  };
}

/**
 * The name of the folder a run is written to.
 * @param {Date} when - When the run started.
 * @returns {string} `YYYYMMDD-HHMMSS` in UTC, which sorts by time.
 */
export function runFolderName(when) {
  return when.toISOString().replaceAll(/[-:]/g, '').replace('T', '-').slice(0, DATE_PREFIX_LENGTH);
}

/**
 * Removes what must not be stored from an answer: the summary of each tool call's arguments.
 * @param {import('../answer/index.js').AskResult} result - What `askQuestion` returned.
 * @returns {Record<string, unknown>} The answer, safe to write to a file.
 */
export function sanitiseResult(result) {
  return {
    ...result,
    toolCalls: result.toolCalls.map(({ server, tool, durationMs, success }) => ({
      server,
      tool,
      durationMs,
      success,
    })),
  };
}

/**
 * The dependencies of a run, all injected so a test needs no Copilot and no clock.
 * @typedef {object} RunDeps
 * @property {ReadonlyArray<import('./schema.js').EvalCase>} cases - The cases to run, in order.
 * @property {ReadonlyMap<string, import('../roles/index.js').Role>} roles - The loaded roles.
 * @property {(input: import('../answer/index.js').AskInput) => Promise<import('../answer/index.js').AskResult>} ask
 *   Answers a question; `askQuestion` with its dependencies bound.
 * @property {import('./budget.js').RequestGuard} guard - Counts requests and says when to stop.
 * @property {{ now: () => number }} clock - Time source in milliseconds.
 * @property {number} maxToolCalls - The limit on tool calls for one question.
 * @property {ReadonlyArray<string>} secrets - Values that must never be written to a result.
 * @property {AbortSignal} [signal] - Aborting it ends the run after stopping the current question.
 * @property {(entry: RunEntry, done: number, total: number) => void} [onCase] - Told as each case finishes.
 */

/**
 * Runs the cases one after another through the real pipeline. A question that fails is recorded
 * as an error and the run goes on. It stops, keeping what it has, when the request limit is
 * reached or the signal is aborted.
 * @param {RunDeps} deps - What to run and how.
 * @returns {Promise<{ entries: RunEntry[], requests: ReturnType<import('./budget.js').RequestGuard['report']>, interrupted: boolean }>}
 *   Each case as it ran, what the run used, and whether it was interrupted.
 * @throws {EvalError} When a case names a role that is not loaded.
 */
export async function runEval({
  cases,
  roles,
  ask,
  guard,
  clock,
  maxToolCalls,
  secrets,
  signal,
  onCase,
}) {
  /** @type {RunEntry[]} */
  const entries = [];
  let interrupted = false;
  for (const one of cases) {
    interrupted = signal?.aborted === true;
    if (interrupted || !guard.canStart()) {
      break;
    }
    const role = roles.get(one.role);
    if (role === undefined) {
      throw new EvalError(`Case "${one.id}" names the role "${one.role}", which is not loaded.`);
    }
    const started = clock.now();
    /** @type {RunEntry} */
    let entry;
    try {
      const result = await ask({ question: one.question, role, detailLevel: 'default', signal });
      guard.record(result);
      entry = {
        ...caseParts(one),
        score: scoreCase(one, result, { depth: role.depth, maxToolCalls }),
        result: sanitiseResult(result),
        error: undefined,
      };
    } catch (error) {
      if (signal?.aborted === true) {
        interrupted = true;
        break;
      }
      guard.record({});
      entry = {
        ...caseParts(one),
        score: scoreFailure(one, clock.now() - started),
        result: undefined,
        error: failureOf(error, secrets),
      };
    }
    entries.push(entry);
    onCase?.(entry, entries.length, cases.length);
  }
  return { entries, requests: guard.report(), interrupted };
}

/**
 * The parts of a case a result line repeats.
 * @param {import('./schema.js').EvalCase} one - The case.
 * @returns {{ id: string, role: string, question: string, tags: ReadonlyArray<string> }} The parts.
 */
function caseParts({ id, role, question, tags }) {
  return { id, role, question, tags };
}

/**
 * Describes a failure without a stack and without any secret.
 * @param {unknown} error - What was thrown.
 * @param {ReadonlyArray<string>} secrets - Values to mask.
 * @returns {{ kind: string, message: string }} The kind of error and a safe message.
 */
function failureOf(error, secrets) {
  const known = error instanceof Error;
  return {
    kind: known ? error.name : 'Error',
    message: maskSecrets(known ? error.message : String(error), secrets, MAX_ERROR_CHARS),
  };
}
