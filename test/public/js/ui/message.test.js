// @vitest-environment happy-dom
// @ts-check
import { describe, expect, it } from 'vitest';
import {
  buildStoppedCard,
  buildUserMessage,
  STOPPED_TEXT,
  STOPPED_WITH_DRAFT_TEXT,
} from '../../../../public/js/ui/message.js';

describe('buildUserMessage', () => {
  it('shows the question in a bubble, and tells a screen reader who asked it', () => {
    const bubble = buildUserMessage({
      question: 'How long is the refund window?',
      detailLevel: 'default',
    });

    expect(bubble.className).toBe('bubble');
    expect(bubble.querySelector('.visually-hidden')?.textContent).toBe('You asked: ');
    expect(bubble.querySelector('.bubble__text')?.textContent).toBe(
      'You asked: How long is the refund window?',
    );
    expect(bubble.querySelector('.bubble__note')).toBeNull();
  });

  it('says a question was asked for more detail', () => {
    const bubble = buildUserMessage({ question: 'How?', detailLevel: 'more' });

    expect(bubble.querySelector('.bubble__note')?.textContent).toBe('Asked for more detail.');
  });

  it('shows the question as text, never as markup', () => {
    const bubble = buildUserMessage({
      question: '<img src=x onerror=alert(1)>',
      detailLevel: 'default',
    });

    expect(bubble.querySelector('img')).toBeNull();
    expect(bubble.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});

describe('buildStoppedCard', () => {
  it('says the question was stopped, with a neutral pill and its turn', () => {
    const card = buildStoppedCard({ turn: 2, draft: '' });

    expect(card.tagName).toBe('ARTICLE');
    expect(card.getAttribute('data-turn')).toBe('2');
    expect(card.querySelector('.pill')?.textContent).toBe('Stopped');
    expect(card.querySelector('.pill')?.className).toBe('pill pill--neutral');
    expect(card.querySelector('.answer-card__turn')?.textContent).toBe('Turn 2');
    expect(card.querySelector('.answer-card__notice')?.textContent).toBe(STOPPED_TEXT);
    expect(card.querySelector('.answer-card__draft')).toBeNull();
  });

  it('shows what had arrived, and says it was not checked', () => {
    const card = buildStoppedCard({ turn: 1, draft: 'The order cannot be' });

    expect(card.querySelector('.answer-card__draft')?.textContent).toBe('The order cannot be');
    expect(card.querySelector('.answer-card__notice')?.textContent).toBe(STOPPED_WITH_DRAFT_TEXT);
    expect(STOPPED_WITH_DRAFT_TEXT).toBe('Stopped. What you see is an unchecked draft.');
  });

  it('shows the draft as text, never as markup', () => {
    const card = buildStoppedCard({ turn: 1, draft: '<b>bold</b>' });

    expect(card.querySelector('b')).toBeNull();
  });
});
