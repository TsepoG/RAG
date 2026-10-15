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
 * @property {string} reference - The short expected answer, as it was when the case ran.
 * @property {{ caseId: string, turn: number, turns: number } | undefined} [conversation] - For a
 *   turn of a conversation case: the case, the turn, and how many turns it has. Each turn is its
 *   own entry, with the id `<case>` for the first and `<case>-t<n>` for the others.
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
 * Lists the models that actually answered. With no model set, Copilot picks one and can pick a
 * different one from run to run, which would change results without anything in the code changing.
 * @param {ReadonlyArray<import('./run.js').RunEntry>} entries - The cases, as they ran.
 * @returns {string[]} The distinct model names Copilot reported, in alphabetical order.
 */
export function modelsSeen(entries) {
  const names = entries.flatMap(({ result }) =>
    typeof result?.model === 'string' ? [result.model] : [],
  );
  return [...new Set(names)].sort((a, b) => a.localeCompare(b));
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
 * A conversation being played: asks one question after another in the same conversation.
 * @typedef {object} PlayedConversation
 * @property {(input: { question: string, signal?: AbortSignal }) => Promise<import('../answer/index.js').AskResult & { reusedKeys?: ReadonlyArray<string> }>} ask -
 *   Asks the next question.
 */

/**
 * The dependencies of a run, all injected so a test needs no Copilot and no clock.
 * @typedef {object} RunDeps
 * @property {ReadonlyArray<import('./schema.js').EvalCase>} cases - The cases to run, in order.
 * @property {ReadonlyMap<string, import('../roles/index.js').Role>} roles - The loaded roles.
 * @property {(input: import('../answer/index.js').AskInput) => Promise<import('../answer/index.js').AskResult>} ask
 *   Answers a question; `askQuestion` with its dependencies bound.
 * @property {'single' | 'conversation'} [path] - `single` (the default) asks each case as a question
 *   on its own and skips a case with several turns; `conversation` asks every case in a conversation.
 * @property {(role: import('../roles/index.js').Role) => Promise<PlayedConversation>} [startConversation] -
 *   Starts a conversation as a role; needed for the `conversation` path.
 * @property {import('./budget.js').RequestGuard} guard - Counts requests and says when to stop.
 * @property {{ now: () => number }} clock - Time source in milliseconds.
 * @property {number} maxToolCalls - The limit on tool calls for one question.
 * @property {ReadonlyArray<string>} secrets - Values that must never be written to a result.
 * @property {AbortSignal} [signal] - Aborting it ends the run after stopping the current question.
 * @property {(entry: RunEntry, done: number, total: number) => void} [onCase] - Told as each case
 *   (or each turn of a conversation) finishes.
 */

/** Said for a turn that was not asked because an earlier turn of its conversation failed. */
const SKIPPED_TURN = Object.freeze({
  kind: 'SkippedTurn',
  message: 'An earlier turn of this conversation failed, so this turn was not asked.',
});

/**
 * Splits a case into the turns it asks: the first under the case's own id, and each follow-up
 * under `<id>-t<n>`. An ordinary case has one turn.
 * @param {import('./schema.js').EvalCase} one - The case.
 * @returns {import('./schema.js').EvalCase[]} One case per turn, each with its own question and expectation.
 */
function turnsOf(one) {
  const { followUps = [], ...first } = one;
  return [
    first,
    ...followUps.map((next, index) => ({ ...first, ...next, id: `${one.id}-t${index + 2}` })),
  ];
}

/**
 * The parts of a case a result line repeats, and for a turn of a conversation which turn it is.
 * @param {import('./schema.js').EvalCase} turn - The case, or one turn of a conversation.
 * @param {import('./schema.js').EvalCase} whole - The case the turn belongs to.
 * @param {number} number - The turn, from 1.
 * @returns {Pick<RunEntry, 'id' | 'role' | 'question' | 'tags' | 'reference' | 'conversation'>} The parts.
 */
function entryParts({ id, role, question, tags, expect: expected }, whole, number) {
  const turns = 1 + (whole.followUps?.length ?? 0);
  return {
    id,
    role,
    question,
    tags,
    reference: expected.reference,
    ...(turns === 1 ? {} : { conversation: { caseId: whole.id, turn: number, turns } }),
  };
}

/**
 * Runs the cases one after another through the real pipeline. A question that fails is recorded
 * as an error and the run goes on. It stops, keeping what it has, when the request limit is
 * reached or the signal is aborted.
 *
 * On the `conversation` path each case is a conversation, and each of its turns is an entry of
 * its own, scored on its own. If a turn fails, the turns after it are recorded as not asked.
 * On the `single` path a case with several turns is left out and listed in `skipped`.
 * @param {RunDeps} deps - What to run and how.
 * @returns {Promise<{ entries: RunEntry[], requests: ReturnType<import('./budget.js').RequestGuard['report']>, interrupted: boolean, skipped: string[] }>}
 *   Each turn as it ran, what the run used, whether it was interrupted, and the cases left out.
 * @throws {EvalError} When a case names a role that is not loaded, or the `conversation` path has no way to start one.
 */
export async function runEval({
  cases,
  roles,
  ask,
  path = 'single',
  startConversation,
  guard,
  clock,
  maxToolCalls,
  secrets,
  signal,
  onCase,
}) {
  if (path === 'conversation' && startConversation === undefined) {
    throw new EvalError('Running as conversations needs a way to start one.');
  }
  const runnable = cases.filter((one) => path === 'conversation' || one.followUps === undefined);
  const skipped = cases.filter((one) => !runnable.includes(one)).map(({ id }) => id);
  const total = runnable.reduce((sum, one) => sum + 1 + (one.followUps?.length ?? 0), 0);
  /** @type {RunEntry[]} */
  const entries = [];
  const finish = (/** @type {RunEntry} */ entry) => {
    entries.push(entry);
    onCase?.(entry, entries.length, total);
  };

  /**
   * Asks one turn and scores it; a failure becomes an error entry.
   * @param {import('./schema.js').EvalCase} turn - The turn as a case.
   * @param {import('./schema.js').EvalCase} whole - The case it belongs to.
   * @param {number} number - Which turn, from 1.
   * @param {(question: string) => Promise<import('../answer/index.js').AskResult & { reusedKeys?: ReadonlyArray<string> }>} send - Asks it.
   * @returns {Promise<{ entry: RunEntry | undefined, failed: boolean }>} The entry, or none when the run was stopped.
   */
  async function playTurn(turn, whole, number, send) {
    const role = /** @type {import('../roles/index.js').Role} */ (roles.get(turn.role));
    const started = clock.now();
    try {
      const result = await send(turn.question);
      guard.record(result);
      return {
        failed: false,
        entry: {
          ...entryParts(turn, whole, number),
          score: scoreCase(turn, result, { depth: role.depth, maxToolCalls }),
          result: sanitiseResult(result),
          error: undefined,
        },
      };
    } catch (error) {
      if (signal?.aborted === true) {
        return { entry: undefined, failed: true };
      }
      guard.record({});
      return {
        failed: true,
        entry: {
          ...entryParts(turn, whole, number),
          score: scoreFailure(turn, clock.now() - started),
          result: undefined,
          error: failureOf(error, secrets),
        },
      };
    }
  }

  /**
   * Plays every turn of a case, in one conversation or as one question.
   * @param {import('./schema.js').EvalCase} one - The case.
   * @returns {Promise<boolean>} False when the run was stopped while it played.
   */
  async function playCase(one) {
    const role = roles.get(one.role);
    if (role === undefined) {
      throw new EvalError(`Case "${one.id}" names the role "${one.role}", which is not loaded.`);
    }
    const turns = turnsOf(one);
    /** @type {PlayedConversation | undefined} */
    let conversation;
    let failed = false;
    for (const [index, turn] of turns.entries()) {
      if (failed) {
        finish({
          ...entryParts(turn, one, index + 1),
          score: scoreFailure(turn, 0),
          result: undefined,
          error: SKIPPED_TURN,
        });
        continue;
      }
      const send =
        path === 'conversation'
          ? async (/** @type {string} */ question) => {
              conversation ??= await /** @type {NonNullable<typeof startConversation>} */ (
                startConversation
              )(role);
              return conversation.ask({ question, signal });
            }
          : (/** @type {string} */ question) =>
              ask({ question, role, detailLevel: 'default', signal });
      const played = await playTurn(turn, one, index + 1, send);
      if (played.entry === undefined) {
        return false;
      }
      finish(played.entry);
      failed = played.failed;
    }
    return true;
  }

  let interrupted = false;
  for (const one of runnable) {
    interrupted = signal?.aborted === true;
    if (interrupted || !guard.canStart()) {
      break;
    }
    if (!(await playCase(one))) {
      interrupted = true;
      break;
    }
  }
  return { entries, requests: guard.report(), interrupted, skipped };
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
