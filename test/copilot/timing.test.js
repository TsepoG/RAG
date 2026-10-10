// @ts-check
import { afterEach, describe, expect, it, vi } from 'vitest';
import { finishesWithin } from '../../src/copilot/timing.js';

describe('finishesWithin', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports true when the work finishes before the limit', async () => {
    await expect(finishesWithin(Promise.resolve('done'), 1000)).resolves.toBe(true);
  });

  it('reports false when the work is still running at the limit', async () => {
    vi.useFakeTimers();
    const outcome = finishesWithin(new Promise(() => undefined), 500);

    await vi.advanceTimersByTimeAsync(500);

    await expect(outcome).resolves.toBe(false);
  });

  it('waits the whole limit before giving up', async () => {
    vi.useFakeTimers();
    let settled = false;
    const outcome = finishesWithin(new Promise(() => undefined), 500).then((value) => {
      settled = true;
      return value;
    });

    await vi.advanceTimersByTimeAsync(499);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    await expect(outcome).resolves.toBe(false);
  });

  it('passes on a failure of the work', async () => {
    await expect(finishesWithin(Promise.reject(new Error('boom')), 1000)).rejects.toThrow('boom');
  });

  it('leaves no timer behind when the work finishes first', async () => {
    vi.useFakeTimers();

    await finishesWithin(Promise.resolve(), 60_000);

    expect(vi.getTimerCount()).toBe(0);
  });
});
