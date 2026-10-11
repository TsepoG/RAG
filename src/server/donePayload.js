// @ts-check
import { renderFinalAnswer } from '../honesty/index.js';

/**
 * What the page receives when a question is answered.
 * @typedef {object} DonePayload
 * @property {string} answerId - The id to send feedback with.
 * @property {Omit<import('../answer/index.js').AskResult, 'toolCalls'> & {
 *   toolCalls: Array<{ server: string, tool: string, durationMs: number | undefined, success: boolean | undefined }>
 * }} result - The whole result. Tool calls keep no summary of their arguments.
 * @property {import('../honesty/index.js').RenderedAnswer} rendered - The banner, notes and lists.
 * @property {{ answer: string, conflicts: string[] }} html - The answer and each conflict as safe HTML.
 */

/**
 * Builds what the page receives once a question is answered.
 * @param {object} input - The pieces.
 * @param {string} input.answerId - The id given to the answer.
 * @param {import('../answer/index.js').AskResult} input.result - What `askQuestion` returned.
 * @param {import('../roles/index.js').Role} input.role - The role as it is usually, with its phrases.
 * @param {(markdown: string) => string} input.renderHtml - Turns markdown into safe HTML.
 * @returns {DonePayload} The payload.
 */
export function buildDonePayload({ answerId, result, role, renderHtml }) {
  const rendered = renderFinalAnswer(result, role);
  return {
    answerId,
    result: {
      ...result,
      toolCalls: result.toolCalls.map(({ server, tool, durationMs, success }) => ({
        server,
        tool,
        durationMs,
        success,
      })),
    },
    rendered,
    html: { answer: renderHtml(rendered.text), conflicts: rendered.conflicts.map(renderHtml) },
  };
}
