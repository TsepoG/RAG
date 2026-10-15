// @vitest-environment happy-dom
// @ts-check
import { describe, expect, it, vi } from 'vitest';
import {
  buildCopyDialog,
  conversationToMarkdown,
  COPIED_MESSAGE,
  copyConversation,
  escapeMarkdown,
  selectDialogText,
  SHOWN_MESSAGE,
} from '../../../../public/js/ui/copyConversation.js';
import { makeAnswer } from '../../../helpers/page.js';

const DATE = new Date('2026-10-15T09:30:00Z');

/**
 * A turn of the conversation.
 * @param {Partial<import('../../../../public/js/chatState.js').TurnView>} [changes] - Parts to change.
 * @returns {import('../../../../public/js/chatState.js').TurnView} The turn.
 */
function turn(changes = {}) {
  return {
    turn: 1,
    question: 'How long is the refund window?',
    detailLevel: 'default',
    phase: 'answered',
    progress: '',
    steps: [],
    currentStep: '',
    draft: '',
    answer: makeAnswer(),
    failure: undefined,
    ...changes,
  };
}

/**
 * @param {import('../../../../public/js/chatState.js').TurnView[]} turns - The turns.
 * @returns {string} The markdown for a Product Owner conversation.
 */
function markdownOf(turns) {
  return conversationToMarkdown({ roleName: 'Product Owner', date: DATE, turns });
}

describe('conversationToMarkdown', () => {
  it('writes the title, the question, the answer with its keys, the confidence, the gaps and the sources', () => {
    expect(markdownOf([turn()])).toBe(
      [
        '# Conversation as Product Owner, 2026-10-15',
        '',
        '## Turn 1',
        '',
        '**Question:**',
        '',
        '> How long is the refund window?',
        '',
        '**Answer:**',
        '',
        'Refunds are allowed for 30 days [C1].',
        '',
        '**Confidence:** Medium confidence. Part of this is my reading.',
        '',
        "**What I'm not sure about:**",
        '',
        '- The refund window for gift cards',
        '',
        '**Who might know:**',
        '',
        '- @acme/payments',
        '',
        '**Sources:**',
        '',
        '- [C1] Refund Policy — https://acme.atlassian.net/wiki/spaces/PAY/pages/1',
        '- [G1] src/refund.js — https://github.com/acme/app/blob/9c1e2ab4f0d1/src/refund.js',
        '',
        '**Also consulted:**',
        '',
        '- Returns FAQ — https://acme.atlassian.net/wiki/spaces/PAY/pages/2',
        '',
      ].join('\n'),
    );
  });

  it('writes every turn in order, under its own heading', () => {
    const text = markdownOf([
      turn(),
      turn({ turn: 2, question: 'And gift cards?', answer: makeAnswer({ turn: 2 }) }),
    ]);

    expect(text.match(/^## Turn \d/gm)).toEqual(['## Turn 1', '## Turn 2']);
    expect(text.indexOf('## Turn 2')).toBeGreaterThan(text.indexOf('## Turn 1'));
    expect(text.endsWith('\n')).toBe(true);
    expect(text.endsWith('\n\n')).toBe(false);
  });

  it('dates the title in UTC and names the role', () => {
    const late = new Date('2026-10-15T23:59:59Z');

    expect(conversationToMarkdown({ roleName: 'QA', date: late, turns: [] })).toBe(
      '# Conversation as QA, 2026-10-15\n',
    );
  });

  it('marks a source that changed after the answer was written', () => {
    const answer = makeAnswer({ changedKeys: ['G1'] });

    const text = markdownOf([turn({ answer })]);

    expect(text).toContain(
      '- [G1] src/refund.js — https://github.com/acme/app/blob/9c1e2ab4f0d1/src/refund.js (changed since this answer was written)',
    );
    expect(text).not.toContain(
      'Refund Policy — https://acme.atlassian.net/wiki/spaces/PAY/pages/1 (',
    );
  });

  it('lists the pages that were only consulted, without keys, under their own heading', () => {
    const text = markdownOf([turn()]);

    expect(text).toContain('**Also consulted:**\n\n- Returns FAQ — https://');
  });

  it('says so when an answer cites nothing, and leaves out the consulted list when it is empty', () => {
    const answer = makeAnswer({ result: { sources: [], alsoConsulted: [] } });

    const text = markdownOf([turn({ answer })]);

    expect(text).toContain('**Sources:** none');
    expect(text).not.toContain('Also consulted');
  });

  it('writes where the sources disagree', () => {
    const answer = makeAnswer({
      rendered: { conflicts: ['The page says 30 days [C1]; the code says 14 [G1].'] },
    });

    expect(markdownOf([turn({ answer })])).toContain(
      '**Where sources disagree:**\n\n- The page says 30 days \\[C1\\]; the code says 14 \\[G1\\].',
    );
  });

  it('writes a reply that is not an answer with its status, where it looked and who might know', () => {
    const answer = makeAnswer({
      result: { status: 'not_found', confidence: null, confidenceReason: '', sources: [] },
      rendered: {
        level: null,
        banner: "I couldn't find anything about this.",
        text: '',
        gaps: [],
        closestPages: [
          { key: 'C2', title: 'Payments FAQ', url: 'https://acme.atlassian.net/wiki/2' },
        ],
        whoToAsk: [{ name: 'The payments team', sourceKeys: [] }],
      },
    });

    const text = markdownOf([turn({ answer })]);

    expect(text).toContain("I couldn't find anything about this.");
    expect(text).toContain('**Reply:** Not found in the docs');
    expect(text).toContain(
      '**Where I looked:**\n\n- [C2] Payments FAQ — https://acme.atlassian.net/wiki/2',
    );
    expect(text).toContain('**Who might know:**\n\n- The payments team');
    expect(text).not.toContain('**Confidence:**');
  });

  it.each([
    ['out_of_scope', 'Outside what I can answer'],
    ['clarify', 'Needs a bit more detail'],
  ])('names a %s reply %j', (status, label) => {
    const answer = makeAnswer({
      result: { status, confidence: null, confidenceReason: '', sources: [], alsoConsulted: [] },
      rendered: { level: null, banner: 'Banner.', text: 'Which one?', gaps: [], whoToAsk: [] },
    });

    expect(markdownOf([turn({ answer })])).toContain(`**Reply:** ${label}`);
  });

  it('leaves the reason out when an answer has none', () => {
    const answer = makeAnswer({ result: { confidence: 'high', confidenceReason: '' } });

    expect(markdownOf([turn({ answer })])).toContain('**Confidence:** High confidence.\n');
  });

  it('says a stopped question got no answer, and a failed one what went wrong', () => {
    const text = markdownOf([
      turn({ phase: 'stopped', answer: undefined }),
      turn({
        turn: 2,
        phase: 'failed',
        answer: undefined,
        failure: 'The assistant took too long.',
      }),
      turn({ turn: 3, phase: 'failed', answer: undefined, failure: undefined }),
    ]);

    expect(text).toContain('_Stopped before an answer._');
    expect(text).toContain('_Something went wrong. The assistant took too long._');
    expect(text.endsWith('_Something went wrong._\n')).toBe(true);
  });

  it('quotes a question line by line, so it cannot become a heading or a list', () => {
    const question = '# Not a heading\n- not a list\n\nSecond paragraph';

    const text = markdownOf([turn({ question })]);

    expect(text).toContain('> # Not a heading\n> - not a list\n>\n> Second paragraph');
  });

  it('escapes the characters that mean something in a title, a role name and a gap', () => {
    const answer = makeAnswer({
      result: {
        sources: [
          {
            key: 'C1',
            type: 'confluence',
            title: 'Refunds [draft] *new* <b>_v2_</b>',
            url: 'https://acme.atlassian.net/wiki/1',
          },
        ],
        alsoConsulted: [],
      },
      rendered: { gaps: ['Is `code` covered?'], whoToAsk: [] },
    });

    const text = conversationToMarkdown({
      roleName: 'Q*A_',
      date: DATE,
      turns: [turn({ answer })],
    });

    expect(text).toContain('# Conversation as Q\\*A\\_, 2026-10-15');
    expect(text).toContain('[C1] Refunds \\[draft\\] \\*new\\* \\<b\\>\\_v2\\_\\</b\\> — https://');
    expect(text).toContain('- Is \\`code\\` covered?');
  });

  it('keeps a title on one line', () => {
    const answer = makeAnswer({
      result: {
        sources: [
          { key: 'C1', type: 'confluence', title: 'Two\nlines', url: 'https://a.example/1' },
        ],
        alsoConsulted: [],
      },
    });

    expect(markdownOf([turn({ answer })])).toContain('- [C1] Two lines — https://a.example/1');
  });

  it('leaves out a link that is not https, as the page does', () => {
    const answer = makeAnswer({
      result: {
        sources: [{ key: 'C1', type: 'confluence', title: 'Page', url: 'javascript:alert(1)' }],
        alsoConsulted: [{ title: 'Other', url: '' }],
      },
    });

    const text = markdownOf([turn({ answer })]);

    expect(text).toContain('- [C1] Page\n');
    expect(text).toContain('- Other\n');
    expect(text).not.toContain('javascript');
  });

  it('writes a title and nothing else for a conversation with no turns', () => {
    expect(markdownOf([])).toBe('# Conversation as Product Owner, 2026-10-15\n');
  });
});

describe('escapeMarkdown', () => {
  it('puts a backslash before each character that means something', () => {
    expect(escapeMarkdown('a\\b`c*d_e[f]g<h>')).toBe('a\\\\b\\`c\\*d\\_e\\[f\\]g\\<h\\>');
  });

  it('leaves plain text as it is', () => {
    expect(escapeMarkdown('Returns and refunds, v3: policy (2026).')).toBe(
      'Returns and refunds, v3: policy (2026).',
    );
  });
});

describe('copyConversation', () => {
  it('writes the text to the clipboard and says the conversation was copied', async () => {
    const clipboard = { writeText: vi.fn(async () => undefined) };
    const announce = vi.fn();
    const showFallback = vi.fn();

    const outcome = await copyConversation({
      markdown: '# text',
      clipboard,
      announce,
      showFallback,
    });

    expect(outcome).toBe('copied');
    expect(clipboard.writeText).toHaveBeenCalledExactlyOnceWith('# text');
    expect(announce).toHaveBeenCalledExactlyOnceWith(COPIED_MESSAGE);
    expect(COPIED_MESSAGE).toBe('Conversation copied');
    expect(showFallback).not.toHaveBeenCalled();
  });

  it('shows the text to copy by hand when the clipboard refuses', async () => {
    const clipboard = {
      writeText: vi.fn(async () => {
        throw new DOMException('Not allowed', 'NotAllowedError');
      }),
    };
    const announce = vi.fn();
    const showFallback = vi.fn();

    const outcome = await copyConversation({
      markdown: '# text',
      clipboard,
      announce,
      showFallback,
    });

    expect(outcome).toBe('shown');
    expect(showFallback).toHaveBeenCalledExactlyOnceWith('# text');
    expect(announce).toHaveBeenCalledExactlyOnceWith(SHOWN_MESSAGE);
  });

  it('shows the text to copy by hand when there is no clipboard at all', async () => {
    const announce = vi.fn();
    const showFallback = vi.fn();

    const outcome = await copyConversation({
      markdown: '# text',
      clipboard: undefined,
      announce,
      showFallback,
    });

    expect(outcome).toBe('shown');
    expect(showFallback).toHaveBeenCalledExactlyOnceWith('# text');
  });
});

describe('buildCopyDialog', () => {
  it('is a modal dialog with a title, a hint and a read-only text area holding the text', () => {
    const dialog = buildCopyDialog('# the text', vi.fn());

    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.querySelector('h2')?.id).toBe(dialog.getAttribute('aria-labelledby'));
    const area = /** @type {HTMLTextAreaElement} */ (dialog.querySelector('textarea'));
    expect(area.value).toBe('# the text');
    expect(area.hasAttribute('readonly')).toBe(true);
    expect(area.getAttribute('aria-label')).toBe('The conversation, ready to copy');
    expect(dialog.querySelector('.copy-dialog__hint')?.textContent).toContain('Ctrl+C');
  });

  it('shows the text as text, never as markup', () => {
    const dialog = buildCopyDialog('<img src=x onerror=alert(1)>', vi.fn());

    expect(dialog.querySelector('img')).toBeNull();
    expect(/** @type {HTMLTextAreaElement} */ (dialog.querySelector('textarea')).value).toBe(
      '<img src=x onerror=alert(1)>',
    );
  });

  it('closes with its button', () => {
    const onClose = vi.fn();
    const dialog = buildCopyDialog('x', onClose);

    /** @type {HTMLButtonElement} */ (dialog.querySelector('button')).click();

    expect(onClose).toHaveBeenCalledOnce();
    expect(dialog.querySelector('button')?.textContent).toBe('Close');
  });

  it('closes with Escape and keeps that key from reaching anything behind it', () => {
    const onClose = vi.fn();
    const behind = vi.fn();
    const dialog = buildCopyDialog('x', onClose);
    document.body.append(dialog);
    document.body.addEventListener('keydown', behind);

    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));

    expect(onClose).toHaveBeenCalledOnce();
    expect(behind).toHaveBeenCalledOnce();
    document.body.removeEventListener('keydown', behind);
    dialog.remove();
  });
});

describe('selectDialogText', () => {
  it('focuses the text and selects all of it', () => {
    const dialog = buildCopyDialog('the whole conversation', vi.fn());
    document.body.append(dialog);

    selectDialogText(dialog);

    const area = /** @type {HTMLTextAreaElement} */ (dialog.querySelector('textarea'));
    expect(document.activeElement).toBe(area);
    expect(area.selectionStart).toBe(0);
    expect(area.selectionEnd).toBe('the whole conversation'.length);
    dialog.remove();
  });
});
