// @ts-check
// Takes the page's screenshots with fixture data, next to the approved mockups, so the two can be
// compared without asking Copilot anything. Run by hand with `npm run screenshots`; it is tooling,
// not part of the application, and CI does not run it.
import { mkdir, readFile, rm } from 'node:fs/promises';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { loadConfig } from '../src/config/index.js';
import { createLogger } from '../src/logger/index.js';
import { loadRoles } from '../src/roles/index.js';
import { createAnswerMemory } from '../src/server/answers.js';
import { buildApp } from '../src/server/app.js';
import { listStaticFiles } from '../src/server/static.js';
import { validEnv } from '../test/helpers/env.js';
import {
  ACTIONS,
  CONVERSATION_ID,
  IN_PROGRESS_EVENTS,
  IN_PROGRESS_QUESTION,
  NOW,
  ROLE_ID,
  STATES,
  WIDTHS,
} from './screenshotScenarios.js';

/** A port the real server (3000) is unlikely to be using; the server's Host check is set to match. */
const PORT = 3917;
const HOST = '127.0.0.1';
const ORIGIN = `http://${HOST}:${PORT}`;

/** How tall the window is at each width. */
/** @type {Readonly<Record<number, number>>} */
const HEIGHTS = Object.freeze({ [WIDTHS.desktop]: 900, [WIDTHS.phone]: 844 });

/** How many questions the fixture conversation allows, as the page shows it. */
const MAX_TURNS = 5;

/** How long to let the page settle after it has drawn, in ms. */
const SETTLE_MS = 150;

const PUBLIC_DIRECTORY = fileURLToPath(new URL('../public', import.meta.url));
const MOCKUP_DIRECTORY = fileURLToPath(new URL('../docs/design/phase-8', import.meta.url));
const OUTPUT_DIRECTORY = fileURLToPath(new URL('../.screenshots', import.meta.url));

/** The fonts the mockups ask Google for, mapped to the files this app serves itself. */
const FONT_FACES = Object.freeze([
  ['Geist', 400, 'Geist-Regular'],
  ['Geist', 500, 'Geist-Medium'],
  ['Geist', 600, 'Geist-SemiBold'],
  ['Geist', 700, 'Geist-Bold'],
  ['Geist Mono', 400, 'GeistMono-Regular'],
  ['Geist Mono', 500, 'GeistMono-Medium'],
]);

/**
 * Stands in for the parts of the app that would ask Copilot or write a file.
 * @returns {Promise<never>} Never; it throws.
 * @throws {Error} Always, because nothing in a screenshot run may reach them.
 */
async function refuse() {
  throw new Error('The screenshot server must not ask a question or save feedback.');
}

/**
 * Answers a question with a stream that sends some events and then stays open, which the page shows
 * as an answer in progress. The app's own stream cannot do this without asking Copilot.
 * @param {import('fastify').FastifyRequest} _request - The request, unused.
 * @param {import('fastify').FastifyReply} reply - The reply to stream into.
 */
function streamThatStaysOpen(_request, reply) {
  reply.hijack();
  reply.raw.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' });
  for (const { event, data } of IN_PROGRESS_EVENTS) {
    reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }
}

/**
 * Starts the real server, with its guards, headers, files and roles, but nothing that reaches
 * Copilot, Confluence or GitHub.
 * @returns {Promise<import('fastify').FastifyInstance>} The running server.
 */
async function startServer() {
  const silent = new Writable({
    write(_chunk, _encoding, done) {
      done();
    },
  });
  const app = buildApp({
    config: loadConfig(validEnv({ PORT: String(PORT) })),
    roles: await loadRoles(),
    ask: refuse,
    answers: createAnswerMemory(),
    saveFeedback: refuse,
    staticFiles: await listStaticFiles(PUBLIC_DIRECTORY),
    logger: createLogger({ level: 'silent', destination: silent }),
  });
  app.post('/api/conversations/:id/messages', streamThatStaysOpen);
  await app.listen({ host: HOST, port: PORT });
  return app;
}

/**
 * Makes the fake server's replies for one state of the page. Anything the page asks for that this
 * state does not expect is refused and remembered, so a wrong call is never silent.
 * @param {import('./screenshotScenarios.js').State} state - The state.
 * @param {string[]} unexpected - Where calls nobody expected are written down.
 * @returns {(route: import('playwright').Route) => Promise<void>} The handler for `/api/**`.
 */
function fakeApi(state, unexpected) {
  const conversationPath = `/api/conversations/${CONVERSATION_ID}`;
  return async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const method = request.method();
    if (pathname === '/api/roles') {
      await route.continue();
    } else if (method === 'POST' && pathname === '/api/conversations') {
      await route.fulfill({ json: { conversationId: CONVERSATION_ID, maxTurns: MAX_TURNS } });
    } else if (method === 'GET' && pathname === conversationPath && state.transcript !== null) {
      await route.fulfill({ json: state.transcript });
    } else if (
      method === 'POST' &&
      pathname === `${conversationPath}/messages` &&
      state.action === ACTIONS.ask
    ) {
      await route.continue();
    } else {
      unexpected.push(`${method} ${pathname}`);
      await route.abort();
    }
  };
}

/**
 * Opens a window of one width, with the clock fixed, the role chosen, and, when the state has a
 * conversation, that conversation remembered as if the page had been reloaded.
 * @param {import('playwright').Browser} browser - The browser.
 * @param {number} width - The window's width.
 * @param {boolean} remembersConversation - Whether the conversation is remembered.
 * @returns {Promise<import('playwright').BrowserContext>} The window.
 */
async function openContext(browser, width, remembersConversation) {
  const context = await browser.newContext({
    viewport: { width, height: HEIGHTS[width] },
    reducedMotion: 'reduce',
  });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ORIGIN });
  await context.clock.setFixedTime(NOW);
  // A script as text, because it runs in the page, where the storage is the browser's.
  const remember = [
    `localStorage.setItem('role-aware-assistant.role', ${JSON.stringify(ROLE_ID)});`,
    remembersConversation
      ? `sessionStorage.setItem('role-aware-assistant.conversation', ${JSON.stringify(CONVERSATION_ID)});`
      : '',
  ].join(' ');
  await context.addInitScript({ content: remember });
  return context;
}

/**
 * Waits until the page has drawn what the state starts with.
 * @param {import('playwright').Page} page - The page.
 * @param {import('./screenshotScenarios.js').State} state - The state.
 */
async function waitForDrawn(page, state) {
  await page
    .locator(state.transcript === null ? '#welcome h2' : '#messages > li')
    .first()
    .waitFor();
}

/**
 * Does what the state needs done to the page before it is photographed.
 * @param {import('playwright').Page} page - The page.
 * @param {import('./screenshotScenarios.js').State} state - The state.
 */
async function act(page, state) {
  if (state.action === ACTIONS.openSources) {
    await page.locator('.sources__toggle').last().click();
    await page.locator('.sources__toggle[aria-expanded="true"]').waitFor();
  } else if (state.action === ACTIONS.ask) {
    await page.locator('#question').fill(IN_PROGRESS_QUESTION);
    await page.locator('.composer__send').click();
    await page.locator('.progress__draft').waitFor();
  } else if (state.action === ACTIONS.copy) {
    await page.locator('#sidebar [data-action="copy-conversation"]').click();
    await page.locator('.toast:not([hidden])').waitFor();
  } else if (state.action === ACTIONS.openDrawer) {
    await page.locator('.topbar__menu').click();
    await page.locator('#sidebar.is-open').waitFor();
  }
}

/**
 * Makes the window as tall as the page, so that a sticky sidebar and question box sit where they do
 * at the top and bottom of a long page, as in a mockup, instead of wherever a full-page capture
 * leaves them.
 * @param {import('playwright').Page} page - The page.
 */
async function fitToPage(page) {
  const size = page.viewportSize();
  const height = await page.evaluate(() =>
    Math.max(globalThis.document.documentElement.scrollHeight, globalThis.innerHeight),
  );
  await page.setViewportSize({ width: size?.width ?? 0, height });
  await page.evaluate(() => globalThis.scrollTo(0, 0));
}

/**
 * Lets the fonts load and the page stop moving, then photographs it.
 * @param {import('playwright').Page} page - The page.
 * @param {string} file - The file to write.
 * @param {boolean} wholePage - Whether to photograph the whole page rather than what is on screen.
 */
async function photograph(page, file, wholePage) {
  await page.evaluate(() => globalThis.document.fonts.ready);
  if (wholePage) {
    await fitToPage(page);
  }
  await page.waitForTimeout(SETTLE_MS);
  await page.screenshot({ path: file, animations: 'disabled' });
  process.stdout.write(`${file}
`);
}

/**
 * Photographs the app in one state at one width.
 * @param {import('playwright').Browser} browser - The browser.
 * @param {import('./screenshotScenarios.js').State} state - The state.
 * @param {number} width - The width.
 * @returns {Promise<void>} Resolves once the file is written.
 * @throws {Error} When the page asked the fake server for something the state does not expect.
 */
async function captureApp(browser, state, width) {
  const context = await openContext(browser, width, state.transcript !== null);
  try {
    /** @type {string[]} */
    const unexpected = [];
    await context.route('**/api/**', fakeApi(state, unexpected));
    const page = await context.newPage();
    await page.goto(`${ORIGIN}/`);
    await waitForDrawn(page, state);
    await act(page, state);
    await photograph(
      page,
      `${OUTPUT_DIRECTORY}/${state.name}-${width}-app.png`,
      state.viewportOnly !== true,
    );
    if (unexpected.length > 0) {
      throw new Error(`${state.name} at ${width}: unexpected calls: ${unexpected.join(', ')}`);
    }
  } finally {
    await context.close();
  }
}

/**
 * Photographs a mockup. It is served from the app's own origin, with the fonts it asks Google for
 * answered from this app's files, so no request leaves the machine and the fonts match.
 * @param {import('playwright').Browser} browser - The browser.
 * @param {string} name - The state's name, used in the file name.
 * @param {number} width - The width.
 * @param {string} mockup - The mockup file in docs/design/phase-8.
 * @returns {Promise<void>} Resolves once the file is written.
 */
async function captureMockup(browser, name, width, mockup) {
  const context = await openContext(browser, width, false);
  try {
    const fontCss = FONT_FACES.map(
      ([family, weight, file]) =>
        `@font-face{font-family:'${family}';font-weight:${weight};font-style:normal;font-display:block;src:url(${ORIGIN}/fonts/${file}.woff2) format('woff2');}`,
    ).join('\n');
    await context.route('https://fonts.googleapis.com/**', (route) =>
      route.fulfill({ contentType: 'text/css', body: fontCss }),
    );
    await context.route(`${ORIGIN}/__mockup/*.html`, async (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: await readFile(`${MOCKUP_DIRECTORY}/${mockup}`, 'utf8'),
      }),
    );
    const page = await context.newPage();
    await page.goto(`${ORIGIN}/__mockup/${mockup}`);
    await photograph(page, `${OUTPUT_DIRECTORY}/${name}-${width}-mockup.png`, true);
  } finally {
    await context.close();
  }
}

/** Photographs every state of the app and every mockup, into `.screenshots/`. */
async function main() {
  await rm(OUTPUT_DIRECTORY, { recursive: true, force: true });
  await mkdir(OUTPUT_DIRECTORY, { recursive: true });
  const server = await startServer();
  const browser = await chromium.launch();
  try {
    for (const state of STATES) {
      for (const width of state.widths) {
        await captureApp(browser, state, width);
        const mockup = state.mockups[width];
        if (mockup !== undefined) {
          await captureMockup(browser, state.name, width, mockup);
        }
      }
    }
  } finally {
    await browser.close();
    await server.close();
  }
}

try {
  await main();
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
}
