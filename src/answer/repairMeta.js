// @ts-check
import { parseAnswerMeta } from '../honesty/index.js';
import { AskTimeoutError, QuestionCancelledError } from '../errors/index.js';
import { analyseReply } from './analyse.js';
import { bestEffort } from './deadline.js';
import { createEventRecorder } from './events.js';

/**
 * How the single repair of a missing answer-meta block ended.
 * @typedef {object} RepairOutcome
 * @property {import('./analyse.js').Analysis} analysis - What to show: the answer judged with the
 *   repaired report when there is one, otherwise the first analysis, unchanged.
 * @property {boolean} metaRepaired - True when a valid report was got and used.
 */

/** The fence the report is written in. */
const FENCE = '```';

/** Said for each way the report can be unusable. */
const PROBLEMS = Object.freeze({
  missing: 'did not end with an answer-meta block',
  'invalid-json': 'ended with an answer-meta block that is not valid JSON',
  'invalid-shape': 'ended with an answer-meta block that does not have the required fields',
});

/**
 * Asks for the report alone. It does not offer another try at the answer, so the answer cannot
 * change, and it forbids tools so nothing more is read.
 * @param {'missing' | 'invalid-json' | 'invalid-shape'} metaError - What was wrong with the report.
 * @returns {string} The message to send.
 */
export function buildRepairPrompt(metaError) {
  return `Your previous reply ${PROBLEMS[metaError]}. Reply with only the answer-meta block for that reply, in the same format, and nothing else. Do not repeat or change the answer. Do not call any tools.`;
}

/**
 * Puts the repaired report after the first answer's own text, so the answer is the same words and
 * the report goes through every check a report in the first reply would.
 * @param {string} answerText - The first reply without any report.
 * @param {import('../honesty/index.js').AnswerMeta} meta - The checked report from the repair.
 * @returns {string} A reply the analysis can read.
 */
function withReport(answerText, meta) {
  return `${answerText}\n\n${FENCE}answer-meta\n${JSON.stringify(meta)}\n${FENCE}`;
}

/**
 * Asks once for the answer-meta block of a reply that had none (or an unusable one), with tools
 * locked. The answer text is never changed: only the report is taken from the repair, and it
 * is judged like any other, so it can still be lowered by every rule. Whatever goes wrong, the
 * first answer is still good, so this does not throw; a timeout aborts the session and keeps the
 * first analysis. The one exception is the person stopping the question, which is passed on.
 * @param {{
 *   session: Pick<import('@github/copilot-sdk').CopilotSession, 'on' | 'send' | 'abort'>,
 *   original: import('./analyse.js').Analysis,
 *   reply: string,
 *   role: import('../roles/index.js').Role,
 *   registry: import('../citations/index.js').CitationRegistry,
 *   gate: import('../mcp/index.js').ToolGate,
 *   clock: { now: () => number },
 *   deadline: { promise: Promise<never> },
 *   logger: Pick<import('../logger/index.js').Logger, 'info' | 'warn'>,
 * }} input - The open session and the first reply with what was found in it.
 * @returns {Promise<RepairOutcome>} What to show.
 */
export async function repairMeta({
  session,
  original,
  reply,
  role,
  registry,
  gate,
  clock,
  deadline,
  logger,
}) {
  const { metaError } = original;
  // With no answer there is nothing for a report to be about.
  if (metaError === undefined || original.parts.answer.trim() === '') {
    return { analysis: original, metaRepaired: false };
  }
  // Locked before the request, so even a model that ignores the instruction gets no tool.
  gate.lock();
  logger.info({ reason: metaError }, 'asking for the answer-meta block');
  const turn = createEventRecorder({ clock });
  turn.attach(session);
  try {
    await session.send({ prompt: buildRepairPrompt(metaError) });
    const outcome = await Promise.race([turn.settled, deadline.promise]);
    if (!outcome.ok) {
      logger.warn({ err: outcome.error }, 'the repair failed; keeping the first report');
      return { analysis: original, metaRepaired: false };
    }
    const repaired = parseAnswerMeta(turn.result().answer);
    if (repaired.meta === undefined) {
      logger.warn({ reason: repaired.metaError }, 'the repaired answer-meta block was not usable');
      return { analysis: original, metaRepaired: false };
    }
    const { answer } = parseAnswerMeta(reply);
    return {
      analysis: analyseReply({ reply: withReport(answer, repaired.meta), role, registry }),
      metaRepaired: true,
    };
  } catch (error) {
    if (error instanceof QuestionCancelledError) {
      // The person stopped the question: there is no answer to keep, so the caller handles it.
      throw error;
    }
    if (error instanceof AskTimeoutError) {
      await bestEffort('abort the timed-out repair', () => session.abort(), logger);
      return { analysis: original, metaRepaired: false };
    }
    logger.warn({ err: error }, 'the repair failed; keeping the first report');
    return { analysis: original, metaRepaired: false };
  } finally {
    turn.detach();
  }
}
