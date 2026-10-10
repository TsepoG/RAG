// @ts-check
import { askQuestion } from '../answer/index.js';
import { AskTimeoutError, AppError } from '../errors/index.js';
import { describeError, EXIT_FAILURE, EXIT_TIMEOUT, loadSettings, withCopilot } from './shared.js';

const USAGE = 'Usage: npm run ask -- "<question>"\n';
const MS_PER_SECOND = 1000;

/**
 * Formats one tool call as a line of the "Tools used" list.
 * @param {import('../answer/toolCalls.js').ToolCallRecord} call - The call.
 * @returns {string} The line.
 */
function formatToolCall({ server, tool, summary, durationMs, success }) {
  const took = durationMs === undefined ? 'no result' : `${durationMs} ms`;
  const failed = success === false ? ', failed' : '';
  const args = summary === '' ? '' : ` (${summary})`;
  return `  - ${server} / ${tool}${args} [${took}${failed}]\n`;
}

/**
 * Prints the tools used and the footer after the streamed answer.
 * @param {import('../answer/askQuestion.js').AskResult} result - The outcome of the question.
 */
function printFooter({ toolCalls, model, durationMs }) {
  process.stdout.write('\n\nTools used:\n');
  process.stdout.write(
    toolCalls.length === 0 ? '  (none)\n' : toolCalls.map(formatToolCall).join(''),
  );
  const seconds = (durationMs / MS_PER_SECOND).toFixed(1);
  process.stdout.write(`\nModel: ${model ?? 'unknown'} | ${seconds}s\n`);
}

/**
 * Asks the question given on the command line and streams the answer to stdout.
 */
async function main() {
  const question = process.argv.slice(2).join(' ').trim();
  if (question === '') {
    process.stderr.write(USAGE);
    process.exitCode = EXIT_FAILURE;
    return;
  }
  try {
    const settings = loadSettings();
    const result = await withCopilot(settings, ({ client, workingDirectory }) =>
      askQuestion(
        { question, onDelta: (text) => process.stdout.write(text) },
        { client, workingDirectory, ...settings },
      ),
    );
    printFooter(result);
  } catch (error) {
    if (!(error instanceof AppError)) {
      throw error;
    }
    process.stderr.write(`\n${describeError(error)}\n`);
    process.exitCode = error instanceof AskTimeoutError ? EXIT_TIMEOUT : EXIT_FAILURE;
  }
}

await main();
