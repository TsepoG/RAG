// @ts-check
import { el } from '../dom.js';
import { TYPICAL_SECONDS_HIGH, TYPICAL_SECONDS_LOW } from './config.js';

const SECONDS_PER_MINUTE = 60;

/**
 * @param {number} count - How many.
 * @param {string} unit - The unit, in the singular.
 * @returns {string} The count with its unit, such as "1 minute" or "3 minutes".
 */
function plural(count, unit) {
  return `${count} ${unit}${count === 1 ? '' : 's'}`;
}

/**
 * Whether a number can be a number of seconds to show.
 * @param {unknown} value - What was given.
 * @returns {value is number} True for a number above zero.
 */
function isSeconds(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Says how long a typical answer takes. From a minute up the time is in whole minutes, below it in
 * seconds, and a range that crosses a minute names both.
 * @param {number | undefined} low - Seconds a typical answer takes at the least.
 * @param {number | undefined} high - Seconds it takes at the most.
 * @returns {string | undefined} The sentence, or undefined when the numbers are missing or make no range.
 */
export function formatTimeHint(low, high) {
  if (!isSeconds(low) || !isSeconds(high) || low > high) {
    return undefined;
  }
  const lowMinutes = Math.round(low / SECONDS_PER_MINUTE);
  const highMinutes = Math.round(high / SECONDS_PER_MINUTE);
  if (low >= SECONDS_PER_MINUTE) {
    return lowMinutes === highMinutes
      ? `Most answers take about ${plural(highMinutes, 'minute')}`
      : `Most answers take ${lowMinutes}–${plural(highMinutes, 'minute')}`;
  }
  if (high >= SECONDS_PER_MINUTE) {
    return `Most answers take ${plural(low, 'second')} to ${plural(highMinutes, 'minute')}`;
  }
  return low === high
    ? `Most answers take about ${plural(low, 'second')}`
    : `Most answers take ${low}–${plural(high, 'second')}`;
}

/** The range from the config, as one value so a caller can swap the whole range. */
const CONFIGURED_RANGE = Object.freeze({ low: TYPICAL_SECONDS_LOW, high: TYPICAL_SECONDS_HIGH });

/**
 * Builds the hint shown beside Stop while a question runs.
 * @param {{ low: number | undefined, high: number | undefined }} [range] - The seconds at the least and at the most; the configured range by default.
 * @returns {HTMLElement | undefined} The hint, or undefined when there is nothing honest to say.
 */
export function buildTimeHint(range = CONFIGURED_RANGE) {
  const text = formatTimeHint(range.low, range.high);
  return text === undefined ? undefined : el('span', { className: 'time-hint', text });
}
