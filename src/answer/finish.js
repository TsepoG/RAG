// @ts-check
import { buildWhoToAsk } from '../honesty/index.js';
import { analyseReply } from './analyse.js';
import { composeResult, wantsWhoToAsk } from './compose.js';
import { rewriteAnswer } from './rewrite.js';

/**
 * Everything finishing a question needs once the model has replied.
 * @typedef {object} FinishInput
 * @property {string} reply - The model's whole reply.
 * @property {import('../roles/index.js').DetailedRole} role - The role as it is for this question.
 * @property {import('../citations/index.js').CitationRegistry} registry - The question's sources.
 * @property {Pick<import('@github/copilot-sdk').CopilotSession, 'on' | 'send' | 'abort'> | undefined} session
 *   The open session, used for a rewrite.
 * @property {import('../mcp/index.js').ToolGate} gate - Locked for the rewrite.
 * @property {{ now: () => number }} clock - Time source.
 * @property {Promise<never>} interrupt - Rejects when the time runs out or the question is stopped.
 * @property {Promise<never>} cancellation - Rejects only when the question is stopped.
 * @property {{ ownersOf: (repo: string, path: string) => Promise<string[]> }} owners - CODEOWNERS lookup.
 * @property {Pick<import('../logger/index.js').Logger, 'info' | 'warn'>} logger - Where to log.
 * @property {(activity: import('./askQuestion.js').Activity) => void} notify - Reports progress.
 */

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
 * Turns the model's reply into the result: checks it, rewrites it once if it does not suit the
 * role, and works out who to ask. A stop from the person asking ends it with a
 * QuestionCancelledError, even while the lookup of who to ask is running.
 * @param {FinishInput} input - The reply and what is needed to check it.
 * @returns {Promise<import('./compose.js').ComposedResult>} The result, without how it was reached.
 * @throws {import('../errors/index.js').QuestionCancelledError} When the question is stopped.
 */
export async function finishAnswer({
  reply,
  role,
  registry,
  session,
  gate,
  clock,
  interrupt,
  cancellation,
  owners,
  logger,
  notify,
}) {
  notify({ kind: 'checking' });
  const first = analyseReply({ reply, role, registry });
  logReportProblems(first, logger);
  const needsRewrite = first.caps.status === 'answered' && first.violations.length > 0;
  if (needsRewrite) {
    notify({ kind: 'rewriting' });
  }
  const rewrite =
    needsRewrite && session !== undefined
      ? await rewriteAnswer({
          session,
          original: first,
          role,
          registry,
          gate,
          clock,
          deadline: { promise: interrupt },
          logger,
        })
      : { analysis: first, rewritten: false, rewriteRejected: false };
  const { analysis } = rewrite;
  const whoToAsk = wantsWhoToAsk(analysis.caps)
    ? await Promise.race([
        buildWhoToAsk({ sources: registry.list(), lookup: owners }),
        cancellation,
      ])
    : [];
  return composeResult({
    analysis,
    role,
    whoToAsk,
    style: {
      ...rewrite,
      violations: analysis.caps.status === 'answered' ? analysis.violations : [],
    },
  });
}
