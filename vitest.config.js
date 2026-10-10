// @ts-check
import { defineConfig } from 'vitest/config';

const COVERAGE_THRESHOLD = 90;

// A tool config file is the one place a default export is allowed (CODING_PRINCIPLES §3).
export default defineConfig({
  test: {
    include: ['test/**/*.test.js'],
    coverage: {
      provider: 'v8',
      // Listing src explicitly makes files that no test imports count as uncovered.
      include: ['src/**/*.js'],
      // Entry-point wiring only: it loads .env, calls the tested units and exits. Excluding it is
      // the one exception CODING_PRINCIPLES §6 allows; sonar.coverage.exclusions mirrors it.
      exclude: ['src/index.js'],
      reporter: ['text', 'lcov', 'html'],
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
