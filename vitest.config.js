// @ts-check
import { defineConfig } from 'vitest/config';

const COVERAGE_THRESHOLD = 90;

// A tool config file is the one place a default export is allowed (CODING_PRINCIPLES §3).
export default defineConfig({
  test: {
    include: ['test/**/*.test.js'],
    // Live tests call real services; `npm run test:live` runs them with vitest.live.config.js.
    exclude: ['test/live/**', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      // Listing src explicitly makes files that no test imports count as uncovered.
      include: ['src/**/*.js', 'public/js/**/*.js'],
      // Entry-point wiring only: src/server/index.js and the src/cli commands load .env, call the tested
      // units, do the network or disk I/O they cannot fake, and exit. Excluding them is the one
      // exception CODING_PRINCIPLES §6 allows; sonar.coverage.exclusions mirrors it.
      // public/js/main.js is the same kind of file: it wires the tested page modules to the DOM
      // events and the network, and is checked by hand and by the live test.
      // scripts/ is tooling run by hand (npm run screenshots): it drives a real browser against the
      // app, and is neither part of the product nor run in CI. It is outside `include`; it is named
      // here so the rule is written down.
      exclude: ['src/server/index.js', 'src/cli/**', 'public/js/main.js', 'scripts/**'],
      // lcov feeds SonarQube; json-summary feeds the CI job summary.
      reporter: ['text', 'lcov', 'html', 'json-summary'],
      reportsDirectory: 'coverage',
      thresholds: {
        lines: COVERAGE_THRESHOLD,
        branches: COVERAGE_THRESHOLD,
        functions: COVERAGE_THRESHOLD,
        statements: COVERAGE_THRESHOLD,
      },
    },
  },
});
