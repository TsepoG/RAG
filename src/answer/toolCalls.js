// @ts-check

/**
 * One tool call, as shown to the user in the "Tools used" list.
 * @typedef {object} ToolCallRecord
 * @property {string} server - The MCP server key, or "unknown" when the runtime did not say.
 * @property {string} tool - The bare tool name.
 * @property {string} summary - A short, secret-free summary of the arguments.
 * @property {number | undefined} durationMs - How long it took; undefined if it never finished.
 * @property {boolean | undefined} success - Whether it succeeded; undefined if it never finished.
 */

/** Argument names whose values are never shown. */
const SENSITIVE_ARGUMENT = /token|authorization|password|secret|credential/i;
const MAX_VALUE_LENGTH = 60;
const MAX_SUMMARY_LENGTH = 140;
const ELLIPSIS = '…';
const WHITESPACE = /\s+/g;
const UNKNOWN_SERVER = 'unknown';

/**
 * Shortens text to a limit, marking the cut.
 * @param {string} text - The text.
 * @param {number} limit - Longest result, in characters.
 * @returns {string} The text, or its start followed by an ellipsis.
 */
function shorten(text, limit) {
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}${ELLIPSIS}` : text;
}

/**
 * Turns an argument value into one line of text.
 * @param {unknown} value - Any JSON value.
 * @returns {string} The value on a single line.
 */
function displayValue(value) {
  const text = typeof value === 'string' ? value : (JSON.stringify(value) ?? '');
  return text.replaceAll(WHITESPACE, ' ').trim();
}

/**
 * Summarises tool arguments for display: names with short values, secrets left out. It is for the
 * human reading the "Tools used" list, so long values (such as a whole file body) are cut short.
 * @param {unknown} args - The arguments as the runtime reported them.
 * @returns {string} For example `owner=acme, repo=app, path=src/index.js`; empty if there are none.
 */
export function summarizeArguments(args) {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    return '';
  }
  const parts = Object.entries(args)
    .filter(([name]) => !SENSITIVE_ARGUMENT.test(name))
    .map(([name, value]) => `${name}=${shorten(displayValue(value), MAX_VALUE_LENGTH)}`);
  return shorten(parts.join(', '), MAX_SUMMARY_LENGTH);
}

/**
 * Keeps the tool calls of one question, matching each end to its start by call id.
 * @param {{ now: () => number }} clock - Time source in milliseconds.
 * @returns {{ start: (data: ToolStart) => void, complete: (data: ToolEnd) => void, list: () => ToolCallRecord[] }}
 *   `start` and `complete` take the data of the matching SDK events; `list` returns a copy of the
 *   calls so far, in the order they started.
 */
export function createToolCallLog(clock) {
  /** @type {Map<string, { record: ToolCallRecord, startedAt: number }>} */
  const calls = new Map();
  return {
    start({ toolCallId, mcpServerName, mcpToolName, toolName, arguments: args }) {
      calls.set(toolCallId, {
        startedAt: clock.now(),
        record: {
          server: mcpServerName ?? UNKNOWN_SERVER,
          tool: mcpToolName ?? toolName,
          summary: summarizeArguments(args),
          durationMs: undefined,
          success: undefined,
        },
      });
    },
    complete({ toolCallId, success }) {
      const call = calls.get(toolCallId);
      if (call !== undefined) {
        call.record.durationMs = clock.now() - call.startedAt;
        call.record.success = success;
      }
    },
    list() {
      return [...calls.values()].map(({ record }) => ({ ...record }));
    },
  };
}

/** @typedef {Pick<import('@github/copilot-sdk').ToolExecutionStartData, 'toolCallId' | 'mcpServerName' | 'mcpToolName' | 'toolName' | 'arguments'>} ToolStart */
/** @typedef {Pick<import('@github/copilot-sdk').ToolExecutionCompleteData, 'toolCallId' | 'success'>} ToolEnd */
