module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    testMatch: ['**/*.test.ts'],
    moduleNameMapper: {
        '^@kubernetes/client-node$': '<rootDir>/src/__mocks__/@kubernetes/client-node.js',
    },
};
