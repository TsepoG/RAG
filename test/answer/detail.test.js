// @ts-check
import { describe, expect, it } from 'vitest';
import { ask, BUSINESS_ROLE, FENCE, PAGE, reply, WINDOW } from '../helpers/ask.js';

const TECHNICAL = `The \`refund()\` call decides the refund window for every order through the endpoint [C1].`;

describe('askQuestion more detail', () => {
  it('reports the level it answered at, and defaults to the usual one', async () => {
    const usual = await ask({
      role: BUSINESS_ROLE,
      tools: [PAGE],
      replies: [reply(`${WINDOW} [C1].`)],
    });
    const more = await ask({
      role: BUSINESS_ROLE,
      detailLevel: 'more',
      tools: [PAGE],
      replies: [reply(`${WINDOW} [C1].`)],
    });

    expect(usual.result.detailLevel).toBe('default');
    expect(more.result.detailLevel).toBe('more');
  });

  it('writes the prompt for the role one step more technical, and says the guidance wins', async () => {
    const { client } = await ask({
      role: BUSINESS_ROLE,
      detailLevel: 'more',
      tools: [PAGE],
      replies: [reply(`${WINDOW} [C1].`)],
    });

    const { content } = client.configs[0].systemMessage;

    expect(content).toContain('Describe the logic and rules in plain terms.');
    expect(content).toContain('The reader asked for more detail than usual');
    expect(content).not.toContain('Do not show code blocks or file paths in the answer.');
    expect(content).not.toContain('Never use these words in the answer');
  });

  it('keeps the usual prompt when no more detail is asked for', async () => {
    const { client } = await ask({
      role: BUSINESS_ROLE,
      tools: [PAGE],
      replies: [reply(`${WINDOW} [C1].`)],
    });

    const { content } = client.configs[0].systemMessage;

    expect(content).toContain('Do not show code blocks or file paths in the answer.');
    expect(content).toContain('Never use these words in the answer: endpoint.');
    expect(content).not.toContain('The reader asked for more detail');
  });

  it('keeps the shared part of the prompt the same at both levels', async () => {
    const usual = await ask({
      role: BUSINESS_ROLE,
      tools: [PAGE],
      replies: [reply(`${WINDOW} [C1].`)],
    });
    const more = await ask({
      role: BUSINESS_ROLE,
      detailLevel: 'more',
      tools: [PAGE],
      replies: [reply(`${WINDOW} [C1].`)],
    });
    const base = (/** @type {any} */ run) =>
      run.client.configs[0].systemMessage.content.split('\n\nThis answer is for')[0];

    expect(base(more)).toBe(base(usual));
  });

  it('does not rewrite inline code or a banned word that the extra detail allows', async () => {
    const { result, session } = await ask({
      role: BUSINESS_ROLE,
      detailLevel: 'more',
      tools: [PAGE],
      replies: [reply(TECHNICAL)],
    });

    expect(session.sent).toHaveLength(1);
    expect(result).toMatchObject({ rewritten: false, styleViolations: [] });
  });

  it('would have rewritten the same answer at the usual level', async () => {
    const { session } = await ask({
      role: BUSINESS_ROLE,
      tools: [PAGE],
      replies: [reply(TECHNICAL), reply(`${WINDOW} for every order we take [C1].`)],
    });

    expect(session.sent).toHaveLength(2);
  });

  it('still rejects a code block, which depth 2 does not allow', async () => {
    const withBlock = `${WINDOW} [C1].\n\n${FENCE}js\nrefund(order);\n${FENCE}`;

    const { session } = await ask({
      role: BUSINESS_ROLE,
      detailLevel: 'more',
      tools: [PAGE],
      replies: [reply(withBlock), reply(`${WINDOW} for every order we take [C1].`)],
    });

    expect(session.sent).toHaveLength(2);
    expect(session.sent[1].prompt).toContain('it contains a code block');
  });
});
