// @ts-check

/**
 * One invalid or missing setting, named by its environment variable.
 * @typedef {{ path: string, message: string }} ConfigIssue
 */

const CONFIG_ERROR_HEADLINE = 'Invalid configuration';

/**
 * Base class for every error this app throws on purpose.
 */
export class AppError extends Error {
  /**
   * Creates an error whose `name` is the name of the concrete subclass.
   * @param {string} message - Human-readable description, free of secret values.
   * @param {{ cause?: unknown }} [options] - The error being wrapped, if any.
   */
  constructor(message, options) {
    super(message, options);
    // new.target keeps the subclass name without each subclass having to set it.
    this.name = new.target.name;
  }
}

/**
 * Thrown when the environment does not satisfy the config schema.
 */
export class ConfigError extends AppError {
  /**
   * Creates the error and lists every issue in its message.
   * @param {ReadonlyArray<ConfigIssue>} issues - Offending variables with the reason for each.
   * @param {{ cause?: unknown }} [options] - The error being wrapped, if any.
   */
  constructor(issues, options) {
    super(formatIssues(issues), options);
    /** @type {ReadonlyArray<ConfigIssue>} */
    this.issues = Object.freeze(issues.map((issue) => Object.freeze({ ...issue })));
  }
}

/**
 * Thrown when the Copilot SDK, its runtime or its authentication fails.
 */
export class CopilotError extends AppError {}

/**
 * Thrown when an MCP server cannot be reached or returns something unusable.
 */
export class McpError extends AppError {}

/**
 * Thrown when a tool call is refused because it is not on the read-only allow-list.
 */
export class ToolNotAllowedError extends AppError {
  /**
   * Creates the error and records which tool was refused.
   * @param {string} server - Key of the MCP server the tool belongs to.
   * @param {string} tool - Name of the refused tool.
   * @param {{ cause?: unknown }} [options] - The error being wrapped, if any.
   */
  constructor(server, tool, options) {
    super(`Tool "${tool}" on server "${server}" is not allowed`, options);
    /** @type {string} */
    this.server = server;
    /** @type {string} */
    this.tool = tool;
  }
}

/**
 * Thrown when a question does not finish within the configured time limit.
 */
export class AskTimeoutError extends AppError {
  /**
   * Creates the error and records the limit that was exceeded.
   * @param {number} timeoutMs - The time limit, in milliseconds.
   * @param {{ cause?: unknown }} [options] - The error being wrapped, if any.
   */
  constructor(timeoutMs, options) {
    super(`The question did not finish within ${timeoutMs} ms`, options);
    /** @type {number} */
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Builds the message for a ConfigError, one line per issue.
 * @param {ReadonlyArray<ConfigIssue>} issues - Issues to describe.
 * @returns {string} Headline followed by a `- PATH: message` line per issue.
 */
function formatIssues(issues) {
  const lines = issues.map(({ path, message }) => `- ${path}: ${message}`);
  return [`${CONFIG_ERROR_HEADLINE}:`, ...lines].join('\n');
}
