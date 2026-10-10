// @ts-check
import { describe, expect, it } from 'vitest';
import { createToolCallLog, summarizeArguments } from '../../src/answer/toolCalls.js';

describe('summarizeArguments', () => {
  it.each([undefined, null, 'text', 42, true, ['a', 'b']])('returns nothing for %j', (args) => {
    expect(summarizeArguments(args)).toBe('');
  });

  it('shows each argument as name=value', () => {
    expect(summarizeArguments({ owner: 'acme', repo: 'app', path: 'src/index.js' })).toBe(
      'owner=acme, repo=app, path=src/index.js',
    );
  });

  it('shows numbers, booleans and nested values as compact JSON', () => {
    expect(summarizeArguments({ limit: 10, draft: false, tags: ['a', 'b'], where: { x: 1 } })).toBe(
      'limit=10, draft=false, tags=["a","b"], where={"x":1}',
    );
  });

  it.each([
    'token',
    'apiToken',
    'githubToken',
    'Authorization',
    'password',
    'client_secret',
    'credentials',
  ])('leaves out the secret-looking argument %s', (name) => {
    expect(summarizeArguments({ owner: 'acme', [name]: 'hunter2' })).toBe('owner=acme');
  });

  it('collapses line breaks and runs of spaces into single spaces', () => {
    expect(summarizeArguments({ cql: 'space = ENG\n\n   AND text ~ "x"' })).toBe(
      'cql=space = ENG AND text ~ "x"',
    );
  });

  it('shortens a long value, marking the cut, so file bodies are not shown', () => {
    const summary = summarizeArguments({ content: 'x'.repeat(500) });

    expect(summary).toBe(`content=${'x'.repeat(59)}…`);
  });

  it('shortens the whole summary when there are many arguments', () => {
    const args = Object.fromEntries(
      Array.from({ length: 12 }, (_, index) => [`argument${index}`, 'value'.repeat(8)]),
    );

    const summary = summarizeArguments(args);

    expect(summary).toHaveLength(140);
    expect(summary.endsWith('…')).toBe(true);
  });

  it('shows an undefined value as empty rather than failing', () => {
    expect(summarizeArguments({ ref: undefined })).toBe('ref=');
  });
});

describe('createToolCallLog', () => {
  /**
   * Builds a log with a clock the test controls.
   * @returns {{ log: ReturnType<typeof createToolCallLog>, setTime: (ms: number) => void }} The log and clock control.
   */
  function setup() {
    let time = 0;
    return { log: createToolCallLog({ now: () => time }), setTime: (ms) => (time = ms) };
  }

  const start = {
    toolCallId: 'call-1',
    toolName: 'github_repos-get_file_contents',
    mcpServerName: 'github_repos',
    mcpToolName: 'get_file_contents',
    arguments: { owner: 'acme', repo: 'app' },
  };

  it('records the server, bare tool name and argument summary when a call starts', () => {
    const { log } = setup();

    log.start(start);

    expect(log.list()).toEqual([
      {
        server: 'github_repos',
        tool: 'get_file_contents',
        summary: 'owner=acme, repo=app',
        durationMs: undefined,
        success: undefined,
      },
    ]);
  });

  it('records how long a call took and whether it worked when it completes', () => {
    const { log, setTime } = setup();

    setTime(100);
    log.start(start);
    setTime(340);
    log.complete({ toolCallId: 'call-1', success: true });

    expect(log.list()[0]).toMatchObject({ durationMs: 240, success: true });
  });

  it('records a failed call as unsuccessful', () => {
    const { log } = setup();

    log.start(start);
    log.complete({ toolCallId: 'call-1', success: false });

    expect(log.list()[0]).toMatchObject({ success: false });
  });

  it('matches each completion to its own call when calls overlap', () => {
    const { log, setTime } = setup();

    setTime(0);
    log.start({ ...start, toolCallId: 'a' });
    setTime(10);
    log.start({ ...start, toolCallId: 'b', mcpToolName: 'list_commits' });
    setTime(30);
    log.complete({ toolCallId: 'b', success: true });
    setTime(50);
    log.complete({ toolCallId: 'a', success: true });

    expect(log.list().map(({ tool, durationMs }) => [tool, durationMs])).toEqual([
      ['get_file_contents', 50],
      ['list_commits', 20],
    ]);
  });

  it('lists calls in the order they started, including ones that never finished', () => {
    const { log } = setup();

    log.start({ ...start, toolCallId: 'a' });
    log.start({ ...start, toolCallId: 'b', mcpToolName: 'list_commits' });
    log.complete({ toolCallId: 'b', success: true });

    expect(log.list().map((call) => call.tool)).toEqual(['get_file_contents', 'list_commits']);
    expect(log.list()[0].durationMs).toBeUndefined();
  });

  it('falls back to the runtime tool name and an unknown server when they are not given', () => {
    const { log } = setup();

    log.start({ toolCallId: 'x', toolName: 'bash', arguments: { command: 'ls' } });

    expect(log.list()[0]).toMatchObject({ server: 'unknown', tool: 'bash', summary: 'command=ls' });
  });

  it('ignores the completion of a call it never saw start', () => {
    const { log } = setup();

    log.complete({ toolCallId: 'missing', success: true });

    expect(log.list()).toEqual([]);
  });

  it('returns copies, so changing the list cannot change the log', () => {
    const { log } = setup();
    log.start(start);

    log.list()[0].tool = 'changed';
    log.list().pop();

    expect(log.list()).toHaveLength(1);
    expect(log.list()[0].tool).toBe('get_file_contents');
  });
});
