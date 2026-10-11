// @ts-check
import { describe, expect, it } from 'vitest';
import { createToolGate, TOOLS_LOCKED_REASON } from '../../src/mcp/index.js';

describe('createToolGate', () => {
  it('starts open', () => {
    expect(createToolGate().isLocked()).toBe(false);
  });

  it('is locked once locked, and stays locked however often it is locked', () => {
    const gate = createToolGate();

    gate.lock();
    gate.lock();

    expect(gate.isLocked()).toBe(true);
  });

  it('has no way to open again', () => {
    expect(Object.keys(createToolGate()).sort()).toEqual(['isLocked', 'lock']);
  });

  it("keeps one question's gate apart from another's", () => {
    const first = createToolGate();
    const second = createToolGate();

    first.lock();

    expect(second.isLocked()).toBe(false);
  });

  it('tells the model why in plain words', () => {
    expect(TOOLS_LOCKED_REASON).toBe('Tools are not available while rewriting.');
  });
});
