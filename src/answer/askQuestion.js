// @ts-check
import { buildSessionConfig, finishesWithin } from '../copilot/index.js';
import { AppError, AskTimeoutError, CopilotError } from '../errors/index.js';
import { createPermissionHandler, createToolHooks } from '../mcp/index.js';
import { createEventRecorder } from './events.js';

/**
 * What to ask, and where to send the answer as it streams.
 * @typedef {object} AskInput
 * @property {string} question - The question.
 * @property {(text: string) => void} [onDelta] - Receives each piece of the answer as it arrives.
 */

/**
 * What `askQuestion` depends on, all injected so tests need no Copilot and no clock.
 * @typedef {object} AskDeps
 * @property {Pick<import('@github/copilot-sdk').CopilotClient, 'createSession'>} client - A started client.
 * @property {string} workingDirectory - The empty directory the session runs in.
 * @property {import('../config/index.js').AppConfig} config - Validated config.
 * @property {import('../logger/index.js').Logger} logger - Where hooks and cleanup log.
 * @property {{ now: () => number }} [clock] - Time source in milliseconds; defaults to Date.now.
 */

/**
 * The outcome of a question.
 * @typedef {object} AskResult
 * @property {string} answer - The answer text.
 * @property {import('./toolCalls.js').ToolCallRecord[]} toolCalls - The tool calls made, in order.
 * @property {string | undefined} model - The model that answered, when Copilot reported it.
 * @property {number} durationMs - How long the whole question took.
 */

/** The parts of a session this function uses. */
/** @typedef {Pick<import('@github/copilot-sdk').CopilotSession, 'on' | 'send' | 'abort' | 'disconnect'>} AskSession */

/** Longest the cleanup after a question may take, so a stuck runtime cannot hang the caller. */
const SHUTDOWN_TIMEOUT_MS = 5000;

/** Real time, used unless a test injects its own clock. */
const SYSTEM_CLOCK = Object.freeze({ now: () => Date.now() });

/**
 * Starts the clock for a question. When it runs out, the returned promise rejects.
 * @param {number} limitMs - The time limit in milliseconds.
 * @returns {{ promise: Promise<never>, cancel: () => void }} The deadline and a way to stop it.
 */
function createDeadline(limitMs) {
  /** @type {NodeJS.Timeout | undefined} */
  let timer;
  const promise = /** @type {Promise<never>} */ (
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new AskTimeoutError(limitMs)), limitMs);
      // A pending deadline must not keep the process alive at exit.
      timer.unref();
    })
  );
  return { promise, cancel: () => clearTimeout(timer) };
}

/**
 * Runs a cleanup step without letting it fail or hang the question. Cleanup trouble is logged: the
 * answer, or the error that is already on its way, matters more than a tidy shutdown.
 * @param {string} what - What is being done, for the log.
 * @param {() => Promise<unknown>} step - The step.
 * @param {Pick<import('../logger/index.js').Logger, 'warn'>} logger - Where problems are logged.
 * @returns {Promise<void>} Resolves when the step is done, failed or out of time.
 */
async function bestEffort(what, step, logger) {
  const attempt = step().catch((error) => {
    logger.warn({ err: error }, `could not ${what}`);
  });
  if (!(await finishesWithin(attempt, SHUTDOWN_TIMEOUT_MS))) {
    logger.warn({}, `gave up waiting to ${what}`);
  }
}

/**
 * Sends a question to Copilot and returns the answer, the tools it used and the model. A new
 * session, with its own hooks and call limit, is used for each question and always disconnected.
 * @param {AskInput} input - The question and an optional receiver for streamed text.
 * @param {AskDeps} deps - Client, config, logger and optional clock.
 * @returns {Promise<AskResult>} The answer and how it was reached.
 * @throws {AppError} When the question is blank.
 * @throws {AskTimeoutError} When the question takes longer than ASK_TIMEOUT_MS.
 * @throws {CopilotError} When Copilot or the session fails; `cause` has the detail if there is one.
 */
export async function askQuestion({ question, onDelta }, deps) {
  const { client, workingDirectory, config, logger, clock = SYSTEM_CLOCK } = deps;
  if (question.trim() === '') {
    throw new AppError('A question is required');
  }
  const startedAt = clock.now();
  const events = createEventRecorder({ clock, onDelta });
  const deadline = createDeadline(config.copilot.askTimeoutMs);
  // Held in an object because the session is created inside the closure below.
  const open = /** @type {{ session?: AskSession }} */ ({});

  const run = async () => {
    const hooks = createToolHooks({
      repos: config.github.repos,
      spaceKeys: config.atlassian.spaceKeys,
      siteUrl: config.atlassian.siteUrl,
      maxToolCalls: config.mcp.maxToolCalls,
      logger,
      clock,
    });
    const onPermissionRequest = createPermissionHandler({ logger });
    open.session = await client.createSession(
      buildSessionConfig({ config, workingDirectory, hooks, onPermissionRequest }),
    );
    events.attach(open.session);
    await open.session.send({ prompt: question });
    return events.settled;
  };

  try {
    const outcome = await Promise.race([run(), deadline.promise]);
    if (!outcome.ok) {
      throw outcome.error;
    }
    return { ...events.result(), durationMs: clock.now() - startedAt };
  } catch (error) {
    if (error instanceof AskTimeoutError && open.session !== undefined) {
      const { session } = open;
      await bestEffort('abort the timed-out question', () => session.abort(), logger);
    }
    throw error instanceof AppError
      ? error
      : new CopilotError('Copilot could not answer the question', { cause: error });
  } finally {
    deadline.cancel();
    events.detach();
    const { session } = open;
    if (session !== undefined) {
      await bestEffort('disconnect the session', () => session.disconnect(), logger);
    }
  }
}
