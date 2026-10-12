// @ts-check
import { AppError, CopilotError } from '../errors/index.js';
import { describeModelCall, markFinalCall } from './modelCalls.js';
import { createToolCallLog } from './toolCalls.js';

/**
 * How a question's event stream ended: normally, or with an error to throw.
 * @typedef {{ ok: true } | { ok: false, error: Error }} Outcome
 */

/**
 * What was collected from the events.
 * @typedef {object} Collected
 * @property {string} answer - The final answer text.
 * @property {import('./toolCalls.js').ToolCallRecord[]} toolCalls - The tool calls made.
 * @property {string | undefined} model - The model that answered, if the events said.
 * @property {ModelChange[]} modelChanges - Each time the session changed model, in order.
 * @property {import('./modelCalls.js').ModelCall[]} modelCalls - Every model call, in order, with
 *   the one that wrote the answer marked.
 */

/**
 * A change of model during a question.
 * @typedef {object} ModelChange
 * @property {string | undefined} from - The model before the change.
 * @property {string} to - The model after it.
 * @property {string} reason - Why, as the runtime says (for example `rate_limit_auto_switch`), or
 *   `unspecified` when it says nothing.
 * @property {string | undefined} source - Who chose it, as the runtime says (for example `automatic`).
 */

/** The reason recorded when the runtime changes the model without saying why. */
export const UNSPECIFIED_REASON = 'unspecified';

/** @typedef {Pick<import('@github/copilot-sdk').CopilotSession, 'on'>} EventSource */

/**
 * Describes a Copilot error event without echoing anything beyond what the service reported.
 * @param {{ errorType: string, message: string, statusCode?: number }} data - The error event data.
 * @returns {string} A one-line description.
 */
function describeSessionError({ errorType, message, statusCode }) {
  const status = statusCode === undefined ? '' : ` ${statusCode}`;
  return `Copilot reported an error (${errorType}${status}): ${message}`;
}

/**
 * Collects what a question produces from the session's events: streamed text, the final message,
 * tool calls and the model. It also reports when the session goes idle (done) or errors.
 * @param {{ clock: { now: () => number }, onDelta?: (text: string) => void, onToolStart?: (tool: { server: string, tool: string }) => void }} options
 *   A time source for tool call durations, an optional receiver for streamed text, and an optional
 *   receiver told which tool each call is as it starts.
 * @returns {{ attach: (source: EventSource) => void, detach: () => void, settled: Promise<Outcome>, result: () => Collected }}
 *   `attach` starts listening; `detach` stops; `settled` resolves when the question ends;
 *   `result` returns what has been collected so far.
 */
export function createEventRecorder({ clock, onDelta, onToolStart }) {
  const toolCalls = createToolCallLog(clock);
  /** @type {Array<() => void>} */
  const unsubscribers = [];
  let streamed = '';
  let finalMessage = '';
  /** @type {string | undefined} */
  let model;
  /** @type {ModelChange[]} */
  const modelChanges = [];
  /** @type {import('./modelCalls.js').ModelCall[]} */
  const modelCalls = [];
  /** @type {string | undefined} */
  let finalApiCallId;
  /** @type {(outcome: Outcome) => void} */
  let settle;
  // Resolves, never rejects, so a failure that arrives before anyone awaits it is not "unhandled".
  const settled = new Promise((resolve) => {
    settle = resolve;
  });

  /**
   * Passes streamed text on, turning a failure of the receiver into a failed question.
   * @param {string} text - The text that arrived.
   */
  function receive(text) {
    streamed += text;
    try {
      onDelta?.(text);
    } catch (error) {
      settle({
        ok: false,
        error: new AppError('Could not write the streamed answer', { cause: error }),
      });
    }
  }

  return {
    attach(source) {
      unsubscribers.push(
        source.on('assistant.message_delta', ({ data }) => receive(data.deltaContent)),
        source.on('assistant.message', ({ data }) => {
          if (data.content.trim() !== '') {
            finalMessage = data.content;
            finalApiCallId = data.apiCallId;
          }
          model = data.model ?? model;
        }),
        source.on('assistant.usage', ({ data }) => {
          model = data.model;
          modelCalls.push(describeModelCall(data, modelCalls.length));
        }),
        source.on('session.model_change', ({ data }) =>
          modelChanges.push({
            from: data.previousModel,
            to: data.newModel,
            reason: data.cause ?? UNSPECIFIED_REASON,
            source: data.source,
          }),
        ),
        source.on('tool.execution_start', ({ data }) => onToolStart?.(toolCalls.start(data))),
        source.on('tool.execution_complete', ({ data }) => toolCalls.complete(data)),
        source.on('session.error', ({ data }) =>
          settle({ ok: false, error: new CopilotError(describeSessionError(data)) }),
        ),
        source.on('session.idle', () => settle({ ok: true })),
      );
    },
    detach() {
      unsubscribers.splice(0).forEach((unsubscribe) => unsubscribe());
    },
    settled,
    result() {
      // The last full message is the answer; text streamed during earlier tool-calling turns is not.
      return {
        answer: finalMessage || streamed,
        toolCalls: toolCalls.list(),
        model,
        modelChanges: [...modelChanges],
        modelCalls: markFinalCall(modelCalls, finalApiCallId),
      };
    },
  };
}
