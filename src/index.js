// @ts-check
import { loadConfig, loadEnvFileIfPresent, redactConfig } from './config/index.js';
import { ConfigError } from './errors/index.js';
import { createLogger } from './logger/index.js';

const APP_NAME = 'role-aware-assistant';
const CONFIG_ERROR_EXIT_CODE = 1;

/**
 * Starts the app: reads config, then logs one redacted startup line.
 * A bad config is reported on stderr and sets a non-zero exit code.
 */
function main() {
  loadEnvFileIfPresent();
  try {
    const config = loadConfig();
    const logger = createLogger({ level: config.logLevel, name: APP_NAME });
    logger.info({ config: redactConfig(config) }, 'startup');
  } catch (error) {
    if (!(error instanceof ConfigError)) {
      throw error;
    }
    // No logger yet: its level comes from the config that just failed to load.
    process.stderr.write(`${error.message}\nSee .env.example for every variable.\n`);
    process.exitCode = CONFIG_ERROR_EXIT_CODE;
  }
}

main();
