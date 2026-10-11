// @ts-check

/** How many decimal places a percentage gets. */
const PERCENT_DIGITS = 0;

/** Shown where a number does not apply, such as a rate over no cases. */
export const NOT_APPLICABLE = 'n/a';

const PERCENT = 100;
const MS_PER_SECOND = 1000;
const SECOND_DIGITS = 1;

/**
 * Writes a share as a percentage.
 * @param {number | undefined} rate - A share from 0 to 1, or undefined.
 * @returns {string} For example `75%`, or `n/a`.
 */
export function percent(rate) {
  return rate === undefined ? NOT_APPLICABLE : `${(rate * PERCENT).toFixed(PERCENT_DIGITS)}%`;
}

/**
 * Writes a count out of a total with its share.
 * @param {import('./summarise.js').Ratio} ratio - The count, the total and the share.
 * @returns {string} For example `3/4 (75%)`, or `n/a` when the total is zero.
 */
export function ratioText({ count, of, rate }) {
  return of === 0 ? NOT_APPLICABLE : `${count}/${of} (${percent(rate)})`;
}

/**
 * Writes a time in milliseconds as seconds.
 * @param {number | undefined} ms - A time, or undefined.
 * @returns {string} For example `4.2 s`, or `n/a`.
 */
export function seconds(ms) {
  return ms === undefined ? NOT_APPLICABLE : `${(ms / MS_PER_SECOND).toFixed(SECOND_DIGITS)} s`;
}

/**
 * Builds a markdown table.
 * @param {ReadonlyArray<string>} header - The column titles.
 * @param {ReadonlyArray<ReadonlyArray<string>>} rows - The rows.
 * @returns {string} The table, without a trailing line break.
 */
export function table(header, rows) {
  const line = (/** @type {ReadonlyArray<string>} */ cells) => `| ${cells.join(' | ')} |`;
  return [line(header), line(header.map(() => '---')), ...rows.map(line)].join('\n');
}
