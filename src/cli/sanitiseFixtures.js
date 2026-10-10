// @ts-check
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { loadConfig, loadEnvFileIfPresent } from '../config/index.js';
import { AppError } from '../errors/index.js';
import { createSanitiser, findForbiddenContent } from '../fixtures/index.js';
import { RAW_DIRECTORY } from '../mcp/index.js';
import { describeError, EXIT_FAILURE } from './shared.js';

const OUTPUT_DIRECTORY = 'test/fixtures/mcp';
const JSON_INDENT = 2;
const JSON_EXTENSION = '.json';

/**
 * Lists the real names a fixture must not contain: the site, owners, repositories and spaces.
 * @param {import('../config/index.js').AppConfig} config - Validated config.
 * @returns {string[]} The names.
 */
function realNames({ atlassian, github }) {
  const siteHost = new URL(atlassian.siteUrl).host;
  const parts = github.repos.flatMap((repo) => repo.split('/'));
  return [siteHost, siteHost.split('.')[0], ...parts, ...atlassian.spaceKeys];
}

/**
 * Sanitises every raw sample, in file order so placeholder numbering is the same on every run.
 * @param {import('../config/index.js').AppConfig} config - Validated config.
 * @returns {Promise<Array<{ file: string, text: string }>>} The fixtures as text, by file name.
 * @throws {AppError} When there are no raw samples.
 */
async function sanitiseAll(config) {
  const sanitiser = createSanitiser({
    siteHost: new URL(config.atlassian.siteUrl).host,
    repos: config.github.repos,
    spaceKeys: config.atlassian.spaceKeys,
  });
  const files = (await readdir(RAW_DIRECTORY))
    .filter((file) => file.endsWith(JSON_EXTENSION))
    .sort((a, b) => a.localeCompare(b));
  if (files.length === 0) {
    throw new AppError(`No raw samples in ${RAW_DIRECTORY}. Run npm run mcp:sample first.`);
  }
  const raws = await Promise.all(
    files.map(async (file) => JSON.parse(await readFile(`${RAW_DIRECTORY}/${file}`, 'utf8'))),
  );
  const outputs = files.map((file, index) => ({
    file,
    text: JSON.stringify(sanitiser.sanitise(raws[index]), undefined, JSON_INDENT),
  }));
  const names = realNames(config);
  const replaced = sanitiser.replacedStrings();
  const problems = outputs.flatMap(({ file, text }) =>
    findForbiddenContent(text, { names, replaced }).map((kind) => `${file}: contains ${kind}`),
  );
  if (problems.length > 0) {
    throw new AppError(`Sanitising failed, nothing was written:\n  ${problems.join('\n  ')}`);
  }
  return outputs;
}

/**
 * Turns every raw sample into a sanitised fixture. Nothing is written unless every fixture passes
 * the leak check, and a failure names the file and the kind of leak, never the value.
 */
async function main() {
  try {
    loadEnvFileIfPresent();
    const outputs = await sanitiseAll(loadConfig());
    await mkdir(OUTPUT_DIRECTORY, { recursive: true });
    await Promise.all(
      outputs.map(({ file, text }) => writeFile(`${OUTPUT_DIRECTORY}/${file}`, `${text}\n`)),
    );
    process.stdout.write(`Wrote ${outputs.length} fixtures to ${OUTPUT_DIRECTORY}\n`);
    process.stdout.write('Review them before committing: no real content may be committed.\n');
  } catch (error) {
    if (!(error instanceof AppError)) {
      throw error;
    }
    process.stderr.write(`${describeError(error)}\n`);
    process.exitCode = EXIT_FAILURE;
  }
}

await main();
