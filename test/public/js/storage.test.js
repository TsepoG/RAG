// @vitest-environment happy-dom
// @ts-check
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearConversationId,
  loadConversationId,
  loadRole,
  saveConversationId,
  saveRole,
} from '../../../public/js/storage.js';

const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

afterEach(() => {
  if (original !== undefined) {
    Object.defineProperty(globalThis, 'localStorage', original);
  }
  vi.unstubAllGlobals();
  globalThis.window.localStorage.clear();
});

/**
 * Storage whose every use throws, as when site data is blocked.
 * @returns {Pick<Storage, 'getItem' | 'setItem'>} The storage.
 */
function blocked() {
  return {
    getItem: () => {
      throw new DOMException('blocked', 'SecurityError');
    },
    setItem: () => {
      throw new DOMException('full', 'QuotaExceededError');
    },
  };
}

describe('saveRole and loadRole', () => {
  it('remember the role across a reload', () => {
    expect(saveRole('product_owner')).toBe(true);

    expect(loadRole()).toBe('product_owner');
  });

  it('give undefined when nothing was saved', () => {
    expect(loadRole()).toBeUndefined();
  });

  it('keep the last role saved', () => {
    saveRole('qa');
    saveRole('developer');

    expect(loadRole()).toBe('developer');
  });

  it('use the storage they are given', () => {
    const storage = { getItem: vi.fn(() => 'qa'), setItem: vi.fn() };

    expect(saveRole('qa', storage)).toBe(true);
    expect(loadRole(storage)).toBe('qa');
    expect(storage.setItem).toHaveBeenCalledWith(expect.any(String), 'qa');
  });

  it('give undefined, and not an error, when reading is blocked', () => {
    expect(loadRole(blocked())).toBeUndefined();
  });

  it('give false, and not an error, when writing is blocked or full', () => {
    expect(saveRole('qa', blocked())).toBe(false);
  });

  it('give undefined and false when the browser has no storage', () => {
    vi.stubGlobal('localStorage', undefined);

    expect(loadRole()).toBeUndefined();
    expect(saveRole('qa')).toBe(false);
  });

  it('cope with the browser throwing when storage is touched at all', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get: () => {
        throw new DOMException('denied', 'SecurityError');
      },
    });

    expect(loadRole()).toBeUndefined();
    expect(saveRole('qa')).toBe(false);
  });
});

describe('the open conversation', () => {
  const originalSession = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');

  afterEach(() => {
    if (originalSession !== undefined) {
      Object.defineProperty(globalThis, 'sessionStorage', originalSession);
    }
    globalThis.window.sessionStorage.clear();
  });

  /**
   * Storage whose every use throws.
   * @returns {import('../../../public/js/storage.js').ConversationStorage} The storage.
   */
  function blockedTab() {
    const fail = () => {
      throw new DOMException('blocked', 'SecurityError');
    };
    return { getItem: fail, setItem: fail, removeItem: fail };
  }

  it('is remembered for the tab, and forgotten when asked', () => {
    expect(loadConversationId()).toBeUndefined();

    expect(saveConversationId('c-1')).toBe(true);
    expect(loadConversationId()).toBe('c-1');
    expect(globalThis.window.localStorage.getItem('role-aware-assistant.conversation')).toBeNull();

    expect(clearConversationId()).toBe(true);
    expect(loadConversationId()).toBeUndefined();
  });

  it('gives nothing, and no error, when the storage is blocked', () => {
    const storage = blockedTab();

    expect(loadConversationId(storage)).toBeUndefined();
    expect(saveConversationId('c-1', storage)).toBe(false);
    expect(clearConversationId(storage)).toBe(false);
  });

  it('gives undefined and false when the browser has no tab storage', () => {
    vi.stubGlobal('sessionStorage', undefined);

    expect(loadConversationId()).toBeUndefined();
    expect(saveConversationId('c-1')).toBe(false);
    expect(clearConversationId()).toBe(false);
  });

  it('copes with the browser throwing when tab storage is touched at all', () => {
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      get: () => {
        throw new DOMException('denied', 'SecurityError');
      },
    });

    expect(loadConversationId()).toBeUndefined();
    expect(saveConversationId('c-1')).toBe(false);
    expect(clearConversationId()).toBe(false);
  });
});
