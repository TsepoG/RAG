// @ts-check
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildRewritePrompt, judgeRewrite, mergeRewrite } from '../../src/answer/rewrite.js';
import { ask, BUSINESS_ROLE, FILE, PAGE, reply, WINDOW } from '../helpers/ask.js';

const WITH_CODE = `The \`refund()\` call decides the refund window for every order [C1].`;
const PLAIN = `${WINDOW} for every order we take [C1].`;

afterEach(() => {
  vi.useRealTimers();
});

/**
 * Makes a turn of the session that asks the hooks about a tool, as a model that ignores the
 * instruction would, then replies.
 * @param {string} text - The reply to give.
 * @param {{ decision?: any }} seen - Where to put what the hook decided.
 * @returns {(context: { emit: (type: string, data: Record<string, unknown>) => void, client: any }) => void}
 *   The turn.
 */
function triesATool(text, seen) {
  return ({ emit, client }) => {
    seen.decision = client.configs[0].hooks.onPreToolUse({
      toolName: 'github_repos-get_file_contents',
      toolArgs: { owner: 'acme', repo: 'app' },
    });
    emit('assistant.message', { content: text });
    emit('session.idle', {});
  };
}

describe('askQuestion rewrite', () => {
  it('rewrites an answer that does not suit the role, once, and uses the rewrite', async () => {
    const { result, session } = await ask({
      role: BUSINESS_ROLE,
      tools: [PAGE],
      replies: [reply(WITH_CODE), reply(PLAIN)],
    });

    expect(session.sent).toHaveLength(2);
    expect(session.sent[1].prompt).toBe(
      'Rewrite your previous answer for a Tester: it uses inline code (refund()). Keep every fact and every citation key exactly, including any asterisks. Do not call any tools. End with the same answer-meta block.',
    );
    expect(result).toMatchObject({
      answer: PLAIN,
      rewritten: true,
      rewriteRejected: false,
      styleViolations: [],
      status: 'answered',
      confidence: 'high',
    });
  });

  it('does not rewrite an answer that suits the role', async () => {
    const { result, session } = await ask({
      role: BUSINESS_ROLE,
      tools: [PAGE],
      replies: [reply(PLAIN)],
    });

    expect(session.sent).toHaveLength(1);
    expect(result).toMatchObject({ rewritten: false, rewriteRejected: false });
  });

  it.each([
    ['out of scope', { status: 'out_of_scope', confidence: undefined }],
    ['not found', { status: 'not_found', confidence: undefined }],
  ])('does not rewrite an answer that is %s, whatever the model wrote', async (_name, meta) => {
    const { session } = await ask({
      role: BUSINESS_ROLE,
      replies: [reply('The `endpoint` is not known to me.', meta)],
    });

    expect(session.sent).toHaveLength(1);
  });

  it('names every problem it found', async () => {
    const text = `The endpoint in src/refunds/policy.ts and \`refund()\` decides this [C1].`;

    const { session } = await ask({
      role: BUSINESS_ROLE,
      tools: [PAGE],
      replies: [reply(text), reply(PLAIN)],
    });

    expect(session.sent[1].prompt).toContain(
      'it uses inline code (refund()); it shows file paths (src/refunds/policy.ts); it uses the word "endpoint"',
    );
  });

  it('refuses every tool call during the rewrite, even from a model that ignores the instruction', async () => {
    const seen = /** @type {{ decision?: any }} */ ({});

    await ask({
      role: BUSINESS_ROLE,
      tools: [PAGE],
      replies: [reply(WITH_CODE), triesATool(reply(PLAIN), seen)],
    });

    expect(seen.decision).toEqual({
      permissionDecision: 'deny',
      permissionDecisionReason: 'Tools are not available while rewriting.',
    });
  });

  it('never rewrites more than once, even if the rewrite still does not suit the role', async () => {
    const { result, session } = await ask({
      role: BUSINESS_ROLE,
      tools: [PAGE],
      replies: [reply(WITH_CODE), reply(WITH_CODE)],
    });

    expect(session.sent).toHaveLength(2);
    expect(result).toMatchObject({
      rewritten: true,
      styleViolations: ['it uses inline code (refund())'],
    });
  });

  it('keeps the first answer and says why when the rewrite drops a citation', async () => {
    const { result } = await ask({
      role: BUSINESS_ROLE,
      tools: [PAGE],
      replies: [reply(WITH_CODE), reply(`${WINDOW} for every order we take.`)],
    });

    expect(result).toMatchObject({
      answer: WITH_CODE,
      rewritten: false,
      rewriteRejected: true,
      rewriteRejectedReason: 'citations',
      styleViolations: ['it uses inline code (refund())'],
    });
  });

  it('keeps the first answer when the rewrite cites a source it did not cite before', async () => {
    const { result } = await ask({
      role: BUSINESS_ROLE,
      tools: [PAGE, FILE],
      replies: [reply(WITH_CODE), reply(`${PLAIN} It is also in the file [G1].`)],
    });

    expect(result).toMatchObject({ rewriteRejected: true, rewriteRejectedReason: 'citations' });
  });

  it('keeps the first answer when the rewrite takes an asterisk away', async () => {
    const first = 'Based on the code, it looks like the `refund()` call decides the window [G1*].';
    const second = 'Based on the code, it looks like the refund call decides the window [G1].';

    const { result } = await ask({
      role: BUSINESS_ROLE,
      tools: [FILE],
      replies: [reply(first), reply(second)],
    });

    expect(result).toMatchObject({
      answer: first,
      rewriteRejected: true,
      rewriteRejectedReason: 'markers',
    });
  });

  it('keeps the first answer when the rewrite changes what kind of answer it is', async () => {
    const { result } = await ask({
      role: BUSINESS_ROLE,
      tools: [PAGE],
      replies: [reply(WITH_CODE), reply(PLAIN, { status: 'out_of_scope', confidence: undefined })],
    });

    expect(result).toMatchObject({
      status: 'answered',
      answer: WITH_CODE,
      rewriteRejectedReason: 'status',
    });
  });

  it('never makes the answer more confident than the first one was', async () => {
    const { result } = await ask({
      role: BUSINESS_ROLE,
      tools: [PAGE],
      replies: [
        reply(WITH_CODE, { gaps: ['No page covers partial refunds'] }),
        reply(PLAIN, { confidence: 'high', gaps: [] }),
      ],
    });

    expect(result).toMatchObject({
      answer: PLAIN,
      rewritten: true,
      confidence: 'medium',
      gaps: ['No page covers partial refunds'],
    });
    expect(result.capsApplied.map(({ code }) => code)).toEqual(['gaps']);
  });

  it('takes the lower level when the rewrite is less sure, keeping the first report of gaps', async () => {
    const { result } = await ask({
      role: BUSINESS_ROLE,
      tools: [PAGE],
      replies: [reply(WITH_CODE, { gaps: ['A gap'] }), reply(PLAIN, null)],
    });

    expect(result).toMatchObject({
      answer: PLAIN,
      rewritten: true,
      confidence: 'low',
      gaps: ['A gap'],
    });
    expect(result.capsApplied.map(({ code }) => code)).toEqual(['no-meta']);
  });

  it('keeps the first answer when the rewrite fails', async () => {
    const { result } = await ask({
      role: BUSINESS_ROLE,
      tools: [PAGE],
      replies: [
        reply(WITH_CODE),
        ({ emit }) => emit('session.error', { errorType: 'rate_limit', message: 'slow down' }),
      ],
    });

    expect(result).toMatchObject({
      answer: WITH_CODE,
      rewriteRejected: true,
      rewriteRejectedReason: 'error',
    });
  });

  it('keeps the first answer when the rewrite cannot be sent', async () => {
    const { result, lines } = await ask({
      role: BUSINESS_ROLE,
      tools: [PAGE],
      replies: [
        reply(WITH_CODE),
        () => {
          throw new Error('connection closed');
        },
      ],
    });

    expect(result).toMatchObject({ rewriteRejected: true, rewriteRejectedReason: 'error' });
    expect(lines()).toContainEqual(
      expect.objectContaining({ msg: 'the rewrite failed; keeping the first answer' }),
    );
  });

  it('keeps the first answer, and aborts the session, when the rewrite runs out of time', async () => {
    vi.useFakeTimers();
    const outcome = ask({
      role: BUSINESS_ROLE,
      tools: [PAGE],
      env: { ASK_TIMEOUT_MS: '8000' },
      replies: [reply(WITH_CODE), () => undefined],
    });
    await vi.advanceTimersByTimeAsync(8000);
    const { result, session } = await outcome;

    expect(result).toMatchObject({
      answer: WITH_CODE,
      status: 'answered',
      rewritten: false,
      rewriteRejected: true,
      rewriteRejectedReason: 'timeout',
      styleViolations: ['it uses inline code (refund())'],
    });
    expect(session.abort).toHaveBeenCalledOnce();
    expect(session.disconnect).toHaveBeenCalledOnce();
  });
});

describe('buildRewritePrompt', () => {
  it('names the role and joins the problems', () => {
    expect(
      buildRewritePrompt({ displayName: 'Product Owner' }, [
        { message: 'it contains a code block' },
        { message: 'it uses the word "endpoint"' },
      ]),
    ).toBe(
      'Rewrite your previous answer for a Product Owner: it contains a code block; it uses the word "endpoint". Keep every fact and every citation key exactly, including any asterisks. Do not call any tools. End with the same answer-meta block.',
    );
  });
});

/**
 * Builds the part of an analysis the rewrite checks look at.
 * @param {Record<string, any>} [changes] - Changes.
 * @returns {any} The analysis.
 */
function analysis(changes = {}) {
  return {
    meta: { status: 'answered', gaps: ['gap'], conflicts: [] },
    citedKeys: ['C1', 'G1'],
    parts: { inferredKeys: ['G1'] },
    caps: {
      status: 'answered',
      confidence: 'medium',
      confidenceReason: 'original',
      capsApplied: [],
    },
    ...changes,
  };
}

describe('judgeRewrite', () => {
  it('accepts a rewrite that cites the same sources, in any order, and keeps the markers', () => {
    expect(
      judgeRewrite(
        analysis(),
        analysis({ citedKeys: ['G1', 'C1'], parts: { inferredKeys: ['G1'] } }),
      ),
    ).toEqual({ accepted: true });
  });

  it('accepts a rewrite that marks more as interpretation', () => {
    expect(judgeRewrite(analysis(), analysis({ parts: { inferredKeys: ['G1', 'C1'] } }))).toEqual({
      accepted: true,
    });
  });

  it('accepts a rewrite whose report is missing', () => {
    expect(judgeRewrite(analysis(), analysis({ meta: undefined }))).toEqual({ accepted: true });
  });

  it.each([
    ['a dropped source', { citedKeys: ['C1'] }, 'citations'],
    ['a new source', { citedKeys: ['C1', 'G1', 'G2'] }, 'citations'],
    ['a swapped source', { citedKeys: ['C1', 'G2'] }, 'citations'],
    ['a lost marker', { parts: { inferredKeys: [] } }, 'markers'],
    ['another status', { meta: { status: 'not_found' } }, 'status'],
  ])('rejects %s', (_name, changes, reason) => {
    expect(judgeRewrite(analysis(), analysis(changes))).toEqual({ accepted: false, reason });
  });
});

describe('mergeRewrite', () => {
  const lower = {
    status: 'answered',
    confidence: 'low',
    confidenceReason: 'rewrite',
    capsApplied: [],
  };

  it('takes the verdict of the first answer when the rewrite is as sure or surer', () => {
    const rewrite = analysis({
      caps: { ...lower, confidence: 'high' },
      parts: { inferredKeys: [] },
    });

    const merged = mergeRewrite(analysis(), rewrite);

    expect(merged.caps.confidenceReason).toBe('original');
    expect(merged.parts).toBe(rewrite.parts);
  });

  it('takes the verdict of the rewrite when it is less sure', () => {
    expect(mergeRewrite(analysis(), analysis({ caps: lower })).caps.confidenceReason).toBe(
      'rewrite',
    );
  });

  it("keeps the first answer's report when the rewrite has none", () => {
    const first = analysis();

    expect(mergeRewrite(first, analysis({ meta: undefined, caps: lower })).meta).toBe(first.meta);
  });
});
