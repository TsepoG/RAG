// @ts-check
import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../src/errors/index.js';
import { formatEvent, openEventStream } from '../../src/server/sse.js';

/**
 * A response that records what is written to it.
 * @returns {any} The fake, with `chunks`, `status`, `headers` and `emitClose`.
 */
function fakeResponse() {
  /** @type {Array<() => void>} */
  const closers = [];
  const response = {
    chunks: /** @type {string[]} */ ([]),
    status: 0,
    headers: /** @type {Record<string, string>} */ ({}),
    writableEnded: false,
    destroyed: false,
    writeHead: vi.fn((/** @type {number} */ status, /** @type {any} */ headers) => {
      response.status = status;
      response.headers = headers;
    }),
    flushHeaders: vi.fn(),
    write: vi.fn((/** @type {string} */ chunk) => {
      response.chunks.push(chunk);
      return true;
    }),
    end: vi.fn(() => {
      response.writableEnded = true;
    }),
    on: vi.fn((/** @type {string} */ name, /** @type {() => void} */ listener) => {
      if (name === 'close') {
        closers.push(listener);
      }
    }),
    emitClose: () => {
      response.destroyed = true;
      for (const listener of closers) {
        listener();
      }
    },
  };
  return response;
}

describe('formatEvent', () => {
  it('writes the event name, the data as one JSON line and a blank line', () => {
    expect(formatEvent('progress', { message: 'Searching…' })).toBe(
      'event: progress\ndata: {"message":"Searching…"}\n\n',
    );
  });

  it('keeps a line break inside the data on one line, so it cannot start another field', () => {
    const text = formatEvent('token', { text: 'a\nevent: done\n\nb' });

    expect(text.split('\n').filter((line) => line !== '')).toHaveLength(2);
    expect(text).toContain(String.raw`a\nevent: done`);
  });

  it('refuses a name that is not one of the known events', () => {
    expect(() => formatEvent('done\nevent: x', {})).toThrow(AppError);
    expect(() => formatEvent('other', {})).toThrow('Unknown event: other');
  });
});

describe('openEventStream', () => {
  it('starts the response as an event stream that is never cached, with the extra headers', () => {
    const response = fakeResponse();

    openEventStream(response, { 'X-Test': 'yes' });

    expect(response.status).toBe(200);
    expect(response.headers).toMatchObject({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Test': 'yes',
    });
    expect(response.flushHeaders).toHaveBeenCalledOnce();
  });

  it('does not let an extra header replace the ones a stream needs', () => {
    const response = fakeResponse();

    openEventStream(response, { 'Content-Type': 'text/html', 'Cache-Control': 'public' });

    expect(response.headers['Content-Type']).toBe('text/event-stream; charset=utf-8');
    expect(response.headers['Cache-Control']).toBe('no-store');
  });

  it('writes events in order', () => {
    const response = fakeResponse();
    const stream = openEventStream(response);

    expect(stream.send('progress', { message: 'a' })).toBe(true);
    expect(stream.send('token', { text: 'b' })).toBe(true);

    expect(response.chunks).toEqual([
      'event: progress\ndata: {"message":"a"}\n\n',
      'event: token\ndata: {"text":"b"}\n\n',
    ]);
  });

  it('ends the stream with the done event, once', () => {
    const response = fakeResponse();
    const stream = openEventStream(response);

    expect(stream.finish('done', { answerId: '1' })).toBe(true);
    expect(stream.finish('error', { message: 'late' })).toBe(false);

    expect(response.chunks).toEqual(['event: done\ndata: {"answerId":"1"}\n\n']);
    expect(response.end).toHaveBeenCalledOnce();
  });

  it('ends the stream with the error event when that comes first', () => {
    const response = fakeResponse();
    const stream = openEventStream(response);

    stream.finish('error', { message: 'broke' });
    stream.finish('done', {});

    expect(response.chunks).toHaveLength(1);
    expect(response.chunks[0]).toContain('event: error');
  });

  it('refuses to end a stream with an event that is not done or error', () => {
    const stream = openEventStream(fakeResponse());

    expect(() => stream.finish('token', {})).toThrow('Not an event that ends a stream: token');
  });

  it('writes nothing after the stream has finished', () => {
    const response = fakeResponse();
    const stream = openEventStream(response);

    stream.finish('done', {});

    expect(stream.send('progress', {})).toBe(false);
    expect(stream.isOpen()).toBe(false);
    expect(response.chunks).toHaveLength(1);
  });

  it('is open until it finishes', () => {
    const stream = openEventStream(fakeResponse());

    expect(stream.isOpen()).toBe(true);
  });

  it('writes nothing once the client has gone, and says the client went', () => {
    const response = fakeResponse();
    const stream = openEventStream(response);
    const gone = vi.fn();
    stream.onDisconnect(gone);

    response.emitClose();

    expect(gone).toHaveBeenCalledOnce();
    expect(stream.isOpen()).toBe(false);
    expect(stream.send('token', {})).toBe(false);
    expect(stream.finish('done', {})).toBe(false);
    expect(response.chunks).toEqual([]);
    expect(response.end).not.toHaveBeenCalled();
  });

  it('does not report a disconnect for a stream that finished normally', () => {
    const response = fakeResponse();
    const stream = openEventStream(response);
    const gone = vi.fn();
    stream.onDisconnect(gone);

    stream.finish('done', {});
    response.emitClose();

    expect(gone).not.toHaveBeenCalled();
  });

  it('reports a disconnect once even if the close arrives twice', () => {
    const response = fakeResponse();
    const stream = openEventStream(response);
    const gone = vi.fn();
    stream.onDisconnect(gone);

    response.emitClose();
    response.emitClose();

    expect(gone).toHaveBeenCalledOnce();
  });
});
