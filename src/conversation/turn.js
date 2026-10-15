// @ts-check
import {
  awaitQuiet,
  buildQuestionHooks,
  completeTurn,
  createEventRecorder,
  createLookups,
  createNotifier,
  startInterrupt,
  toTurnError,
} from '../answer/index.js';
import { buildSessionConfig } from '../copilot/index.js';
import {
  AppError,
  AskTimeoutError,
  ConversationBusyError,
  ConversationEndedError,
  ConversationFullError,
  QuestionCancelledError,
} from '../errors/index.js';
import { applyMemoryDroppedCap } from '../honesty/index.js';
import { createCallBudget, createPermissionHandler, createTurnGate } from '../mcp/index.js';
import { withDetailLevel } from '../roles/index.js';
import { buildTurnNote } from './turnNote.js';

/** The parts of a session a turn uses. */
/** @typedef {Pick<import('@github/copilot-sdk').CopilotSession, 'on' | 'send' | 'abort' | 'disconnect'>} TurnSession */

/**
 * What to ask in a conversation, and where to send the answer as it streams.
 * @typedef {object} TurnInput
 * @property {string} question - The question.
 * @property {import('../roles/index.js').DetailLevel} [detailLevel] - `more` answers one step more
 *   technically than the last answer; defaults to `default`.
 * @property {ReadonlyArray<string>} [changedKeys] - Sources the model should read again because
 *   they changed since it read them (a "re-ask with the latest version").
 * @property {AbortSignal} [signal] - Aborting it stops this turn only; the conversation goes on.
 * @property {(activity: import('../answer/askQuestion.js').Activity) => void} [onActivity] - Told what the turn is doing.
 * @property {(text: string) => void} [onDelta] - Receives each piece of the model's reply.
 */

/**
 * What the runner depends on, all injected so tests need no Copilot and no clock.
 * @typedef {object} RunnerDeps
 * @property {Pick<import('@github/copilot-sdk').CopilotClient, 'createSession'>} client - A started client.
 * @property {string} workingDirectory - The empty directory sessions run in.
 * @property {import('../config/index.js').AppConfig} config - Validated config.
 * @property {import('../logger/index.js').Logger} logger - Where hooks and cleanup log.
 * @property {(conversation: import('./conversation.js').Conversation, reason: string) => Promise<void>} endConversation -
 *   Closes a conversation to new questions and frees its session (the store's `end`).
 * @property {{ now: () => number }} clock - Time source.
 * @property {typeof fetch} [fetch] - Used to look up commits and CODEOWNERS; defaults to the global fetch.
 */

/**
 * What lives as long as a conversation's session: the hooks the session was made with, and the
 * parts of them that start again each turn.
 * @typedef {object} Runtime
 * @property {ReturnType<typeof buildQuestionHooks>} hooks - The tool hooks.
 * @property {(view: import('../citations/index.js').CitationRegistry) => void} useView - Points the hooks at this turn's view of the sources.
 * @property {import('../mcp/index.js').TurnGate} gate - Open at the start of each turn.
 * @property {import('../mcp/index.js').CallBudget} budget - Counted again each turn.
 * @property {ReturnType<typeof createLookups>['owners']} owners - CODEOWNERS lookup.
 * @property {boolean} previousRewritten - Whether the last answer was rewritten.
 */

/** Stands in for the watch on the session until there is a session to watch. */
const NOT_WATCHING = /** @type {{ dropped: () => boolean, stop: () => void }} */ (
  // `Boolean()` with no argument is false: nothing has been dropped before there is a session.
  Object.freeze({ dropped: Boolean, stop: () => undefined })
);

/** The error for each reason a turn cannot start. */
const REFUSALS = Object.freeze({
  busy: () => new ConversationBusyError(),
  ended: () => new ConversationEndedError(),
  turns: () => new ConversationFullError('turns'),
  budget: () => new ConversationFullError('budget'),
});

/**
 * Whether an error is the turn being cut short (by time or by the reader), as opposed to the
 * session itself failing.
 * @param {unknown} error - What was thrown.
 * @returns {boolean} True for a timeout or a stop.
 */
function isInterruption(error) {
  return error instanceof AskTimeoutError || error instanceof QuestionCancelledError;
}

/**
 * Points the tool hooks at whichever turn is running. The hooks are made once, with the session,
 * so the registry they write to has to be a stand-in that can be moved.
 * @param {import('../citations/index.js').CitationRegistry} first - The registry to start with.
 * @returns {{ registry: import('../citations/index.js').CitationRegistry, use: (view: import('../citations/index.js').CitationRegistry) => void }} The stand-in and the way to move it.
 */
export function createSwitchableRegistry(first) {
  let current = first;
  return {
    registry: {
      register: (source) => current.register(source),
      get: (key) => current.get(key),
      list: () => current.list(),
      addCandidate: (candidate) => current.addCandidate(candidate),
      candidates: () => current.candidates(),
    },
    use(view) {
      current = view;
    },
  };
}

/**
 * Watches for the runtime cutting the conversation's history short, which would leave an earlier
 * key pointing at text the model can no longer see. It also logs how full the context is, as
 * numbers only.
 * @param {Pick<TurnSession, 'on'>} session - The session.
 * @param {Pick<import('../logger/index.js').Logger, 'debug'>} logger - Where the counts are logged.
 * @returns {{ dropped: () => boolean, stop: () => void }} Whether anything was dropped, and the way to stop watching.
 */
function watchMemory(session, logger) {
  let dropped = false;
  const drop = () => {
    dropped = true;
  };
  const unsubscribers = [
    session.on('session.truncation', drop),
    session.on('session.compaction_start', drop),
    session.on('session.usage_info', ({ data }) =>
      logger.debug(
        { currentTokens: data.currentTokens, tokenLimit: data.tokenLimit },
        'context usage',
      ),
    ),
  ];
  return { dropped: () => dropped, stop: () => unsubscribers.forEach((off) => off()) };
}

/**
 * Creates the runner for conversations: the one function that asks a question in a conversation,
 * through the same stages a single question goes through.
 * @param {RunnerDeps} deps - Client, config, logger and how to end a conversation.
 * @returns {{ ask: (conversation: import('./conversation.js').Conversation, input: TurnInput) => Promise<import('../answer/askQuestion.js').AskResult & { turn: number }> }} The runner.
 * @throws {AppError} (from `ask`) When the question is blank.
 * @throws {QuestionCancelledError} (from `ask`) When the turn is stopped.
 * @throws {AskTimeoutError} (from `ask`) When the turn takes longer than ASK_TIMEOUT_MS.
 * @throws {ConversationBusyError} (from `ask`) While the last question is still being answered.
 * @throws {ConversationFullError} (from `ask`) When the turn cap or the source budget is used up.
 * @throws {ConversationEndedError} (from `ask`) When the conversation was closed.
 * @throws {CopilotError} (from `ask`) When Copilot or the session fails; the conversation ends.
 */
export function createConversationRunner(deps) {
  const { client, workingDirectory, config, logger, endConversation, fetch, clock } = deps;
  /** @type {WeakMap<import('./conversation.js').Conversation, Runtime>} */
  const runtimes = new WeakMap();

  /**
   * Makes what lasts as long as the conversation's session.
   * @param {import('./conversation.js').Conversation} conversation - The conversation.
   * @returns {Runtime} The runtime.
   */
  function createRuntime(conversation) {
    const switchable = createSwitchableRegistry(conversation.registry.turnView());
    const gate = createTurnGate();
    const budget = createCallBudget();
    const { commits, owners } = createLookups({ config, fetch, logger });
    const hooks = buildQuestionHooks({
      config,
      registry: switchable.registry,
      gate,
      commits,
      logger,
      clock,
      budget,
      onSourceText: (chars) => conversation.addSourceChars(chars),
    });
    return { hooks, useView: switchable.use, gate, budget, owners, previousRewritten: false };
  }

  /**
   * Gives the conversation its session the first time it needs one.
   * @param {import('./conversation.js').Conversation} conversation - The conversation.
   * @param {Runtime} runtime - Its runtime.
   * @param {import('../roles/index.js').DetailedRole} role - The role the session is made for.
   * @returns {Promise<TurnSession>} The session.
   */
  async function ensureSession(conversation, runtime, role) {
    const existing = /** @type {TurnSession | undefined} */ (conversation.session());
    if (existing !== undefined) {
      return existing;
    }
    const session = await client.createSession(
      buildSessionConfig({
        config,
        role,
        workingDirectory,
        hooks: runtime.hooks,
        onPermissionRequest: createPermissionHandler({ logger }),
      }),
    );
    conversation.setSession(session);
    return session;
  }

  /**
   * Ends the turn that was cut short or that broke the session. A stop or a timeout leaves the
   * conversation usable, if the session confirms it has gone quiet; anything else ends it.
   * @param {unknown} error - What was thrown.
   * @param {{ conversation: import('./conversation.js').Conversation, turn: number }} turn - The turn.
   * @returns {Promise<Error>} The error to throw.
   */
  async function failTurn(error, { conversation, turn }) {
    const session = /** @type {TurnSession | undefined} */ (conversation.session());
    const interrupted = isInterruption(error);
    // Listening starts before the abort, so the idle that ends it is not missed.
    const watch = interrupted && session !== undefined ? awaitQuiet(session) : undefined;
    const failure = await toTurnError(error, { session, logger });
    const quiet = watch === undefined ? true : await watch.quiet();
    watch?.stop();
    if (!interrupted || !quiet) {
      // Ending first, while the turn still counts as running, makes the closer abort it.
      await endConversation(conversation, interrupted ? 'abort-unconfirmed' : 'session-error');
    }
    const cancelled = error instanceof QuestionCancelledError;
    conversation.finishTurn(turn, cancelled ? 'cancelled' : 'failed');
    return failure;
  }

  /**
   * Records an answered turn. If the runtime dropped history during it, the answer is capped and
   * the conversation ends once the answer is out.
   * @param {import('../answer/askQuestion.js').AskResult} result - The finished result.
   * @param {{ conversation: import('./conversation.js').Conversation, runtime: Runtime, turn: number, memory: { dropped: () => boolean } }} turn - The turn.
   * @returns {Promise<import('../answer/askQuestion.js').AskResult & { turn: number }>} The result.
   */
  async function recordAnswer(result, { conversation, runtime, turn, memory }) {
    const dropped = memory.dropped();
    const final = dropped ? applyMemoryDroppedCap(result) : result;
    conversation.finishTurn(turn, 'answered', { result: final });
    runtime.previousRewritten = final.rewritten;
    if (dropped) {
      conversation.markTruncated();
      await endConversation(conversation, 'truncated');
    }
    return { ...final, turn };
  }

  return {
    async ask(conversation, input) {
      const { question, detailLevel = 'default', changedKeys, signal, onActivity, onDelta } = input;
      if (question.trim() === '') {
        throw new AppError('A question is required');
      }
      if (signal?.aborted) {
        throw new QuestionCancelledError();
      }
      const begun = conversation.beginTurn({ question, detailLevel });
      if (!begun.ok) {
        throw REFUSALS[begun.refusal]();
      }
      const { turn } = begun;
      const runtime = runtimes.get(conversation) ?? createRuntime(conversation);
      runtimes.set(conversation, runtime);
      const view = conversation.registry.turnView();
      runtime.useView(view);
      runtime.gate.startTurn();
      runtime.budget.reset();
      const role = withDetailLevel(conversation.role, detailLevel);
      const note = buildTurnNote({
        turn,
        detailLevel,
        changedKeys,
        previousRewritten: runtime.previousRewritten,
      });
      const startedAt = clock.now();
      const notify = createNotifier(onActivity, logger);
      const events = createEventRecorder({
        clock,
        onDelta,
        onToolStart: (tool) => notify({ kind: 'tool', ...tool }),
      });
      const { interrupt, cancellation, stop } = startInterrupt({
        askTimeoutMs: config.copilot.askTimeoutMs,
        signal,
      });
      const turnState = {
        conversation,
        runtime,
        turn,
        // Replaced by the real watch once the session exists.
        memory: NOT_WATCHING,
      };

      const run = async () => {
        const session = await ensureSession(conversation, runtime, role);
        events.attach(session);
        turnState.memory = watchMemory(session, logger);
        await session.send({ prompt: note === '' ? question : `${note}\n\nQuestion: ${question}` });
        return events.settled;
      };

      try {
        const outcome = await Promise.race([run(), interrupt]);
        if (!outcome.ok) {
          throw outcome.error;
        }
        const result = await completeTurn({
          events,
          startedAt,
          detailLevel,
          role,
          registry: view,
          session: /** @type {TurnSession} */ (conversation.session()),
          gate: runtime.gate,
          clock,
          interrupt,
          cancellation,
          owners: runtime.owners,
          logger,
          notify,
        });
        return await recordAnswer(result, turnState);
      } catch (error) {
        throw await failTurn(error, turnState);
      } finally {
        stop();
        events.detach();
        turnState.memory.stop();
      }
    },
  };
}
