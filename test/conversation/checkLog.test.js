// @ts-check
import { describe, expect, it } from 'vitest';
import { createCheckLog } from '../../src/conversation/index.js';

describe('createCheckLog', () => {
  it('has nothing for a key that was never checked', () => {
    const log = createCheckLog();

    expect(log.get('C1')).toBeUndefined();
    expect(log.lastCheckedAt('C1')).toBeUndefined();
    expect(log.lastManualAt()).toBeUndefined();
  });

  it('keeps the latest result for each key and when it was found', () => {
    const log = createCheckLog();

    log.record([
      { key: 'C1', status: 'unchanged', checkedAt: 1000 },
      { key: 'G1', status: 'unavailable', checkedAt: 1000 },
    ]);
    log.record([{ key: 'C1', status: 'changed', checkedAt: 2000 }]);

    expect(log.get('C1')).toEqual({ status: 'changed', checkedAt: 2000 });
    expect(log.get('G1')).toEqual({ status: 'unavailable', checkedAt: 1000 });
    expect(log.lastCheckedAt('C1')).toBe(2000);
  });

  it('keeps a result frozen, so a page cannot change it', () => {
    const log = createCheckLog();
    log.record([{ key: 'C1', status: 'unchanged', checkedAt: 1000 }]);

    expect(Object.isFrozen(log.get('C1'))).toBe(true);
  });

  it('remembers when the reader last asked for a check by hand', () => {
    const log = createCheckLog();

    log.markManual(5000);
    log.markManual(9000);

    expect(log.lastManualAt()).toBe(9000);
  });
});
