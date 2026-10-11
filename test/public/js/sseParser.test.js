// @ts-check
import { describe, expect, it } from 'vitest';
import { createSseParser } from '../../../public/js/sseParser.js';

/**
 * Feeds text to a new parser in pieces of a given size.
 * @param {string} text - The whole stream.
 * @param {number} size - The size of each piece.
 * @returns {Array<{ event: string, data: string }>} Every event found.
 */
function parseInPieces(text, size) {
  const parser = createSseParser();
  const found = [];
  for (let start = 0; start < text.length; start += size) {
    found.push(...parser.push(text.slice(start, start + size)));
  }
  return found;
}

const STREAM =
  'event: progress\ndata: {"message":"a"}\n\nevent: token\ndata: {"text":"b"}\n\nevent: done\ndata: {"id":1}\n\n';
const EXPECTED = [
  { event: 'progress', data: '{"message":"a"}' },
  { event: 'token', data: '{"text":"b"}' },
  { event: 'done', data: '{"id":1}' },
];

describe('createSseParser', () => {
  it('reads each event, with its name and data', () => {
    expect(createSseParser().push(STREAM)).toEqual(EXPECTED);
  });

  it.each([1, 2, 3, 5, 7, 13, 50])(
    'gives the same events when split every %i characters',
    (size) => {
      expect(parseInPieces(STREAM, size)).toEqual(EXPECTED);
    },
  );

  it('holds an event back until its blank line arrives', () => {
    const parser = createSseParser();

    expect(parser.push('event: token\ndata: {"text":"x"}\n')).toEqual([]);
    expect(parser.push('\n')).toEqual([{ event: 'token', data: '{"text":"x"}' }]);
  });

  it('joins several data lines with a line break', () => {
    expect(createSseParser().push('data: one\ndata: two\n\n')).toEqual([
      { event: 'message', data: 'one\ntwo' },
    ]);
  });

  it('names an event with no event line "message"', () => {
    expect(createSseParser().push('data: x\n\n')[0].event).toBe('message');
  });

  it('does not carry an event name over to the next event', () => {
    const events = createSseParser().push('event: token\ndata: a\n\ndata: b\n\n');

    expect(events.map(({ event }) => event)).toEqual(['token', 'message']);
  });

  it('ignores comment lines, including a keep-alive', () => {
    expect(createSseParser().push(': keep-alive\n\nevent: token\n: note\ndata: x\n\n')).toEqual([
      { event: 'token', data: 'x' },
    ]);
  });

  it('ignores id and retry lines and fields it does not know', () => {
    expect(createSseParser().push('id: 4\nretry: 10\nother: 1\ndata: x\n\n')).toEqual([
      { event: 'message', data: 'x' },
    ]);
  });

  it('does not send an event that has no data', () => {
    expect(createSseParser().push('event: token\n\n')).toEqual([]);
  });

  it('removes one space after the colon and no more', () => {
    expect(createSseParser().push('data:  two spaces\n\ndata:none\n\n')).toEqual([
      { event: 'message', data: ' two spaces' },
      { event: 'message', data: 'none' },
    ]);
  });

  it('reads a data line with no colon as an empty value', () => {
    expect(createSseParser().push('data\ndata: x\n\n')).toEqual([
      { event: 'message', data: '\nx' },
    ]);
  });

  it('keeps a colon inside the data', () => {
    expect(createSseParser().push('data: a: b\n\n')[0].data).toBe('a: b');
  });

  it.each([
    ['\r\n', 'data: x\r\n\r\n'],
    ['\r', 'data: x\r\r: end\r\r'],
    ['\n', 'data: x\n\n'],
  ])('understands the line ending %j', (_name, text) => {
    expect(createSseParser().push(text)).toEqual([{ event: 'message', data: 'x' }]);
  });

  it.each([1, 2, 3])('understands \\r\\n split across pieces of %i characters', (size) => {
    expect(parseInPieces('event: a\r\ndata: x\r\n\r\n', size)).toEqual([{ event: 'a', data: 'x' }]);
  });

  it('waits for the next piece when a carriage return ends the text', () => {
    const parser = createSseParser();

    expect(parser.push('data: x\r\n\r')).toEqual([]);
    expect(parser.push('\n')).toEqual([{ event: 'message', data: 'x' }]);
  });

  it('keeps a line break inside JSON data intact, because the server escapes it', () => {
    const [event] = createSseParser().push('data: {"text":"a\\nb"}\n\n');

    expect(JSON.parse(event.data).text).toBe('a\nb');
  });

  it('reads many events from one piece, and none from an empty one', () => {
    const parser = createSseParser();

    expect(parser.push('')).toEqual([]);
    expect(parser.push('data: 1\n\ndata: 2\n\ndata: 3\n\n')).toHaveLength(3);
  });
});
