// @ts-check
import { describe, expect, it, vi } from 'vitest';
import { EvalError } from '../../src/errors/index.js';
import { createRequestGuard } from '../../src/eval/budget.js';
import {
  collectRunInfo,
  modelsSeen,
  runEval,
  runFolderName,
  sanitiseResult,
} from '../../src/eval/run.js';
import { loadConfig } from '../../src/config/index.js';
import { makeCase } from '../helpers/eval.js';
import { FAKE_GITHUB_TOKEN, validEnv } from '../helpers/env.js';
import { makeRole } from '../helpers/role.js';

const ROLES = new Map([
  ['developer', makeRole({ id: 'developer', depth: 3, version: 2 })],
  ['product_owner', makeRole({ id: 'product_owner', depth: 1, version: 5 })],
]);

/**
 * An answer as `askQuestion` returns it.
 * @param {Record<string, unknown>} [changes] - Fields to replace.
 * @returns {import('../../src/answer/index.js').AskResult} The answer.
 */
function answer(changes = {}) {
  return /** @type {any} */ ({
    status: 'answered',
    confidence: 'medium',
    capsApplied: [],
    sources: [],
    invalidKeys: [],
    uncitedSentences: [],
    styleViolations: [],
    rewritten: false,
    rewriteRejected: false,
    answer: 'Thirty days.',
    toolCalls: [
      {
        server: 'atlassian',
        tool: 'searchConfluence',
        summary: 'cql=SECRET',
        durationMs: 5,
        success: true,
      },
    ],
    durationMs: 1200,
    ...changes,
  });
}

/**
 * Standard dependencies for a run, with changes.
 * @param {Partial<import('../../src/eval/run.js').RunDeps>} [changes] - What to replace.
 * @returns {import('../../src/eval/run.js').RunDeps} The dependencies.
 */
function deps(changes = {}) {
  let now = 0;
  return {
    cases: [makeCase({ id: 'a' }), makeCase({ id: 'b', role: 'product_owner' })],
    roles: ROLES,
    ask: vi.fn(async () => answer()),
    guard: createRequestGuard(undefined),
    clock: { now: () => (now += 1000) },
    maxToolCalls: 12,
    secrets: [],
    ...changes,
  };
}

describe('runEval', () => {
  it('asks each case in order, as its role, at the usual level, with its question', async () => {
    const options = deps();

    await runEval(options);

    expect(options.ask).toHaveBeenCalledTimes(2);
    expect(options.ask).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        question: 'Where is the refund window enforced?',
        role: ROLES.get('developer'),
        detailLevel: 'default',
      }),
    );
    expect(options.ask).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ role: ROLES.get('product_owner') }),
    );
  });

  it('asks one question at a time', async () => {
    let running = 0;
    let most = 0;
    const ask = vi.fn(async () => {
      running += 1;
      most = Math.max(most, running);
      await Promise.resolve();
      running -= 1;
      return answer();
    });

    await runEval(deps({ ask }));

    expect(most).toBe(1);
  });

  it('scores each answer with the role’s depth, and keeps the answer', async () => {
    const { entries } = await runEval(
      deps({
        cases: [makeCase({ id: 'po', role: 'product_owner' })],
        ask: vi.fn(async () => answer({ styleViolations: ['code block'] })),
      }),
    );

    expect(entries[0].score).toMatchObject({ id: 'po', plainStyleViolations: 1, passed: false });
    expect(entries[0].result).toMatchObject({ answer: 'Thirty days.', status: 'answered' });
    expect(entries[0]).toMatchObject({
      id: 'po',
      role: 'product_owner',
      reference: 'In window.js.',
      error: undefined,
    });
  });

  it('never keeps the summary of a tool call’s arguments', async () => {
    const { entries } = await runEval(deps());

    expect(JSON.stringify(entries)).not.toContain('SECRET');
    expect(/** @type {any} */ (entries[0].result).toolCalls).toEqual([
      { server: 'atlassian', tool: 'searchConfluence', durationMs: 5, success: true },
    ]);
  });

  it('records a question that fails as an error, and goes on with the next', async () => {
    const ask = vi.fn().mockRejectedValueOnce(new Error('the question did not finish'));
    ask.mockResolvedValue(answer());

    const { entries } = await runEval(deps({ ask }));

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      result: undefined,
      error: { kind: 'Error', message: 'the question did not finish' },
      score: { status: 'error', passed: false },
    });
    expect(entries[1].score.status).toBe('answered');
  });

  it('measures how long a failed question ran, with the clock it is given', async () => {
    const ask = vi.fn(async () => Promise.reject(new Error('x')));

    const { entries } = await runEval(deps({ ask, cases: [makeCase()] }));

    expect(entries[0].score.latencyMs).toBe(1000);
  });

  it('masks a secret in a failure’s message, and cuts a long one', async () => {
    const ask = vi.fn(async () =>
      Promise.reject(new Error(`bad token ${FAKE_GITHUB_TOKEN} ${'x'.repeat(500)}`)),
    );

    const { entries } = await runEval(
      deps({ ask, cases: [makeCase()], secrets: [FAKE_GITHUB_TOKEN] }),
    );

    expect(entries[0].error?.message).not.toContain(FAKE_GITHUB_TOKEN);
    expect(entries[0].error?.message.length).toBeLessThanOrEqual(300);
  });

  it('records something thrown that is not an Error', async () => {
    const ask = vi.fn(async () => Promise.reject('plain text'));

    const { entries } = await runEval(deps({ ask, cases: [makeCase()] }));

    expect(entries[0].error).toEqual({ kind: 'Error', message: 'plain text' });
  });

  it('stops starting cases once the request limit is reached, and says how many ran', async () => {
    const options = deps({ guard: createRequestGuard(1) });

    const { entries, requests } = await runEval(options);

    expect(entries.map(({ id }) => id)).toEqual(['a']);
    expect(requests).toMatchObject({ used: 1, casesRun: 1, stoppedEarly: true });
  });

  it('counts a rewrite as a second request', async () => {
    const ask = vi.fn(async () => answer({ rewritten: true }));

    const { requests } = await runEval(deps({ ask, cases: [makeCase()] }));

    expect(requests.used).toBe(2);
  });

  it('counts a failed question as one request', async () => {
    const ask = vi.fn(async () => Promise.reject(new Error('x')));

    const { requests } = await runEval(deps({ ask, cases: [makeCase()] }));

    expect(requests.used).toBe(1);
  });

  it('stops, keeping what finished, when the signal is aborted between cases', async () => {
    const controller = new AbortController();
    const ask = vi.fn(async () => {
      controller.abort();
      return answer();
    });

    const { entries, interrupted } = await runEval(deps({ ask, signal: controller.signal }));

    expect(entries.map(({ id }) => id)).toEqual(['a']);
    expect(interrupted).toBe(true);
  });

  it('does not record the question that was cut off when the signal is aborted during it', async () => {
    const controller = new AbortController();
    const ask = vi.fn(async () => {
      controller.abort();
      throw new Error('cancelled');
    });

    const { entries, interrupted } = await runEval(deps({ ask, signal: controller.signal }));

    expect(entries).toEqual([]);
    expect(interrupted).toBe(true);
  });

  it('is not interrupted when it finishes', async () => {
    expect((await runEval(deps())).interrupted).toBe(false);
  });

  it('passes the signal on to the question', async () => {
    const controller = new AbortController();
    const options = deps({ signal: controller.signal });

    await runEval(options);

    expect(options.ask).toHaveBeenCalledWith(
      expect.objectContaining({ signal: controller.signal }),
    );
  });

  it('tells the caller as each case finishes, with how far it has got', async () => {
    const onCase = vi.fn();

    await runEval(deps({ onCase }));

    expect(onCase).toHaveBeenNthCalledWith(1, expect.objectContaining({ id: 'a' }), 1, 2);
    expect(onCase).toHaveBeenNthCalledWith(2, expect.objectContaining({ id: 'b' }), 2, 2);
  });

  it('refuses a case whose role is not loaded', async () => {
    const options = deps({ cases: [makeCase({ role: 'stranger' })] });

    await expect(runEval(options)).rejects.toThrow(EvalError);
    await expect(runEval(deps({ cases: [makeCase({ role: 'stranger' })] }))).rejects.toThrow(
      '"stranger"',
    );
  });

  it('runs nothing for no cases', async () => {
    const { entries, requests } = await runEval(deps({ cases: [] }));

    expect(entries).toEqual([]);
    expect(requests.casesRun).toBe(0);
  });
});

describe('sanitiseResult', () => {
  it('keeps the rest of the answer as it is', () => {
    const result = sanitiseResult(answer({ answer: 'Text', sources: [{ key: 'C1' }] }));

    expect(result).toMatchObject({ answer: 'Text', sources: [{ key: 'C1' }] });
  });
});

describe('collectRunInfo', () => {
  const config = loadConfig(validEnv({ COPILOT_MODEL: 'gpt-x' }));

  it('records the commit, whether the tree is dirty, the model and each role’s version', async () => {
    const info = await collectRunInfo({
      git: async () => ({ commit: 'abc123def456', dirty: true }),
      roles: ROLES,
      config,
    });

    expect(info).toMatchObject({
      commit: 'abc123def456',
      dirty: true,
      model: 'gpt-x',
      roles: { developer: 2, product_owner: 5 },
    });
  });

  it('says "default" when no model is set', async () => {
    const info = await collectRunInfo({
      git: async () => ({ commit: 'c', dirty: false }),
      roles: ROLES,
      config: loadConfig(validEnv()),
    });

    expect(info.model).toBe('default');
  });

  it('records a short hash of the base prompt that is the same for the same prompt', async () => {
    const git = async () => ({ commit: 'c', dirty: false });

    const first = await collectRunInfo({ git, roles: ROLES, config });
    const second = await collectRunInfo({ git, roles: ROLES, config });

    expect(first.basePromptHash).toMatch(/^[\da-f]{12}$/);
    expect(second.basePromptHash).toBe(first.basePromptHash);
  });

  it('records a different hash when the base prompt differs', async () => {
    const git = async () => ({ commit: 'c', dirty: false });
    const other = loadConfig(validEnv({ CONFLUENCE_SPACE_KEYS: 'ENG,PROD,OPS' }));

    const first = await collectRunInfo({ git, roles: ROLES, config });
    const second = await collectRunInfo({ git, roles: ROLES, config: other });

    expect(second.basePromptHash).not.toBe(first.basePromptHash);
  });

  it('records the same hash for every role, since the base prompt is shared', async () => {
    const git = async () => ({ commit: 'c', dirty: false });
    const roles = new Map([
      ['developer', ROLES.get('developer')],
      ['product_owner', makeRole({ version: 9 })],
    ]);

    const first = await collectRunInfo({ git, roles: ROLES, config });
    const second = await collectRunInfo({ git, roles: /** @type {any} */ (roles), config });

    expect(second.basePromptHash).toBe(first.basePromptHash);
    expect(second.roles.product_owner).toBe(9);
  });
});

describe('runFolderName', () => {
  it('writes the time in UTC so the folders sort by time', () => {
    expect(runFolderName(new Date('2026-10-11T18:05:09.123Z'))).toBe('20261011-180509');
  });
});

describe('modelsSeen', () => {
  /**
   * An entry with an answer from a model.
   * @param {unknown} model - What the answer says about the model.
   * @returns {import('../../src/eval/run.js').RunEntry} The entry.
   */
  function entryFrom(model) {
    return /** @type {any} */ ({ id: 'a', result: model === undefined ? undefined : { model } });
  }

  it('lists each model once, in alphabetical order', () => {
    const entries = ['mai-code-1.1-flash', 'gpt-6-luna', 'mai-code-1.1-flash'].map(entryFrom);

    expect(modelsSeen(entries)).toEqual(['gpt-6-luna', 'mai-code-1.1-flash']);
  });

  it('leaves out a case that failed and so has no answer, and an answer that names no model', () => {
    expect(modelsSeen([entryFrom(undefined), entryFrom(undefined), entryFrom(null)])).toEqual([]);
  });

  it('lists nothing for no cases', () => {
    expect(modelsSeen([])).toEqual([]);
  });
});

describe('runEval as conversations', () => {
  const answered = { status: /** @type {const} */ ('answered'), reference: 'r' };
  const followUp = (/** @type {string} */ question, expectChanges = {}) => ({
    question,
    expect: { ...answered, ...expectChanges },
  });

  /**
   * A conversation that answers each question in turn, and records what it was asked.
   * @param {Array<Record<string, unknown> | Error>} answers - What each turn gets.
   * @returns {{ start: import('vitest').Mock, ask: import('vitest').Mock }} The doubles.
   */
  function conversation(answers = []) {
    let turn = 0;
    const ask = vi.fn(async () => {
      const next = answers[turn] ?? {};
      turn += 1;
      if (next instanceof Error) {
        throw next;
      }
      return answer(next);
    });
    return { ask, start: vi.fn(async () => ({ ask })) };
  }

  const trio = makeCase({
    id: 'dev-followup',
    followUps: [
      followUp('And for gift cards?', { reusesEarlier: true }),
      followUp('Who signs off?'),
    ],
  });

  it('asks every turn of a case in one conversation, as its role', async () => {
    const played = conversation();

    await runEval(deps({ cases: [trio], path: 'conversation', startConversation: played.start }));

    expect(played.start).toHaveBeenCalledExactlyOnceWith(ROLES.get('developer'));
    expect(played.ask.mock.calls.map(([call]) => call.question)).toEqual([
      'Where is the refund window enforced?',
      'And for gift cards?',
      'Who signs off?',
    ]);
  });

  it('records each turn as an entry of its own, scored on its own expectation', async () => {
    const played = conversation([
      {},
      { reusedKeys: ['C1'] },
      { status: 'not_found', confidence: null },
    ]);

    const { entries } = await runEval(
      deps({ cases: [trio], path: 'conversation', startConversation: played.start }),
    );

    expect(entries.map(({ id }) => id)).toEqual([
      'dev-followup',
      'dev-followup-t2',
      'dev-followup-t3',
    ]);
    expect(entries.map(({ question }) => question)).toEqual([
      'Where is the refund window enforced?',
      'And for gift cards?',
      'Who signs off?',
    ]);
    expect(entries.map(({ conversation: of }) => of)).toEqual([
      { caseId: 'dev-followup', turn: 1, turns: 3 },
      { caseId: 'dev-followup', turn: 2, turns: 3 },
      { caseId: 'dev-followup', turn: 3, turns: 3 },
    ]);
    expect(entries[1].score).toMatchObject({ id: 'dev-followup-t2', reusedEarlierSource: true });
    expect(entries[2].score).toMatchObject({ status: 'not_found', statusMatch: false });
  });

  it('plays a case with one turn as a conversation of one, with no conversation marking on it', async () => {
    const played = conversation();

    const { entries } = await runEval(
      deps({
        cases: [makeCase({ id: 'a' })],
        path: 'conversation',
        startConversation: played.start,
      }),
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]).not.toHaveProperty('conversation');
    expect(entries[0]?.id).toBe('a');
  });

  it('starts a new conversation for each case', async () => {
    const played = conversation();

    await runEval(
      deps({
        cases: [makeCase({ id: 'a' }), makeCase({ id: 'b' })],
        path: 'conversation',
        startConversation: played.start,
      }),
    );

    expect(played.start).toHaveBeenCalledTimes(2);
  });

  it('tells how far it is in turns, not cases', async () => {
    const seen = /** @type {Array<[string, number, number]>} */ ([]);

    await runEval(
      deps({
        cases: [trio, makeCase({ id: 'b' })],
        path: 'conversation',
        startConversation: conversation().start,
        onCase: (entry, done, total) => seen.push([entry.id, done, total]),
      }),
    );

    expect(seen.map(([, done, total]) => `${done}/${total}`)).toEqual(['1/4', '2/4', '3/4', '4/4']);
  });

  it('counts the requests of every turn', async () => {
    const guard = createRequestGuard(undefined);

    const { requests } = await runEval(
      deps({
        cases: [trio],
        guard,
        path: 'conversation',
        startConversation: conversation([{ rewritten: true }, {}, {}]).start,
      }),
    );

    expect(requests).toMatchObject({ used: 4, casesRun: 3 });
  });

  it('records a failed turn as an error and the turns after it as not asked', async () => {
    const played = conversation([{}, new Error('timed out')]);

    const { entries } = await runEval(
      deps({ cases: [trio], path: 'conversation', startConversation: played.start }),
    );

    expect(entries.map(({ error }) => error?.kind)).toEqual([undefined, 'Error', 'SkippedTurn']);
    expect(entries[2]?.error?.message).toContain('An earlier turn');
    expect(entries[2]?.score).toMatchObject({ status: 'error', passed: false });
    expect(played.ask).toHaveBeenCalledTimes(2);
  });

  it('records a conversation that could not be started as a failure of its first turn', async () => {
    const start = vi.fn(async () => {
      throw new Error('no session');
    });

    const { entries } = await runEval(
      deps({ cases: [trio], path: 'conversation', startConversation: start }),
    );

    expect(entries.map(({ error }) => error?.kind)).toEqual([
      'Error',
      'SkippedTurn',
      'SkippedTurn',
    ]);
  });

  it('stops, keeping the turns it has, when the run is aborted in the middle of a conversation', async () => {
    const controller = new AbortController();
    const ask = vi.fn(async () => {
      if (ask.mock.calls.length === 2) {
        controller.abort();
        throw new Error('stopped');
      }
      return answer();
    });

    const outcome = await runEval(
      deps({
        cases: [trio, makeCase({ id: 'b' })],
        path: 'conversation',
        startConversation: async () => ({ ask }),
        signal: controller.signal,
      }),
    );

    expect(outcome.interrupted).toBe(true);
    expect(outcome.entries.map(({ id }) => id)).toEqual(['dev-followup']);
  });

  it('needs a way to start a conversation', async () => {
    await expect(runEval(deps({ path: 'conversation' }))).rejects.toThrow(
      'Running as conversations needs a way to start one.',
    );
  });

  it('refuses a case whose role is not loaded, before it starts a conversation', async () => {
    const played = conversation();

    await expect(
      runEval(
        deps({
          cases: [makeCase({ id: 'x', role: 'ghost' })],
          path: 'conversation',
          startConversation: played.start,
        }),
      ),
    ).rejects.toThrow(EvalError);
    expect(played.start).not.toHaveBeenCalled();
  });
});

describe('runEval of a conversation case as single questions', () => {
  it('leaves it out and says so, running the others', async () => {
    const trio = makeCase({
      id: 'dev-followup',
      followUps: [{ question: 'Then?', expect: { status: 'answered', reference: 'r' } }],
    });
    const options = deps({ cases: [trio, makeCase({ id: 'b' })] });

    const outcome = await runEval(options);

    expect(outcome.skipped).toEqual(['dev-followup']);
    expect(outcome.entries.map(({ id }) => id)).toEqual(['b']);
    expect(options.ask).toHaveBeenCalledTimes(1);
  });

  it('reports nothing skipped for ordinary cases', async () => {
    expect((await runEval(deps())).skipped).toEqual([]);
  });
});

describe('a one-turn conversation and a single question', () => {
  it('score alike for the same answer, so the two paths can be compared', async () => {
    const one = makeCase({
      id: 'a',
      expect: {
        status: 'answered',
        reference: 'r',
        sources: [{ type: 'confluence', match: 'Refund' }],
      },
    });
    const result = answer({
      sources: [{ key: 'C1', type: 'confluence', title: 'Refund Policy', url: 'https://x' }],
    });

    const single = await runEval(deps({ cases: [one], ask: vi.fn(async () => result) }));
    const asConversation = await runEval(
      deps({
        cases: [one],
        path: 'conversation',
        startConversation: async () => ({ ask: async () => ({ ...result, reusedKeys: [] }) }),
      }),
    );

    expect(asConversation.entries[0]?.score).toEqual(single.entries[0]?.score);
    expect(asConversation.entries[0]?.id).toBe(single.entries[0]?.id);
    expect(asConversation.requests).toEqual(single.requests);
  });
});
