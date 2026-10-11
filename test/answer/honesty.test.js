// @ts-check
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ask, FENCE, FILE, FOLDER, NOT_FOUND_TEXT, PAGE, reply, WINDOW } from '../helpers/ask.js';
import { makeRole } from '../helpers/role.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('askQuestion status and confidence', () => {
  it('keeps the confidence the model reports when nothing lowers it', async () => {
    const { result } = await ask({ tools: [PAGE], replies: [reply(`${WINDOW} [C1].`)] });

    expect(result).toMatchObject({
      status: 'answered',
      confidence: 'high',
      confidenceReason: 'Stated in the page.',
      capsApplied: [],
      answer: `${WINDOW} [C1].`,
      gaps: [],
      conflicts: [],
      whoToAsk: [],
      rewritten: false,
      rewriteRejected: false,
    });
    expect(result.sources.map(({ key }) => key)).toEqual(['C1']);
  });

  it('never shows the answer-meta block', async () => {
    const { result } = await ask({ tools: [PAGE], replies: [reply(`${WINDOW} [C1].`)] });

    expect(JSON.stringify(result)).not.toContain('answer-meta');
    expect(result.answer).not.toContain(FENCE);
  });

  it('counts a missing report as low, says so, and logs only the kind of problem', async () => {
    const { result, lines } = await ask({
      tools: [PAGE],
      replies: [reply(`${WINDOW} [C1].`, null)],
    });

    expect(result).toMatchObject({
      status: 'answered',
      confidence: 'low',
      confidenceReason: 'The assistant did not report its confidence.',
    });
    expect(result.capsApplied.map(({ code }) => code)).toEqual(['no-meta']);
    expect(lines()).toContainEqual(
      expect.objectContaining({
        msg: 'the answer-meta block was missing or invalid',
        reason: 'missing',
      }),
    );
    expect(JSON.stringify(lines())).not.toContain('thirty days');
  });

  it('counts an invalid report as low', async () => {
    const bad = `${WINDOW} [C1].\n\n${FENCE}answer-meta\n{"status": "maybe"}\n${FENCE}`;

    const { result, lines } = await ask({ tools: [PAGE], replies: [bad] });

    expect(result.confidence).toBe('low');
    expect(lines()).toContainEqual(expect.objectContaining({ reason: 'invalid-shape' }));
  });

  it('uses a report that is not at the end, keeps the text after it, and warns', async () => {
    const withReport = reply(`${WINDOW} [C1].`);
    const text = `${withReport}\n\nHope that helps.`;

    const { result, lines } = await ask({ tools: [PAGE], replies: [text] });

    expect(result.confidence).toBe('high');
    expect(result.answer).toBe(`${WINDOW} [C1].\n\nHope that helps.`);
    expect(lines()).toContainEqual(
      expect.objectContaining({ msg: 'text followed the answer-meta block', reason: 'not-at-end' }),
    );
  });

  it('limits a stale page to medium and says why', async () => {
    const later = () => Date.parse('2028-01-01T00:00:00Z');

    const { result } = await ask({
      tools: [PAGE],
      replies: [reply(`${WINDOW} [C1].`)],
      now: later,
    });

    expect(result.confidence).toBe('medium');
    expect(result.capsApplied.map(({ code }) => code)).toEqual(['stale-page']);
    expect(result.confidenceReason).toBe(
      'Stated in the page. A cited page was last updated more than a year ago.',
    );
    expect(result.sources[0]).toMatchObject({ stale: true });
  });

  it('limits an answer with an invented key to medium and reports the key', async () => {
    const { result } = await ask({
      tools: [PAGE],
      replies: [reply(`${WINDOW} [C1]. Managers approve large ones as well [C9].`)],
    });

    expect(result).toMatchObject({ confidence: 'medium', invalidKeys: ['C9'] });
    expect(result.answer).toBe(`${WINDOW} [C1]. Managers approve large ones as well.`);
  });

  it('limits an answer with an uncited claim to medium and lists the claim', async () => {
    const { result } = await ask({
      tools: [PAGE],
      replies: [reply(`${WINDOW} [C1]. Managers approve every large refund themselves.`)],
    });

    expect(result.confidence).toBe('medium');
    expect(result.uncitedSentences).toEqual(['Managers approve every large refund themselves.']);
  });

  it('limits an interpretation marked with an asterisk to medium', async () => {
    const { result } = await ask({
      tools: [FILE],
      replies: [
        reply('Based on the code, it looks like refunds are capped at five thousand [G1*].'),
      ],
    });

    expect(result).toMatchObject({ confidence: 'medium', inferredKeys: ['G1'] });
    expect(result.sources[0]).toMatchObject({ key: 'G1', inferred: true });
    expect(result.capsApplied.map(({ code }) => code)).toEqual(['inferred']);
  });

  it('treats a sentence resting only on a folder listing as an interpretation and limits it to medium', async () => {
    const { result } = await ask({
      tools: [FOLDER],
      replies: [reply('The refund rules are kept in their own folder under the source tree [G1].')],
    });

    expect(result.answer).toBe(
      'The refund rules are kept in their own folder under the source tree [G1*].',
    );
    expect(result).toMatchObject({ confidence: 'medium', inferredKeys: ['G1'] });
    expect(result.sources[0]).toMatchObject({ kind: 'directory', inferred: true });
    expect(result.capsApplied.map(({ code }) => code)).toEqual(['inferred', 'folder-only']);
  });

  it('does not mark a sentence that also cites a file', async () => {
    const { result } = await ask({
      tools: [FOLDER, ['github_repos-get_file_contents', 'get_file_contents', { path: 'a.md' }]],
      replies: [
        reply('The refund rules are kept in their own folder under the source tree [G1][G2].'),
      ],
    });

    expect(result.answer).toContain('[G1][G2]');
    expect(result.capsApplied).toEqual([]);
  });

  it('limits an answer with gaps to medium and returns the gaps', async () => {
    const { result } = await ask({
      tools: [PAGE],
      replies: [reply(`${WINDOW} [C1].`, { gaps: ['No page covers partial refunds'] })],
    });

    expect(result).toMatchObject({
      confidence: 'medium',
      gaps: ['No page covers partial refunds'],
    });
  });

  it('limits an answer with a conflict to low, and lists both sides in the sources', async () => {
    const conflict = {
      topic: 'Refund window',
      docSays: '30 days',
      docKeys: ['C1'],
      codeSays: '14 days',
      codeKeys: ['G1'],
    };

    const { result } = await ask({
      tools: [PAGE, FILE],
      replies: [reply(`${WINDOW} [C1].`, { conflicts: [conflict] })],
    });

    expect(result).toMatchObject({ confidence: 'low', conflicts: [conflict] });
    expect(result.sources.map(({ key }) => key)).toEqual(['C1', 'G1']);
    expect(result.uncitedSourceKeys).toEqual([]);
  });

  it('checks the keys of a conflict: an invented key is dropped, and so is a conflict left with none', async () => {
    const kept = { topic: 'A', docSays: 'x', docKeys: ['C1', 'C9'], codeSays: 'y', codeKeys: [] };
    const gone = {
      topic: 'B',
      docSays: 'x',
      docKeys: ['C8'],
      codeSays: 'y',
      codeKeys: ['not a key'],
    };

    const { result } = await ask({
      tools: [PAGE],
      replies: [reply(`${WINDOW} [C1].`, { conflicts: [kept, gone] })],
    });

    expect(result.conflicts).toEqual([{ ...kept, docKeys: ['C1'] }]);
    expect(result.invalidKeys).toEqual(['C9', 'C8']);
    expect(result.confidence).toBe('low');
  });

  it('never lets the model raise the confidence above what the caps allow', async () => {
    const { result } = await ask({
      tools: [PAGE],
      replies: [reply(`${WINDOW} [C1].`, { confidence: 'high', gaps: ['x'] })],
    });

    expect(result.confidence).toBe('medium');
  });

  it('keeps a lower level the model gave itself', async () => {
    const { result } = await ask({
      tools: [PAGE],
      replies: [reply(`${WINDOW} [C1].`, { confidence: 'low', confidenceReason: 'Thin.' })],
    });

    expect(result).toMatchObject({ confidence: 'low', confidenceReason: 'Thin.' });
  });
});

describe('askQuestion when nothing can be said', () => {
  it('turns an answer with no valid citation into not found, with the pages looked at', async () => {
    const { result } = await ask({
      tools: [PAGE, FILE],
      replies: [reply('Refunds are probably thirty days long, but I am not certain.')],
    });

    expect(result).toMatchObject({
      status: 'not_found',
      confidence: null,
      answer: NOT_FOUND_TEXT,
      sources: [],
    });
    expect(result.capsApplied.map(({ code }) => code)).toEqual(['no-citations']);
    expect(result.alsoConsulted.map(({ key }) => key)).toEqual(['C1', 'G1']);
  });

  it('accepts not found from the model, and discards what it wrote', async () => {
    const { result } = await ask({
      tools: [PAGE],
      replies: [
        reply('A long guess about refunds that should not be shown.', {
          status: 'not_found',
          confidence: undefined,
          confidenceReason: 'No page covers it.',
        }),
      ],
    });

    expect(result).toMatchObject({ status: 'not_found', answer: NOT_FOUND_TEXT });
    expect(JSON.stringify(result)).not.toContain('long guess');
  });

  it("uses the role's own words for not found", async () => {
    const role = makeRole({ phrases: { notFound: 'Nothing here, sorry.' } });

    const { result } = await ask({ role, replies: [reply('No idea.', null)] });

    expect(result.answer).toBe('Nothing here, sorry.');
  });

  it('returns the out-of-scope text, with no sources', async () => {
    const { result } = await ask({
      tools: [PAGE],
      replies: [
        reply('Next year the release will be in May [C1].', {
          status: 'out_of_scope',
          confidence: undefined,
          confidenceReason: 'A prediction.',
        }),
      ],
    });

    expect(result).toMatchObject({
      status: 'out_of_scope',
      confidence: null,
      answer:
        "I don't have that information. I can only answer from the team's Confluence pages and code.",
      sources: [],
      gaps: [],
      conflicts: [],
    });
  });

  it('returns only the one clarifying question, with no sources', async () => {
    const question = 'Do you mean refunds in the shop or in billing?';

    const { result } = await ask({
      tools: [PAGE],
      replies: [
        reply(`${question} [C1]`, {
          status: 'clarify',
          confidence: undefined,
          clarifyingQuestion: question,
        }),
      ],
    });

    expect(result).toMatchObject({
      status: 'clarify',
      confidence: null,
      answer: question,
      clarifyingQuestion: question,
      sources: [],
    });
  });

  it('does not clarify without a question: the report is invalid', async () => {
    const { result } = await ask({
      tools: [PAGE],
      replies: [reply(`${WINDOW} [C1].`, { status: 'clarify', confidence: undefined })],
    });

    expect(result).toMatchObject({ status: 'answered', confidence: 'low' });
  });
});

describe('askQuestion who to ask', () => {
  /**
   * A fake fetch that serves a CODEOWNERS file and nothing else.
   * @param {string} file - The file.
   * @returns {typeof fetch} The fake.
   */
  const withCodeowners = (file) =>
    /** @type {typeof fetch} */ (
      vi.fn(async (/** @type {string} */ url) =>
        url.endsWith('/contents/.github/CODEOWNERS')
          ? new Response(file)
          : new Response('', { status: 404 }),
      )
    );

  it('suggests the owners of a file when the answer is not found', async () => {
    const { result } = await ask({
      tools: [FILE],
      fetchFunction: withCodeowners('* @acme/everyone'),
      replies: [reply('Nothing.', { status: 'not_found', confidence: undefined })],
    });

    expect(result.whoToAsk).toEqual([{ name: '@acme/everyone', sourceKeys: ['G1'] }]);
  });

  it('suggests them for a medium answer', async () => {
    const { result } = await ask({
      tools: [FILE],
      fetchFunction: withCodeowners('* @acme/everyone'),
      replies: [reply('Based on the code, it looks like refunds are capped [G1*].')],
    });

    expect(result.whoToAsk).toEqual([{ name: '@acme/everyone', sourceKeys: ['G1'] }]);
  });

  it('suggests nobody, and reads no CODEOWNERS, for a confident answer', async () => {
    const fetchFunction = withCodeowners('* @acme/everyone');

    const { result } = await ask({
      tools: [FILE],
      fetchFunction,
      replies: [reply('The retry rule is in the file we read first today [G1].')],
    });

    expect(result.whoToAsk).toEqual([]);
    const urls = vi.mocked(fetchFunction).mock.calls.map(([url]) => String(url));
    expect(urls.some((url) => url.includes('CODEOWNERS'))).toBe(false);
  });

  it('suggests nobody when the repository has no CODEOWNERS file', async () => {
    const { result } = await ask({
      tools: [FILE],
      replies: [reply('Nothing.', { status: 'not_found', confidence: undefined })],
    });

    expect(result.whoToAsk).toEqual([]);
  });
});
