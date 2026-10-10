// @ts-check
import js from '@eslint/js';
import vitest from '@vitest/eslint-plugin';
import prettier from 'eslint-config-prettier';
import jsdoc from 'eslint-plugin-jsdoc';
import n from 'eslint-plugin-n';
import sonarjs from 'eslint-plugin-sonarjs';
import globals from 'globals';

const SRC_FILES = ['src/**/*.js'];
const TEST_FILES = ['test/**/*.js'];

// Only src/config may read process.env (CODING_PRINCIPLES §3); everything else receives config.
const PROCESS_ENV_RULE = [
  'error',
  {
    object: 'process',
    property: 'env',
    message: 'Read settings through loadConfig() from src/config instead of process.env.',
  },
];

// A tool config file is the one place a default export is allowed (CODING_PRINCIPLES §3).
export default [
  { ignores: ['coverage/**', 'node_modules/**', '.scannerwork/**', 'reports/**'] },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
    },
  },
  { ...jsdoc.configs['flat/recommended-error'], files: SRC_FILES },
  {
    files: SRC_FILES,
    rules: {
      'jsdoc/require-jsdoc': [
        'error',
        {
          publicOnly: true,
          require: {
            FunctionDeclaration: true,
            ClassDeclaration: true,
            MethodDefinition: true,
            ArrowFunctionExpression: true,
            FunctionExpression: true,
          },
          contexts: ['ExportNamedDeclaration > VariableDeclaration'],
        },
      ],
      'no-console': 'error',
    },
  },
  sonarjs.configs.recommended,
  n.configs['flat/recommended-module'],
  { ...vitest.configs.recommended, files: TEST_FILES },
  {
    ignores: ['src/config/**'],
    rules: { 'no-restricted-properties': PROCESS_ENV_RULE },
  },
  prettier,
];
