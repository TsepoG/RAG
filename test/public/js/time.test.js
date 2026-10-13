// @ts-check
import { describe, expect, it } from 'vitest';
import { agoText } from '../../../public/js/time.js';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const NOW = 10 * DAY;

describe('agoText', () => {
  it.each([
    [0, 'just now'],
    [59 * SECOND, 'just now'],
    [MINUTE, '1 min ago'],
    [2 * MINUTE + 30 * SECOND, '2 min ago'],
    [59 * MINUTE, '59 min ago'],
    [HOUR, '1 h ago'],
    [23 * HOUR + 59 * MINUTE, '23 h ago'],
    [DAY, '1 day ago'],
    [3 * DAY, '3 days ago'],
  ])('says %i ms ago as "%s"', (elapsed, text) => {
    expect(agoText(NOW, NOW - elapsed)).toBe(text);
  });

  it('says "just now" for a time in the future, such as a clock that moved back', () => {
    expect(agoText(NOW, NOW + HOUR)).toBe('just now');
  });
});
