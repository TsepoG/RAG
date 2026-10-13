// @ts-check
import { randomUUID } from 'node:crypto';
import { vi } from 'vitest';
import { pageFingerprint } from '../../src/citations/index.js';
import { createConversationStore } from '../../src/conversation/index.js';
import { QuestionCancelledError } from '../../src/errors/index.js';
import { createRecheckService } from '../../src/server/recheckService.js';
import { ask as realAsk, PAGE, reply, WINDOW } from './ask.js';
import { buildTestApp } from './server.js';
import { confluenceSource } from './sources.js';

/** Time zero of the fake clock the conversation tests use. */
export const START = Date.parse('2026-10-13T09:00:00Z');

/** @type {import('../../src/answer/index.js').AskResult | undefined} */
let base;

/**
 * A realistic result of one question, made once by the real pipeline over canned model output.
 * @returns {Promise<import('../../src/answer/index.js').AskResult>} A result that cites C1.
 */
async function baseResult() {
  base ??= (await realAsk({ tools: [PAGE], replies: [reply(`${WINDOW} [C1].`)] })).result;
  return base;
}

/**
 * What a fake turn does: which pages it fetches (each at a version), or how it fails.
 * @typedef {object} Plan
 * @property {Array<{ id: string, version: number }>} [pages] - Pages the turn fetches and cites.
 * @property {Error} [fail] - Makes the turn end with this error.
 * @property {() => Promise<void>} [during] - Runs in the middle of the turn, before it answers.
 * @property {boolean} [untilStopped] - Makes the turn wait until it is stopped, then end cancelled.
 */

/**
 * A stand-in for the conversation runner that does what the real one does to the conversation:
 * starts the turn, registers sources, and records the result, without Copilot.
 * @param {Plan[]} plans - What each turn does, in order; the last repeats.
 * @returns {{ ask: import('vitest').Mock }} The runner.
 */
export function fakeRunner(plans) {
  let calls = 0;
  return {
    ask: vi.fn(async (conversation, input) => {
      const plan = plans[Math.min(calls, plans.length - 1)] ?? {};
      calls += 1;
      const begun = conversation.beginTurn({
        question: input.question,
        detailLevel: input.detailLevel ?? 'default',
      });
      const keys = (plan.pages ?? [{ id: '100', version: 1 }]).map(({ id, version }) =>
        conversation.registry.register({
          ...confluenceSource({ id, version, spaceKey: 'ENG' }),
          fingerprint: pageFingerprint(version),
        }),
      );
      input.onActivity?.({ kind: 'checking' });
      input.onDelta?.('Working on it');
      // The model's report is not part of the answer, so the route filters it out of the stream.
      input.onDelta?.('\n');
      input.onDelta?.('```answer-meta\n{}\n```');
      await plan.during?.();
      if (plan.untilStopped) {
        await new Promise((resolve) => input.signal.addEventListener('abort', resolve));
        conversation.finishTurn(begun.turn, 'cancelled');
        throw new QuestionCancelledError();
      }
      if (plan.fail) {
        conversation.finishTurn(begun.turn, 'failed');
        throw plan.fail;
      }
      const result = await baseResult();
      const answered = {
        ...result,
        sources: keys.map((key) => ({ ...result.sources[0], key })),
        detailLevel: input.detailLevel ?? 'default',
      };
      conversation.finishTurn(begun.turn, 'answered', { result: answered });
      return { ...answered, turn: begun.turn };
    }),
  };
}

/**
 * An app with the conversation routes, a real store and re-check service, a fake runner, and
 * checkers whose answer the test sets.
 * @param {object} [options] - What differs from the usual.
 * @param {Plan[]} [options.plans] - What each turn does.
 * @param {Partial<{ maxTurns: number, maxSourceChars: number, idleMinutes: number }>} [options.limits] - Conversation limits.
 * @param {string} [options.status] - What the Confluence checker says for every page.
 * @returns {Promise<{
 *   app: import('fastify').FastifyInstance,
 *   store: import('../../src/conversation/index.js').ConversationStore,
 *   runner: { ask: import('vitest').Mock },
 *   confluenceCheck: import('vitest').Mock,
 *   closeSession: import('vitest').Mock,
 *   lines: () => Array<Record<string, unknown>>,
 *   answers: import('../../src/server/answers.js').AnswerMemory,
 *   setNow: (ms: number) => void,
 *   setStatus: (status: string) => void,
 * }>} The app and its doubles.
 */
export async function buildConversationApp({
  plans = [{}],
  limits = {},
  status = 'unchanged',
} = {}) {
  await baseResult();
  let now = START;
  let answer = status;
  const clock = { now: () => now };
  const closeSession = vi.fn(async () => {});
  const store = createConversationStore({
    clock,
    limits: { maxTurns: 5, maxSourceChars: 250_000, idleMinutes: 30, ...limits },
    closeSession,
    newId: randomUUID,
  });
  const runner = fakeRunner(plans);
  const confluenceCheck = vi.fn(async () => answer);
  const { app, lines, answers } = buildTestApp({
    conversations: {
      store,
      runner,
      recheck: createRecheckService({
        checkers: /** @type {any} */ ({
          github: { check: vi.fn(async () => 'unchanged') },
          confluence: { check: confluenceCheck },
        }),
        clock,
        afterMinutes: 15,
        logger: { info: () => undefined },
      }),
    },
  });
  return {
    app,
    store,
    runner,
    confluenceCheck,
    closeSession,
    lines,
    answers,
    setNow: (ms) => (now = ms),
    setStatus: (next) => (answer = next),
  };
}
