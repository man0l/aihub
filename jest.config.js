/**
 * Jest configuration for TypeScript tests with ES Modules
 * 
 * This configuration file is set up to run TypeScript tests as ES Modules,
 * which is the primary implementation pattern for this project.
 */
export default {
  testEnvironment: 'node',
  testMatch: ['**/*.test.ts'],
  moduleFileExtensions: ['js', 'ts'],
  extensionsToTreatAsEsm: ['.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      useESM: true,
      tsconfig: 'tsconfig.test.json'
    }]
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1'
  },
  transformIgnorePatterns: ['/node_modules/'],
  verbose: true,
  collectCoverage: false,
  clearMocks: true,
  resetMocks: false
}; 