// @ts-check
import { AppError, ToolNotAllowedError } from '../errors/index.js';
import { isAllowedTool, resolveTool } from './allowlist.js';
import { buildScope, checkToolScope } from './scope.js';

/**
 * A request to call one tool and keep its raw result.
 * @typedef {object} SampleRequest
 * @property {string} tool - Tool name, as the allow-list names it (for example `get_commit`).
 * @property {Record<string, unknown>} args - The tool's arguments.
 * @property {string} name - What to call the saved file, without extension.
 */

const NAME_FLAG = '--as';
const SAFE_NAME = /^[\w-]+$/;
/** Where raw samples are saved; git-ignored, because they hold real content. */
export const RAW_DIRECTORY = 'test/fixtures/raw';

/** Shown when the command line is incomplete or malformed. */
export const SAMPLE_USAGE = `Usage: npm run mcp:sample -- <tool> '<json arguments>' [${NAME_FLAG} <file name>]`;

/**
 * Splits out the optional `--as <name>` flag.
 * @param {ReadonlyArray<string>} argv - The command-line arguments after the script name.
 * @returns {{ positional: string[], name: string | undefined }} The other arguments and the name.
 * @throws {AppError} When the flag has no value, or the value is not a plain file name.
 */
function splitNameFlag(argv) {
  const at = argv.indexOf(NAME_FLAG);
  if (at === -1) {
    return { positional: [...argv], name: undefined };
  }
  const name = argv[at + 1];
  if (name === undefined || !SAFE_NAME.test(name)) {
    throw new AppError(
      `${NAME_FLAG} needs a file name made of letters, digits, _ or -. ${SAMPLE_USAGE}`,
    );
  }
  return { positional: [...argv.slice(0, at), ...argv.slice(at + 2)], name };
}

/**
 * Reads the tool arguments, which must be a JSON object.
 * @param {string} text - The JSON text from the command line.
 * @returns {Record<string, unknown>} The arguments.
 * @throws {AppError} When the text is not JSON, or is not an object.
 */
function parseJsonObject(text) {
  /** @type {unknown} */
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new AppError(`The arguments are not valid JSON. ${SAMPLE_USAGE}`, { cause: error });
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AppError(`The arguments must be a JSON object. ${SAMPLE_USAGE}`);
  }
  return /** @type {Record<string, unknown>} */ (value);
}

/**
 * Reads the command line of `mcp:sample`: a tool, its JSON arguments and an optional file name.
 * @param {ReadonlyArray<string>} argv - The command-line arguments after the script name.
 * @returns {SampleRequest} The request; `name` defaults to the tool name.
 * @throws {AppError} When an argument is missing, malformed or unexpected.
 */
export function parseSampleArgs(argv) {
  const { positional, name } = splitNameFlag(argv);
  const [tool, json, ...extra] = positional;
  if (tool === undefined || json === undefined || extra.length > 0) {
    throw new AppError(SAMPLE_USAGE);
  }
  return { tool, args: parseJsonObject(json), name: name ?? tool };
}

/**
 * Checks a sample request the way the assistant checks a tool call: the tool must be
 * allow-listed, and its arguments must stay within the configured repos and Confluence spaces. A
 * sample is therefore no way around the limits the assistant itself works under.
 * @param {SampleRequest} request - The request.
 * @param {{ repos: ReadonlyArray<string>, spaceKeys: ReadonlyArray<string>, siteUrl: string }} limits
 *   Repos, space keys and site URL from config.
 * @returns {{ server: string, tool: string }} The server and bare tool name to call.
 * @throws {ToolNotAllowedError} When the tool is not on the allow-list.
 * @throws {AppError} When the arguments are outside the configured scope.
 */
export function checkSample({ tool, args }, limits) {
  const target = resolveTool(tool);
  if (target === undefined || !isAllowedTool(target.server, target.tool)) {
    throw new ToolNotAllowedError(target?.server ?? 'unknown', tool);
  }
  const verdict = checkToolScope(target, args, buildScope(limits));
  if (!verdict.ok) {
    throw new AppError(`Refused: ${verdict.reason}`);
  }
  return target;
}

/**
 * Where a sample is saved.
 * @param {string} name - The file name without extension.
 * @returns {string} A path under the raw fixtures directory.
 */
export function rawSamplePath(name) {
  return `${RAW_DIRECTORY}/${name}.json`;
}
