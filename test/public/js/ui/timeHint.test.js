// @vitest-environment happy-dom
// @ts-check
import { describe, expect, it } from 'vitest';
import { TYPICAL_SECONDS_HIGH, TYPICAL_SECONDS_LOW } from '../../../../public/js/ui/config.js';
import { buildTimeHint, formatTimeHint } from '../../../../public/js/ui/timeHint.js';

describe('formatTimeHint', () => {
  it.each([
    [60, 180, 'Most answers take 1–3 minutes'],
    [60, 90, 'Most answers take 1–2 minutes'],
    [60, 60, 'Most answers take about 1 minute'],
    [120, 130, 'Most answers take about 2 minutes'],
    [40, 50, 'Most answers take 40–50 seconds'],
    [30, 30, 'Most answers take about 30 seconds'],
    [1, 20, 'Most answers take 1–20 seconds'],
    [50, 120, 'Most answers take 50 seconds to 2 minutes'],
    [30, 60, 'Most answers take 30 seconds to 1 minute'],
  ])('says %i to %i seconds as "%s"', (low, high, expected) => {
    expect(formatTimeHint(low, high)).toBe(expected);
  });

  it('writes whole minutes from a minute up, rounded', () => {
    expect(formatTimeHint(60, 176.5)).toBe('Most answers take 1–3 minutes');
  });

  it.each([
    [undefined, 180],
    [60, undefined],
    [undefined, undefined],
    [0, 180],
    [60, 0],
    [-5, 10],
    [Number.NaN, 180],
    [60, Number.POSITIVE_INFINITY],
    [180, 60],
  ])('says nothing for %s to %s, which is no honest range', (low, high) => {
    expect(formatTimeHint(low, high)).toBeUndefined();
  });

  it('says nothing for a value that is not a number', () => {
    expect(formatTimeHint(/** @type {any} */ ('60'), 180)).toBeUndefined();
  });
});

describe('buildTimeHint', () => {
  it('builds the hint from the numbers in the config', () => {
    const hint = /** @type {HTMLElement} */ (buildTimeHint());

    expect(hint.tagName).toBe('SPAN');
    expect(hint.className).toBe('time-hint');
    expect(hint.textContent).toBe('Most answers take 1–3 minutes');
  });

  it('uses the numbers it is given in place of the config', () => {
    expect(buildTimeHint({ low: 40, high: 50 })?.textContent).toBe(
      'Most answers take 40–50 seconds',
    );
  });

  it('is not built when a number is missing, so nothing is claimed', () => {
    expect(buildTimeHint({ low: undefined, high: 180 })).toBeUndefined();
  });

  it('is not built when the config numbers do not make a range', () => {
    expect(buildTimeHint({ low: 0, high: 0 })).toBeUndefined();
  });
});

describe('the configured numbers', () => {
  it('are the quartiles of the named run, rounded to ten seconds', () => {
    expect(TYPICAL_SECONDS_LOW).toBe(60);
    expect(TYPICAL_SECONDS_HIGH).toBe(180);
    expect(TYPICAL_SECONDS_LOW % 10).toBe(0);
    expect(TYPICAL_SECONDS_HIGH % 10).toBe(0);
  });
});
