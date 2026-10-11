// @ts-check
import { isAllowedTool, resolveTool } from './allowlist.js';
import { SERVER_KEYS } from './servers.js';
import { CODE_SEARCH_HINT, CODE_SEARCH_TOOL, MAX_CODE_SEARCHES } from './hints.js';
import { createPostToolHooks } from './postHooks.js';
import { buildScope, checkToolScope } from './scope.js';
import { createToolGate, TOOLS_LOCKED_REASON } from './toolGate.js';
import { asRecord } from './scopeCommon.js';

/** @typedef {import('@github/copilot-sdk').SessionHooks} SessionHooks */
/** @typedef {Parameters<NonNullable<SessionHooks['onPreToolUse']>>[0]} PreToolInput */
/** @typedef {Parameters<NonNullable<SessionHooks['onPostToolUse']>>[0]} PostToolInput */
/** @typedef {Parameters<NonNullable<SessionHooks['onPostToolUseFailure']>>[0]} ToolFailureInput */
/** @typedef {Pick<SessionHooks, 'onPreToolUse' | 'onPostToolUse' | 'onPostToolUseFailure'>} ToolHooks */
/** @typedef {Pick<import('../logger/index.js').Logger, 'info' | 'warn' | 'error'>} HookLogger */

/**
 * Dependencies of the tool hooks, injected so tests need no real clock, logger or scope rules.
 * @typedef {object} ToolHooksDeps
 * @property {ReadonlyArray<string>} repos - Allowed `owner/repo` names (GITHUB_REPOS).
 * @property {ReadonlyArray<string>} spaceKeys - Allowed Confluence space keys.
 * @property {string} siteUrl - Atlassian site URL, so page URLs on other sites are refused.
 * @property {number} maxToolCalls - Most tool calls one question may attempt.
 * @property {import('./toolGate.js').ToolGate} [gate] - When locked, every call is refused. A new
 *   open gate is used when omitted.
 * @property {string} [cloudId] - The Atlassian cloudId. When set, it replaces the one the model
 *   passes to Confluence tools, whether missing, a placeholder or wrong.
 * @property {ReadonlyArray<string>} [secrets] - Secret values to mask in logged error text.
 * @property {import('../citations/index.js').CitationRegistry} [registry] - Where fetched sources
 *   are recorded; a fresh one when omitted.
 * @property {(repo: string) => Promise<string | undefined>} [resolveHead] - Looks up a repository's
 *   head commit, for pinning file links.
 * @property {HookLogger} logger - Where denials, completions and failures are logged.
 * @property {{ now: () => number }} [clock] - Time source in milliseconds; defaults to Date.now.
 * @property {typeof checkToolScope} [checkScope] - The scope check; defaults to the real one.
 */

/** Real time, used unless a test injects its own clock. */
const SYSTEM_CLOCK = Object.freeze({ now: () => Date.now() });

/** Confluence tools that take a cloudId; getAccessibleAtlassianResources takes no arguments. */
const CLOUD_ID_TOOLS = new Set(['searchConfluence', 'getConfluenceContent']);

/** Said to the model when a call is refused for a reason it cannot act on. */
const NOT_AVAILABLE = 'This tool is not available.';

/** Said to the model when a check itself failed, so the call is refused rather than guessed at. */
const CHECK_FAILED = 'The tool call could not be checked, so it was not run.';

/**
 * Pairs each tool call's start with its end, to measure how long it took. The SDK gives hooks no
 * call id, so calls are matched by tool name and arguments, oldest first.
 * @param {{ now: () => number }} clock - Time source.
 * @returns {{ start: (name: string, args: unknown) => void, stop: (name: string, args: unknown) => number | undefined }}
 *   `start` notes when a call began; `stop` returns its duration in ms, or undefined if unknown.
 */
function createCallTimer(clock) {
  /** @type {Map<string, number[]>} */
  const started = new Map();
  /**
   * Builds the key a call is matched on.
   * @param {string} name - Tool name.
   * @param {unknown} args - Tool arguments.
   * @returns {string} The key.
   */
  const keyOf = (name, args) => {
    try {
      return `${name}\u0000${JSON.stringify(args)}`;
    } catch {
      // Arguments that cannot be serialized still need a key; the name alone is good enough to time.
      return name;
    }
  };
  return {
    start(name, args) {
      const key = keyOf(name, args);
      started.set(key, [...(started.get(key) ?? []), clock.now()]);
    },
    stop(name, args) {
      const key = keyOf(name, args);
      const [first, ...rest] = started.get(key) ?? [];
      if (rest.length > 0) {
        started.set(key, rest);
      } else {
        started.delete(key);
      }
      return first === undefined ? undefined : clock.now() - first;
    },
  };
}

/**
 * Builds the hook that runs before every tool call and allows or denies it. It only ever answers
 * allow or deny (never ask), and any failure inside it denies.
 * @param {ToolHooksDeps & { timer: ReturnType<typeof createCallTimer> }} deps - Limits and helpers.
 * @returns {NonNullable<SessionHooks['onPreToolUse']>} The hook.
 */
function createPreToolHook({
  repos,
  spaceKeys,
  siteUrl,
  maxToolCalls,
  cloudId,
  gate = createToolGate(),
  logger,
  timer,
  checkScope = checkToolScope,
}) {
  const scope = buildScope({ repos, spaceKeys, siteUrl });
  let attempts = 0;
  // Only searches that passed the scope check count, so a badly formed query does not use one up.
  let codeSearches = 0;

  /**
   * Refuses a call and logs it. Only the tool name and a reason code are logged, never arguments.
   * @param {string} tool - Tool name as the runtime reported it.
   * @param {string} code - Short reason code for the log.
   * @param {string} reason - Explanation sent back to the model.
   * @returns {{ permissionDecision: 'deny', permissionDecisionReason: string }} The decision.
   */
  function refuse(tool, code, reason) {
    logger.warn({ tool, reason: code }, 'tool call denied');
    return { permissionDecision: 'deny', permissionDecisionReason: reason };
  }

  /**
   * Decides on one call.
   * @param {string} toolName - Tool name as the runtime reported it.
   * @param {unknown} toolArgs - Tool arguments.
   * @returns {{ permissionDecision: 'allow' | 'deny', permissionDecisionReason?: string, modifiedArgs?: unknown }}
   *   The decision, with the arguments to run the call with when they were changed.
   */
  function decide(toolName, toolArgs) {
    if (gate.isLocked()) {
      return refuse(toolName, 'tools-locked', TOOLS_LOCKED_REASON);
    }
    // Every attempt counts, allowed or not, so a model stuck retrying a denied call still stops.
    attempts += 1;
    if (attempts > maxToolCalls) {
      return refuse(
        toolName,
        'call-limit',
        `The limit of ${maxToolCalls} tool calls is reached. Answer with what you have.`,
      );
    }
    const target = resolveTool(toolName);
    if (target === undefined || !isAllowedTool(target.server, target.tool)) {
      return refuse(toolName, 'not-allow-listed', NOT_AVAILABLE);
    }
    const scoped = checkScope(target, toolArgs, scope);
    if (!scoped.ok) {
      return refuse(toolName, scoped.code, scoped.reason);
    }
    if (target.tool === CODE_SEARCH_TOOL) {
      if (codeSearches >= MAX_CODE_SEARCHES) {
        return refuse(toolName, 'search-limit', CODE_SEARCH_HINT);
      }
      codeSearches += 1;
    }
    timer.start(toolName, toolArgs);
    if (
      cloudId === undefined ||
      target.server !== SERVER_KEYS.atlassian ||
      !CLOUD_ID_TOOLS.has(target.tool)
    ) {
      return { permissionDecision: 'allow' };
    }
    const modifiedArgs = { ...asRecord(toolArgs), cloudId };
    // The post-tool hook may be given either form of the arguments, so both are timed.
    timer.start(toolName, modifiedArgs);
    return { permissionDecision: 'allow', modifiedArgs };
  }

  return (input) => {
    try {
      return decide(input.toolName, input.toolArgs);
    } catch (error) {
      // Not reading the input again here: reading it may be what failed.
      logger.error({ err: error }, 'pre-tool hook failed; denying');
      return { permissionDecision: 'deny', permissionDecisionReason: CHECK_FAILED };
    }
  };
}

/**
 * Creates the hooks for one question: the pre-tool hook that allows or denies each call, and the
 * post-tool hooks that log it and register what it returned as sources. Make a new set per
 * question, because the call limit and the registry are per set.
 * @param {ToolHooksDeps} deps - Limits, logger and optional clock and scope check.
 * @returns {ToolHooks} Hooks to register on the session.
 */
export function createToolHooks(deps) {
  const timer = createCallTimer(deps.clock ?? SYSTEM_CLOCK);
  return {
    onPreToolUse: createPreToolHook({ ...deps, timer }),
    ...createPostToolHooks({ ...deps, clock: deps.clock ?? SYSTEM_CLOCK, timer }),
  };
}
