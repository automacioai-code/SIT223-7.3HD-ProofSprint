'use strict';

module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.js'],
  collectCoverageFrom: ['src/**/*.js', '!src/server.js'],
  coverageDirectory: 'coverage',
  coverageReporters: ['text-summary', 'lcov', 'cobertura', 'json-summary'],
  // Quality gate for the Test stage: the build fails if coverage drops below these thresholds.
  coverageThreshold: {
    global: { statements: 85, lines: 85, functions: 85, branches: 75 },
  },
};
