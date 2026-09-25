'use strict';

const js = require('@eslint/js');
const globals = require('globals');
const security = require('eslint-plugin-security');

/**
 * Code-health rules used as a custom quality profile (the report is also imported into SonarQube):
 * complexity and size limits keep functions small and maintainable.
 */
module.exports = [
  { ignores: ['node_modules/**', 'coverage/**', 'reports/**', 'monitoring/grafana/**'] },
  js.configs.recommended,
  security.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'commonjs', globals: { ...globals.node } },
    rules: {
      complexity: ['error', 10],
      'max-depth': ['error', 3],
      'max-params': ['error', 4],
      'max-lines-per-function': ['warn', { max: 70, skipBlankLines: true, skipComments: true }],
      'max-lines': ['warn', { max: 250, skipBlankLines: true, skipComments: true }],
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-console': 'off',
      // Documented false positive: every object key used in this codebase comes from a fixed map
      // or a validated id, never from raw user input (see security/triage.json).
      'security/detect-object-injection': 'off',
    },
  },
  {
    // Pipeline tooling and the alert notifier run only on the Jenkins agent, with paths that come
    // from the repository and Jenkins configuration (never from user input).
    files: ['ci/**/*.js', 'monitoring/**/*.js'],
    rules: { 'security/detect-non-literal-fs-filename': 'off', 'security/detect-non-literal-require': 'off' },
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: { globals: { ...globals.jest } },
    rules: { 'max-lines-per-function': 'off', 'max-lines': 'off', 'security/detect-non-literal-fs-filename': 'off' },
  },
  {
    files: ['public/**/*.js'],
    languageOptions: { sourceType: 'script', globals: { ...globals.browser } },
  },
];
