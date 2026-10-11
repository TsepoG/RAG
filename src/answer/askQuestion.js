// @ts-check
import { createCitationRegistry } from '../citations/index.js';
import { listSecrets } from '../config/index.js';
import { buildSessionConfig } from '../copilot/index.js';
import { AppError, AskTimeoutError, CopilotError } from '../errors/index.js';
import { createCodeownersLookup, createCommitResolver, createGithubApi } from '../github/index.js';
import { buildWhoToAsk } from '../honesty/index.js';
import { createPermissionHandler, createToolGate, createToolHooks } from '../mcp/index.js';
import { analyseReply } from './analyse.js';
import { composeResult, wantsWhoToAsk } from './compose.js';
import { bestEffort, createDeadline } from './deadline.js';
import { createEventRecorder } from './events.js';
import { rewriteAnswer } from './rewrite.js';

/**
 * What to ask, and where to send the answer as it streams.
 * @typedef {object} AskInput
 * @property {string} question - The question.
 * @property {import('../roles/index.js').Role} role - The role the answer is written for.
 * @property {(text: string) => void} [onDelta] - Receives each piece of the model's reply as it
 *   arrives. The reply includes its answer-meta block, which is not part of the final answer.
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
 * Logs why the model's report could not be used, or that text followed it. Only the kind of
 * problem is logged, never the reply.
 * @param {import('./analyse.js').Analysis} analysis - What was found in the reply.
 * @param {Pick<import('../logger/index.js').Logger, 'warn'>} logger - Where to log.
 */
function logReportProblems({ metaError, warning }, logger) {
  if (metaError !== undefined) {
    logger.warn({ reason: metaError }, 'the answer-meta block was missing or invalid');
  }
  if (warning !== undefined) {
    logger.warn({ reason: warning }, 'text followed the answer-meta block');
  }
}

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
 * @throws {CopilotError} When Copilot or the session fails; `cause` has the detail if there is one.
 */
export async function askQuestion({ question, role, onDelta }, deps) {
  const { client, workingDirectory, config, logger, clock = SYSTEM_CLOCK, fetch } = deps;
  if (question.trim() === '') {
    throw new AppError('A question is required');
  }
  const startedAt = clock.now();
  const events = createEventRecorder({ clock, onDelta });
  const deadline = createDeadline(config.copilot.askTimeoutMs);
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
    const outcome = await Promise.race([run(), deadline.promise]);
    if (!outcome.ok) {
      throw outcome.error;
    }
    const { answer: reply, toolCalls, model } = events.result();
    const first = analyseReply({ reply, role, registry });
    logReportProblems(first, logger);
    const needsRewrite = first.caps.status === 'answered' && first.violations.length > 0;
    const rewrite =
      needsRewrite && open.session !== undefined
        ? await rewriteAnswer({
            session: open.session,
            original: first,
            role,
            registry,
            gate,
            clock,
            deadline,
            logger,
          })
        : { analysis: first, rewritten: false, rewriteRejected: false };
    const { analysis } = rewrite;
    const whoToAsk = wantsWhoToAsk(analysis.caps)
      ? await buildWhoToAsk({ sources: registry.list(), lookup: owners })
      : [];
    const composed = composeResult({
      analysis,
      role,
      whoToAsk,
      style: {
        ...rewrite,
        violations: analysis.caps.status === 'answered' ? analysis.violations : [],
      },
    });
    return { ...composed, toolCalls, model, durationMs: clock.now() - startedAt };
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
