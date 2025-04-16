import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'js'],
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      useESM: true,
      tsconfig: {
        esModuleInterop: true
      }
    }],
  },
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  setupFilesAfterEnv: ['./jest.setup.ts'],
  testMatch: ['**/*.test.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/', 'server.test.ts'],
  collectCoverage: true,
  collectCoverageFrom: [
    '../routes/**/*.ts',
    '../middleware/**/*.ts',
    '!../**/*.d.ts',
    '!../tests/**/*.ts',
  ],
  coverageDirectory: '../coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  verbose: true,
};

export default config; 