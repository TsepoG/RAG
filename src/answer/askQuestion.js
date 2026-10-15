// @ts-check
import { createCitationRegistry } from '../citations/index.js';
import { buildSessionConfig } from '../copilot/index.js';
import { AppError, QuestionCancelledError } from '../errors/index.js';
import { createPermissionHandler, createToolGate } from '../mcp/index.js';
import { withDetailLevel } from '../roles/index.js';
import { createEventRecorder } from './events.js';
import {
  buildQuestionHooks,
  completeTurn,
  createLookups,
  createNotifier,
  disconnectSession,
  startInterrupt,
  toTurnError,
} from './stages.js';

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
 *   modelChanges: import('./events.js').ModelChange[],
 *   modelCalls: import('./modelCalls.js').ModelCall[],
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
  const notify = createNotifier(onActivity, logger);
  const events = createEventRecorder({
    clock,
    onDelta,
    onToolStart: (tool) => notify({ kind: 'tool', ...tool }),
  });
  const { interrupt, cancellation, stop } = startInterrupt({
    askTimeoutMs: config.copilot.askTimeoutMs,
    signal,
  });
  // Per question, so one question's sources, keys and lookups never leak into another's.
  const registry = createCitationRegistry();
  const gate = createToolGate();
  const { commits, owners } = createLookups({ config, fetch, logger });
  // Held in an object because the session is created inside the closure below.
  const open = /** @type {{ session?: AskSession }} */ ({});

  const run = async () => {
    const hooks = buildQuestionHooks({ config, registry, gate, commits, logger, clock });
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
    return await completeTurn({
      events,
      startedAt,
      detailLevel,
      role,
      registry,
      session: open.session,
      gate,
      clock,
      interrupt,
      cancellation,
      owners,
      logger,
      notify,
    });
  } catch (error) {
    throw await toTurnError(error, { session: open.session, logger });
  } finally {
    stop();
    events.detach();
    await disconnectSession(open.session, logger);
  }
}
