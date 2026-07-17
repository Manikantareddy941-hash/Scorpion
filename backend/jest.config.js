module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    testMatch: ['**/*.test.ts'],
    // First test in a suite pays the ts-jest compile cost; under full parallel
    // load that can blow the 5s default and flake (seen in policyRoutes).
    testTimeout: 30000,
};
