// @ts-check
import { listSecrets } from '../config/index.js';
import {
  AppError,
  AskTimeoutError,
  CopilotError,
  QuestionCancelledError,
} from '../errors/index.js';
import { createCodeownersLookup, createCommitResolver, createGithubApi } from '../github/index.js';
import { createToolHooks } from '../mcp/index.js';
import { finishesWithin } from '../copilot/index.js';
import { bestEffort, createCancellation, createDeadline, SHUTDOWN_TIMEOUT_MS } from './deadline.js';
import { finishAnswer } from './finish.js';

/**
 * The stages every question goes through, whether it is alone in its session or one turn of a
 * conversation. `askQuestion` composes them in order; the conversation code reuses them, so the
 * two cannot drift apart.
 */

/** The parts of a session the stages use. */
/** @typedef {Pick<import('@github/copilot-sdk').CopilotSession, 'on' | 'send' | 'abort' | 'disconnect'>} SessionHandle */

/**
 * Makes the function that tells the caller what is happening. A progress display failing must not
 * fail the question, so a failure of the receiver is logged and dropped.
 * @param {((activity: import('./askQuestion.js').Activity) => void) | undefined} onActivity - The receiver, if any.
 * @param {Pick<import('../logger/index.js').Logger, 'warn'>} logger - Where a failure is logged.
 * @returns {(activity: import('./askQuestion.js').Activity) => void} The function to call.
 */
export function createNotifier(onActivity, logger) {
  return (activity) => {
    try {
      onActivity?.(activity);
    } catch (error) {
      logger.warn({ err: error }, 'could not report progress');
    }
  };
}

/**
 * What can end a question early: the time limit, or the person asking to stop it.
 * @typedef {object} Interrupt
 * @property {Promise<never>} interrupt - Rejects at whichever comes first.
 * @property {Promise<never>} cancellation - Rejects only when the person stops the question.
 * @property {() => void} stop - Clears the timer and the listener once the question is over.
 */

/**
 * Starts the clock and the watch for a stop.
 * @param {{ askTimeoutMs: number, signal: AbortSignal | undefined }} input - The limit and the signal.
 * @returns {Interrupt} What can end the question early.
 */
export function startInterrupt({ askTimeoutMs, signal }) {
  const deadline = createDeadline(askTimeoutMs);
  const cancellation = createCancellation(signal);
  // Whichever comes first: the time limit or the person stopping the question.
  const interrupt = Promise.race([deadline.promise, cancellation.promise]);
  interrupt.catch(() => undefined);
  return {
    interrupt,
    cancellation: cancellation.promise,
    stop() {
      deadline.cancel();
      cancellation.cancel();
    },
  };
}

/**
 * Creates the lookups a question uses against GitHub: head commits to pin links to, and
 * CODEOWNERS to suggest who to ask.
 * @param {{ config: import('../config/index.js').AppConfig, fetch: typeof fetch | undefined, logger: import('../logger/index.js').Logger }} input - Config, fetch and logger.
 * @returns {{ commits: ReturnType<typeof createCommitResolver>, owners: ReturnType<typeof createCodeownersLookup> }} The lookups.
 */
export function createLookups({ config, fetch, logger }) {
  const api = createGithubApi({ token: config.github.token, fetch });
  return {
    commits: createCommitResolver({
      token: config.github.token,
      repos: config.github.repos,
      api,
      logger,
    }),
    owners: createCodeownersLookup({ api, repos: config.github.repos, logger }),
  };
}

/**
 * Builds the hooks around one question's registry and gate.
 * @param {{
 *   config: import('../config/index.js').AppConfig,
 *   registry: import('../citations/index.js').CitationRegistry,
 *   gate: import('../mcp/index.js').ToolGate,
 *   commits: { resolveHead: (repo: string) => Promise<string | undefined> },
 *   logger: import('../logger/index.js').Logger,
 *   clock: { now: () => number },
 *   budget?: import('../mcp/index.js').CallBudget,
 *   onSourceText?: (chars: number) => void,
 * }} input - What the hooks check against and write to. A conversation passes its own call budget
 *   and a receiver for the size of each source.
 * @returns {ReturnType<typeof createToolHooks>} The hooks.
 */
export function buildQuestionHooks({
  config,
  registry,
  gate,
  commits,
  logger,
  clock,
  budget,
  onSourceText,
}) {
  return createToolHooks({
    repos: config.github.repos,
    spaceKeys: config.atlassian.spaceKeys,
    siteUrl: config.atlassian.siteUrl,
    cloudId: config.atlassian.cloudId,
    maxToolCalls: config.mcp.maxToolCalls,
    secrets: listSecrets(config),
    registry,
    resolveHead: commits.resolveHead,
    gate,
    budget,
    onSourceText,
    logger,
    clock,
  });
}

/**
 * Checks what the model replied and builds the result of the question: the checked answer with its
 * status, confidence and sources, and how it was reached.
 * @param {{
 *   events: ReturnType<typeof import('./events.js').createEventRecorder>,
 *   startedAt: number,
 *   detailLevel: import('../roles/index.js').DetailLevel,
 * } & Omit<import('./finish.js').FinishInput, 'reply'>} input - The recorder, when the question
 *   started, the level of detail, and what finishing needs.
 * @returns {Promise<import('./askQuestion.js').AskResult>} The result.
 * @throws {QuestionCancelledError} When the question is stopped while it is being finished.
 */
export async function completeTurn({ events, startedAt, detailLevel, ...finishInput }) {
  const { answer: reply, toolCalls, model, modelChanges, modelCalls } = events.result();
  const composed = await finishAnswer({ reply, ...finishInput });
  return {
    ...composed,
    detailLevel,
    toolCalls,
    model,
    modelChanges,
    modelCalls,
    durationMs: finishInput.clock.now() - startedAt,
  };
}

/**
 * Turns whatever stopped a question into the error to throw, after stopping the work the session
 * was doing if it was interrupted. An error of ours is passed on; any other is wrapped.
 * @param {unknown} error - What was thrown.
 * @param {{ session: SessionHandle | undefined, logger: import('../logger/index.js').Logger }} input - The open session, if any, and the logger.
 * @returns {Promise<Error>} The error to throw.
 */
export async function toTurnError(error, { session, logger }) {
  if (error instanceof QuestionCancelledError) {
    logger.info({}, 'the question was cancelled; aborting the session');
  }
  const interrupted = error instanceof AskTimeoutError || error instanceof QuestionCancelledError;
  if (interrupted && session !== undefined) {
    await bestEffort('abort the interrupted question', () => session.abort(), logger);
  }
  return error instanceof AppError
    ? error
    : new CopilotError('Copilot could not answer the question', { cause: error });
}

/**
 * Disconnects a session without letting that fail or hang the caller.
 * @param {SessionHandle | undefined} session - The session, if one was opened.
 * @param {import('../logger/index.js').Logger} logger - Where trouble is logged.
 * @returns {Promise<void>} Resolves when it is done, failed or out of time.
 */
export async function disconnectSession(session, logger) {
  if (session !== undefined) {
    await bestEffort('disconnect the session', () => session.disconnect(), logger);
  }
}

/**
 * Starts watching for the session to go quiet again. Call it before aborting a turn, then wait on
 * the result: the abort ends with the runtime saying the session is idle, and an idle that arrived
 * late would otherwise be taken for the end of the next turn.
 * @param {Pick<SessionHandle, 'on'>} session - The session.
 * @returns {{ quiet: () => Promise<boolean>, stop: () => void }} `quiet` resolves true when the
 *   session went idle (or reported an error) within the shutdown time, false when it did not;
 *   `stop` removes the listeners.
 */
export function awaitQuiet(session) {
  /** @type {Array<() => void>} */
  const unsubscribers = [];
  const heard = new Promise((done) => {
    unsubscribers.push(
      session.on('session.idle', () => done(undefined)),
      session.on('session.error', () => done(undefined)),
    );
  });
  return {
    quiet: () => finishesWithin(heard, SHUTDOWN_TIMEOUT_MS),
    stop: () => unsubscribers.forEach((unsubscribe) => unsubscribe()),
  };
}
