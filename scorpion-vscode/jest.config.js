module.exports = {
  testEnvironment: 'node',
  // extension.ts and the commands/* and sidebarProvider.ts/scorpionClient.ts files
  // import the `vscode` module, which only exists inside a running VS Code host -
  // it can't be required under plain Jest. Only pure-Node modules are unit tested
  // here; the vscode-dependent glue is exercised manually/by VS Code's own test harness.
  testPathIgnorePatterns: ['/node_modules/', '/out/'],
  testMatch: ['**/src/**/*.test.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.test.json' }],
  },
};
