// @ts-check
export {
  AUTH_HELP,
  buildClientOptions,
  createCopilotClient,
  ensureAuthenticated,
} from './client.js';
export { buildSessionConfig, CLIENT_NAME, EXCLUDED_TOOLS } from './session.js';
export { buildBaseMessage, buildRoleBlock, buildSystemMessage } from './systemMessage.js';
export { finishesWithin } from './timing.js';
