import { defineConfig } from "@vscode/test-cli";
import path from "path";

export default defineConfig({
  files: "out/test/**/*.test.js",
  workspaceFolder: path.resolve("src/test/fixtures/sample-workspace"),
  mocha: { ui: "tdd", timeout: 30000 },
  launchArgs: ["--disable-extensions"],
});
