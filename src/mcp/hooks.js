// @ts-check
import { isAllowedTool, resolveTool } from './allowlist.js';
import { buildScope, checkToolScope, findSpaceKeys } from './scope.js';
import { SERVER_KEYS } from './servers.js';

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
 * @property {HookLogger} logger - Where denials, completions and failures are logged.
 * @property {{ now: () => number }} [clock] - Time source in milliseconds; defaults to Date.now.
 * @property {typeof checkToolScope} [checkScope] - The scope check; defaults to the real one.
 */

/** Real time, used unless a test injects its own clock. */
const SYSTEM_CLOCK = Object.freeze({ now: () => Date.now() });

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
  logger,
  timer,
  checkScope = checkToolScope,
}) {
  const scope = buildScope({ repos, spaceKeys, siteUrl });
  let attempts = 0;

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
   * @returns {{ permissionDecision: 'allow' | 'deny', permissionDecisionReason?: string }} The decision.
   */
  function decide(toolName, toolArgs) {
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
    timer.start(toolName, toolArgs);
    return { permissionDecision: 'allow' };
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
 * Builds the hooks that run after a tool call. They only log: tool name, duration and size, never
 * the content a tool returned. A failure inside them is logged and never reaches the model.
 * @param {ToolHooksDeps & { timer: ReturnType<typeof createCallTimer> }} deps - Limits and helpers.
 * @returns {Pick<ToolHooks, 'onPostToolUse' | 'onPostToolUseFailure'>} The hooks.
 */
function createPostToolHooks({ spaceKeys, logger, timer }) {
  const allowedSpaces = new Set(spaceKeys.map((key) => key.toLowerCase()));

  /**
   * Warns when a Confluence result mentions a space outside the allowed list. This is a backstop:
   * the pre-tool hook already confines searches and fetches, so a hit is usually a link in a page.
   * @param {string} toolName - Tool name as the runtime reported it.
   * @param {string} text - What the tool returned.
   */
  function warnAboutStraySpaces(toolName, text) {
    if (resolveTool(toolName)?.server !== SERVER_KEYS.atlassian) {
      return;
    }
    const spaces = findSpaceKeys(text).filter((key) => !allowedSpaces.has(key.toLowerCase()));
    if (spaces.length > 0) {
      logger.warn(
        { tool: toolName, spaces },
        'confluence result mentions a space outside the allowed list',
      );
    }
  }

  return {
    onPostToolUse(input) {
      try {
        const text = input.toolResult.textResultForLlm;
        const resultChars = typeof text === 'string' ? text.length : 0;
        const durationMs = timer.stop(input.toolName, input.toolArgs);
        logger.info({ tool: input.toolName, durationMs, resultChars }, 'tool call completed');
        if (typeof text === 'string') {
          warnAboutStraySpaces(input.toolName, text);
        }
      } catch (error) {
        logger.error({ err: error }, 'post-tool hook failed');
      }
    },
    onPostToolUseFailure(input) {
      try {
        const durationMs = timer.stop(input.toolName, input.toolArgs);
        const errorChars = typeof input.error === 'string' ? input.error.length : 0;
        logger.warn({ tool: input.toolName, durationMs, errorChars }, 'tool call failed');
      } catch (error) {
        logger.error({ err: error }, 'post-tool failure hook failed');
      }
    },
  };
}

/**
 * Creates the hooks for one question: the pre-tool hook that allows or denies each call, and the
 * post-tool hooks that log it. Make a new set per question, because the call limit is per set.
 * @param {ToolHooksDeps} deps - Limits, logger and optional clock and scope check.
 * @returns {ToolHooks} Hooks to register on the session.
 */
export function createToolHooks(deps) {
  const timer = createCallTimer(deps.clock ?? SYSTEM_CLOCK);
  return {
    onPreToolUse: createPreToolHook({ ...deps, timer }),
    ...createPostToolHooks({ ...deps, timer }),
  };
}
