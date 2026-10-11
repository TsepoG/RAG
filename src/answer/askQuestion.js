// @ts-check
import { createCitationRegistry } from '../citations/index.js';
import { listSecrets } from '../config/index.js';
import { buildSessionConfig } from '../copilot/index.js';
import {
  AppError,
  AskTimeoutError,
  CopilotError,
  QuestionCancelledError,
} from '../errors/index.js';
import { createCodeownersLookup, createCommitResolver, createGithubApi } from '../github/index.js';
import { createPermissionHandler, createToolGate, createToolHooks } from '../mcp/index.js';
import { withDetailLevel } from '../roles/index.js';
import { bestEffort, createCancellation, createDeadline } from './deadline.js';
import { createEventRecorder } from './events.js';
import { finishAnswer } from './finish.js';

/**
 * What to ask, and where to send the answer as it streams.
 * @typedef {object} AskInput
 * @property {string} question - The question.
 * @property {import('../roles/index.js').Role} role - The role the answer is written for.
 * @property {import('../roles/index.js').DetailLevel} [detailLevel] - `more` answers one step more
 *   technically than the role usually does; defaults to `default`.
 * @property {AbortSignal} [signal] - Aborting it stops the question: the session is aborted and
 *   disconnected, and the question throws a QuestionCancelledError.
 * @property {(activity: Activity) => void} [onActivity] - Told what the question is doing, for a
 *   progress display. Nothing in it comes from the content of a page or file.
 * @property {(text: string) => void} [onDelta] - Receives each piece of the model's reply as it
 *   arrives. The reply includes its answer-meta block, which is not part of the final answer.
 */

/**
 * Something the question is doing, as it happens.
 * @typedef {{ kind: 'tool', server: string, tool: string } | { kind: 'checking' } | { kind: 'rewriting' }} Activity
 */

/**
 * What `askQuestion` depends on, all injected so tests need no Copilot and no clock.
 * @typedef {object} AskDeps
 * @property {Pick<import('@github/copilot-sdk').CopilotClient, 'createSession'>} client - A started client.
 * @property {string} workingDirectory - The empty directory the session runs in.
 * @property {import('../config/index.js').AppConfig} config - Validated config.
 * @property {import('../logger/index.js').Logger} logger - Where hooks and cleanup log.
 * @property {{ now: () => number }} [clock] - Time source in milliseconds; defaults to Date.now.
 * @property {typeof fetch} [fetch] - Used to look up commits and CODEOWNERS; defaults to the global fetch.
 */

/**
 * The outcome of a question: the checked answer with its status, confidence and sources, and how it
 * was reached.
 * @typedef {import('./compose.js').ComposedResult & {
 *   detailLevel: import('../roles/index.js').DetailLevel,
 *   toolCalls: import('./toolCalls.js').ToolCallRecord[],
 *   model: string | undefined,
 *   durationMs: number,
 * }} AskResult
 */

/** The parts of a session this function uses. */
/** @typedef {Pick<import('@github/copilot-sdk').CopilotSession, 'on' | 'send' | 'abort' | 'disconnect'>} AskSession */

/** Real time, used unless a test injects its own clock. */
const SYSTEM_CLOCK = Object.freeze({ now: () => Date.now() });

/**
 * Sends a question to Copilot and returns the checked answer, its status and confidence, the tools
 * used and the model. A new session, with its own hooks, call limit and sources, is used for each
 * question and always disconnected. If the answer does not suit the role, it is rewritten once,
 * with tools locked.
 * @param {AskInput} input - The question and an optional receiver for streamed text.
 * @param {AskDeps} deps - Client, config, logger and optional clock.
 * @returns {Promise<AskResult>} The answer and how it was reached.
 * @throws {AppError} When the question is blank.
 * @throws {AskTimeoutError} When the question takes longer than ASK_TIMEOUT_MS before it has an answer.
 * @throws {QuestionCancelledError} When `signal` is aborted before the question is answered.
 * @throws {CopilotError} When Copilot or the session fails; `cause` has the detail if there is one.
 */
export async function askQuestion(
  { question, role: usualRole, detailLevel = 'default', signal, onActivity, onDelta },
  deps,
) {
  const { client, workingDirectory, config, logger, clock = SYSTEM_CLOCK, fetch } = deps;
  if (question.trim() === '') {
    throw new AppError('A question is required');
  }
  if (signal?.aborted) {
    throw new QuestionCancelledError();
  }
  // Both the prompt and the style check use the role as it is for this level of detail, so a
  // rewrite cannot undo the extra detail that was asked for.
  const role = withDetailLevel(usualRole, detailLevel);
  const startedAt = clock.now();
  /**
   * Tells the caller what is happening. A progress display failing must not fail the question.
   * @param {Activity} activity - What the question is doing.
   */
  const notify = (activity) => {
    try {
      onActivity?.(activity);
    } catch (error) {
      logger.warn({ err: error }, 'could not report progress');
    }
  };
  const events = createEventRecorder({
    clock,
    onDelta,
    onToolStart: (tool) => notify({ kind: 'tool', ...tool }),
  });
  const deadline = createDeadline(config.copilot.askTimeoutMs);
  const cancellation = createCancellation(signal);
  // Whichever comes first: the time limit or the person stopping the question.
  const interrupt = Promise.race([deadline.promise, cancellation.promise]);
  interrupt.catch(() => undefined);
  // Per question, so one question's sources, keys and lookups never leak into another's.
  const registry = createCitationRegistry();
  const gate = createToolGate();
  const api = createGithubApi({ token: config.github.token, fetch });
  const commits = createCommitResolver({
    token: config.github.token,
    repos: config.github.repos,
    api,
    logger,
  });
  const owners = createCodeownersLookup({ api, repos: config.github.repos, logger });
  // Held in an object because the session is created inside the closure below.
  const open = /** @type {{ session?: AskSession }} */ ({});

  const run = async () => {
    const hooks = createToolHooks({
      repos: config.github.repos,
      spaceKeys: config.atlassian.spaceKeys,
      siteUrl: config.atlassian.siteUrl,
      cloudId: config.atlassian.cloudId,
      maxToolCalls: config.mcp.maxToolCalls,
      secrets: listSecrets(config),
      registry,
      resolveHead: commits.resolveHead,
      gate,
      logger,
      clock,
    });
    const onPermissionRequest = createPermissionHandler({ logger });
    open.session = await client.createSession(
      buildSessionConfig({ config, role, workingDirectory, hooks, onPermissionRequest }),
    );
    events.attach(open.session);
    await open.session.send({ prompt: question });
    return events.settled;
  };

  try {
    const outcome = await Promise.race([run(), interrupt]);
    if (!outcome.ok) {
      throw outcome.error;
    }
    const { answer: reply, toolCalls, model } = events.result();
    const composed = await finishAnswer({
      reply,
      role,
      registry,
      session: open.session,
      gate,
      clock,
      interrupt,
      cancellation: cancellation.promise,
      owners,
      logger,
      notify,
    });
    return { ...composed, detailLevel, toolCalls, model, durationMs: clock.now() - startedAt };
  } catch (error) {
    if (error instanceof QuestionCancelledError) {
      logger.info({}, 'the question was cancelled; aborting the session');
    }
    const interrupted = error instanceof AskTimeoutError || error instanceof QuestionCancelledError;
    if (interrupted && open.session !== undefined) {
      const { session } = open;
      await bestEffort('abort the interrupted question', () => session.abort(), logger);
    }
    throw error instanceof AppError
      ? error
      : new CopilotError('Copilot could not answer the question', { cause: error });
  } finally {
    deadline.cancel();
    cancellation.cancel();
    events.detach();
    const { session } = open;
    if (session !== undefined) {
      await bestEffort('disconnect the session', () => session.disconnect(), logger);
    }
  }
}
