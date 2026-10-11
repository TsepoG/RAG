// @ts-check
import { AskTimeoutError, QuestionCancelledError } from '../errors/index.js';
import { analyseReply } from './analyse.js';
import { bestEffort } from './deadline.js';
import { createEventRecorder } from './events.js';

/**
 * How the single rewrite of an answer ended.
 * @typedef {object} RewriteOutcome
 * @property {import('./analyse.js').Analysis} analysis - What to show: the rewrite's text when it
 *   was accepted, otherwise the original, unchanged.
 * @property {boolean} rewritten - True when the rewrite replaced the answer.
 * @property {boolean} rewriteRejected - True when a rewrite was tried and not used.
 * @property {'status' | 'citations' | 'markers' | 'timeout' | 'error'} [rewriteRejectedReason] - Why.
 */

/** Higher is surer. */
const RANK = Object.freeze({ high: 3, medium: 2, low: 1 });

/**
 * Asks for one rewrite in the role's style. It names what was wrong, and repeats the rules that
 * must not change: the facts, the citation keys with their asterisks, and no tools.
 * @param {{ displayName: string }} role - The role.
 * @param {ReadonlyArray<{ message: string }>} violations - What was wrong with the answer.
 * @returns {string} The message to send.
 */
export function buildRewritePrompt(role, violations) {
  const problems = violations.map(({ message }) => message).join('; ');
  return `Rewrite your previous answer for a ${role.displayName}: ${problems}. Keep every fact and every citation key exactly, including any asterisks. Do not call any tools. End with the same answer-meta block.`;
}

/**
 * Whether two lists hold the same values, whatever their order.
 * @param {ReadonlyArray<string>} a - One list.
 * @param {ReadonlyArray<string>} b - Another.
 * @returns {boolean} True when they match.
 */
function sameValues(a, b) {
  return a.length === b.length && a.every((value) => b.includes(value));
}

/**
 * Decides whether a rewrite may replace the answer. It may only change the words: it must still be
 * an answer, cite exactly the same sources, and keep every interpretation marked as one.
 * @param {import('./analyse.js').Analysis} original - The first answer.
 * @param {import('./analyse.js').Analysis} rewrite - The rewrite.
 * @returns {{ accepted: true } | { accepted: false, reason: 'status' | 'citations' | 'markers' }}
 *   The decision, and the reason when it is no.
 */
export function judgeRewrite(original, rewrite) {
  if (rewrite.meta !== undefined && rewrite.meta.status !== 'answered') {
    return { accepted: false, reason: 'status' };
  }
  if (!sameValues(original.citedKeys, rewrite.citedKeys)) {
    return { accepted: false, reason: 'citations' };
  }
  const keepsMarkers = original.parts.inferredKeys.every((key) =>
    rewrite.parts.inferredKeys.includes(key),
  );
  return keepsMarkers ? { accepted: true } : { accepted: false, reason: 'markers' };
}

/**
 * Takes the words of the rewrite and the verdict of whichever answer is less sure. A rewrite can
 * therefore never make the answer more confident than the original was.
 * @param {import('./analyse.js').Analysis} original - The first answer.
 * @param {import('./analyse.js').Analysis} rewrite - The accepted rewrite.
 * @returns {import('./analyse.js').Analysis} The rewrite, with the less sure report and caps.
 */
export function mergeRewrite(original, rewrite) {
  const rewriteIsLower =
    RANK[/** @type {'high'} */ (rewrite.caps.confidence)] <
    RANK[/** @type {'high'} */ (original.caps.confidence)];
  const verdict = rewriteIsLower ? rewrite : original;
  // A rewrite that left out its report must not lose the gaps and conflicts of the first.
  return { ...rewrite, meta: verdict.meta ?? original.meta, caps: verdict.caps };
}

/**
 * Builds the outcome for a rewrite that was not used.
 * @param {import('./analyse.js').Analysis} original - The first answer.
 * @param {NonNullable<RewriteOutcome['rewriteRejectedReason']>} reason - Why.
 * @returns {RewriteOutcome} The outcome.
 */
function rejected(original, reason) {
  return {
    analysis: original,
    rewritten: false,
    rewriteRejected: true,
    rewriteRejectedReason: reason,
  };
}

/**
 * Asks for the answer to be rewritten once, with tools locked, and keeps the rewrite only if it
 * passes `judgeRewrite`. Whatever goes wrong, the original answer is still good, so it does not
 * throw; a timeout aborts the session and keeps the original. The one exception is the person
 * stopping the question, which is passed on.
 * @param {{
 *   session: Pick<import('@github/copilot-sdk').CopilotSession, 'on' | 'send' | 'abort'>,
 *   original: import('./analyse.js').Analysis,
 *   role: import('../roles/index.js').Role,
 *   registry: import('../citations/index.js').CitationRegistry,
 *   gate: import('../mcp/index.js').ToolGate,
 *   clock: { now: () => number },
 *   deadline: { promise: Promise<never> },
 *   logger: Pick<import('../logger/index.js').Logger, 'info' | 'warn'>,
 * }} input - The open session and what the rewrite is judged against.
 * @returns {Promise<RewriteOutcome>} What to show.
 */
export async function rewriteAnswer({
  session,
  original,
  role,
  registry,
  gate,
  clock,
  deadline,
  logger,
}) {
  // Locked before the request, so even a model that ignores the instruction gets no tool.
  gate.lock();
  logger.info({ problems: original.violations.map(({ type }) => type) }, 'rewriting the answer');
  const turn = createEventRecorder({ clock });
  turn.attach(session);
  try {
    await session.send({ prompt: buildRewritePrompt(role, original.violations) });
    const outcome = await Promise.race([turn.settled, deadline.promise]);
    if (!outcome.ok) {
      logger.warn({ err: outcome.error }, 'the rewrite failed; keeping the first answer');
      return rejected(original, 'error');
    }
    const rewrite = analyseReply({ reply: turn.result().answer, role, registry });
    const verdict = judgeRewrite(original, rewrite);
    if (!verdict.accepted) {
      logger.warn({ reason: verdict.reason }, 'the rewrite was not used');
      return rejected(original, verdict.reason);
    }
    return { analysis: mergeRewrite(original, rewrite), rewritten: true, rewriteRejected: false };
  } catch (error) {
    if (error instanceof QuestionCancelledError) {
      // The person stopped the question: there is no answer to keep, so the caller handles it.
      throw error;
    }
    if (error instanceof AskTimeoutError) {
      await bestEffort('abort the timed-out rewrite', () => session.abort(), logger);
      return rejected(original, 'timeout');
    }
    logger.warn({ err: error }, 'the rewrite failed; keeping the first answer');
    return rejected(original, 'error');
  } finally {
    turn.detach();
  }
}
