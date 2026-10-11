// @ts-check
import { describe, expect, it, vi } from 'vitest';
import { ApiError, askStream, fetchRoles, sendFeedback } from '../../../public/js/api.js';

/**
 * A response whose body arrives in the given pieces.
 * @param {string[]} pieces - The body, piece by piece.
 * @param {number} [status] - HTTP status.
 * @returns {Response} The response.
 */
function streamResponse(pieces, status = 200) {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const piece of pieces) {
        controller.enqueue(encoder.encode(piece));
      }
      controller.close();
    },
  });
  return new Response(body, { status, headers: { 'Content-Type': 'text/event-stream' } });
}

/**
 * A fake fetch that answers once.
 * @param {Response | Error} outcome - What to give back, or throw.
 * @returns {import('vitest').Mock & typeof fetch} The fake.
 */
function fakeFetch(outcome) {
  return /** @type {any} */ (
    vi.fn(async () => {
      if (outcome instanceof Error) {
        throw outcome;
      }
      return outcome;
    })
  );
}

const EVENTS = [
  'event: progress\ndata: {"message":"Searching…"}\n\n',
  'event: token\ndata: {"text":"Hi"}\n\n',
  'event: done\ndata: {"answerId":"a1"}\n\n',
];

describe('fetchRoles', () => {
  it('gets the roles from the API', async () => {
    const roles = [{ id: 'qa', displayName: 'QA', description: 'd', depth: 2 }];
    const fetchFunction = fakeFetch(Response.json(roles));

    expect(await fetchRoles(fetchFunction)).toEqual(roles);
    expect(fetchFunction).toHaveBeenCalledWith('/api/roles', expect.any(Object));
  });

  it('throws the server message when it refuses', async () => {
    const fetchFunction = fakeFetch(Response.json({ message: 'Not allowed.' }, { status: 403 }));

    await expect(fetchRoles(fetchFunction)).rejects.toMatchObject({
      name: 'ApiError',
      message: 'Not allowed.',
      status: 403,
    });
  });

  it('says the server could not be reached when the request fails', async () => {
    const failure = await fetchRoles(fakeFetch(new TypeError('failed'))).catch((error) => error);

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure.message).toContain('could not be reached');
    expect(failure.status).toBeUndefined();
  });

  it('uses the status text when the error body is not JSON', async () => {
    const response = new Response('<html>', { status: 502, statusText: 'Bad Gateway' });

    await expect(fetchRoles(fakeFetch(response))).rejects.toThrow('Bad Gateway');
  });

  it('uses the status text when the error body has no message', async () => {
    const response = Response.json({ error: 'x' }, { status: 500, statusText: 'Server Error' });

    await expect(fetchRoles(fakeFetch(response))).rejects.toThrow('Server Error');
  });

  it('uses a general message when there is neither a message nor a status text', async () => {
    const response = new Response('nope', { status: 500, statusText: '' });

    await expect(fetchRoles(fakeFetch(response))).rejects.toThrow('could not be reached');
  });

  it('uses the browser fetch when none is given', async () => {
    const real = vi.fn(async () => Response.json([]));
    vi.stubGlobal('fetch', real);

    await fetchRoles();

    expect(real).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});

describe('askStream', () => {
  it('posts the question as JSON and reports each event with its data parsed', async () => {
    const fetchFunction = fakeFetch(streamResponse(EVENTS));
    const seen = /** @type {any[]} */ ([]);

    await askStream({
      question: 'How?',
      role: 'qa',
      detailLevel: 'more',
      onEvent: (event) => seen.push(event),
      fetchFunction,
    });

    const [url, init] = fetchFunction.mock.calls[0];
    expect(url).toBe('/api/ask');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ question: 'How?', role: 'qa', detailLevel: 'more' });
    expect(seen).toEqual([
      { event: 'progress', data: { message: 'Searching…' } },
      { event: 'token', data: { text: 'Hi' } },
      { event: 'done', data: { answerId: 'a1' } },
    ]);
  });

  it('reads events split across pieces of the body, even in the middle of a character', async () => {
    const bytes = new TextEncoder().encode('event: token\ndata: {"text":"é…"}\n\n');
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(bytes.slice(0, 22));
        controller.enqueue(bytes.slice(22));
        controller.close();
      },
    });
    const seen = /** @type {any[]} */ ([]);

    await askStream({
      question: 'q',
      role: 'qa',
      detailLevel: 'default',
      onEvent: (event) => seen.push(event),
      fetchFunction: fakeFetch(new Response(body)),
    });

    expect(seen).toEqual([{ event: 'token', data: { text: 'é…' } }]);
  });

  it('passes the signal to fetch', async () => {
    const fetchFunction = fakeFetch(streamResponse([]));
    const controller = new AbortController();

    await askStream({
      question: 'q',
      role: 'qa',
      detailLevel: 'default',
      signal: controller.signal,
      onEvent: () => undefined,
      fetchFunction,
    });

    expect(fetchFunction.mock.calls[0][1].signal).toBe(controller.signal);
  });

  it.each([
    [429, 'Another question is being answered.'],
    [400, 'The request was not valid.'],
    [403, 'Not allowed.'],
  ])('throws the server message for a %i before any stream starts', async (status, message) => {
    const onEvent = vi.fn();
    const fetchFunction = fakeFetch(Response.json({ message }, { status }));

    const failure = await askStream({
      question: 'q',
      role: 'qa',
      detailLevel: 'default',
      onEvent,
      fetchFunction,
    }).catch((error) => error);

    expect(failure).toMatchObject({ message, status });
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('lets an abort through as an AbortError, not an ApiError', async () => {
    const abort = new DOMException('aborted', 'AbortError');

    const failure = await askStream({
      question: 'q',
      role: 'qa',
      detailLevel: 'default',
      onEvent: () => undefined,
      fetchFunction: fakeFetch(abort),
    }).catch((error) => error);

    expect(failure).toBe(abort);
  });

  it('says the server could not be reached when the request fails', async () => {
    await expect(
      askStream({
        question: 'q',
        role: 'qa',
        detailLevel: 'default',
        onEvent: () => undefined,
        fetchFunction: fakeFetch(new TypeError('failed')),
      }),
    ).rejects.toThrow('could not be reached');
  });

  it('throws when an event holds data that is not JSON', async () => {
    const failure = await askStream({
      question: 'q',
      role: 'qa',
      detailLevel: 'default',
      onEvent: () => undefined,
      fetchFunction: fakeFetch(streamResponse(['event: token\ndata: {broken\n\n'])),
    }).catch((error) => error);

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure.message).toContain('could not read');
  });

  it('throws when the response has no body', async () => {
    const response = new Response(null, { status: 200 });

    await expect(
      askStream({
        question: 'q',
        role: 'qa',
        detailLevel: 'default',
        onEvent: () => undefined,
        fetchFunction: fakeFetch(response),
      }),
    ).rejects.toThrow('no answer');
  });

  it('resolves, with no events, when the stream is empty', async () => {
    const onEvent = vi.fn();

    await askStream({
      question: 'q',
      role: 'qa',
      detailLevel: 'default',
      onEvent,
      fetchFunction: fakeFetch(streamResponse([])),
    });

    expect(onEvent).not.toHaveBeenCalled();
  });

  it('uses the browser fetch when none is given', async () => {
    const real = vi.fn(async () => streamResponse([]));
    vi.stubGlobal('fetch', real);

    await askStream({
      question: 'q',
      role: 'qa',
      detailLevel: 'default',
      onEvent: () => undefined,
    });

    expect(real).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});

describe('sendFeedback', () => {
  it('posts the feedback as JSON', async () => {
    const fetchFunction = fakeFetch(Response.json({ saved: true }));

    await sendFeedback(
      { answerId: 'a1', rating: 'down', comment: 'Wrong', wrongSourceKey: 'C1' },
      fetchFunction,
    );

    const [url, init] = fetchFunction.mock.calls[0];
    expect(url).toBe('/api/feedback');
    expect(JSON.parse(init.body)).toEqual({
      answerId: 'a1',
      rating: 'down',
      comment: 'Wrong',
      wrongSourceKey: 'C1',
    });
  });

  it('throws the server message when it is refused', async () => {
    const fetchFunction = fakeFetch(
      Response.json({ message: 'That answer is no longer remembered.' }, { status: 404 }),
    );

    await expect(sendFeedback({ answerId: 'x', rating: 'up' }, fetchFunction)).rejects.toThrow(
      'no longer remembered',
    );
  });

  it('uses the browser fetch when none is given', async () => {
    const real = vi.fn(async () => Response.json({ saved: true }));
    vi.stubGlobal('fetch', real);

    await sendFeedback({ answerId: 'a', rating: 'up' });

    expect(real).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});
