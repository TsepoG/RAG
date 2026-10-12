// @ts-check
import { EvalError } from '../errors/index.js';

/** Excel only reads UTF-8 correctly when the file starts with this mark. */
const BOM = '﻿';

const QUOTE = '"';
const COMMA = ',';
const LINE_FEED = '\n';
const CARRIAGE_RETURN = '\r';

/**
 * Writes one field, in quotes when it holds a comma, a quote or a line break.
 * @param {string} value - The text.
 * @returns {string} The field.
 */
function field(value) {
  const needsQuotes = [COMMA, QUOTE, LINE_FEED, CARRIAGE_RETURN].some((mark) =>
    value.includes(mark),
  );
  return needsQuotes ? `${QUOTE}${value.replaceAll(QUOTE, QUOTE + QUOTE)}${QUOTE}` : value;
}

/**
 * Writes rows as CSV (RFC 4180): comma-separated, quotes doubled inside quoted fields, a line
 * break after every row. It starts with a byte-order mark so Excel reads accents and quotes right.
 * @param {ReadonlyArray<ReadonlyArray<string>>} rows - The rows, the first being the header.
 * @returns {string} The file's text.
 */
export function toCsv(rows) {
  return BOM + rows.map((row) => row.map(field).join(COMMA) + LINE_FEED).join('');
}

/**
 * Reads a quoted field, starting just after its opening quote.
 * @param {string} source - The text.
 * @param {number} start - The position after the opening quote.
 * @returns {{ value: string, next: number }} The field's text, and where reading goes on.
 * @throws {EvalError} When the closing quote is missing.
 */
function readQuoted(source, start) {
  let value = '';
  let index = start;
  while (index < source.length) {
    if (source[index] === QUOTE && source[index + 1] === QUOTE) {
      value += QUOTE;
      index += 2;
    } else if (source[index] === QUOTE) {
      return { value, next: index + 1 };
    } else {
      value += source[index];
      index += 1;
    }
  }
  throw new EvalError('The CSV has a quoted field that is never closed.');
}

/**
 * Reads CSV text into rows. It handles quoted fields with commas, doubled quotes and line breaks
 * inside, rows ending in a line feed or a carriage return and line feed, a missing final line
 * break, and a leading byte-order mark.
 * @param {string} text - The file's text.
 * @returns {string[][]} The rows. A blank line is not a row.
 * @throws {EvalError} When a quoted field is never closed.
 */
export function parseCsv(text) {
  const source = text.startsWith(BOM) ? text.slice(BOM.length) : text;
  /** @type {string[][]} */
  const rows = [];
  /** @type {string[]} */
  let row = [];
  let current = '';
  let started = false;
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (char === QUOTE) {
      const quoted = readQuoted(source, index + 1);
      current += quoted.value;
      index = quoted.next;
      started = true;
    } else if (char === COMMA) {
      row.push(current);
      current = '';
      started = true;
      index += 1;
    } else if (char === LINE_FEED || char === CARRIAGE_RETURN) {
      index += char === CARRIAGE_RETURN && source[index + 1] === LINE_FEED ? 2 : 1;
      if (started) {
        rows.push([...row, current]);
      }
      row = [];
      current = '';
      started = false;
    } else {
      current += char;
      started = true;
      index += 1;
    }
  }
  if (started) {
    rows.push([...row, current]);
  }
  return rows;
}
