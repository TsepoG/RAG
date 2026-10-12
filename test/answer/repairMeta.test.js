// @ts-check
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildRepairPrompt } from '../../src/answer/repairMeta.js';
import { ask, BUSINESS_ROLE, FENCE, NOT_FOUND_TEXT, PAGE, reply, WINDOW } from '../helpers/ask.js';

const ANSWER = `${WINDOW} for every order we take [C1].`;
const BLOCK_ONLY = reply('', { status: 'answered' }).trim();

afterEach(() => {
  vi.useRealTimers();
});

describe('askQuestion when the answer-meta block is missing', () => {
  it('asks once for the block alone, and keeps the answer text and the repaired report', async () => {
    const { result, session } = await ask({
      tools: [PAGE],
      replies: [ANSWER, BLOCK_ONLY],
    });

    expect(session.sent).toHaveLength(2);
    expect(session.sent[1].prompt).toBe(buildRepairPrompt('missing'));
    expect(result).toMatchObject({
      answer: ANSWER,
      status: 'answered',
      confidence: 'high',
      metaRepaired: true,
    });
    expect(result.capsApplied.map(({ code }) => code)).not.toContain('no-meta');
  });

  it('does not ask when the first reply has a report', async () => {
    const { result, session } = await ask({ tools: [PAGE], replies: [reply(ANSWER)] });

    expect(session.sent).toHaveLength(1);
    expect(result).toMatchObject({ metaRepaired: false, metaRepairRejected: false });
  });

  it('does not ask when there is no answer for a report to be about', async () => {
    const { result, session } = await ask({ replies: ['   '] });

    expect(session.sent).toHaveLength(1);
    expect(result.metaRepaired).toBe(false);
  });

  it('judges the repaired report by every rule, so it can still be lowered', async () => {
    const { result } = await ask({
      tools: [PAGE],
      replies: [ANSWER, reply('', { gaps: ['No page covers partial refunds'] }).trim()],
    });

    expect(result).toMatchObject({ confidence: 'medium', metaRepaired: true });
    expect(result.capsApplied.map(({ code }) => code)).toEqual(['gaps']);
  });

  it('lowers the repaired report for a citation that was never given out', async () => {
    const { result } = await ask({
      tools: [PAGE],
      replies: [`${ANSWER} It is also stated elsewhere [C9].`, BLOCK_ONLY],
    });

    expect(result).toMatchObject({ confidence: 'medium', invalidKeys: ['C9'] });
    expect(result.capsApplied.map(({ code }) => code)).toContain('invalid-keys');
  });

  it('reports a decline as the status the repaired report gives, without citing anything', async () => {
    const { result, session } = await ask({
      replies: [
        'I could not find anything about that.',
        reply('', { status: 'out_of_scope', confidence: undefined }).trim(),
      ],
    });

    expect(session.sent).toHaveLength(2);
    expect(result).toMatchObject({
      status: 'out_of_scope',
      confidence: null,
      sources: [],
      metaRepaired: true,
    });
  });

  it('reports a clarifying question the same way', async () => {
    const { result } = await ask({
      replies: [
        'Which service do you mean?',
        reply('', {
          status: 'clarify',
          confidence: undefined,
          clarifyingQuestion: 'Which service do you mean?',
        }).trim(),
      ],
    });

    expect(result).toMatchObject({
      status: 'clarify',
      clarifyingQuestion: 'Which service do you mean?',
      answer: 'Which service do you mean?',
      metaRepaired: true,
    });
  });

  it.each([
    ['not valid JSON', `${ANSWER}\n\n${FENCE}answer-meta\n{oops\n${FENCE}`, 'invalid-json'],
    [
      'missing a required field',
      `${ANSWER}\n\n${FENCE}answer-meta\n{"status":"answered"}\n${FENCE}`,
      'invalid-shape',
    ],
  ])('asks again when the block is %s, and names what was wrong', async (_name, first, kind) => {
    const { result, session } = await ask({ tools: [PAGE], replies: [first, BLOCK_ONLY] });

    expect(session.sent[1].prompt).toBe(
      buildRepairPrompt(/** @type {'invalid-json' | 'invalid-shape'} */ (kind)),
    );
    expect(result).toMatchObject({ answer: ANSWER, metaRepaired: true });
  });

  it.each([
    [
      'not valid JSON',
      `${FENCE}answer-meta
{oops
${FENCE}`,
      'invalid-json',
    ],
    [
      'without the required fields',
      `${FENCE}answer-meta
{"status":"answered"}
${FENCE}`,
      'invalid-shape',
    ],
  ])('says why when the repair is %s', async (_name, second, reason) => {
    const { result } = await ask({ tools: [PAGE], replies: [ANSWER, second] });

    expect(result).toMatchObject({ metaRepaired: false, metaRepairRejectedReason: reason });
  });

  it('names the fields that were wrong in the repaired report, never what they held', async () => {
    const second = `${FENCE}answer-meta
{"status":"out_of_scope","confidence":null,"gaps":"SECRET"}
${FENCE}`;

    const { result } = await ask({ tools: [PAGE], replies: [ANSWER, second] });

    expect(result.metaRepairRejectedFields).toEqual([
      'confidence',
      'confidenceReason',
      'gaps',
      'conflicts',
    ]);
    expect(JSON.stringify(result)).not.toContain('SECRET');
  });

  it('uses only the block from the repair, never words around it', async () => {
    const { result } = await ask({
      tools: [PAGE],
      replies: [ANSWER, `Sure, here it is. A different answer [C1].\n\n${BLOCK_ONLY}`],
    });

    expect(result.answer).toBe(ANSWER);
    expect(result.metaRepaired).toBe(true);
  });

  it('asks only once, though the repair has no block either', async () => {
    const { result, session } = await ask({
      tools: [PAGE],
      replies: [ANSWER, 'I cannot do that.'],
    });

    expect(session.sent).toHaveLength(2);
    expect(result).toMatchObject({
      answer: ANSWER,
      metaRepaired: false,
      metaRepairRejected: true,
      metaRepairRejectedReason: 'missing',
      confidence: 'low',
    });
    expect(result.capsApplied.map(({ code }) => code)).toContain('no-meta');
  });

  it('refuses every tool call during the repair, even from a model that ignores the instruction', async () => {
    /** @type {{ decision?: any }} */
    const seen = {};

    await ask({
      tools: [PAGE],
      replies: [
        ANSWER,
        ({ emit, client }) => {
          seen.decision = client.configs[0].hooks.onPreToolUse({
            toolName: 'github_repos-get_file_contents',
            toolArgs: { owner: 'acme', repo: 'app' },
          });
          emit('assistant.message', { content: BLOCK_ONLY });
          emit('session.idle', {});
        },
      ],
    });

    expect(seen.decision).toMatchObject({ permissionDecision: 'deny' });
  });

  it('keeps the first answer and its low confidence when the repair fails', async () => {
    const { result, lines } = await ask({
      tools: [PAGE],
      replies: [
        ANSWER,
        ({ emit }) => emit('session.error', { errorType: 'rate_limit', message: 'slow down' }),
      ],
    });

    expect(result).toMatchObject({
      answer: ANSWER,
      metaRepaired: false,
      metaRepairRejected: true,
      metaRepairRejectedReason: 'error',
      confidence: 'low',
    });
    expect(lines()).toContainEqual(
      expect.objectContaining({ msg: 'the repair failed; keeping the first report' }),
    );
  });

  it('keeps the first answer when the repair cannot be sent', async () => {
    const { result } = await ask({
      tools: [PAGE],
      replies: [
        ANSWER,
        () => {
          throw new Error('connection closed');
        },
      ],
    });

    expect(result).toMatchObject({
      answer: ANSWER,
      metaRepaired: false,
      metaRepairRejected: true,
      metaRepairRejectedReason: 'error',
    });
  });

  it('keeps the first answer, and aborts the session, when the repair runs out of time', async () => {
    vi.useFakeTimers();
    const outcome = ask({
      tools: [PAGE],
      env: { ASK_TIMEOUT_MS: '8000' },
      replies: [ANSWER, () => undefined],
    });
    await vi.advanceTimersByTimeAsync(8000);
    const { result, session } = await outcome;

    expect(result).toMatchObject({
      answer: ANSWER,
      metaRepaired: false,
      metaRepairRejectedReason: 'timeout',
    });
    expect(session.abort).toHaveBeenCalledOnce();
  });

  it('can still rewrite the answer after the report was repaired', async () => {
    const { result, session } = await ask({
      role: BUSINESS_ROLE,
      tools: [PAGE],
      replies: [
        'The `refund()` call decides the refund window for every order [C1].',
        BLOCK_ONLY,
        reply(ANSWER),
      ],
    });

    expect(session.sent).toHaveLength(3);
    expect(result).toMatchObject({ answer: ANSWER, metaRepaired: true, rewritten: true });
  });

  it('keeps the text of a decline that the report turned into not found', async () => {
    const { result } = await ask({
      replies: [NOT_FOUND_TEXT, reply('', { status: 'not_found', confidence: undefined }).trim()],
    });

    expect(result.status).toBe('not_found');
    expect(result.metaRepaired).toBe(true);
  });
});

describe('buildRepairPrompt', () => {
  it.each([
    ['missing', 'did not end with an answer-meta block'],
    ['invalid-json', 'ended with an answer-meta block that is not valid JSON'],
    ['invalid-shape', 'ended with an answer-meta block that does not have the required fields'],
  ])('says what was wrong with %s', (kind, words) => {
    const prompt = buildRepairPrompt(/** @type {'missing'} */ (kind));

    expect(prompt).toContain(words);
    expect(prompt).toContain('Reply with only the answer-meta block');
    expect(prompt).toContain('Do not repeat or change the answer. Do not call any tools.');
  });
});
