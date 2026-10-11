// @ts-check
import { describe, expect, it } from 'vitest';
import { createAnswerHtmlRenderer } from '../../src/render/index.js';
import { buildDonePayload } from '../../src/server/donePayload.js';
import { ask, FILE, PAGE, reply, WINDOW } from '../helpers/ask.js';
import { TEST_ROLE } from '../helpers/role.js';

const renderHtml = createAnswerHtmlRenderer({ allowedHosts: ['github.com'] });

describe('buildDonePayload', () => {
  it('carries the id, the result, the rendered parts and the answer as HTML', async () => {
    const { result } = await ask({ tools: [PAGE], replies: [reply(`${WINDOW} [C1].`)] });

    const payload = buildDonePayload({ answerId: 'a1', result, role: TEST_ROLE, renderHtml });

    expect(payload.answerId).toBe('a1');
    expect(payload.result.status).toBe('answered');
    expect(payload.rendered.level).toBe('high');
    expect(payload.html.answer).toContain('<button type="button" class="cite"');
    expect(payload.html.answer).toContain('data-key="C1"');
  });

  it('cuts each tool call to its server, name, time and outcome, without the argument summary', async () => {
    const { result } = await ask({ tools: [PAGE], replies: [reply(`${WINDOW} [C1].`)] });
    const withCall = {
      ...result,
      toolCalls: [
        {
          server: 'atlassian',
          tool: 'searchConfluence',
          summary: 'cql=space = SECRET',
          durationMs: 5,
          success: true,
        },
      ],
    };

    const { result: sent } = buildDonePayload({
      answerId: 'a1',
      result: withCall,
      role: TEST_ROLE,
      renderHtml,
    });

    expect(sent.toolCalls).toEqual([
      { server: 'atlassian', tool: 'searchConfluence', durationMs: 5, success: true },
    ]);
    expect(JSON.stringify(sent)).not.toContain('SECRET');
  });

  it('turns each conflict into HTML with chips', async () => {
    const { result } = await ask({
      tools: [PAGE, FILE],
      replies: [
        reply(`${WINDOW} [C1].`, {
          conflicts: [
            {
              topic: 'Window',
              docSays: '30 days',
              docKeys: ['C1'],
              codeSays: '14 days',
              codeKeys: ['G1'],
            },
          ],
        }),
      ],
    });

    const { html } = buildDonePayload({ answerId: 'a1', result, role: TEST_ROLE, renderHtml });

    expect(html.conflicts).toHaveLength(1);
    expect(html.conflicts[0]).toContain('data-key="C1"');
  });

  it('has no answer HTML when the application speaks in its own voice', async () => {
    const { result } = await ask({
      replies: [reply('Nothing.', { status: 'not_found', confidence: undefined })],
    });

    const { html, rendered } = buildDonePayload({
      answerId: 'a1',
      result,
      role: TEST_ROLE,
      renderHtml,
    });

    expect(html.answer).toBe('');
    expect(rendered.banner).not.toBe('');
  });
});
