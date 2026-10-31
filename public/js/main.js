// @ts-check
import {
  ApiError,
  checkGithub,
  createConversation,
  deleteConversation,
  fetchConversation,
  fetchAuthStatus,
  fetchRoles,
  recheckAnswer,
  sendFeedback,
  sendMessage,
  signOut,
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

// The thumbs up and down are hidden for now, at the owner's request. The server still accepts
// feedback, so setting this back to true is all it takes to offer them again.
const SHOW_FEEDBACK = false;

const chat = createChat({
  refs: findRefs(),
  api: {
    fetchRoles,
    fetchAuthStatus,
    signOut,
    checkGithub,
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
  showFeedback: SHOW_FEEDBACK,
});

// A failure to start is shown on the page by the chat itself; only an unexpected one reaches here.
chat.start().catch((error) => {
  if (!(error instanceof ApiError)) {
    throw error;
  }
});
setInterval(chat.tick, AGE_REFRESH_MS);
