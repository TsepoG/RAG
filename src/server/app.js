// @ts-check
import Fastify from 'fastify';
import { createAnswerHtmlRenderer } from '../render/index.js';
import { createGuardHook, createGuardPolicy } from './guards.js';
import { createSecurityHeadersHook } from './headers.js';
import { registerAskRoute } from './routes/ask.js';
import { registerFeedbackRoute } from './routes/feedback.js';
import { registerInfoRoutes } from './routes/info.js';
import { createStaticHandler } from './static.js';

/** The biggest request body accepted. A question is at most 2000 characters. */
export const BODY_LIMIT_BYTES = 16 * 1024;

/** Where a failure of our own is reported from. */
const SERVER_ERROR = 500;

/** The host name of GitHub, whose links may appear in an answer. */
const GITHUB_HOST = 'github.com';

/**
 * Everything the app is built from, so a test can use fakes for all of it.
 * @typedef {object} AppDeps
 * @property {import('../config/index.js').AppConfig} config - Validated config.
 * @property {ReadonlyMap<string, import('../roles/index.js').Role>} roles - The loaded roles.
 * @property {import('./routes/ask.js').AskRouteDeps['ask']} ask - Answers a question.
 * @property {import('./answers.js').AnswerMemory} answers - The answers given so far.
 * @property {import('./routes/feedback.js').FeedbackRouteDeps['save']} saveFeedback - Stores feedback.
 * @property {ReadonlyMap<string, import('./static.js').StaticFile>} staticFiles - Files to serve.
 * @property {import('../logger/index.js').Logger} logger - Where to log.
 */

/**
 * Builds the web app: the guards and security headers, the API and the page's files. It does not
 * listen; the caller does.
 * @param {AppDeps} deps - Dependencies.
 * @returns {import('fastify').FastifyInstance} The app, ready to listen or to `inject` into.
 */
export function buildApp({ config, roles, ask, answers, saveFeedback, staticFiles, logger }) {
  // Fastify's defaults convert types and drop unknown fields; here a wrong request is refused.
  const app = Fastify({
    logger: false,
    bodyLimit: BODY_LIMIT_BYTES,
    ajv: { customOptions: { coerceTypes: false, removeAdditional: false } },
  });
  const policy = createGuardPolicy({ ...config.server, port: config.port });
  const renderHtml = createAnswerHtmlRenderer({
    allowedHosts: [new URL(config.atlassian.siteUrl).hostname, GITHUB_HOST],
  });

  app.addHook('onRequest', createSecurityHeadersHook());
  app.addHook('onRequest', createGuardHook({ policy, logger }));
  app.setErrorHandler((/** @type {import('fastify').FastifyError} */ error, _request, reply) => {
    const status = error.statusCode ?? SERVER_ERROR;
    if (status >= SERVER_ERROR) {
      logger.error({ err: error }, 'a request failed');
      return reply.code(SERVER_ERROR).send({ message: 'Something went wrong. Please try again.' });
    }
    return reply.code(status).send({ message: error.message });
  });

  registerInfoRoutes(app, { roles });
  registerAskRoute(app, { roles, ask, answers, renderHtml, logger });
  registerFeedbackRoute(app, { answers, save: saveFeedback });
  app.get('/*', createStaticHandler(staticFiles));
  return app;
}
