module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleNameMapper: { '^@home-kitchen/shared$': '<rootDir>/../shared/src/index.ts' },
  setupFiles: ['<rootDir>/src/__tests__/setupEnv.ts'],
  testTimeout: 40000,
};
