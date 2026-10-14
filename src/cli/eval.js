// @ts-check
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { askQuestion } from '../answer/index.js';
import { listSecrets } from '../config/index.js';
import {
  createConversationRunner,
  createConversationStore,
  createSessionCloser,
} from '../conversation/index.js';
import { AppError, EvalError } from '../errors/index.js';
import {
  assertRunnable,
  collectRunInfo,
  createConversationPath,
  createRequestGuard,
  estimateRequests,
  EVAL_FILE,
  formatResults,
  formatSummary,
  loadCases,
  modelsSeen,
  parseEvalArguments,
  planRun,
  RESULTS_DIRECTORY,
  RESULTS_FILE,
  runEval,
  runFolderName,
  selectCases,
  summarise,
  SUMMARY_FILE,
} from '../eval/index.js';
import { loadRoles } from '../roles/index.js';
import { describeError, EXIT_FAILURE, loadSettings, withCopilot } from './shared.js';

const run = promisify(execFile);

/**
 * Asks git for the commit the code is at and whether there are uncommitted changes.
 * @returns {Promise<{ commit: string, dirty: boolean }>} The commit and whether the tree is dirty.
 */
async function gitState() {
  const { stdout: commit } = await run('git', ['rev-parse', '--short=12', 'HEAD']);
  const { stdout: status } = await run('git', ['status', '--porcelain']);
  return { commit: commit.trim(), dirty: status.trim() !== '' };
}

/**
 * Writes one line of progress for a finished case.
 * @param {import('../eval/index.js').RunEntry} entry - The case that finished.
 * @param {number} done - How many cases have finished.
 * @param {number} total - How many there are.
 * @returns {string} The line, ending with a line break.
 */
function progressLine({ id, score }, done, total) {
  const level = score.confidence === null ? '' : ` (${score.confidence})`;
  const verdict = score.passed ? 'passed' : 'FAILED';
  return `[${done}/${total}] ${id}: ${score.status}${level}, ${verdict}\n`;
}

/**
 * Asks the owner to confirm, because a run spends Copilot requests.
 * @param {string} question - What to ask.
 * @returns {Promise<boolean>} Whether they answered yes.
 * @throws {AppError} When there is no terminal to ask on.
 */
async function confirm(question) {
  if (!process.stdin.isTTY) {
    throw new AppError(
      'There is no terminal to ask for confirmation on. Pass --yes to start without asking.',
    );
  }
  const prompt = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return /^y(es)?$/i.test((await prompt.question(question)).trim());
  } finally {
    prompt.close();
  }
}

/**
 * Runs the eval set through the real pipeline, one case at a time, and writes the results and a
 * summary to `eval/results/<time>/`. Press Ctrl+C to stop: the current question is cancelled and
 * what has finished is still written.
 */
async function main() {
  try {
    const args = parseEvalArguments(process.argv.slice(2));
    const settings = loadSettings();
    const { config, logger } = settings;
    const roles = await loadRoles();
    const all = await loadCases({ roles });
    const cases = selectCases(all, {
      subset: args.subset,
      ids: args.ids,
      caseId: args.caseId,
      role: args.role,
    });
    assertRunnable(cases);
    const { runnable, skipped } = planRun(cases, {
      path: args.path,
      maxTurns: config.conversation.maxTurns,
    });
    if (runnable.length === 0) {
      throw new EvalError(
        'Every case chosen has several turns; run them with --path conversation.',
      );
    }
    if (skipped.length > 0) {
      process.stderr.write(
        `Left out, because they have several turns (use --path conversation): ${skipped.join(', ')}.\n`,
      );
    }
    const estimate = estimateRequests(runnable, roles);
    process.stderr.write(
      `${runnable.length} cases from ${EVAL_FILE}, asked as ${args.path === 'conversation' ? 'conversations' : 'single questions'}. Expected Copilot requests: about ${estimate.expected}, at most ${estimate.worstCase}.\n`,
    );
    if (args.maxRequests !== undefined) {
      process.stderr.write(`It will stop starting new cases after ${args.maxRequests} requests.\n`);
    }
    if (!args.yes && !(await confirm('Start? (y/N) '))) {
      process.stderr.write('Cancelled. Nothing was asked.\n');
      return;
    }
    const controller = new AbortController();
    process.once('SIGINT', () => controller.abort());
    const startedAt = new Date();
    const result = await withCopilot(settings, async ({ client, workingDirectory }) => {
      const info = await collectRunInfo({ git: gitState, roles, config });
      const clock = { now: () => Date.now() };
      const store = createConversationStore({
        clock,
        limits: {
          maxTurns: config.conversation.maxTurns,
          maxSourceChars: config.conversation.maxSourceChars,
          idleMinutes: config.conversation.idleMinutes,
        },
        closeSession: createSessionCloser(logger),
        newId: randomUUID,
      });
      const runner = createConversationRunner({
        client,
        workingDirectory,
        config,
        logger,
        clock,
        endConversation: (conversation, reason) => store.end(conversation, reason),
      });
      const outcome = await runEval({
        cases: runnable,
        roles,
        path: args.path,
        startConversation: createConversationPath({ store, runner }),
        ask: (input) => askQuestion(input, { client, workingDirectory, config, logger }),
        guard: createRequestGuard(args.maxRequests),
        clock,
        maxToolCalls: config.mcp.maxToolCalls,
        secrets: listSecrets(config),
        signal: controller.signal,
        onCase: (entry, done, total) => process.stderr.write(progressLine(entry, done, total)),
      });
      await store.close();
      return { info, outcome };
    });
    const header = {
      ...result.info,
      models: modelsSeen(result.outcome.entries),
      path: args.path,
      startedAt: startedAt.toISOString(),
      requests: result.outcome.requests,
      interrupted: result.outcome.interrupted,
    };
    const folder = join(RESULTS_DIRECTORY, runFolderName(startedAt));
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, RESULTS_FILE), formatResults(header, result.outcome.entries));
    const summary = formatSummary({
      run: header,
      entries: result.outcome.entries,
      summary: summarise(result.outcome.entries.map(({ score }) => score)),
    });
    await writeFile(join(folder, SUMMARY_FILE), summary);
    process.stdout.write(`${summary}\nWritten to ${folder}\n`);
  } catch (error) {
    if (!(error instanceof AppError)) {
      throw error;
    }
    process.stderr.write(`${describeError(error)}\n`);
    process.exitCode = EXIT_FAILURE;
  }
}

await main();
