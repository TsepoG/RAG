// @ts-check
import { defineConfig } from 'vitest/config';

const LIVE_TIMEOUT_MS = 180_000;

// A tool config file is the one place a default export is allowed (CODING_PRINCIPLES §3).
// Live tests call the real Copilot, Confluence and GitHub, so they run only through
// `npm run test:live` and are left out of `npm test` and CI. They need a filled-in .env.
export default defineConfig({
  test: {
    include: ['test/live/**/*.live.test.js'],
    testTimeout: LIVE_TIMEOUT_MS,
    hookTimeout: LIVE_TIMEOUT_MS,
    // One Copilot runtime at a time keeps the rate limits and the output readable.
    fileParallelism: false,
  },
});
