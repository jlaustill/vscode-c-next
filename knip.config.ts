import type { KnipConfig } from "knip";

const config: KnipConfig = {
  entry: [".vscode-test.mjs", "src/test/**/*.ts"],
  project: ["src/**/*.ts"],
  ignore: ["src/__mocks__/**"],
  ignoreDependencies: [
    // Virtual module provided by VS Code runtime, not a real npm package
    "@types/vscode",
    // Used by .vscode-test.mjs runner (knip doesn't trace it)
    "@vscode/test-electron",
    "@types/mocha",
    "mocha",
  ],
};

export default config;
