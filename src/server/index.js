// @ts-check
import { fileURLToPath } from 'node:url';
import { askQuestion } from '../answer/index.js';
import { loadConfig, loadEnvFileIfPresent, redactConfig } from '../config/index.js';
import { createCopilotClient, ensureAuthenticated } from '../copilot/index.js';
import { AppError, ConfigError } from '../errors/index.js';
import { createLogger } from '../logger/index.js';
import { loadRoles } from '../roles/index.js';
import { createAnswerMemory } from './answers.js';
import { buildApp } from './app.js';
import { appendFeedback } from './feedbackStore.js';
import { listStaticFiles } from './static.js';

const APP_NAME = 'role-aware-assistant';
const EXIT_FAILURE = 1;
const SCHEME = 'http:';
const ADDRESS_IN_USE = 'EADDRINUSE';
const STOP_SIGNALS = ['SIGINT', 'SIGTERM'];

/** The page's files and the feedback folder, found from this file so the folder it is run from does not matter. */
const PUBLIC_DIRECTORY = fileURLToPath(new URL('../../public', import.meta.url));
const DATA_DIRECTORY = fileURLToPath(new URL('../../data', import.meta.url));

/**
 * Writes a failure the way the commands do: one message on stderr and a failing exit code.
 * @param {unknown} error - What went wrong.
 */
function reportFailure(error) {
  if (error instanceof ConfigError) {
    process.stderr.write(`${error.message}\nSee .env.example for every variable.\n`);
  } else if (error instanceof AppError) {
    const cause = error.cause instanceof Error ? `\n  caused by: ${error.cause.message}` : '';
    process.stderr.write(`${error.message}${cause}\n`);
  } else if (error instanceof Error && 'code' in error && error.code === ADDRESS_IN_USE) {
    process.stderr.write(
      'That port is already in use. Set PORT to another one, or stop the other server.\n',
    );
  } else {
    throw error;
  }
  process.exitCode = EXIT_FAILURE;
}

/**
 * Starts the web server: reads config and the roles, starts Copilot and checks it is signed in,
 * then listens. Stopping it (Ctrl+C) closes the server, which stops any running question, and then
 * the Copilot client.
 */
async function main() {
  loadEnvFileIfPresent();
  const config = loadConfig();
  const logger = createLogger({ level: config.logLevel, name: APP_NAME });
  logger.info({ config: redactConfig(config) }, 'startup');
  const roles = await loadRoles();
  const handle = await createCopilotClient(config, { logger });
  try {
    await ensureAuthenticated(handle.client);
    const app = buildApp({
      config,
      roles,
      ask: (input) =>
        askQuestion(input, {
          client: handle.client,
          workingDirectory: handle.workingDirectory,
          config,
          logger,
        }),
      answers: createAnswerMemory(),
      saveFeedback: (answer, input) => appendFeedback(answer, input, { dir: DATA_DIRECTORY }),
      staticFiles: await listStaticFiles(PUBLIC_DIRECTORY),
      logger,
    });
    const stop = async () => {
      await app.close();
      await handle.stop();
    };
    for (const signal of STOP_SIGNALS) {
      process.once(signal, () => {
        logger.info({ signal }, 'stopping');
        stop().catch((error) => logger.error({ err: error }, 'could not stop cleanly'));
      });
    }
    // Node wants ::1, not the bracketed form that a Host header uses.
    await app.listen({ host: config.server.host.replace(/^\[|\]$/g, ''), port: config.port });
    process.stdout.write(`Open ${SCHEME}//${config.server.host}:${config.port}\n`);
  } catch (error) {
    await handle.stop();
    throw error;
  }
}

main().catch(reportFailure);
