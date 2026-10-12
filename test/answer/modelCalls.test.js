// @ts-check
import { describe, expect, it } from 'vitest';
import { describeModelCall, markFinalCall } from '../../src/answer/modelCalls.js';

describe('describeModelCall', () => {
  it('keeps what identifies the call and what routed it', () => {
    const call = describeModelCall(
      {
        model: 'gpt-6-luna',
        apiCallId: 'c1',
        interactionType: 'conversation-agent',
        initiator: 'sub-agent',
        fusion: {
          syntheticModel: 'luna',
          sourceModel: 'mai',
          policy: 'p',
          pattern: 'q',
          phaseKind: 'draft',
          role: 'r',
        },
      },
      2,
    );

    expect(call).toEqual({
      index: 2,
      model: 'gpt-6-luna',
      apiCallId: 'c1',
      interactionType: 'conversation-agent',
      initiator: 'sub-agent',
      fusion: {
        syntheticModel: 'luna',
        sourceModel: 'mai',
        policy: 'p',
        pattern: 'q',
        phaseKind: 'draft',
        role: 'r',
      },
      producedFinal: false,
    });
  });

  it('leaves out routing when there was none', () => {
    expect(describeModelCall({ model: 'm' }, 0).fusion).toBeUndefined();
  });
});

describe('markFinalCall', () => {
  const calls = [
    describeModelCall({ model: 'a', apiCallId: '1' }, 0),
    describeModelCall({ model: 'b', apiCallId: '2' }, 1),
  ];

  it('marks the call whose id the answer carries', () => {
    expect(markFinalCall(calls, '2').map((call) => call.producedFinal)).toEqual([false, true]);
  });

  it('marks nothing when the answer names no call, rather than guessing', () => {
    expect(markFinalCall(calls, undefined).some((call) => call.producedFinal)).toBe(false);
  });

  it('does not mark a call that has no id', () => {
    const [call] = markFinalCall([describeModelCall({ model: 'a' }, 0)], undefined);

    expect(call.producedFinal).toBe(false);
  });
});
