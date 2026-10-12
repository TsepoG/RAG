// @ts-check
import {
  createCitationRegistry,
  getExtractor,
  NO_RESULTS,
  removedNotice,
  wrapAsSource,
} from '../citations/index.js';
import { maskSecrets } from '../logger/index.js';
import { resolveTool } from './allowlist.js';
import { CODE_SEARCH_HINT, CODE_SEARCH_TOOL } from './hints.js';
import { SERVER_KEYS } from './servers.js';
import { capSource, CONFLUENCE_PAGE_TOOL, confluencePageText } from './sourceText.js';

export { CUT_NOTICE, MAX_SOURCE_CHARS } from './sourceText.js';

/** @typedef {import('@github/copilot-sdk').SessionHooks} SessionHooks */
/** @typedef {import('@github/copilot-sdk').ToolResultObject} ToolResultObject */
/** @typedef {Pick<SessionHooks, 'onPostToolUse' | 'onPostToolUseFailure'>} PostToolHooks */

/**
 * What the post-tool hooks need, on top of the limits every hook shares.
 * @typedef {object} PostToolDeps
 * @property {ReadonlyArray<string>} repos - Allowed `owner/repo` names.
 * @property {ReadonlyArray<string>} spaceKeys - Allowed Confluence space keys.
 * @property {string} siteUrl - Atlassian site URL, used to build page links.
 * @property {ReadonlyArray<string>} [secrets] - Secret values to mask in logged error text.
 * @property {Pick<import('../logger/index.js').Logger, 'info' | 'warn' | 'error'>} logger - Where
 *   completions, removals and failures are logged.
 * @property {{ now: () => number }} clock - Time source in milliseconds.
 * @property {{ start: (name: string, args: unknown) => void, stop: (name: string, args: unknown) => number | undefined }} timer
 *   Measures how long each call took.
 * @property {import('../citations/index.js').CitationRegistry} [registry] - Where fetched sources
 *   are recorded; a fresh one when omitted.
 * @property {(repo: string) => Promise<string | undefined>} [resolveHead] - Looks up a repository's
 *   head commit, for pinning a file link; finds nothing when omitted.
 */

/** Longest error text logged for a failed tool call. */
const ERROR_TEXT_LIMIT = 300;

/** The result the model gets in place of Confluence content that must not reach it. */
const REMOVED_RESULT = Object.freeze({
  textResultForLlm: removedNotice(),
  resultType: /** @type {const} */ ('success'),
  binaryResultsForLlm: Object.freeze([]),
});

/**
 * Builds the replacement result. A fresh object, with no field copied from the original, so
 * nothing of the content (text, binary parts or logs) goes with it.
 * @returns {ToolResultObject} The replacement.
 */
function removedResult() {
  return { ...REMOVED_RESULT, binaryResultsForLlm: [] };
}

/**
 * Whether a failure while handling this call must remove its result. Confluence content is
 * fail-closed: if it could not be checked, the model does not see it. An input that cannot even
 * be read counts as Confluence, because it cannot be shown to be anything else.
 * @param {{ toolName: string }} input - The hook input.
 * @returns {boolean} True when the result must be replaced.
 */
function mustFailClosed(input) {
  try {
    const target = resolveTool(input.toolName);
    return target?.server === SERVER_KEYS.atlassian && getExtractor(target) !== undefined;
  } catch {
    return true;
  }
}

/**
 * Builds the hooks that run after a tool call. The success hook logs the call, then reads what the
 * tool returned: sources the model was given are registered and wrapped with their key, search hits
 * are noted as candidates, and Confluence content that cannot be shown to be inside the allowed
 * spaces is replaced by a notice. It never throws. If it fails while handling Confluence content,
 * the content is replaced; for GitHub it is passed through unwrapped, because the pre-tool hook
 * already confined those calls and unwrapped content simply cannot be cited. Nothing it logs
 * includes what a tool returned.
 * @param {PostToolDeps} deps - Limits, logger, clock, timer, registry and commit lookup.
 * @returns {PostToolHooks} The hooks.
 */
export function createPostToolHooks({
  repos,
  spaceKeys,
  siteUrl,
  secrets = [],
  logger,
  clock,
  timer,
  registry = createCitationRegistry(),
  resolveHead = async () => undefined,
}) {
  const context = { siteUrl, spaceKeys, repos, now: () => clock.now(), resolveHead };

  /**
   * Reads one tool result and decides what the model is given instead.
   * @param {{ toolName: string, toolArgs: unknown, toolResult: ToolResultObject }} input - The hook input.
   * @param {string} text - The text of the result.
   * @returns {Promise<{ modifiedResult?: ToolResultObject, additionalContext?: string } | undefined>} A
   *   replacement result, a note for the model, or nothing.
   */
  async function handle(input, text) {
    const target = resolveTool(input.toolName);
    const extractor = target === undefined ? undefined : getExtractor(target);
    if (target === undefined || extractor === undefined) {
      return undefined;
    }
    const { sessionLog } = input.toolResult;
    const extraction = await extractor(
      { args: input.toolArgs, text, log: typeof sessionLog === 'string' ? sessionLog : undefined },
      context,
    );
    if (extraction.blocked) {
      logger.warn(
        { tool: input.toolName, reason: extraction.reason },
        'confluence content removed',
      );
      return { modifiedResult: removedResult() };
    }
    extraction.candidates.forEach((candidate) => registry.addCandidate(candidate));
    const keys = extraction.sources.map((source) => registry.register(source));
    const [source] = extraction.sources;
    if (source === undefined) {
      // An empty code search is common for this server, and repeating it only uses up calls.
      return extraction.reason === NO_RESULTS && target.tool === CODE_SEARCH_TOOL
        ? { additionalContext: CODE_SEARCH_HINT }
        : undefined;
    }
    logger.info({ tool: input.toolName, keys }, 'sources registered');
    const page = target.tool === CONFLUENCE_PAGE_TOOL ? confluencePageText(text) : undefined;
    const wrapped = wrapAsSource(
      { key: keys[0], type: source.type, title: source.title },
      capSource(page ?? text, { names: page !== undefined }),
    );
    return { modifiedResult: { ...input.toolResult, textResultForLlm: wrapped } };
  }

  return {
    async onPostToolUse(input) {
      try {
        const raw = input.toolResult.textResultForLlm;
        const text = typeof raw === 'string' ? raw : '';
        const durationMs = timer.stop(input.toolName, input.toolArgs);
        logger.info(
          { tool: input.toolName, durationMs, resultChars: text.length },
          'tool call completed',
        );
        return await handle(input, text);
      } catch (error) {
        logger.error({ err: error }, 'post-tool hook failed');
        return mustFailClosed(input) ? { modifiedResult: removedResult() } : undefined;
      }
    },
    onPostToolUseFailure(input) {
      try {
        const durationMs = timer.stop(input.toolName, input.toolArgs);
        const { error } = input;
        const detail =
          typeof error === 'string'
            ? { errorChars: error.length, error: maskSecrets(error, secrets, ERROR_TEXT_LIMIT) }
            : { errorChars: 0 };
        logger.warn({ tool: input.toolName, durationMs, ...detail }, 'tool call failed');
      } catch (error) {
        logger.error({ err: error }, 'post-tool failure hook failed');
      }
    },
  };
}
