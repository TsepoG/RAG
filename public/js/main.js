// @ts-check
import {
  ApiError,
  createConversation,
  deleteConversation,
  fetchConversation,
  fetchRoles,
  recheckAnswer,
  sendFeedback,
  sendMessage,
} from './api.js';
import { AGE_REFRESH_MS, createChat } from './chat.js';
import { findRefs } from './refs.js';
import {
  clearConversationId,
  loadConversationId,
  loadRole,
  saveConversationId,
  saveRole,
} from './storage.js';

// Wiring only: this file connects the tested page modules to the browser and the network, and holds
// no logic of its own that is worth a test. It is checked by hand and by the live test.

const chat = createChat({
  refs: findRefs(),
  api: {
    fetchRoles,
    createConversation,
    sendMessage,
    fetchConversation,
    deleteConversation,
    recheckAnswer,
    sendFeedback,
  },
  storage: {
    loadRole: () => loadRole(),
    saveRole: (roleId) => saveRole(roleId),
    loadConversationId: () => loadConversationId(),
    saveConversationId: (conversationId) => saveConversationId(conversationId),
    clearConversationId: () => clearConversationId(),
  },
  clock: { now: () => Date.now() },
});

// A failure to start is shown on the page by the chat itself; only an unexpected one reaches here.
chat.start().catch((error) => {
  if (!(error instanceof ApiError)) {
    throw error;
  }
});
setInterval(chat.tick, AGE_REFRESH_MS);
