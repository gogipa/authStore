// e2e 테스트(test/**/*.e2e-spec.ts). autostore_test DB(TEST_DATABASE_URL)에 붙는다.
/** @type {import('jest').Config} */
module.exports = {
  rootDir: '..',
  testEnvironment: 'node',
  testRegex: 'test/.*\\.e2e-spec\\.ts$',
  moduleFileExtensions: ['ts', 'js', 'json'],
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  transform: {
    '^.+\\.ts$': ['ts-jest', { useESM: true, tsconfig: '<rootDir>/tsconfig.json' }],
  },
  globalSetup: '<rootDir>/test/global-setup.cjs',
  setupFiles: ['<rootDir>/test/setup-env.cjs'],
  setupFilesAfterEnv: ['<rootDir>/test/cleanup-data-dir.cjs'],
  testTimeout: 30000,
};
