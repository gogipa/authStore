// 단위 테스트(src/**/*.spec.ts). ESM(Nest 12)이라 ts-jest ESM 모드 + --experimental-vm-modules로 돈다.
/** @type {import('jest').Config} */
module.exports = {
  rootDir: 'src',
  testEnvironment: 'node',
  testRegex: '.*\\.spec\\.ts$',
  moduleFileExtensions: ['ts', 'js', 'json'],
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  transform: {
    '^.+\\.ts$': ['ts-jest', { useESM: true, tsconfig: '<rootDir>/../tsconfig.json' }],
  },
  collectCoverageFrom: ['**/*.ts', '!generated/**', '!main.ts', '!openapi-export.ts'],
  coverageDirectory: '../coverage',
};
