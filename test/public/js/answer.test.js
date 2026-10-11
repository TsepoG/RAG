// @vitest-environment happy-dom
// @ts-check
import { beforeEach, describe, expect, it } from 'vitest';
import { renderAnswer } from '../../../public/js/answer.js';
import { chip, loadPage, makePayload } from '../../helpers/page.js';

/** @type {import('../../../public/js/refs.js').PageRefs} */
let refs;

beforeEach(() => {
  refs = loadPage();
});

describe('renderAnswer: the banner', () => {
  it.each([
    ['high', 'High confidence', 'level-high'],
    ['medium', 'Medium confidence', 'level-medium'],
    ['low', 'Low confidence', 'level-low'],
  ])('says %s in words as well as colour', (level, words, className) => {
    renderAnswer(refs, makePayload({ rendered: { level } }));

    expect(refs.bannerBadge.textContent).toBe(words);
    expect(refs.bannerBadge.classList.contains(className)).toBe(true);
  });

  it('shows the banner text and why', () => {
    renderAnswer(refs, makePayload());

    expect(refs.banner.hidden).toBe(false);
    expect(refs.bannerText.textContent).toBe('Mostly confirmed. Part of this is my reading.');
    expect(refs.bannerReason.textContent).toBe('Why: Part of this is my reading.');
    expect(refs.bannerReason.hidden).toBe(false);
  });

  it('shows no badge and no reason when the application speaks in its own voice', () => {
    renderAnswer(
      refs,
      makePayload({
        result: { status: 'not_found', confidence: null, confidenceReason: 'ignored' },
        rendered: { level: null, banner: "I couldn't find this.", text: '' },
        html: { answer: '' },
      }),
    );

    expect(refs.bannerBadge.textContent).toBe('');
    expect(refs.bannerBadge.className).toBe('badge');
    expect(refs.bannerReason.hidden).toBe(true);
    expect(refs.bannerText.textContent).toBe("I couldn't find this.");
  });

  it('hides the banner for a clarifying question, which has none', () => {
    renderAnswer(
      refs,
      makePayload({
        result: { status: 'clarify' },
        rendered: { level: null, banner: '' },
      }),
    );

    expect(refs.banner.hidden).toBe(true);
  });

  it('shows no reason line when the model gave none', () => {
    renderAnswer(refs, makePayload({ result: { confidenceReason: '' } }));

    expect(refs.bannerReason.hidden).toBe(true);
    expect(refs.bannerReason.textContent).toBe('');
  });
});

describe('renderAnswer: the answer', () => {
  it('puts the server’s HTML in, with its citation chips', () => {
    renderAnswer(refs, makePayload());

    expect(refs.answer.querySelector('button.cite')?.getAttribute('data-key')).toBe('C1');
    expect(refs.answer.textContent).toContain('Refunds are allowed for 30 days');
  });

  it('points each chip at its source', () => {
    renderAnswer(refs, makePayload());

    expect(refs.answer.querySelector('button.cite')?.getAttribute('aria-describedby')).toBe(
      'source-title-C1',
    );
  });

  it('styles a clarifying question as a question', () => {
    renderAnswer(
      refs,
      makePayload({
        result: { status: 'clarify' },
        html: { answer: '<p>Which refunds do you mean?</p>' },
      }),
    );

    expect(refs.answer.className).toBe('answer clarify');
  });

  it('replaces a draft, and its muted style, with the answer', () => {
    refs.answer.className = 'answer draft';
    refs.answer.textContent = 'draft text';
    refs.draftNote.hidden = false;

    renderAnswer(refs, makePayload());

    expect(refs.answer.className).toBe('answer');
    expect(refs.answer.textContent).not.toContain('draft text');
    expect(refs.draftNote.hidden).toBe(true);
  });
});

describe('renderAnswer: the notes', () => {
  it('lists what could not be confirmed', () => {
    renderAnswer(refs, makePayload());

    expect(refs.gaps.hidden).toBe(false);
    expect(refs.gapsList.textContent).toBe('The refund window for gift cards');
  });

  it('writes a gap that holds HTML as text', () => {
    renderAnswer(refs, makePayload({ rendered: { gaps: ['<img src=x onerror=alert(1)>'] } }));

    expect(refs.gapsList.querySelector('img')).toBeNull();
  });

  it('hides a section that has nothing in it', () => {
    renderAnswer(refs, makePayload({ rendered: { gaps: [], whoToAsk: [] } }));

    expect(refs.gaps.hidden).toBe(true);
    expect(refs.who.hidden).toBe(true);
    expect(refs.conflicts.hidden).toBe(true);
    expect(refs.closest.hidden).toBe(true);
  });

  it('shows each conflict with chips that point at their sources', () => {
    renderAnswer(
      refs,
      makePayload({
        html: {
          conflicts: [
            `<p>The page says 30 days ${chip('C1')}; the code says 14 ${chip('G1', true)}.</p>`,
          ],
        },
      }),
    );

    expect(refs.conflicts.hidden).toBe(false);
    const chips = refs.conflictsList.querySelectorAll('button.cite');
    expect(chips).toHaveLength(2);
    expect(chips[1].getAttribute('aria-describedby')).toBe('source-title-G1');
  });

  it('lists who might know, with the sources they are known from', () => {
    renderAnswer(
      refs,
      makePayload({
        rendered: {
          whoToAsk: [
            { name: '@acme/payments', sourceKeys: ['G1', 'G2'] },
            { name: 'Dana Lee', sourceKeys: [] },
          ],
        },
      }),
    );

    const items = [...refs.whoList.querySelectorAll('li')].map((item) => item.textContent);
    expect(items).toEqual(['@acme/payments (G1, G2)', 'Dana Lee']);
  });

  it('lists the closest pages as links', () => {
    renderAnswer(
      refs,
      makePayload({
        rendered: {
          closestPages: [{ title: 'Returns FAQ', url: 'https://acme.atlassian.net/wiki/x' }],
        },
      }),
    );

    expect(refs.closest.hidden).toBe(false);
    expect(refs.closestList.querySelector('a')?.getAttribute('href')).toBe(
      'https://acme.atlassian.net/wiki/x',
    );
  });

  it('draws the Sources panel', () => {
    renderAnswer(refs, makePayload());

    expect(refs.sourcesList.children).toHaveLength(2);
  });
});
