// @ts-check

/** The key the chosen role is remembered under. */
const ROLE_KEY = 'role-aware-assistant.role';

/**
 * The part of `localStorage` this module uses.
 * @typedef {Pick<Storage, 'getItem' | 'setItem'>} RoleStorage
 */

/**
 * Finds the browser's storage. Reading it can throw, for example when site data is blocked.
 * @returns {RoleStorage | undefined} The storage, or undefined when it is not available.
 */
function browserStorage() {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/**
 * Reads the role chosen last time. The page works without it, so any failure gives undefined.
 * @param {RoleStorage | undefined} [storage] - Where to read; defaults to the browser's.
 * @returns {string | undefined} The role id, or undefined when none was saved or storage failed.
 */
export function loadRole(storage = browserStorage()) {
  try {
    return storage?.getItem(ROLE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Remembers the chosen role for the next visit.
 * @param {string} roleId - The role id.
 * @param {RoleStorage | undefined} [storage] - Where to write; defaults to the browser's.
 * @returns {boolean} Whether it was saved; false when storage is blocked or full.
 */
export function saveRole(roleId, storage = browserStorage()) {
  try {
    storage?.setItem(ROLE_KEY, roleId);
    return storage !== undefined;
  } catch {
    return false;
  }
}

/** The key the open conversation is remembered under, for the length of the tab. */
const CONVERSATION_KEY = 'role-aware-assistant.conversation';

/**
 * The part of `sessionStorage` this module uses.
 * @typedef {Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>} ConversationStorage
 */

/**
 * Finds the tab's storage. Reading it can throw, for example when site data is blocked.
 * @returns {ConversationStorage | undefined} The storage, or undefined when it is not available.
 */
function tabStorage() {
  try {
    return globalThis.sessionStorage;
  } catch {
    return undefined;
  }
}

/**
 * Reads the conversation this tab had open. The page works without it, so any failure gives undefined.
 * @param {ConversationStorage | undefined} [storage] - Where to read; defaults to the tab's.
 * @returns {string | undefined} The conversation id, or undefined when none was saved or storage failed.
 */
export function loadConversationId(storage = tabStorage()) {
  try {
    return storage?.getItem(CONVERSATION_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Remembers the open conversation, so a reload of the tab can show it again.
 * @param {string} conversationId - The conversation id.
 * @param {ConversationStorage | undefined} [storage] - Where to write; defaults to the tab's.
 * @returns {boolean} Whether it was saved; false when storage is blocked or full.
 */
export function saveConversationId(conversationId, storage = tabStorage()) {
  try {
    storage?.setItem(CONVERSATION_KEY, conversationId);
    return storage !== undefined;
  } catch {
    return false;
  }
}

/**
 * Forgets the open conversation.
 * @param {ConversationStorage | undefined} [storage] - Where to remove it; defaults to the tab's.
 * @returns {boolean} Whether it was removed; false when storage is blocked.
 */
export function clearConversationId(storage = tabStorage()) {
  try {
    storage?.removeItem(CONVERSATION_KEY);
    return storage !== undefined;
  } catch {
    return false;
  }
}
