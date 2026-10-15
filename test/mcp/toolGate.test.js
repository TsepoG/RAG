// @ts-check
import { describe, expect, it } from 'vitest';
import { createToolGate, createTurnGate, TOOLS_LOCKED_REASON } from '../../src/mcp/index.js';

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

describe('createTurnGate', () => {
  it('starts open and locks like the gate of a single question', () => {
    const gate = createTurnGate();

    expect(gate.isLocked()).toBe(false);
    gate.lock();
    expect(gate.isLocked()).toBe(true);
  });

  it('opens again only when a new turn starts', () => {
    const gate = createTurnGate();
    gate.lock();

    gate.lock();
    expect(gate.isLocked()).toBe(true);
    gate.startTurn();

    expect(gate.isLocked()).toBe(false);
  });

  it('does not let a lock in one turn carry into the next, or a new turn undo a later lock', () => {
    const gate = createTurnGate();
    gate.lock();
    gate.startTurn();

    gate.lock();

    expect(gate.isLocked()).toBe(true);
  });

  it('offers a way to start a turn and nothing else to open it', () => {
    expect(Object.keys(createTurnGate()).sort()).toEqual(['isLocked', 'lock', 'startTurn']);
  });
});
