// @ts-check
import { describe, expect, it, vi } from 'vitest';
import { EvalError } from '../../src/errors/index.js';
import { createRequestGuard } from '../../src/eval/budget.js';
import { collectRunInfo, runEval, runFolderName, sanitiseResult } from '../../src/eval/run.js';
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
