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
  ignoreBinaries: [
    // graphviz binary used by depcruise:graph script
    "dot",
    // run via npx in duplication script
    "jscpd",
  ],
};

export default config;
